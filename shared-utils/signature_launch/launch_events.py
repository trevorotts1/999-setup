#!/usr/bin/env python3
"""Launch event emitter: one run event per launch step, never a launch failure.

Skill 83 (dispatch / assemble / check) and Skill 49 (dispatch_launch) call
``emit(skill, launch_id, event)`` so a launch is visible in the Command Center.
Events use the frozen Skill 71 run-events contract plus the two launch fields
``skill`` and ``launch_id`` (CC: src/lib/launch-run-events.ts) and are POSTed to
the CC launch ingest (``/api/launch-runs/ingest``) with the per-client token.

NON-BLOCKING: ``emit`` never raises and never waits long. Any failure (no URL,
no token, refused connection, timeout, HTTP error, a bad event) appends the
event to a JSONL spool on disk instead; the next successful ``emit`` (or an
explicit ``drain``) replays it, oldest first. A CC outage never fails a launch.

Environment (names only; values are never printed or logged):
  LAUNCH_EVENTS_URL          full ingest URL; else COMMAND_CENTER_URL /
                             MISSION_CONTROL_URL + /api/launch-runs/ingest
  LAUNCH_EVENTS_TOKEN_FILE   file holding the per-client bearer token; else
                             SKILL71_RUNS_SHIP_TOKEN_FILE (the Skill 71 shipper's
                             token file, same ingest token store); else
                             CC_API_TOKEN / MC_API_TOKEN
  LAUNCH_EVENTS_SPOOL        spool directory (default
                             ~/.openclaw/data/signature-launch/events-spool)
  LAUNCH_EVENTS_TIMEOUT      per-request seconds (default 3)
  LAUNCH_EVENTS_HOST_SHAPE   fleet-mac | fleet-hostinger | fleet-contabo, only
                             stamped on run_initialized (default fleet-mac)
  LAUNCH_EVENTS_INSTALLATION_ID
                             this installation's id. Emitted as `installation_id`
                             and folded into the derived run_id. It MUST equal the
                             Command Center's own MC_INSTALLATION_ID for this box;
                             when it is unset the field is omitted and the CC
                             stamps its own, which is why a value is never guessed.
  LAUNCH_EVENTS_PLAN_REVISION
                             the approved plan revision integer, folded into the
                             derived run_id when supplied.
  LAUNCH_EVENTS_PLAN_HASH    the approved plan_document_hash, folded into the
                             derived run_id when supplied.

F23 (governed launch evidence consumed by the Command Center):
  * run identity is skill + launch + installation + approved plan revision/hash,
    so a re-planned launch is a NEW run instead of a colliding one, and a second
    client using the same human-friendly launch slug cannot land in the first
    client's run. Without any identity input the legacy skill:launch derivation
    is kept, so events already spooled on a box replay under their original id.
  * a CC response that rejected the item (`delivery_failures`, or a `rejected`
    count, or a `results[].status` of `rejected`) is a DELIVERY FAILURE: it moves
    to the rejected spool and is never counted as sent.
  * the spool's read-modify-write is serialised with an exclusive lock, so
    concurrent producers cannot drop or duplicate a queued event.

Pure stdlib.
"""
from __future__ import annotations

import contextlib
import json
import os
import sys
import threading
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = "1.0"
INGEST_PATH = "/api/launch-runs/ingest"
SPOOL_FILE = "launch-events.jsonl"
REJECTED_FILE = "launch-events.rejected.jsonl"
LOCK_FILE = "launch-events.lock"
# One launch of one skill is one CC run: run_id is derived, so every event of a
# launch carries the same run_id without any shared state between processes.
_RUN_NS = uuid.UUID("6f0c1c1e-83a4-49b0-8f6e-7a1c0de5eed1")
# Same-process producers serialise on this before the file lock, so a re-entrant
# spool call inside one process cannot block itself.
_IN_PROCESS_LOCK = threading.RLock()

# The agreed stage vocabulary (F23.12), version 2 — the same version the Command
# Center registers in LAUNCH_STAGE_VOCABULARY_VERSION. The CC scores one
# CANONICAL stage order per launch ability; a producer spelling that differs is
# translated HERE, before the event leaves the box, so the evidence is accepted
# instead of arriving as an unknown stage the CC can only report as a delivery
# failure.
#
#   83 `check`      -> `checks`      Skill 83 cmd_check's singular spelling.
#   49 `dispatch`   -> `page_dispatch`
#       Skill 49's dispatcher names the page-dispatch stage `dispatch`; the
#       registry names it `page_dispatch`. Its per-page `item_closed` /
#       `item_blocked` events carry the same `dispatch`, and the registry's
#       page stages are `page_dispatch` / `page_results`, so both spellings of
#       the producing stage resolve to the one registered stage.
#
# A stage in neither list is passed through UNCHANGED on purpose: an
# unregistered stage must stay visible as a delivery failure, never be silently
# renamed into some other stage. A new producer spelling is added here (and this
# version bumped) together with the CC registration that accepts it.
STAGE_VOCABULARY_VERSION = 2
STAGE_ALIASES = {
    83: {"check": "checks"},
    49: {"dispatch": "page_dispatch"},
}

# Producer FIELD spellings the frozen run-events contract names differently.
# Skill 49's dispatcher writes `{"event_type": "item_closed", "item": <lane>}`;
# the contract — and therefore the Command Center — names the field `item_id`,
# and refuses the whole event for both an unknown field and a missing `item_id`.
# Translated here, at the only place every launch event passes through, so the
# emitting skills keep their own vocabulary and the wire stays the contract's.
FIELD_ALIASES = {"item": "item_id"}


def _now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _log(msg):
    print("[launch_events] %s" % msg, file=sys.stderr, flush=True)


def _token(env):
    direct = (env.get("CC_API_TOKEN") or env.get("MC_API_TOKEN") or "").strip()
    path = env.get("LAUNCH_EVENTS_TOKEN_FILE") or env.get("SKILL71_RUNS_SHIP_TOKEN_FILE")
    if path:
        try:
            return Path(path).read_text(encoding="utf-8").strip()
        except OSError:
            return direct
    return direct


def _url(env):
    explicit = (env.get("LAUNCH_EVENTS_URL") or "").strip()
    if explicit:
        return explicit
    base = (env.get("COMMAND_CENTER_URL") or env.get("MISSION_CONTROL_URL") or "").strip().rstrip("/")
    return base + INGEST_PATH if base else ""


def _spool_dir(env):
    explicit = (env.get("LAUNCH_EVENTS_SPOOL") or "").strip()
    if explicit:
        return Path(explicit)
    return Path(env.get("HOME") or os.path.expanduser("~")) / ".openclaw" / "data" / \
        "signature-launch" / "events-spool"


def _int_or_none(value):
    """An int identity component, or None. Never raises on a stray env value."""
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def run_id_for(skill, launch_id, installation_id="", plan_revision=None, plan_hash=""):
    """The run id for one launch of one skill (F23.2).

    With no identity input this is the legacy derivation, byte for byte, so an
    event already sitting in a box's spool replays under the id it was queued
    with. With any of installation / plan revision / plan hash supplied the id
    also binds those, because the wire contract carries none of them as a field:
    the approved-plan binding can only travel as part of the run identity. That is
    what stops a re-planned launch, or a second client reusing the same launch
    slug, from landing in an existing run (the CC now refuses a mismatched
    rebind, so a collision would silently lose the launch instead).
    """
    key = "%s:%s" % (int(skill), launch_id)
    revision = _int_or_none(plan_revision)
    if installation_id or revision is not None or plan_hash:
        key = "%s:%s:%s:%s" % (key, installation_id or "",
                               "" if revision is None else revision, plan_hash or "")
    return str(uuid.uuid5(_RUN_NS, key))


def _identity(env, installation_id, plan_revision, plan_hash):
    """The identity inputs: the caller's value wins, the environment is the default."""
    if installation_id is None:
        installation_id = (env.get("LAUNCH_EVENTS_INSTALLATION_ID") or "").strip()
    if plan_revision is None:
        plan_revision = env.get("LAUNCH_EVENTS_PLAN_REVISION")
    if plan_hash is None:
        plan_hash = (env.get("LAUNCH_EVENTS_PLAN_HASH") or "").strip()
    return (installation_id or "").strip(), _int_or_none(plan_revision), (plan_hash or "").strip()


def build_event(skill, launch_id, event, env=None,
                installation_id=None, plan_revision=None, plan_hash=None):
    """Complete a caller's event into a contract-shaped launch run event.

    ``event`` is a dict with at least ``event_type``, or a plain stage name
    (shorthand for a passing ``stage_closed``). Caller fields always win.

    ``installation_id`` / ``plan_revision`` / ``plan_hash`` default to the
    LAUNCH_EVENTS_* environment values; pass them explicitly for a process that
    runs more than one launch, where the environment cannot carry per-launch
    facts. `installation_id` is emitted only when it is known — an absent field is
    stamped from the receiving installation's own identity, while a guess would
    contradict it and be refused.
    """
    env = os.environ if env is None else env
    if isinstance(event, str):
        event = {"event_type": "stage_closed", "stage": event}
    installation_id, plan_revision, plan_hash = _identity(
        env, installation_id, plan_revision, plan_hash)
    now = _now()
    out = dict(event)
    out["skill"] = int(skill)
    out["launch_id"] = str(launch_id)
    if installation_id:
        out.setdefault("installation_id", installation_id)
    out.setdefault("event_id", str(uuid.uuid4()))
    out.setdefault("run_id", run_id_for(skill, launch_id, installation_id,
                                        plan_revision, plan_hash))
    out.setdefault("schema_version", SCHEMA_VERSION)
    out.setdefault("emitted_at", now)
    stage = out.get("stage")
    if isinstance(stage, str):
        canonical = STAGE_ALIASES.get(int(skill), {}).get(stage)
        if canonical:
            out["stage"] = canonical
    for produced, contract in FIELD_ALIASES.items():
        if produced in out:  # the contract's own name wins when both are present
            out.setdefault(contract, out.pop(produced))
    kind = out.get("event_type")
    if kind == "run_initialized":
        out.setdefault("host_shape", env.get("LAUNCH_EVENTS_HOST_SHAPE") or "fleet-mac")
    elif kind == "stage_closed":
        out.setdefault("receipt_status", "pass")
        out.setdefault("closed_at", now)
    elif kind == "stage_blocked":
        out.setdefault("failures", [])
        out.setdefault("blocked_at", now)
    elif kind == "item_closed":
        out.setdefault("closed_at", now)
    elif kind == "item_blocked":
        out.setdefault("failures", [])
        out.setdefault("blocked_at", now)
    return out


def _post(url, token, events, timeout):
    """POST one batch. Returns (HTTP status, parsed JSON payload or None).

    Raises only network errors. The payload is read because the Command Center
    reports a rejected item in the BODY of a 200 response (F23.12): a caller that
    only looked at the status would count a refused stage as synchronized.
    """
    req = urllib.request.Request(
        url, data=json.dumps({"events": events}).encode("utf-8"), method="POST",
        headers={"Content-Type": "application/json"})
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            try:
                payload = json.loads(raw.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                payload = None
            return resp.status, payload if isinstance(payload, dict) else None
    except urllib.error.HTTPError as exc:
        return exc.code, None


def _result(result):
    """(status, payload) from either a bare status or a (status, payload) pair.

    An injected transport that returns just an int keeps working: that is the
    pre-F23 shape, and no item-rejection information exists to misread from it.
    """
    if isinstance(result, tuple):
        status = result[0] if result else None
        payload = result[1] if len(result) > 1 else None
    else:
        status, payload = result, None
    return status, payload if isinstance(payload, dict) else None


def _rejection_codes(payload):
    """Codes when the CC answered 2xx but REJECTED this item; [] when accepted.

    Three shapes are read because the transport lists a rejected item more than
    once (F23.12): the `delivery_failures` list, the per-item `results`, and the
    aggregate `rejected` count. Any one of them is enough to stop the item being
    counted as sent.
    """
    if not isinstance(payload, dict):
        return []
    failures = payload.get("delivery_failures")
    if isinstance(failures, list) and failures:
        codes = []
        for failure in failures:
            if isinstance(failure, dict) and isinstance(failure.get("codes"), list):
                codes.extend(str(code) for code in failure["codes"])
        return codes or ["delivery_failed"]
    results = payload.get("results")
    if isinstance(results, list):
        for item in results:
            if isinstance(item, dict) and item.get("status") == "rejected":
                codes = item.get("codes")
                return ([str(c) for c in codes] if isinstance(codes, list) else []) or ["rejected"]
    rejected = payload.get("rejected")
    if isinstance(rejected, int) and rejected > 0:
        return ["rejected"]
    return []


@contextlib.contextmanager
def _spool_lock(spool):
    """Exclusive lock around one spool read-modify-write (F23.14).

    Two producers on one box (a scheduled checkpoint and a delegated worker)
    otherwise read the same lines and each rewrite the file, dropping or
    duplicating queued events. The in-process guard makes the lock re-entrant for
    this module, because flock is per open file description and a second open of
    the same file inside the same process would deadlock.
    """
    spool.mkdir(parents=True, exist_ok=True)
    with _IN_PROCESS_LOCK:
        handle = open(spool / LOCK_FILE, "a+")
        try:
            try:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            except (ImportError, OSError):  # a platform without flock: in-process only
                pass
            yield
        finally:
            try:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
            except (ImportError, OSError):
                pass
            handle.close()


def _append(spool, event, name=SPOOL_FILE):
    """Append one line. Caller holds the spool lock."""
    spool.mkdir(parents=True, exist_ok=True)
    with open(spool / name, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(event, sort_keys=True) + "\n")


def _spool(spool, event, name=SPOOL_FILE):
    with _spool_lock(spool):
        _append(spool, event, name)


def drain(env=None, post=None):
    """Replay the spool, oldest first. Returns {"sent": n, "left": n, "rejected": n}.

    Stops at the first transient failure (order is kept). A 422 is a permanent
    contract rejection: that line moves to the rejected file, never retried. A 2xx
    whose payload rejected the item is the same permanent rejection (F23.12), and
    is never counted as sent. Never raises.
    """
    env = os.environ if env is None else env
    sent = left = rejected = 0
    try:
        spool = _spool_dir(env)
        path = spool / SPOOL_FILE
        url = _url(env)
        if not url or not path.is_file():
            return {"sent": 0, "left": _count(path), "rejected": 0}
        token, send = _token(env), post or _post
        try:
            timeout = float(env.get("LAUNCH_EVENTS_TIMEOUT") or 3)
        except ValueError:
            timeout = 3.0
        with _spool_lock(spool):
            lines = [ln for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]
            kept = []
            for i, raw in enumerate(lines):
                try:
                    status, payload = _result(send(url, token, [json.loads(raw)], timeout))
                except Exception:  # noqa: BLE001 - outage: keep this and the rest
                    kept = lines[i:]
                    break
                if 200 <= status < 300 and not _rejection_codes(payload):
                    sent += 1
                elif status == 422 or 200 <= status < 300:
                    _append(spool, json.loads(raw), REJECTED_FILE)
                    rejected += 1
                else:
                    kept = lines[i:]
                    break
            left = len(kept)
            tmp = path.with_suffix(".tmp")
            if kept:
                tmp.write_text("\n".join(kept) + "\n", encoding="utf-8")
                os.replace(tmp, path)
            else:
                path.unlink()
    except Exception as exc:  # noqa: BLE001 - the spool is never a gate
        _log("drain skipped (%s)" % type(exc).__name__)
    return {"sent": sent, "left": left, "rejected": rejected}


def _count(path):
    try:
        return len([ln for ln in Path(path).read_text(encoding="utf-8").splitlines() if ln.strip()])
    except OSError:
        return 0


def emit(skill, launch_id, event, env=None, post=None,
         installation_id=None, plan_revision=None, plan_hash=None):
    """Send one launch event to the Command Center; spool it on any failure.

    Returns {"event_id", "sent": bool, "spooled": bool, "codes": [..]}. `codes`
    is populated when the item was a DELIVERY FAILURE for the CC — refused as
    malformed or rejected — and such an event is never reported as sent. NEVER
    raises.
    """
    env = os.environ if env is None else env
    result = {"event_id": None, "sent": False, "spooled": False, "codes": []}
    try:
        body = build_event(skill, launch_id, event, env,
                           installation_id=installation_id,
                           plan_revision=plan_revision,
                           plan_hash=plan_hash)
        result["event_id"] = body["event_id"]
        url = _url(env)
        try:
            timeout = float(env.get("LAUNCH_EVENTS_TIMEOUT") or 3)
        except ValueError:
            timeout = 3.0
        if url and _count(_spool_dir(env) / SPOOL_FILE):
            # A backlog exists: queue behind it so the CC sees events oldest first.
            _spool(_spool_dir(env), body)
            replay = drain(env, post)
            result["sent"] = replay["left"] == 0
            result["spooled"] = not result["sent"]
            return result
        if url:
            try:
                status, payload = _result((post or _post)(url, _token(env), [body], timeout))
                if 200 <= status < 300 and not _rejection_codes(payload):
                    result["sent"] = True
                    return result
                if 200 <= status < 300 or status == 422:
                    # Permanent contract rejection: retrying cannot help.
                    result["codes"] = _rejection_codes(payload) or ["rejected"]
                    _log("CC rejected event %s (HTTP %s: %s); kept in rejected spool"
                         % (body["event_id"], status, ",".join(result["codes"])))
                    _spool(_spool_dir(env), body, REJECTED_FILE)
                    return result
                _log("CC ingest answered HTTP %s; spooling" % status)
            except Exception as exc:  # noqa: BLE001 - CC outage never fails a launch
                _log("CC ingest unreachable (%s); spooling" % type(exc).__name__)
        _spool(_spool_dir(env), body)
        result["spooled"] = True
    except Exception as exc:  # noqa: BLE001
        _log("emit skipped (%s: %s)" % (type(exc).__name__, exc))
    return result
