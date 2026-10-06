#!/usr/bin/env python3
"""Workflow staffing rules: the ONE implementation of the swarm-plan contract. Stdlib only.

The plan document decides how many workflows run at once and how many agents each
one has. Nothing here carries a flat per-workflow number of its own; the ceilings
(10 agents per workflow, 50 workflows, 500 agents) are maximums a plan may not exceed.
The per-workflow cap is MEASURED from the box (capacity_probe.py: RAM, cores, container limits)
and recorded in the plan as policy.max_agents_per_workflow (integer 1..10).

PLAN DISCOVERY  walking upward from cwd (max 40 levels), at each level in this order:
  (1) .spec-protocol.json key "swarmPlan" (path relative to that file),
  (2) SWARM-PLAN.json, (3) claude-nine-swarm/SWARM-PLAN.json. First hit wins.
  No plan found -> no floor; only ceilings apply.
PLAN SCHEMA     "blackceo.swarm-plan/v2": policy.max_active_workflows (1..50),
  policy.max_agents_per_workflow (int 1..10, the measured cap), policy.max_working_agents <= 500.
  Optional policy.capacity_probe {per_workflow_cap, ...}: when present its cap must equal policy.max_agents_per_workflow. Each workflow:
  workflow_id, dependencies, units [{unit_id "<WID>-U<n>", work, owned_output (repo-relative file, or directory ending "/"; no
  overlap across the plan: equal or path-prefix of another unit's owned_output is rejected), acceptance, source, verdict_file "evidence/<WID>/<unit_id>.verdict.json"}],
  agent_count = min(policy.max_agents_per_workflow, len(units)), concurrency = agent_count,
  no leftover staffing keys (builders, checkers, repair_extra_executions_max, max_total_executions) and no
  workflow-level verdict_file (removed in v2.1). Top-level status: "planned-not-running" or "running".
  Unit work text may not be "slice N of M" padding, nor repeat another unit's work text (digits, whitespace
  and case ignored) -- the same rules as swarm_plan_check.py.
DONE      a UNIT is done iff its verdict file (relative to the plan file's directory) parses as
          {"verdict":"PASS" (exactly), "unit_id": this unit, "attempt_id": an ADMITTED launch of this workflow
          recorded by the guard, "builder_model" and "reviewer_model": nonempty and of different model FAMILIES},
          AND the file's current sha256 matches a guard journal verdict record (verdict_records), which the guard
          writes only when a SUBAGENT of that admitted run Writes this very content. A file nobody journaled
          (hand-written, edited afterwards, written by the conductor) is never done.
          WHO WROTE IT / WHICH MODEL RAN (#6): the labels and models INSIDE the verdict JSON are claims, not proof. The
          run folder (<launch transcript>/subagents/workflows/<run>/) holds ground truth: journal.jsonl "started" lines
          {agentId,label,phase} and agent-<agentId>.meta.json {model}. The journal record's writer agent_id must be an
          agent labelled "qc:<unit_id>" (make-workflow emits that label; the builder is "build:<unit_id>"), and the ACTUAL
          model families (from meta.json) of that unit's builder(s) and checker must differ. A builder writing its own PASS,
          or builder and checker running the same family, is never done; unreadable run files or models -> not done.
          At launch, a script whose builder (non-QC phase) and checker (QC phase) agent() model pins share a family is refused.
          A workflow is DONE iff every one of its units is done. A plan's own "status" never decides completion.
RUNNING   the guard journal has a live launch tagged with that workflowId (and this plan).
READY     not done, not running, every dependency done, not in handback.
OWED      required_running = min(max_active_workflows, program cap, running + ready);
          owed = the first (required_running - running) ready workflows in plan order.
HANDBACK  launched 3 times (recorded) without becoming done: not owed, an alert is written. (No release path
          after admitted-then-failed launches: only handback stops the loop.)
ARMED     plan found AND its status is "running" -- the single definition. `staffing.py start --cwd DIR`
          validates the plan and sets status "running" (the build-start act); and when the guard ADMITS the
          first launch of a plan whose status is "planned-not-running" it sets status "running" itself
          (set_running), so every plan with an admitted launch is armed. (A recorded launch still pins the plan
          to the session -- resolve_plans -- but pinning is not arming.)
LAUNCH CONTRACT (check_launch) a Workflow call under a found plan must carry args.workflowId
          of a READY workflow, args.units with exactly that workflow's unit_ids, and a script
          that fans out over args.units in exactly ONE pipeline(args.units, ...) call (parallel() is refused)
          containing every agent() call, and a unique non-empty args.attemptId. The script may never run more than the
          per-workflow cap at once (min of plan cap, limits.json, plan capacity_probe).
          CONCURRENCY WINDOW (#5, "fewer agents than units is a violation"): the agents running at once must EQUAL
          min(live cap, len(units)) exactly. len(units) <= cap: the rolling window helper is FORBIDDEN (the plain
          pipeline already runs every unit at once; validate.mjs's computed peak must equal agent_count). len(units) > cap:
          the script must carry the helper (WINDOW_HELPER) with a window of exactly cap (not smaller, not larger).
          Undeterminable -> blocked.

CLI:  staffing.py status --cwd DIR [--state-dir DIR] [--json]   |   staffing.py start --cwd DIR   |   staffing.py --selftest
"""
import hashlib
import json
import os
import re
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

SCHEMA = "blackceo.swarm-plan/v2"
CEIL_AGENTS, CEIL_WORKFLOWS, CEIL_TOTAL = 10, 50, 500
MAX_WALK = 40
HANDBACK_LAUNCHES = 3
LIVE_STATES = ("VALIDATED", "RETURNED", "LAUNCH_UNVERIFIED")
STATUS_OK = ("planned-not-running", "running")
_SLICE_TEXT = re.compile(r"slice \d+ of \d+", re.I)
HERE = Path(__file__).resolve().parent


def default_state_dir():
    return Path(os.environ.get("WORKFLOW_GUARD_STATE", str(HERE / "state")))


# ---------------------------------------------------------------- plan discovery
def _jload(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def find_plan(cwd):
    """(plan_path, doc) for the nearest plan, walking up <= 40 levels; None if none.
    doc is None when the file exists but is unreadable or not a JSON object."""
    try:
        p = Path(cwd).resolve()
    except (OSError, ValueError, TypeError):
        return None
    for _ in range(MAX_WALK):
        cands = []
        prof = p / ".spec-protocol.json"
        if prof.is_file():
            d = _jload(prof)
            ref = d.get("swarmPlan") if isinstance(d, dict) else None
            if isinstance(ref, str) and ref.strip():
                cands.append((p / ref).resolve())
        cands += [p / "SWARM-PLAN.json", p / "claude-nine-swarm" / "SWARM-PLAN.json"]
        for f in cands:
            if f.is_file():
                d = _jload(f)
                return f, (d if isinstance(d, dict) else None)
        if p.parent == p:
            break
        p = p.parent
    return None


# ---------------------------------------------------------------- plan accessors
def workflows(doc):
    w = doc.get("workflows") if isinstance(doc, dict) else None
    return [x for x in w if isinstance(x, dict)] if isinstance(w, list) else []


def unit_ids(wf):
    return [u.get("unit_id") for u in (wf.get("units") or []) if isinstance(u, dict)]


LEFTOVER_KEYS = ("builders", "checkers", "repair_extra_executions_max", "max_total_executions")


def plan_cap(doc):
    """policy.max_agents_per_workflow when it is an int 1..10, else None (plan invalid)."""
    v = policy(doc).get("max_agents_per_workflow")
    return v if _int(v) and 1 <= v <= CEIL_AGENTS else None


def agent_count(wf, cap=CEIL_AGENTS):
    return min(cap, len(wf.get("units") or []))


def policy(doc):
    p = doc.get("policy") if isinstance(doc, dict) else None
    return p if isinstance(p, dict) else {}


def _int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def _nonempty(v):
    return isinstance(v, str) and bool(v.strip())


_PLACEHOLDER = re.compile(r"slices/|[<>*]|TBD|TODO", re.I)


def _bad_owned(oo):
    """ONE RULE: concrete repo-relative file, or directory ending in '/'."""
    if not _nonempty(oo):
        return "must be a concrete repo-relative file or directory path (empty)"
    if oo.startswith("/") or re.match(r"[A-Za-z]:", oo) or oo.startswith("~"):
        return "must be repo-relative, not absolute: %r" % oo
    if ".." in oo.split("/"):
        return "must not contain '..': %r" % oo
    if _PLACEHOLDER.search(oo):
        return "is a placeholder: %r" % oo
    return None


def _overlap(a, b):
    return a == b or (a.endswith("/") and b.startswith(a)) or (b.endswith("/") and a.startswith(b))


def validate_plan(doc):
    """Return a list of error strings; empty means the plan satisfies the v2 schema."""
    if not isinstance(doc, dict):
        return ["plan is unreadable or not a JSON object"]
    errs = []
    if doc.get("schema") != SCHEMA:
        errs.append("schema must be %r, got %r" % (SCHEMA, doc.get("schema")))
    if doc.get("status") not in STATUS_OK:
        errs.append("plan status must be planned-not-running or running (staffing.py start); other claims need actual census evidence")
    pol = policy(doc)
    maw = pol.get("max_active_workflows")
    if not (_int(maw) and 1 <= maw <= CEIL_WORKFLOWS):
        errs.append("policy.max_active_workflows must be an integer 1..%d" % CEIL_WORKFLOWS)
    cap = plan_cap(doc)
    if cap is None:
        errs.append("policy.max_agents_per_workflow must be an integer 1..%d (the measured per-workflow cap)" % CEIL_AGENTS)
    cp = pol.get("capacity_probe")
    if cp is not None and (not isinstance(cp, dict) or cp.get("per_workflow_cap") != pol.get("max_agents_per_workflow")):
        errs.append("policy.max_agents_per_workflow must equal policy.capacity_probe.per_workflow_cap")
    mwa = pol.get("max_working_agents")
    if not (_int(mwa) and 1 <= mwa <= CEIL_TOTAL):
        errs.append("policy.max_working_agents must be an integer 1..%d" % CEIL_TOTAL)
    wfs = doc.get("workflows")
    if not isinstance(wfs, list) or not wfs or not all(isinstance(w, dict) for w in wfs):
        errs.append("workflows must be a nonempty list of objects")
        return errs
    ids = [w.get("workflow_id") for w in wfs]
    for i in ids:
        if not _nonempty(i):
            errs.append("every workflow needs a nonempty workflow_id")
    good = [i for i in ids if _nonempty(i)]
    if len(set(good)) != len(good):
        errs.append("workflow_id values must be unique")
    owned = []
    for w in wfs:
        wid = w.get("workflow_id")
        if not _nonempty(wid):
            continue
        deps = w.get("dependencies")
        if not isinstance(deps, list):
            errs.append("%s: dependencies must be a list" % wid)
        else:
            for d in deps:
                if d not in good:
                    errs.append("%s: dependency %r is not a workflow in this plan" % (wid, d))
                if d == wid:
                    errs.append("%s: depends on itself" % wid)
        units = w.get("units")
        if not isinstance(units, list) or not units:
            errs.append("%s: units must be a nonempty list" % wid)
            continue
        seen = set()
        works = set()
        for k, u in enumerate(units, 1):
            if not isinstance(u, dict):
                errs.append("%s: unit %d must be an object" % (wid, k))
                continue
            uid = u.get("unit_id")
            if not (isinstance(uid, str) and re.fullmatch(re.escape(wid) + r"-U[0-9]+", uid)):
                errs.append("%s: unit_id %r must look like %s-U<n>" % (wid, uid, wid))
            elif uid in seen:
                errs.append("%s: duplicate unit_id %s" % (wid, uid))
            seen.add(uid)
            for key in ("work", "acceptance", "source"):
                if not _nonempty(u.get(key)):
                    errs.append("%s: %s needs a nonempty %s" % (wid, uid, key))
            oo = u.get("owned_output")
            bad = _bad_owned(oo)
            if bad:
                errs.append("%s: %s owned_output %s" % (wid, uid, bad))
            else:
                for q, other in owned:
                    if _overlap(oo, q):
                        errs.append("%s: owned_output %s overlaps %s %s" % (uid, oo, other, q))
                owned.append((oo, uid))
            if u.get("verdict_file") != "evidence/%s/%s.verdict.json" % (wid, uid):
                errs.append("%s: %s verdict_file must be evidence/%s/%s.verdict.json" % (wid, uid, wid, uid))
            work = u.get("work")  # padding rules: verbatim from swarm_plan_check.py
            if isinstance(work, str):
                if _SLICE_TEXT.search(work):
                    errs.append('%s: %s work is "slice N of M" padding' % (wid, uid))
                norm = re.sub(r"[\d\s]+", "", work).lower()
                if norm and norm in works:
                    errs.append("%s: %s work duplicates another unit (padding)" % (wid, uid))
                works.add(norm)
        for k in LEFTOVER_KEYS:
            if k in w:
                errs.append("%s: leftover key %s \u2014 staffing is derived from units" % (wid, k))
        want = min(cap or CEIL_AGENTS, len(units))
        if w.get("agent_count") != want or not _int(w.get("agent_count")):
            errs.append("%s: agent_count must be min(max_agents_per_workflow, len(units)) = %d" % (wid, want))
        if w.get("concurrency") != want or not _int(w.get("concurrency")):
            errs.append("%s: concurrency must equal agent_count = %d" % (wid, want))
        if "verdict_file" in w:
            errs.append("%s: leftover key verdict_file \u2014 a workflow is done when every unit has a valid PASS verdict" % wid)
    # dependency cycles
    deps_of = {w["workflow_id"]: [d for d in (w.get("dependencies") or []) if d in good]
               for w in wfs if _nonempty(w.get("workflow_id")) and isinstance(w.get("dependencies"), list)}
    state = {}

    def visit(n):
        if state.get(n) == 1:
            return True
        if state.get(n) == 2:
            return False
        state[n] = 1
        if any(visit(d) for d in deps_of.get(n, [])):
            return True
        state[n] = 2
        return False
    if any(visit(n) for n in list(deps_of)):
        errs.append("workflow dependencies contain a cycle")
    return errs


# ---------------------------------------------------------------- done / ready / owed
_FAMILIES = ("opus", "sonnet", "haiku", "fable", "gpt", "gemini", "deepseek", "glm", "kimi", "qwen", "llama", "mistral",
             "grok", "minimax", "nemotron", "gemma", "codex", "agnes")


def model_family(name):
    """Family of a model name: vendor prefix, version, date and case stripped ('anthropic/claude-opus-4-5-20251101' -> 'opus').
    Unknown names compare as normalized lowercase with digits and separators removed."""
    s = str(name or "").strip().lower().rsplit("/", 1)[-1].split(":", 1)[0]
    for tok in re.split(r"[^a-z]+", s):
        if tok in _FAMILIES:
            return tok
    return re.sub(r"[\d._\s-]+", "", s) or s


def file_sha256(path):
    try:
        return hashlib.sha256(Path(path).read_bytes()).hexdigest()
    except OSError:
        return None


def run_dirs(transcript, receipt):
    """Run folders of a launch: <transcript dir>/<transcript stem>/subagents/workflows/<run_id>, or every wf_* when the
    receipt has no run_id (agent ids are globally unique, so that is still unambiguous). [] when unknowable."""
    if not transcript:
        return []
    tp = Path(transcript)
    base = tp.parent / tp.stem / "subagents" / "workflows"
    try:
        rid = (json.loads(receipt or "{}") or {}).get("run_id")
    except (ValueError, AttributeError):
        rid = None
    try:
        return [str(base / rid)] if isinstance(rid, str) and rid else [str(d) for d in base.glob("wf_*") if d.is_dir()]
    except OSError:
        return []


def run_agents(dirs):
    """{agentId: (label, ACTUAL model)} read from the run folders: journal.jsonl 'started' lines give agentId+label, and
    agent-<agentId>.meta.json gives the model the agent really ran on. Model is "" when unreadable."""
    out = {}
    for d in dirs or ():
        try:
            lines = (Path(d) / "journal.jsonl").read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        for ln in lines:
            try:
                j = json.loads(ln)
            except ValueError:
                continue
            if isinstance(j, dict) and j.get("type") == "started" and _nonempty(j.get("agentId")):
                m = _jload(Path(d) / ("agent-%s.meta.json" % j["agentId"]))
                out[j["agentId"]] = (j.get("label"), m.get("model") if isinstance(m, dict) and _nonempty(m.get("model")) else "")
    return out


def actual_roles_ok(unit_id, writer, dirs):
    """True iff the verdict's journaled writer is an agent labelled qc:<unit_id>, the unit has at least one build:<unit_id>
    agent, every one of them has a readable ACTUAL model, and no builder shares the checker's model family."""
    ag = run_agents(dirs)
    chk = ag.get(writer)
    builders = [v for k, v in ag.items() if v[0] == "build:%s" % unit_id]
    if not chk or chk[0] != "qc:%s" % unit_id or not chk[1] or not builders or any(not b[1] for b in builders):
        return False
    return all(model_family(b[1]) != model_family(chk[1]) for b in builders)


def unit_done(plan_dir, wf, u, attempts, records=None, proof=None):
    """True iff u's verdict file is a valid PASS: verdict == "PASS" exactly, unit_id matches, attempt_id is an
    ADMITTED launch of this workflow (attempts, recorded by the guard), builder_model and reviewer_model nonempty and of
    different model FAMILIES, AND the file's current sha256 matches a journal record (records: {(unit_id, attempt_id, sha256)})
    the guard wrote when a subagent of that live/finished admitted launch wrote this very content. A file nobody
    journaled (hand-written, edited afterwards, written by the conductor) is never DONE. proof ({(unit,attempt,sha): (writer
    agent_id, run folders)}) must show the writer is that unit's qc:<unit_id> agent and that its ACTUAL model family (meta.json)
    differs from every build:<unit_id> agent's; the verdict JSON's own model/label fields are never trusted for that."""
    vf = u.get("verdict_file")
    if not _nonempty(vf):
        return False
    try:
        base = Path(plan_dir).resolve()
        target = (base / vf).resolve()
        target.relative_to(base)
        raw = target.read_bytes()
        d = json.loads(raw.decode("utf-8"))
    except (OSError, ValueError):
        return False
    if not isinstance(d, dict) or d.get("verdict") != "PASS" or d.get("unit_id") != u.get("unit_id"):
        return False
    aid, b, r = d.get("attempt_id"), d.get("builder_model"), d.get("reviewer_model")
    if not (_nonempty(aid) and aid in (attempts or ())):
        return False
    key = (u.get("unit_id"), aid, hashlib.sha256(raw).hexdigest())
    if key not in (records or ()):
        return False
    writer, dirs = (proof or {}).get(key, (None, []))
    if not _nonempty(writer) or not actual_roles_ok(u.get("unit_id"), writer, dirs):
        return False
    return _nonempty(b) and _nonempty(r) and model_family(b) != model_family(r)


def is_done(plan_dir, wf, attempts=(), records=None, proof=None):
    """A workflow is DONE iff every one of its units has a valid PASS verdict (see unit_done)."""
    units = [u for u in (wf.get("units") or []) if isinstance(u, dict)]
    return bool(units) and all(unit_done(plan_dir, wf, u, attempts, records, proof) for u in units)


def compute(plan_path, doc, running=(), launches=None, program_cap=CEIL_WORKFLOWS, agent_cap=None, attempts=None, records=None, proof=None):
    """Pure state computation. running: workflowIds with a live launch. launches: wid -> count."""
    launches = launches or {}
    attempts = attempts or {}
    records = records or {}
    proof = proof or {}
    wfs = workflows(doc)
    order = [w["workflow_id"] for w in wfs]
    done = {w["workflow_id"] for w in wfs if is_done(Path(plan_path).parent, w, attempts.get(w["workflow_id"], ()), records.get(w["workflow_id"], ()), proof.get(w["workflow_id"]))}
    run = [i for i in order if i in set(running)]
    handback = [i for i in order if i not in done and i not in run and launches.get(i, 0) >= HANDBACK_LAUNCHES]
    ready = []
    for w in wfs:
        i = w["workflow_id"]
        if i in done or i in run or i in handback:
            continue
        if all(d in done for d in (w.get("dependencies") or [])):
            ready.append(i)
    maw = policy(doc).get("max_active_workflows")
    maw = maw if _int(maw) and maw > 0 else CEIL_WORKFLOWS
    required = min(maw, program_cap, len(run) + len(ready))
    owed = ready[:max(0, required - len(run))]
    acap = agent_cap or plan_cap(doc) or CEIL_AGENTS
    counts = {w["workflow_id"]: agent_count(w, acap) for w in wfs}
    return {"order": order, "done": sorted(done, key=order.index), "running": run, "ready": ready,
            "owed": owed, "handback": handback, "required_running": required,
            "max_active": maw, "agents": counts}


def is_armed(doc):
    """The single arming definition: status == "running" (set by `staffing.py start`, or by the guard when it admits the
    plan's first launch)."""
    return str((doc or {}).get("status") or "").lower() == "running"


def set_running(path):
    """Flip a plan file's status "planned-not-running" -> "running" (atomic, indent 2, trailing newline). True when it
    wrote. Never touches a plan that is not exactly planned-not-running or that does not parse as an object."""
    path = Path(path)
    doc = _jload(path)
    if not isinstance(doc, dict) or doc.get("status") != "planned-not-running":
        return False
    doc["status"] = "running"
    tmp = path.with_name(path.name + ".%d.tmp" % os.getpid())
    tmp.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)
    return True


def describe_owed(state):
    return ", ".join("%s (%d agents)" % (i, state["agents"][i]) for i in state["owed"])


# ---------------------------------------------------------------- journal (guard.sqlite3)
def migrate(conn):
    """Idempotent: tag table for workflowId on each launch, denied/failed attempt table, session pins (many per session),
    and verdict_records (the journal side of every DONE)."""
    fresh = not conn.execute("SELECT 1 FROM sqlite_master WHERE name='session_pins'").fetchone()
    conn.executescript(
        "CREATE TABLE IF NOT EXISTS launch_tags(id TEXT PRIMARY KEY,session TEXT,workflow_id TEXT,plan TEXT,created REAL);"
        "CREATE TABLE IF NOT EXISTS session_plans(session TEXT PRIMARY KEY,plan TEXT,armed REAL);"
        "CREATE TABLE IF NOT EXISTS session_pins(session TEXT,plan TEXT,armed REAL,PRIMARY KEY(session,plan));"
        "CREATE TABLE IF NOT EXISTS verdict_records(plan TEXT,workflow_id TEXT,unit_id TEXT,attempt_id TEXT,sha256 TEXT,agent_id TEXT,launch_id TEXT,created REAL,PRIMARY KEY(plan,unit_id,attempt_id,sha256));"
        "CREATE TABLE IF NOT EXISTS attempt_ids(plan TEXT,attempt_id TEXT,workflow_id TEXT,launch_id TEXT,created REAL,PRIMARY KEY(plan,attempt_id));"
        "CREATE TABLE IF NOT EXISTS launch_attempts(attempt TEXT PRIMARY KEY,session TEXT,plan TEXT,workflow_id TEXT,outcome TEXT,detail TEXT,created REAL);")
    if fresh:  # one-time carry-over of the old single-pin table; never again, or deleted pins would come back
        conn.execute("INSERT OR IGNORE INTO session_pins SELECT session,plan,armed FROM session_plans")
        conn.commit()


def journal_view(conn, plan_path, ids, session=None):
    """Read the journal for one plan. Returns dict(running=set, launches={wid:n}, any=bool, attempts={wid:set(attempt_id)},
    records={wid:{(unit,attempt,sha)}}, proof={wid:{(unit,attempt,sha):(writer agent_id, [run folders])}}).
    Everything here is an ADMITTED launch; hook refusals are never counted."""
    out = {"running": set(), "launches": {}, "any": False, "attempts": {}, "records": {}, "proof": {}}
    p = str(plan_path)
    idset = set(ids)
    try:
        q = ",".join("?" * len(LIVE_STATES))
        for (wid,) in conn.execute("SELECT DISTINCT t.workflow_id FROM launch_tags t JOIN launches l ON l.id=t.id WHERE t.plan=? AND l.state IN (%s)" % q, (p,) + LIVE_STATES):
            if wid in idset:
                out["running"].add(wid)
        for wid, n in conn.execute("SELECT workflow_id,COUNT(*) FROM launch_tags WHERE plan=? GROUP BY workflow_id", (p,)):
            if wid in idset:
                out["launches"][wid] = n
        out["any"] = bool(out["launches"]) or (not idset and bool(conn.execute("SELECT 1 FROM launch_tags WHERE plan=? LIMIT 1", (p,)).fetchone()))
        out["records"], out["proof"] = _records_proof(conn, p)
        for wid, aid in conn.execute("SELECT workflow_id,attempt_id FROM attempt_ids WHERE plan=?", (p,)):
            if wid in idset:
                out["attempts"].setdefault(wid, set()).add(aid)
    except sqlite3.Error:
        pass
    return out


def open_journal(state_dir=None):
    """Read-write connection with the staffing tables present, or None when it cannot be had."""
    sd = Path(state_dir) if state_dir else default_state_dir()
    try:
        sd.mkdir(parents=True, exist_ok=True)
        c = sqlite3.connect(sd / "guard.sqlite3", timeout=5)
        c.execute("PRAGMA busy_timeout=5000")
        migrate(c)
        return c
    except (OSError, sqlite3.Error):
        return None


def _reap(state_dir):
    """Let the guard release finished/dead launches first, so RUNNING is not stale. Best effort."""
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location("guard_for_staffing", HERE / "guard.py")
        g = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(g)
        if state_dir:
            g.STATE = Path(state_dir)
            g.LIMITS_FILE = g.STATE / "limits.json"
        c = g.db()
        try:
            g.reap_dead(c)
        finally:
            c.close()
    except Exception:
        pass


def program_cap(state_dir=None):
    sd = Path(state_dir) if state_dir else default_state_dir()
    d = _jload(sd / "limits.json")
    v = d.get("concurrent_workflows_per_program") if isinstance(d, dict) else None
    return v if _int(v) and v > 0 else CEIL_WORKFLOWS


PROBE_TTL = 600
PROBE = None  # tests inject a callable returning {"per_workflow_cap": n}; None = capacity_probe.probe()
if os.environ.get("STAFFING_TEST_PROBE_CAP", "").isdigit() and 1 <= int(os.environ["STAFFING_TEST_PROBE_CAP"]) <= 10:
    PROBE = lambda: {"per_workflow_cap": int(os.environ["STAFFING_TEST_PROBE_CAP"])}  # test-only door (999-setup repo adaptation)


def probed_cap(state_dir=None, session=None, now=None):
    """The per-workflow cap measured on THIS box right now (capacity_probe.probe()), cached per session for 10 minutes in
    <state>/capacity-probe-cache.json so every hook process of a session agrees. None when the probe fails (the plan cap then stands)."""
    sd = Path(state_dir) if state_dir else default_state_dir()
    now = time.time() if now is None else now
    f, key = sd / "capacity-probe-cache.json", str(session or "-")
    cache = _jload(f)
    cache = cache if isinstance(cache, dict) else {}
    e = cache.get(key)
    if isinstance(e, dict) and _int(e.get("cap")) and isinstance(e.get("t"), (int, float)) and 0 <= now - e["t"] < PROBE_TTL:
        return e["cap"]
    try:
        if PROBE is not None:
            cap = PROBE()["per_workflow_cap"]
        else:
            import importlib.util
            spec = importlib.util.spec_from_file_location("capacity_probe_for_staffing", HERE / "capacity_probe.py")
            m = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(m)
            cap = m.probe()["per_workflow_cap"]
        if not (_int(cap) and cap >= 1):
            return None
    except Exception:
        return None
    cache = {k: v for k, v in cache.items() if isinstance(v, dict) and isinstance(v.get("t"), (int, float)) and 0 <= now - v["t"] < PROBE_TTL}
    cache[key] = {"cap": cap, "t": now}
    try:
        sd.mkdir(parents=True, exist_ok=True)
        tmp = f.with_name(f.name + ".%d.tmp" % os.getpid())
        tmp.write_text(json.dumps(cache), encoding="utf-8")
        os.replace(tmp, f)
    except OSError:
        pass
    return cap


def launch_agent_cap(doc, state_dir=None, session=None):
    """THE per-workflow cap: min(plan policy.max_agents_per_workflow, limits.json concurrent_agents_per_workflow,
    plan policy.capacity_probe.per_workflow_cap when present, and a LIVE capacity_probe.probe() of this box cached 10
    minutes per session). Max 10; 10 on the operator's Mac. The number typed into a plan can only lower the measured one."""
    sd = Path(state_dir) if state_dir else default_state_dir()
    d = _jload(sd / "limits.json")
    v = d.get("concurrent_agents_per_workflow") if isinstance(d, dict) else None
    cap = min(plan_cap(doc) or CEIL_AGENTS, v if _int(v) and v > 0 else CEIL_AGENTS)
    cp = policy(doc).get("capacity_probe")
    pc = cp.get("per_workflow_cap") if isinstance(cp, dict) else None
    cap = min(cap, pc) if _int(pc) and pc > 0 else cap
    live = probed_cap(state_dir, session)
    return min(cap, live) if live else cap


def remember_session_plan(state_dir, session, plan_path):
    """Pin an ARMED plan to a session so it keeps governing it after the cwd moves. Never replaces another pin."""
    conn = open_journal(state_dir)
    if not conn:
        return
    try:
        conn.execute("INSERT OR IGNORE INTO session_pins VALUES(?,?,?)", (str(session), str(plan_path), time.time()))
        conn.commit()
    except sqlite3.Error:
        pass
    finally:
        conn.close()


def _records_proof(conn, p):
    """(records, proof) from verdict_records joined to the launch that journaled them (guard records
    {unit_id, attempt_id, sha256, agent_id, launch_id}; launches holds that launch's transcript and receipt run_id)."""
    rec, proof = {}, {}
    for wid_, uid_, aid_, sha_, agent_, tr_, rc_ in conn.execute(
            "SELECT v.workflow_id,v.unit_id,v.attempt_id,v.sha256,v.agent_id,l.transcript,l.receipt FROM verdict_records v LEFT JOIN launches l ON l.id=v.launch_id WHERE v.plan=?", (str(p),)):
        rec.setdefault(wid_, set()).add((uid_, aid_, sha_))
        proof.setdefault(wid_, {})[(uid_, aid_, sha_)] = (agent_, run_dirs(tr_, rc_))
    return rec, proof


def _attempts_records(conn, p):
    att = {}
    for wid_, aid_ in conn.execute("SELECT workflow_id,attempt_id FROM attempt_ids WHERE plan=?", (str(p),)):
        att.setdefault(wid_, set()).add(aid_)
    rec, proof = _records_proof(conn, p)
    return att, rec, proof


def resolve_plans(cwd, session=None, state_dir=None):
    """Every plan governing this session: [(path, doc)], doc None when the file is missing/unreadable.
    A plan found from cwd that is ARMED (status running) or has a recorded launch is pinned to the session; a pin is never
    replaced by another (several armed plans may be pinned at once). Pinned plans keep governing wherever the cwd goes
    until EVERY workflow of the plan is done (the pin is then deleted); the user's stop latch only SUSPENDS pins (they stay
    and govern again after the next human message). A pinned plan whose file vanished or is unreadable while launches are
    recorded is returned with doc None: armed and invalid ("plan file missing"), never "no plan". An unarmed cwd plan stays cwd-scoped."""
    found = find_plan(cwd)
    if not session:
        return [found] if found else []
    conn = open_journal(state_dir)
    if not conn:
        return [found] if found else []
    out = []
    try:
        if found and found[1] is not None:
            path, doc = found
            launched = conn.execute("SELECT 1 FROM launch_tags WHERE plan=? LIMIT 1", (str(path),)).fetchone()
            if str(doc.get("status") or "").lower() == "running" or launched:
                conn.execute("INSERT OR IGNORE INTO session_pins VALUES(?,?,?)", (str(session), str(path), time.time()))
                conn.commit()
                out.append(found)
        try:
            latched = (conn.execute("SELECT latched FROM continuations WHERE session=?", (str(session),)).fetchone() or [0])[0]
        except sqlite3.Error:
            latched = 0
        if not latched:
            have = {str(x[0]) for x in out}
            for (plan,) in conn.execute("SELECT plan FROM session_pins WHERE session=? ORDER BY armed", (str(session),)).fetchall():
                if plan in have:
                    continue
                p = Path(plan)
                d = _jload(p) if p.is_file() else None
                if not isinstance(d, dict):
                    if conn.execute("SELECT 1 FROM launch_tags WHERE plan=? LIMIT 1", (plan,)).fetchone():
                        out.append((p, None))
                    else:
                        conn.execute("DELETE FROM session_pins WHERE session=? AND plan=?", (str(session), plan))
                        conn.commit()
                    continue
                wfs = workflows(d)
                att, rec, proof = _attempts_records(conn, p)
                if wfs and all(is_done(p.parent, w, att.get(w.get("workflow_id"), ()), rec.get(w.get("workflow_id"), ()), proof.get(w.get("workflow_id"))) for w in wfs):
                    conn.execute("DELETE FROM session_pins WHERE session=? AND plan=?", (str(session), plan))
                    conn.commit()
                    continue
                out.append((p, d))
    except sqlite3.Error:
        pass
    finally:
        conn.close()
    return out or ([found] if found else [])


def resolve_plan(cwd, session=None, state_dir=None):
    """The first plan governing this session (see resolve_plans), or None."""
    r = resolve_plans(cwd, session, state_dir)
    return r[0] if r else None


def plan_for_launch(cwd, session, state_dir, wid):
    """Of the plans governing the session, the one that owns workflow wid (else the first)."""
    plans = resolve_plans(cwd, session, state_dir)
    for path, doc in plans:
        if isinstance(wid, str) and doc is not None and wid in [w.get("workflow_id") for w in workflows(doc)]:
            return path, doc
    return plans[0] if plans else None


def protected_plan_paths(cwd, session, state_dir=None):
    """Plan files the main session may not write: the armed cwd-found plan and every plan pinned to the session (even
    one whose file is gone), as Paths. Read-only apart from opening the journal."""
    out = []
    found = find_plan(cwd)
    conn = open_journal(state_dir)
    try:
        if found:
            launched = conn.execute("SELECT 1 FROM launch_tags WHERE plan=? LIMIT 1", (str(found[0]),)).fetchone() if conn else None
            if launched or (found[1] is not None and str(found[1].get("status") or "").lower() == "running"):
                out.append(Path(found[0]))
        if conn and session:
            out += [Path(r[0]) for r in conn.execute("SELECT plan FROM session_pins WHERE session=?", (str(session),)).fetchall()]
    except sqlite3.Error:
        pass
    finally:
        if conn:
            conn.close()
    return out


def _empty_view():
    return {"running": set(), "launches": {}, "any": False, "attempts": {}, "records": {}}


def snapshot(cwd, state_dir=None, session=None, reap=True, plan=None):
    """Everything a caller needs: plan, errors, journal view, computed state, armed flag. None if no plan.
    plan: a (path, doc) from resolve_plans to evaluate instead of the first governing plan."""
    found = plan or resolve_plan(cwd, session, state_dir)
    if not found:
        return None
    path, doc = found
    errs = validate_plan(doc) if doc is not None else (
        ["plan file missing: %s (a pinned plan with recorded launches cannot vanish; restore it, do not rename or rewrite it)" % path] if not Path(path).exists()
        else ["plan file unreadable: %s" % path])
    snap = {"path": path, "doc": doc, "errors": errs, "view": None, "state": None, "armed": False}
    ids = [w["workflow_id"] for w in workflows(doc) if _nonempty(w.get("workflow_id"))]
    if reap and not errs:
        _reap(state_dir)
    conn = open_journal(state_dir)
    try:
        view = journal_view(conn, path, ids, session) if conn else _empty_view()
    finally:
        if conn:
            conn.close()
    snap["view"] = view
    # An INVALID armed plan is still armed (Stop must hold). A pinned plan whose file vanished (doc None) has no status to
    # read, so its recorded launches stand in (they only exist because the guard admitted them, which set status running).
    snap["armed"] = is_armed(doc) if doc is not None else bool(view["any"])
    if errs:
        return snap
    snap["state"] = compute(path, doc, view["running"], view["launches"], program_cap(state_dir), launch_agent_cap(doc, state_dir, session), view["attempts"], view["records"], view["proof"])
    return snap


def snapshots(cwd, state_dir=None, session=None, reap=True):
    """One snapshot per plan governing the session (armed pinned plans are all evaluated; Stop's owed list is their union)."""
    return [snapshot(cwd, state_dir, session, reap=reap, plan=p) for p in resolve_plans(cwd, session, state_dir)]


def pending_units(plan_path, doc, wf, state_dir=None):
    """The wf's unit objects that are NOT yet PASS (journal-attested): the exact unit list of a repair relaunch."""
    conn = open_journal(state_dir)
    if not conn:
        return list(wf.get("units") or [])
    try:
        att, rec, proof = _attempts_records(conn, Path(plan_path).resolve())
    finally:
        conn.close()
    wid = wf.get("workflow_id")
    return [u for u in wf.get("units") or [] if not unit_done(Path(plan_path).parent, wf, u, att.get(wid, ()), rec.get(wid, ()), proof.get(wid))]


def plan_max_active(plan_path, state_dir=None):
    """Plan max_active_workflows (min with limits.json concurrent_workflows_per_program) for the plan file, or None."""
    d = _jload(plan_path)
    m = policy(d).get("max_active_workflows") if isinstance(d, dict) else None
    return min(m, program_cap(state_dir)) if _int(m) and m > 0 else None


def record_attempt(state_dir, session, plan_path, wid, outcome, detail, attempt_id=None):
    """Record one hook-denied/failed launch attempt. Idempotent per attempt id."""
    conn = open_journal(state_dir)
    if not conn:
        return
    try:
        aid = "%s|%s" % (session, attempt_id or time.time_ns())
        conn.execute("INSERT OR IGNORE INTO launch_attempts VALUES(?,?,?,?,?,?,?)",
                     (aid, str(session), str(plan_path), wid or "", outcome, str(detail)[:300], time.time()))
        conn.commit()
    except sqlite3.Error:
        pass
    finally:
        conn.close()


# ---------------------------------------------------------------- launch contract
def _unit_list(v):
    """Accept a list of strings or of objects with unit_id. None if the shape is wrong."""
    if not isinstance(v, list):
        return None
    out = []
    for x in v:
        if isinstance(x, str):
            out.append(x)
        elif isinstance(x, dict) and isinstance(x.get("unit_id"), str):
            out.append(x["unit_id"])
        else:
            return None
    return out


# ---- script reading (own span parser; the dispatch gate is not imported)
# rolling window: the ONE concurrency limiter a launched script may carry. {N} is the window; make-workflow.py
# emits it verbatim and the guard (validate.mjs) and check_launch recognise only this exact text.
WINDOW_HELPER = (
    "const WG_WINDOW = __N__;\n"
    "const wg = {active: 0, queue: []};\n"
    "async function wgSlot(fn) {\n"
    "  while (wg.active >= WG_WINDOW) { await new Promise((resolve) => wg.queue.push(resolve)); }\n"
    "  wg.active++;\n"
    "  try { return await fn(); } finally { wg.active--; const next = wg.queue.shift(); if (next) next(); }\n"
    "}\n")


def window_helper(n):
    return WINDOW_HELPER.replace("__N__", str(n))


def sanitize(src):
    """Same length as src: comments and string/template text blanked (code inside ${...} kept), so parens balance."""
    out, i, n = [], 0, len(src)
    tmpl = []  # brace depth stack for template literals being inside ${ }
    prev = ""  # last significant char, to tell a regex literal from division
    while i < n:
        c = src[i]
        if c == "/" and src[i + 1:i + 2] == "/":
            j = src.find("\n", i)
            j = n if j < 0 else j
            out.append(" " * (j - i)); i = j; continue
        if c == "/" and src[i + 1:i + 2] == "*":
            j = src.find("*/", i + 2)
            j = n if j < 0 else j + 2
            out.append("".join(ch if ch == "\n" else " " for ch in src[i:j])); i = j; continue
        if c in "'\"":
            j = i + 1
            while j < n and src[j] != c and src[j] != "\n":
                j += 2 if src[j] == "\\" else 1
            j = min(j + 1, n)
            out.append(c + " " * max(0, j - i - 2) + (c if j - i >= 2 else "")); i = j; prev = c; continue
        if c == "/" and (not prev or prev in "(,=:[!&|?{};+-*%<>~^"):
            j = i + 1
            while j < n and src[j] != "/" and src[j] != "\n":
                j += 2 if src[j] == "\\" else 1
            j = min(j + 1, n)
            out.append("/" + " " * max(0, j - i - 1)); i = j; prev = "/"; continue
        if c == "`":
            out.append("`"); i += 1
            while i < n and src[i] != "`":
                if src[i] == "\\":
                    out.append("  "); i += 2; continue
                if src[i] == "$" and src[i + 1:i + 2] == "{":
                    out.append("${"); i += 2; tmpl.append(1); break
                out.append("\n" if src[i] == "\n" else " "); i += 1
            else:
                if i < n:
                    out.append("`"); i += 1
            prev = "`"; continue
        if tmpl:
            if c == "{":
                tmpl[-1] += 1
            elif c == "}":
                tmpl[-1] -= 1
                if tmpl[-1] == 0:
                    tmpl.pop(); out.append("}"); i += 1
                    while i < n and src[i] != "`":  # resume the template text
                        if src[i] == "\\":
                            out.append("  "); i += 2; continue
                        if src[i] == "$" and src[i + 1:i + 2] == "{":
                            out.append("${"); i += 2; tmpl.append(1); break
                        out.append("\n" if src[i] == "\n" else " "); i += 1
                    else:
                        if i < n:
                            out.append("`"); i += 1
                    continue
        out.append(c); i += 1
        if not c.isspace():
            prev = c
    return "".join(out)


def _close(code, open_idx):
    """Index just past the ')' that closes the '(' at open_idx; -1 when unbalanced."""
    d = 0
    for k in range(open_idx, len(code)):
        if code[k] == "(":
            d += 1
        elif code[k] == ")":
            d -= 1
            if d == 0:
                return k + 1
    return -1


def calls(code, name):
    """[(start, open_paren_idx, end)] for every call name( ... ) in sanitized code, balanced-paren spans."""
    out = []
    for m in re.finditer(r"(?<![\w$])" + re.escape(name) + r"\s*\(", code):
        o = m.end() - 1
        out.append((m.start(), o, _close(code, o)))
    return out


def _first_arg(code, o, end):
    d = 0
    for k in range(o + 1, end - 1):
        ch = code[k]
        if ch in "([{":
            d += 1
        elif ch in ")]}":
            d -= 1
        elif ch == "," and d == 0:
            return code[o + 1:k].strip()
    return code[o + 1:end - 1].strip()


def unit_stage_problem(script):
    """None when the script's work is ONE pipeline() call whose first argument is exactly the expression args.units and
    which contains every agent() call; else a sentence naming what is wrong. Bare agent() calls, extra stages,
    hard-coded arrays, aliases and derived lists (.filter/.slice/.map/spread/concat/index) are all refused: a derived list
    lets the script run FEWER units than the launch declares."""
    code = sanitize(script)
    stages = calls(code, "pipeline") + calls(code, "parallel")
    if len(stages) != 1:
        return "the script must contain exactly ONE pipeline() call, over args.units; it has %d parallel()/pipeline() stage call(s)" % len(stages)
    st, o, end = stages[0]
    if end < 0:
        return "the stage call is unbalanced"
    arg = re.sub(r"\s+", "", _first_arg(code, o, end))
    kind = code[st:o].strip()
    if not kind.startswith("pipeline") or arg != "args.units":
        return "the %s stage must take args.units itself: its first argument must be exactly the expression args.units (pipeline(args.units, ...)), not %s (no .filter/.slice/.map/spread/concat/index, no alias, no parallel())" % (kind, arg[:60] or "nothing")
    outside = [a for a in calls(code, "agent") if not (st <= a[0] < end)]
    if outside:
        return "%d agent() call(s) sit outside the single args.units stage; all work must run inside it" % len(outside)
    if not calls(code, "agent"):
        return "the script has no agent() call"
    return None


def fans_out_over_units(script, run_args=None):
    return unit_stage_problem(script) is None


def window_problem(script, cap, n_units):
    """None when the agents running at once EQUAL min(cap, n_units) exactly ("fewer agents than units is a violation").
    n_units <= cap: the rolling window helper is FORBIDDEN (the plain pipeline already runs every unit at once).
    n_units > cap: the canonical helper with a window of exactly cap, every agent() written wgSlot(() => agent(...))."""
    code = sanitize(script)
    m = re.search(r"const WG_WINDOW = (\d+);", code)
    if n_units <= cap:
        if m or "wgSlot" in code or "WG_WINDOW" in code:
            return "the rolling window helper is forbidden when units (%d) <= cap (%d): the plain pipeline already runs all %d at once, a window would run fewer agents than units" % (n_units, cap, n_units)
        return None
    if not m or int(m.group(1)) != cap:
        return "the concurrency window must be exactly %d (min of the live cap and %d units); found %s" % (cap, n_units, m.group(1) if m else "none")
    if sanitize(window_helper(int(m.group(1)))) not in code:
        return "the window helper was altered; it must be byte-for-byte the one make-workflow.py emits"
    for a in calls(code, "agent"):
        if not re.search(r"wgSlot\s*\(\s*\(\s*\)\s*=>\s*$", code[:a[0]]):
            return "an agent() call is not wrapped as wgSlot(() => agent(...))"
    return None


def family_pin_problem(script):
    """None unless a builder (non-QC phase) and a checker (phase QC) agent() model pin of the script share a model family."""
    code, pins = sanitize(script), {"b": set(), "c": set()}
    for st, o, end in calls(code, "agent"):
        if end < 0:
            continue
        def pin(key):  # key found in CODE (not inside a prompt string); its string value read from the raw script at the same offset
            k = re.search(r"\b" + key + r"\s*:\s*['\"]", code[o:end])
            if not k:
                return None
            v = re.match(r"([^'\"]*)['\"]", script[o + k.end():end])
            return v.group(1) if v else None
        mv, pv = pin("model"), pin("phase")
        if mv is not None:
            pins["c" if (pv or "").strip().lower() == "qc" else "b"].add(model_family(mv))
    both = pins["b"] & pins["c"]
    return ("builder and checker model pins share the family %s; the checker must be a different model family from the builder" % sorted(both)[0]) if both else None


def _read_script(ti, cwd):
    s = ti.get("script")
    if isinstance(s, str) and s.strip():
        return s, None
    p = ti.get("scriptPath")
    if not isinstance(p, str) or not p.strip():
        return None, "a launch by saved name has no script this guard can read"
    path = Path(p).expanduser()
    if not path.is_absolute():
        path = Path(cwd) / path
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return None, "scriptPath %s cannot be read" % path
    return (text, None) if text.strip() else (None, "script %s is empty" % path)


def check_launch(tool_input, cwd, session=None, state_dir=None, attempt_id=None, reap=None, record=True):
    """The launch contract. Returns (ok, message). (True, '') when no plan is found."""
    ti = tool_input if isinstance(tool_input, dict) else {}
    args = ti.get("args")
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except ValueError:
            args = None
    args = args if isinstance(args, dict) else {}
    wid = args.get("workflowId")
    found = plan_for_launch(cwd, session, state_dir, wid)
    if not found:
        return True, ""
    snap = snapshot(cwd, state_dir, session, reap=(state_dir is None) if reap is None else reap, plan=found)
    path = snap["path"]
    head = "WORKFLOW LAUNCH CONTRACT (plan %s): " % path
    if snap["errors"]:
        return False, head + "the plan itself is invalid, so no launch can be checked against it. Fix the plan first:\n  - " + "\n  - ".join(snap["errors"][:12])
    st, doc = snap["state"], snap["doc"]
    wfs = {w["workflow_id"]: w for w in workflows(doc)}
    problems = []

    cap_now = launch_agent_cap(doc, state_dir, session)

    def fix_for(target):
        w = wfs[target]
        return ("FIX: launch workflow %s with args.workflowId=%s, args.units = its %d planned unit objects exactly as in the plan (ids %s; "
                "agent_count %d; a repair relaunch carries exactly the not-yet-PASS units), a unique args.attemptId (e.g. \"%s-<epoch-ms>\"), and a script that fans out in ONE stage "
                "pipeline(args.units, build, check) with a model: pin on every agent() and every agent() inside "
                "that stage. Never more than %d agents at once (the measured per-workflow cap). Generate the launch with "
                "python3 %s --plan <SWARM-PLAN.json> --workflow-id %s --out-dir <dir> (add --repair for a repair relaunch); do not add or drop units."
                % (target, json.dumps(target), len(unit_ids(w)), json.dumps(unit_ids(w)), st["agents"][target], target, cap_now, HERE / "make-workflow.py", target))

    target = wid if isinstance(wid, str) and wid in wfs else None
    if target is None:
        problems.append("args.workflowId is %s; it must equal a workflow_id of this plan" % (json.dumps(wid) if "workflowId" in args else "missing"))
    elif target in st["done"]:
        problems.append("workflow %s is already done (its verdict file is PASS); do not launch it again" % target)
    elif target in st["running"]:
        problems.append("workflow %s is already running" % target)
    elif target in st["handback"]:
        problems.append("workflow %s was launched %d times without becoming done: it is in HANDBACK and needs the user, not a relaunch" % (target, HANDBACK_LAUNCHES))
    elif target not in st["ready"]:
        unmet = [d for d in (wfs[target].get("dependencies") or []) if d not in st["done"]]
        problems.append("workflow %s is not ready: unfinished dependencies %s" % (target, unmet))
    elif len(st["running"]) >= min(st["max_active"], program_cap(state_dir)):
        problems.append("the plan runs at most %d workflows at once and %d are running; launch %s when one finishes" % (min(st["max_active"], program_cap(state_dir)), len(st["running"]), target))
    required = target if target and not problems else None
    if required is None:
        required = (st["owed"] or st["ready"] or [None])[0]
    if required is None:
        msg = head + "; ".join(problems or ["no workflow"]) + ". No workflow of this plan is launchable right now (done, running, in handback or waiting on dependencies); do not launch."
        _record(record, state_dir, session, path, wid if target else None, attempt_id, msg)
        return False, msg
    w = wfs[required]
    if target and not problems:
        want = unit_ids(w)
        got = _unit_list(args.get("units"))
        view = snap["view"]
        pend = [u.get("unit_id") for u in (w.get("units") or []) if isinstance(u, dict)
                and not unit_done(path.parent, w, u, view["attempts"].get(required, ()), view["records"].get(required, ()), view["proof"].get(required))]
        repair = 0 < len(pend) < len(want)
        if got is None:
            problems.append("args.units is %s; it must be the list of this workflow's unit_ids" % ("missing" if "units" not in args else "malformed"))
        elif sorted(got) != sorted(pend if repair else want):
            problems.append("args.units has %d unit(s) %s; workflow %s plans exactly %d: %s%s" % (len(got), json.dumps(got), required, len(want), json.dumps(want),
                            (" (a repair relaunch must carry exactly the %d not-yet-PASS units %s)" % (len(pend), json.dumps(pend))) if repair else ""))
        else:
            planned = {u.get("unit_id"): u for u in (w.get("units") or []) if isinstance(u, dict)}
            altered = [x["unit_id"] for x in args["units"] if isinstance(x, dict) and x != planned.get(x.get("unit_id"))]
            if altered:
                problems.append("args.units entr%s %s differ%s from the plan's unit object (every field must be identical; rewritten work/acceptance/owned_output changes what the agents are told to build)" % ("ies" if len(altered) > 1 else "y", json.dumps(altered), "" if len(altered) > 1 else "s"))
            aid = args.get("attemptId")
            if not _nonempty(aid):
                problems.append("args.attemptId is %s; it must be a non-empty unique string the conductor generates (e.g. \"%s-<epoch-ms>\")" % ("missing" if "attemptId" not in args else "empty or not a string", required))
            elif any(aid in v for v in snap["view"]["attempts"].values()):
                problems.append("args.attemptId %s was already used by an admitted launch; every launch needs a new unique attemptId" % json.dumps(aid))
            script, why = _read_script(ti, cwd)
            if script is None:
                problems.append("undeterminable launch (blocked, fail closed): " + why)
            else:
                try:
                    stage = unit_stage_problem(script)
                    win = None if stage else window_problem(script, cap_now, len(got))
                    fam = None if stage else family_pin_problem(script)
                except Exception as e:  # parser trouble under a plan is undeterminable
                    problems.append("undeterminable launch (blocked, fail closed): %s while reading the script" % type(e).__name__)
                else:
                    if stage:
                        problems.append(stage)
                    if fam:
                        problems.append(fam)
                    if win:
                        problems.append("the script cannot be shown to respect the per-workflow cap of %d agents at once for %d units: %s" % (cap_now, len(got), win))
    if not problems:
        return True, ""
    msg = head + "; ".join(problems) + ".\n" + fix_for(required)
    _record(record, state_dir, session, path, required, attempt_id, msg)
    return False, msg


def _record(record, state_dir, session, path, wid, attempt_id, msg):
    if record and session:
        record_attempt(state_dir, session, path, wid, "denied", msg, attempt_id)


# ---------------------------------------------------------------- CLI
def cmd_status(cwd, state_dir, as_json):
    snap = snapshot(cwd, state_dir, reap=False)
    if snap is None:
        print("no plan found from %s (no floor; ceilings only: %d workflows / %d agents per workflow / %d agents)" % (cwd, CEIL_WORKFLOWS, CEIL_AGENTS, CEIL_TOTAL))
        return 0
    if snap["errors"]:
        print("plan %s is INVALID (%s):\n  - %s" % (snap["path"], "armed: the Stop hook holds" if snap["armed"] else "not started", "\n  - ".join(snap["errors"])))
        return 1
    st = snap["state"]
    row = {"plan": str(snap["path"]), "armed": snap["armed"], "max_active": st["max_active"], "required_running": st["required_running"],
           "done": st["done"], "running": st["running"], "ready": st["ready"], "owed": [{"workflow_id": i, "agents": st["agents"][i]} for i in st["owed"]],
           "handback": st["handback"]}
    if as_json:
        print(json.dumps(row, indent=2))
        return 0
    if not snap["armed"]:
        print("Plan %s found, not started. Start the build with: %s" % (snap["path"], start_command(snap["path"])))
    print("plan: %s\narmed: %s\nactive workflows allowed: %d  required running now: %d" % (row["plan"], row["armed"], row["max_active"], row["required_running"]))
    print("done (%d): %s" % (len(st["done"]), ", ".join(st["done"]) or "none"))
    print("running (%d): %s" % (len(st["running"]), ", ".join(st["running"]) or "none"))
    print("owed now: %s" % (describe_owed(st) or "none"))
    print("handback: %s" % (", ".join(st["handback"]) or "none"))
    return 0


def start_command(path):
    return "python3 ~/.claude/hooks/workflow-guard/staffing.py start --cwd %s" % Path(path).parent


def cmd_start(cwd):
    """The build-start act: validate the plan, then set its top-level status to "running" (arms the floor)."""
    found = find_plan(cwd)
    if found is None:
        print("no plan found from %s; nothing to start" % cwd)
        return 1
    path, doc = found
    errs = validate_plan(doc)
    if errs:
        print("plan %s is INVALID, not started:\n  - %s" % (path, "\n  - ".join(errs)))
        return 1
    if doc.get("status") == "running":
        print("plan %s is already running" % path)
        return 0
    set_running(path)
    print("plan %s started: status is now running; the floor applies" % path)
    return 0


# ---------------------------------------------------------------- selftest
def _alpha(k):
    return "".join(chr(97 + int(d)) for d in str(k)) + "x" * (k // 10)


def _mkplan(root, specs, status="planned-not-running", maw=3, deps=None, cap=10):
    """specs: {wid: n_units}. Writes SWARM-PLAN.json under root and returns its path."""
    wfs = []
    for wid, n in specs.items():
        units = [{"unit_id": "%s-U%d" % (wid, k), "work": "build part " + _alpha(k), "owned_output": "out/%s/%d.md" % (wid, k), "acceptance": "a",
                  "source": "s", "verdict_file": "evidence/%s/%s-U%d.verdict.json" % (wid, wid, k)} for k in range(1, n + 1)]
        wfs.append({"workflow_id": wid, "dependencies": (deps or {}).get(wid, []), "units": units, "agent_count": min(cap, n),
                    "concurrency": min(cap, n)})
    doc = {"schema": SCHEMA, "status": status, "policy": {"max_active_workflows": maw, "max_agents_per_workflow": cap, "max_working_agents": 500}, "workflows": wfs}
    p = Path(root) / "SWARM-PLAN.json"
    p.write_text(json.dumps(doc))
    return p


def _verdict(root, wid, v="PASS", attempt="A1", builder="opus", reviewer="sonnet", unit_ids_=None):
    """Write unit verdict files for workflow wid (all units, or the listed ones)."""
    doc = json.loads((Path(root) / "SWARM-PLAN.json").read_text())
    wf = next(w for w in workflows(doc) if w["workflow_id"] == wid)
    for u in wf["units"]:
        if unit_ids_ is not None and u["unit_id"] not in unit_ids_:
            continue
        f = Path(root) / u["verdict_file"]
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps({"verdict": v, "unit_id": u["unit_id"], "attempt_id": attempt, "builder_model": builder, "reviewer_model": reviewer}))


def _file_records(root, wid):
    """{wid: {(unit_id, attempt_id, sha256)}} for every verdict file on disk: what the guard journals when an attested subagent
    Writes it (test helper; the real records come only from guard.record_subagent_verdict)."""
    doc = json.loads((Path(root) / "SWARM-PLAN.json").read_text())
    wf = next(w for w in workflows(doc) if w["workflow_id"] == wid)
    out = set()
    for u in wf["units"]:
        f = Path(root) / u["verdict_file"]
        if f.is_file():
            out.add((u["unit_id"], json.loads(f.read_text()).get("attempt_id"), file_sha256(f)))
    return {wid: out}


def _mkrun(root, wid, builder="opus", checker="sonnet"):
    """Test helper: a real-shaped run folder (journal.jsonl 'started' lines + agent-<id>.meta.json with the ACTUAL model) for every
    unit of wid: build:<unit> on `builder`, qc:<unit> on `checker`. Returns (transcript path, run folder)."""
    doc = json.loads((Path(root) / "SWARM-PLAN.json").read_text())
    wf = next(w for w in workflows(doc) if w["workflow_id"] == wid)
    tx = Path(root) / ".tx" / "sess.jsonl"
    run = tx.parent / "sess" / "subagents" / "workflows" / ("wf_" + wid)
    run.mkdir(parents=True, exist_ok=True)
    tx.write_text("")
    lines = ['{"type":"launched"}']
    for u in wf["units"]:
        for pre, ph, model in (("bu", "Build", builder), ("qc", "QC", checker)):
            aid = "%s-%s" % (pre, u["unit_id"])
            lines.append(json.dumps({"type": "started", "key": "k" + aid, "agentId": aid, "label": ("build:" if pre == "bu" else "qc:") + u["unit_id"], "phase": ph}))
            (run / ("agent-%s.meta.json" % aid)).write_text(json.dumps({"agentType": "workflow-subagent", "description": "x", "model": model}))
    (run / "journal.jsonl").write_text("\n".join(lines) + "\n")
    return tx, run


def _proof(root, wid, writer_prefix="qc"):
    """{wid: {(unit,attempt,sha): (writer agent_id, [run folder])}} for every verdict file on disk, as journal_view builds it."""
    _tx, run = _mkrun(root, wid) if not (Path(root) / ".tx" / "sess" / "subagents" / "workflows" / ("wf_" + wid)).exists() else (None, Path(root) / ".tx" / "sess" / "subagents" / "workflows" / ("wf_" + wid))
    return {wid: {k: ("%s-%s" % (writer_prefix, k[0]), [str(run)]) for k in _file_records(root, wid)[wid]}}


def _journal_verdicts(state_dir, root, wid, writer_prefix="qc"):
    """Test helper: journal every verdict file of wid currently on disk, as the guard does for an attested subagent write."""
    conn = open_journal(state_dir)
    try:
        for uid, aid, sha in _file_records(root, wid)[wid]:
            conn.execute("INSERT OR IGNORE INTO verdict_records VALUES(?,?,?,?,?,?,?,?)", (str((Path(root) / "SWARM-PLAN.json").resolve()), wid, uid, aid, sha, "%s-%s" % (writer_prefix, uid), "test-launch-" + wid, time.time()))
        tx, _run = _mkrun(root, wid)
        conn.execute("CREATE TABLE IF NOT EXISTS launches(id TEXT PRIMARY KEY,session TEXT,transcript TEXT,created REAL,script_hash TEXT,state TEXT,name TEXT,peak INTEGER,receipt TEXT)")
        conn.execute("INSERT OR REPLACE INTO launches VALUES(?,?,?,?,?,?,?,?,?)", ("test-launch-" + wid, "s", str(tx), time.time(), "h", "COMPLETED", "n", 1, json.dumps({"run_id": "wf_" + wid})))
        conn.commit()
    finally:
        conn.close()


def _windowed(script, n):
    """GOOD_SCRIPT-style script with the canonical rolling window around every agent() call."""
    return ("export const meta = { name: 'x', description: 'y' }\n" + window_helper(n)
            + script.split("\n", 1)[1].replace("=> agent(", "=> wgSlot(() => agent(").replace(" }),", " })),").replace(" }))\nreturn", " })))\nreturn"))


GOOD_SCRIPT = ("export const meta = { name: 'x', description: 'y' }\n"
               "const r = await pipeline(args.units, (u) => agent('build ' + u, { label: 'b', phase: 'Build', model: 'opus' }),"
               " (b, u) => agent('check ' + u, { label: 'c', phase: 'QC', model: 'sonnet' }))\nreturn r\n")


def selftest():
    global PROBE
    PROBE = lambda: {"per_workflow_cap": 10}  # deterministic: the live probe is exercised by its own fixtures below
    fails = []

    def check(name, cond, detail=""):
        print(("PASS " if cond else "FAIL ") + name + ((" -- " + str(detail)) if detail and not cond else ""))
        if not cond:
            fails.append(name)

    tmp = Path(tempfile.mkdtemp(prefix="staffing-selftest."))
    proj, sd = tmp / "proj", tmp / "state"
    (proj / "a" / "b").mkdir(parents=True)
    sd.mkdir()
    plan = _mkplan(proj, {"W0-01": 8, "W0-02": 6, "W0-03": 12, "W0-04": 3}, maw=2, deps={"W0-04": ["W0-01"]})
    doc = json.loads(plan.read_text())
    check("valid plan has no errors", validate_plan(doc) == [], validate_plan(doc))
    check("agent_count = min(cap 10, units)", [agent_count(w, plan_cap(doc)) for w in workflows(doc)] == [8, 6, 10, 3])
    # measured cap 6: 8 units -> 6 accepted, 8 rejected; cap missing / 11 rejected; probe mismatch rejected
    c6 = {"W6-01": 8}
    d6 = json.loads(_mkplan(tmp / "c6", c6, cap=6).read_text()) if (tmp / "c6").mkdir() is None else None
    check("cap 6, 8 units -> agent_count 6 accepted", d6["workflows"][0]["agent_count"] == 6 and validate_plan(d6) == [], validate_plan(d6))
    d6["workflows"][0]["agent_count"] = d6["workflows"][0]["concurrency"] = 8
    check("cap 6, agent_count 8 rejected", "W6-01: agent_count must be min(max_agents_per_workflow, len(units)) = 6" in validate_plan(d6) and "W6-01: concurrency must equal agent_count = 6" in validate_plan(d6), validate_plan(d6))
    d6 = json.loads(json.dumps(doc)); del d6["policy"]["max_agents_per_workflow"]
    MAXMSG = "policy.max_agents_per_workflow must be an integer 1..10 (the measured per-workflow cap)"
    check("missing policy.max_agents_per_workflow rejected", MAXMSG in validate_plan(d6), validate_plan(d6))
    d6["policy"]["max_agents_per_workflow"] = 11
    check("policy cap 11 rejected", MAXMSG in validate_plan(d6), validate_plan(d6))
    d6 = json.loads(json.dumps(doc)); d6["policy"]["capacity_probe"] = {"per_workflow_cap": 10}
    check("capacity_probe matching cap accepted", validate_plan(d6) == [], validate_plan(d6))
    d6["policy"]["capacity_probe"]["per_workflow_cap"] = 6
    check("capacity_probe differing cap rejected", "policy.max_agents_per_workflow must equal policy.capacity_probe.per_workflow_cap" in validate_plan(d6), validate_plan(d6))
    def mut(f):
        d = json.loads(json.dumps(doc)); f(d); return validate_plan(d)
    check("padding 'slice N of M' rejected with the checker's message", '%s: %s work is "slice N of M" padding' % ("W0-01", "W0-01-U1") in mut(lambda d: d["workflows"][0]["units"][0].__setitem__("work", "Build Slice 3 of 8")))
    check("repeated work text (digits/whitespace/case ignored) rejected", "W0-01: W0-01-U2 work duplicates another unit (padding)" in mut(lambda d: d["workflows"][0]["units"][1].__setitem__("work", d["workflows"][0]["units"][0]["work"].upper() + " 7 ")))
    check("workflow-level verdict_file rejected as leftover", "W0-01: leftover key verdict_file \u2014 a workflow is done when every unit has a valid PASS verdict" in mut(lambda d: d["workflows"][0].__setitem__("verdict_file", "evidence/W0-01/verdict.json")))
    check("status active rejected; running and planned-not-running accepted", any(x.startswith("plan status must be planned-not-running or running") for x in mut(lambda d: d.__setitem__("status", "active"))) and not mut(lambda d: d.__setitem__("status", "running")) and not mut(lambda d: d.__setitem__("status", "planned-not-running")))
    for k in LEFTOVER_KEYS:
        d6 = json.loads(json.dumps(doc)); d6["workflows"][0][k] = 1
        check("leftover key %s rejected" % k, "W0-01: leftover key %s \u2014 staffing is derived from units" % k in validate_plan(d6), validate_plan(d6))
    lsd = tmp / "lim"; lsd.mkdir(); (lsd / "limits.json").write_text(json.dumps({"concurrent_agents_per_workflow": 4}))
    check("launch cap = min(plan 10, limits 4) = 4", launch_agent_cap(doc, lsd) == 4 and compute(plan, doc, agent_cap=4)["agents"]["W0-03"] == 4)
    bad = json.loads(plan.read_text())
    bad["workflows"][0]["agent_count"] = 10
    bad["workflows"][1]["units"][0]["owned_output"] = bad["workflows"][1]["units"][1]["owned_output"]
    bad["policy"]["max_active_workflows"] = 51
    e = validate_plan(bad)
    check("invalid plan reports agent_count, owned_output, max_active", "W0-01: agent_count must be min(max_agents_per_workflow, len(units)) = 8" in e and any("owned_output" in x and "overlaps" in x for x in e) and "policy.max_active_workflows must be an integer 1..50" in e, e)
    def _oo(*vals):
        d = json.loads(json.dumps(doc)); us = d["workflows"][0]["units"]
        for u, v in zip(us, vals): u["owned_output"] = v
        return validate_plan(d)
    ov = lambda e: any("overlaps" in x for x in e)
    check("owned dir accepted", not _oo("t/creative/", "t/other.py"), _oo("t/creative/", "t/other.py"))
    check("owned file accepted", not _oo("t/a.py", "t/b.py"))
    check("dir/file overlap rejected", ov(_oo("a/b/", "a/b/c.py")))
    check("equal owned rejected", ov(_oo("a/b.py", "a/b.py")))
    check("sibling prefix a/b vs a/bc.py accepted", not _oo("a/b", "a/bc.py"))
    check("absolute owned rejected", "W0-01: W0-01-U1 owned_output must be repo-relative, not absolute: '/etc/x.py'" in _oo("/etc/x.py", "t/b.py"), _oo("/etc/x.py", "t/b.py"))
    check("dotdot owned rejected", "W0-01: W0-01-U1 owned_output must not contain '..': 'a/../x.py'" in _oo("a/../x.py", "t/b.py"), _oo("a/../x.py", "t/b.py"))
    # discovery
    check("find_plan walks upward", find_plan(proj / "a" / "b")[0] == plan.resolve())
    nop = tmp / "noplan"
    nop.mkdir()
    check("no plan -> allowed (ceilings only)", find_plan(nop) is None and check_launch({"args": {}}, nop, state_dir=sd, reap=False)[0])
    alt = tmp / "alt"
    (alt / "sub").mkdir(parents=True)
    (alt / "docs").mkdir()
    pplan = _mkplan(alt / "docs", {"P-01": 2})
    (alt / ".spec-protocol.json").write_text(json.dumps({"swarmPlan": "docs/SWARM-PLAN.json"}))
    check("swarmPlan pointer wins", find_plan(alt / "sub")[0] == pplan.resolve())
    # compute
    s = compute(plan, doc)
    check("owed follows plan max_active (2) and plan order", s["owed"] == ["W0-01", "W0-02"] and s["ready"] == ["W0-01", "W0-02", "W0-03"], s)
    check("dependent workflow not ready", "W0-04" not in s["ready"])
    s = compute(plan, doc, running={"W0-01"})
    check("running counts toward max_active", s["owed"] == ["W0-02"], s)
    s = compute(plan, doc, running={"W0-01", "W0-02"})
    check("at max_active nothing owed", s["owed"] == [], s)
    A1 = {"W0-01": {"A1"}}
    R = lambda: _file_records(proj, "W0-01")
    P = lambda: _proof(proj, "W0-01")
    _verdict(proj, "W0-01", "FAIL")
    check("FAIL verdict is not done", compute(plan, doc, attempts=A1, records=R(), proof=P())["done"] == [])
    _verdict(proj, "W0-01", "PASS")
    check("PASS without an admitted attempt id is not done", compute(plan, doc)["done"] == [] and compute(plan, doc, attempts={"W0-01": {"B9"}})["done"] == [])
    _verdict(proj, "W0-01", "PASS")
    check("control: PASS + admitted attempt + journal record + different families -> done", compute(plan, doc, attempts=A1, records=R(), proof=P())["done"] == ["W0-01"], compute(plan, doc, attempts=A1, records=R(), proof=P()))
    check("PASS verdict with NO journal record is not done (a hand-written file never counts)", compute(plan, doc, attempts=A1)["done"] == [] and compute(plan, doc, attempts=A1, records={"W0-01": set()})["done"] == [])
    rr = R(); rr["W0-01"] = {(u_, a_, "0" * 64) for (u_, a_, _s) in rr["W0-01"]}
    check("journal sha256 differing from the file (edited after journaling) is not done", compute(plan, doc, attempts=A1, records=rr, proof=P())["done"] == [])
    rr = R(); rr["W0-01"] = {(u_, "A9", s_) for (u_, a_, s_) in rr["W0-01"]}
    check("journal record under another attempt_id is not done", compute(plan, doc, attempts=A1, records=rr, proof=P())["done"] == [])
    for b_, r_ in (("claude-opus-4-5", "opus"), ("anthropic/claude-opus-4-5-20251101", "OPUS"), ("ds/deepseek-flash", "deepseek-v4-pro"), ("gpt-5", "openai/GPT-4o"), ("zz-model-7", "ZZ_MODEL 8")):
        _verdict(proj, "W0-01", builder=b_, reviewer=r_)
        check("same model family under two names is not done: %r vs %r" % (b_, r_), model_family(b_) == model_family(r_) and compute(plan, doc, attempts=A1, records=R(), proof=P())["done"] == [], (model_family(b_), model_family(r_)))
    check("model_family normalizes vendor prefix, version, date, case", model_family("anthropic/claude-opus-4-5-20251101") == "opus" and model_family("Claude-3-5-Sonnet-20241022") == "sonnet" and model_family("ollama/glm-5.3:cloud") == "glm" and model_family("opus") != model_family("sonnet"))
    _verdict(proj, "W0-01", "PASS")
    for label, kw in (("builder == reviewer", {"builder": "opus", "reviewer": "Opus"}), ("empty reviewer", {"reviewer": ""}), ("empty builder", {"builder": " "}), ("verdict 'pass'", {"v": "pass"}), ("verdict 'PASS '", {"v": "PASS "})):
        _verdict(proj, "W0-01", **kw)
        check("unit verdict invalid: %s" % label, compute(plan, doc, attempts=A1, records=R(), proof=P())["done"] == [])
    _verdict(proj, "W0-01", "PASS")
    u1 = next(w for w in workflows(doc) if w["workflow_id"] == "W0-01")["units"][0]["verdict_file"]
    d_ = json.loads((proj / u1).read_text()); d_["unit_id"] = "W0-01-U2"; (proj / u1).write_text(json.dumps(d_))
    check("unit verdict naming another unit is not done", compute(plan, doc, attempts=A1, records=R(), proof=P())["done"] == [])
    _verdict(proj, "W0-01", "FAIL")
    _verdict(proj, "W0-01", "PASS", unit_ids_={"W0-01-U1"})
    check("a workflow is done only when EVERY unit has a PASS (7 of 8 -> not done)", compute(plan, doc, attempts=A1, records=R(), proof=P())["done"] == [])
    _verdict(proj, "W0-01", "PASS")
    s = compute(plan, doc, attempts=A1, records=R(), proof=P())
    check("PASS verdict makes done and releases dependents", s["done"] == ["W0-01"] and s["ready"] == ["W0-02", "W0-03", "W0-04"] and s["owed"] == ["W0-02", "W0-03"], s)
    doc2 = json.loads(plan.read_text())
    doc2["status"] = "complete"
    check("status field ignored for done", compute(plan, doc2, attempts=A1, records=R(), proof=P())["done"] == ["W0-01"] and compute(plan, doc2)["done"] == [])
    s = compute(plan, doc, launches={"W0-02": 3}, attempts=A1, records=R(), proof=P())
    check("handback after 3 launches, not owed", s["handback"] == ["W0-02"] and "W0-02" not in s["owed"] and s["owed"] == ["W0-03", "W0-04"], s)
    check("armed iff status running; a recorded launch alone does not arm; 'active' does not arm", is_armed({"status": "running"}) and not is_armed({"status": "planned-not-running"}) and not is_armed({"status": "active"}))
    sr = tmp / "setrun"; sr.mkdir(); srp = _mkplan(sr, {"S-01": 2})
    srp.write_text(json.dumps(json.loads(srp.read_text()), indent=2, ensure_ascii=False) + "\n")
    check("set_running flips planned-not-running -> running (indent 2, trailing newline) once", set_running(srp) and json.loads(srp.read_text())["status"] == "running" and srp.read_text().endswith("}\n") and "\n  \"status\": \"running\"" in srp.read_text() and not set_running(srp))
    # journal + launch contract (reap off: temp state)
    conn = open_journal(sd)
    conn.executescript("CREATE TABLE IF NOT EXISTS launches(id TEXT PRIMARY KEY,session TEXT,transcript TEXT,created REAL,script_hash TEXT,state TEXT,name TEXT,peak INTEGER,receipt TEXT);")
    conn.execute("INSERT INTO launches VALUES('t1','s1','',?,'h','VALIDATED','n',8,'')", (time.time(),))
    conn.execute("INSERT INTO launch_tags VALUES('t1','s1','W0-02',?,?)", (str(plan), time.time()))
    conn.commit()
    v = journal_view(conn, plan, ["W0-02", "W0-03"], "s1")
    check("journal view: live launch is running + armed", v["running"] == {"W0-02"} and v["launches"] == {"W0-02": 1} and v["any"], v)
    conn.execute("DELETE FROM launch_tags")
    conn.execute("INSERT INTO attempt_ids VALUES(?,?,?,?,?)", (str(plan.resolve()), "A1", "W0-01", "t0", time.time()))
    conn.commit()
    conn.close()
    _journal_verdicts(sd, proj, "W0-01")
    want = unit_ids(workflows(doc)[2])  # W0-03: 12 units; but agent_count 10
    w3 = {"workflowId": "W0-03", "units": want, "attemptId": "W0-03-1"}
    WIN10 = _windowed(GOOD_SCRIPT, 10)
    cases = [
        ("wrong workflowId blocked", {"script": GOOD_SCRIPT, "args": {"workflowId": "NOPE", "units": want}}, False, 'args.workflowId is "NOPE"; it must equal a workflow_id of this plan'),
        ("missing workflowId blocked", {"script": GOOD_SCRIPT, "args": {"units": want}}, False, "args.workflowId is missing; it must equal a workflow_id of this plan"),
        ("missing units blocked", {"script": GOOD_SCRIPT, "args": {"workflowId": "W0-03"}}, False, "args.units is missing; it must be the list of this workflow's unit_ids"),
        ("11 of 12 units blocked", {"script": GOOD_SCRIPT, "args": {"workflowId": "W0-03", "units": want[:-1], "attemptId": "a1"}}, False, "exactly 12"),
        ("extra unit blocked", {"script": GOOD_SCRIPT, "args": {"workflowId": "W0-03", "units": want + ["W0-03-U13"], "attemptId": "a1"}}, False, "exactly 12"),
        ("name-only launch blocked", {"args": w3}, False, "a launch by saved name has no script this guard can read"),
        ("no fan-out stage blocked", {"script": GOOD_SCRIPT.replace("args.units", "['a','b','c']"), "args": w3}, False, "must take args.units itself"),
        ("unreadable scriptPath blocked", {"scriptPath": str(tmp / "missing.js"), "args": w3}, False, "missing.js cannot be read"),
        ("missing attemptId blocked", {"script": GOOD_SCRIPT, "args": {"workflowId": "W0-03", "units": want}}, False, "args.attemptId is missing; it must be a non-empty unique string"),
        ("empty attemptId blocked", {"script": GOOD_SCRIPT, "args": {"workflowId": "W0-03", "units": want, "attemptId": " "}}, False, "args.attemptId is empty or not a string"),
        ("12 units over cap 10 without a window blocked", {"script": GOOD_SCRIPT, "args": w3}, False, "per-workflow cap of 10"),
        ("window 12 > cap 10 blocked", {"script": _windowed(GOOD_SCRIPT, 12), "args": w3}, False, "per-workflow cap of 10"),
        ("altered window helper blocked", {"script": WIN10.replace("wg.active >= WG_WINDOW", "wg.active >= 99"), "args": w3}, False, "altered"),
        ("agent outside wgSlot blocked", {"script": WIN10.replace("=> wgSlot(() => agent('check", "=> agent('check").replace("'sonnet' })))", "'sonnet' }))"), "args": w3}, False, "wgSlot"),
        ("extra parallel stage over hard-coded array blocked", {"script": WIN10.replace("return r", "const e = await parallel(['x','y'].map(t => () => wgSlot(() => agent('b '+t, { label: 'e', phase: 'Build', model: 'opus' }))))\nreturn r"), "args": w3}, False, "exactly ONE"),
        ("bare agent() outside the stage blocked", {"script": WIN10.replace("return r", "const e = await wgSlot(() => agent('solo', { label: 'e', phase: 'Build', model: 'opus' }))\nreturn r"), "args": w3}, False, "outside"),
        ("decoy stage + lumped builder blocked", {"script": "export const meta = {name:'x',description:'y'}\nconst r = await pipeline(args.units, (u) => agent('ok', { label: 'c', phase: 'QC', model: 'haiku' }))\nconst all = await agent('build ALL', { label: 'b', phase: 'Build', model: 'opus' })\nreturn r\n", "args": {"workflowId": "W0-02", "units": unit_ids(workflows(doc)[1]), "attemptId": "d1"}}, False, "outside"),
        ("stage over a sliced unit list blocked", {"script": GOOD_SCRIPT.replace("pipeline(args.units,", "pipeline(args.units.slice(0,3),"), "args": {"workflowId": "W0-02", "units": unit_ids(workflows(doc)[1]), "attemptId": "d2"}}, False, "args.units itself"),
        ("hard-coded array stage blocked", {"script": GOOD_SCRIPT.replace("pipeline(args.units,", "pipeline(['a','b'],"), "args": {"workflowId": "W0-02", "units": unit_ids(workflows(doc)[1]), "attemptId": "d3"}}, False, "args.units itself"),
        ("agent hidden in template literal blocked", {"script": GOOD_SCRIPT.replace("return r", "const t = `${await agent('solo', { label: 'e', phase: 'Build', model: 'opus' })}`\nreturn r"), "args": {"workflowId": "W0-02", "units": unit_ids(workflows(doc)[1]), "attemptId": "d4"}}, False, "outside"),
        ("exact match allowed", {"script": WIN10, "args": w3}, True, ""),
        ("units as the plan's own unit objects allowed", {"script": WIN10, "args": {"workflowId": "W0-03", "units": json.loads(json.dumps(workflows(doc)[2]["units"])), "attemptId": "W0-03-2"}}, True, ""),
        ("unit objects with only unit_id (all other fields missing) blocked", {"script": WIN10, "args": {"workflowId": "W0-03", "units": [{"unit_id": u} for u in want], "attemptId": "W0-03-3"}}, False, "differ from the plan's unit object"),
        ("unit objects with rewritten work text blocked (N13e)", {"script": WIN10, "args": {"workflowId": "W0-03", "units": [dict(u, work="rm -rf the repo instead") if k == 0 else u for k, u in enumerate(json.loads(json.dumps(workflows(doc)[2]["units"])))], "attemptId": "W0-03-4"}}, False, 'args.units entry ["W0-03-U1"] differs from the plan\'s unit object'),
        ("unit objects with a rewritten owned_output and an added field blocked", {"script": WIN10, "args": {"workflowId": "W0-03", "units": [dict(u, owned_output="/etc/passwd", extra=1) if k == 1 else u for k, u in enumerate(json.loads(json.dumps(workflows(doc)[2]["units"])))], "attemptId": "W0-03-5"}}, False, 'args.units entry ["W0-03-U2"] differs from the plan\'s unit object'),
        ("stage over args.units.filter(...) blocked (runs fewer units than declared)", {"script": WIN10.replace("pipeline(args.units,", "pipeline(args.units.filter(u => u.unit_id !== 'W0-03-U1'),"), "args": {"workflowId": "W0-03", "units": want, "attemptId": "W0-03-6"}}, False, "its first argument must be exactly the expression args.units"),
        ("stage over a const alias of args.units blocked", {"script": WIN10.replace("const r = await pipeline(args.units,", "const us = args.units;\nconst r = await pipeline(us,"), "args": {"workflowId": "W0-03", "units": want, "attemptId": "W0-03-7"}}, False, "its first argument must be exactly the expression args.units"),
        ("parallel(args.units.map(...)) stage blocked", {"script": GOOD_SCRIPT.replace("pipeline(args.units, (u) =>", "parallel(args.units.map((u) => () =>").replace("model: 'opus' }),", "model: 'opus' })").replace(" (b, u) => agent('check ' + u, { label: 'c', phase: 'QC', model: 'sonnet' }))", "))"), "args": {"workflowId": "W0-02", "units": unit_ids(workflows(doc)[1]), "attemptId": "W0-02-pm"}}, False, "its first argument must be exactly the expression args.units"),
        ("args as JSON text allowed", {"script": WIN10, "args": json.dumps(w3)}, True, ""),
    ]
    for name, ti, want_ok, needle in cases:
        ok, msg = check_launch(ti, proj / "a", session="s1", state_dir=sd, reap=False, attempt_id=name)
        check(name, ok == want_ok and (not needle or needle in msg) and (ok or ("W0-0" in msg and "agent_count" in msg)), msg[:300])
    dep = tmp / "dep"
    dep.mkdir()
    _mkplan(dep, {"A-01": 2, "A-02": 2}, deps={"A-02": ["A-01"]})
    ok, msg = check_launch({"script": GOOD_SCRIPT, "args": {"workflowId": "A-02", "units": ["A-02-U1", "A-02-U2"], "attemptId": "z"}}, dep, state_dir=sd, reap=False)
    check("dependency-blocked workflow blocked", not ok and "not ready" in msg and "A-01" in msg, msg[:200])
    ok, msg = check_launch({"script": GOOD_SCRIPT, "args": {"workflowId": "W0-02", "units": unit_ids(workflows(doc)[1]), "attemptId": "W0-02-1"}}, proj, session="s1", state_dir=sd, reap=False)
    check("ready W0-02 allowed", ok, msg)
    conn = open_journal(sd); conn.execute("INSERT INTO attempt_ids VALUES(?,?,?,?,?)", (str(plan.resolve()), "W0-02-1", "W0-02", "t9", time.time())); conn.commit(); conn.close()
    ok, msg = check_launch({"script": GOOD_SCRIPT, "args": {"workflowId": "W0-02", "units": unit_ids(workflows(doc)[1]), "attemptId": "W0-02-1"}}, proj, session="s1", state_dir=sd, reap=False)
    check("attemptId already admitted is refused", not ok and "already used" in msg, msg[:200])
    # measured cap 6, 8 units: plan cap 6 -> a window of 6 passes, none or 8 is blocked
    c6d = tmp / "c6b"; c6d.mkdir(); _mkplan(c6d, {"X-01": 8}, cap=6, maw=1)
    x8 = unit_ids(workflows(json.loads((c6d / "SWARM-PLAN.json").read_text()))[0])
    for label, scr, want_ok in (("cap 6 / 8 units, window 6 allowed", _windowed(GOOD_SCRIPT, 6), True), ("cap 6 / 8 units, no window blocked", GOOD_SCRIPT, False), ("cap 6 / 8 units, window 8 blocked", _windowed(GOOD_SCRIPT, 8), False)):
        ok, msg = check_launch({"script": scr, "args": {"workflowId": "X-01", "units": x8, "attemptId": "x-" + label[:12]}}, c6d, state_dir=sd, reap=False)
        check(label, ok == want_ok and (ok or ("per-workflow cap of 6 agents at once for 8 units" in msg and "FIX" in msg)), msg[:240])
    ok, msg = check_launch({"script": GOOD_SCRIPT, "args": {"workflowId": "W0-01", "units": unit_ids(workflows(doc)[0]), "attemptId": "W0-01-1"}}, proj, session="s1", state_dir=sd, reap=False)
    check("done W0-01 relaunch blocked", not ok and "already done" in msg, msg[:200])
    # session-pinned (armed) plans survive a cwd change; unarmed plans stay cwd-scoped
    away = tmp / "away"
    away.mkdir()
    armed = tmp / "armed"
    armed.mkdir()
    _mkplan(armed, {"R-01": 2}, status="running")
    unarmed = tmp / "unarmed"
    unarmed.mkdir()
    _mkplan(unarmed, {"N-01": 2}, status="planned")
    check("unarmed plan + cwd away -> no plan", (resolve_plan(unarmed, "sA", sd), resolve_plan(away, "sA", sd)) [1] is None)
    check("armed plan found from its cwd", resolve_plan(armed, "sB", sd)[0] == (armed / "SWARM-PLAN.json").resolve())
    pinned = resolve_plan(away, "sB", sd)
    check("armed session keeps its plan after cwd moves", pinned is not None and pinned[0] == (armed / "SWARM-PLAN.json").resolve())
    check("another session is unaffected", resolve_plan(away, "sC", sd) is None)
    ok, msg = check_launch({"script": GOOD_SCRIPT, "args": {}}, away, session="sB", state_dir=sd, reap=False)
    check("armed session + cwd away + unplanned Workflow blocked", not ok and "R-01" in msg, msg[:200])
    c2 = open_journal(sd)
    c2.execute("CREATE TABLE IF NOT EXISTS continuations(session TEXT PRIMARY KEY,count INTEGER,latched INTEGER,updated REAL)")
    c2.execute("INSERT OR REPLACE INTO continuations VALUES('sB',0,1,0)")
    c2.commit()
    c2.close()
    check("the user's stop latch suspends the pinned plan", resolve_plan(away, "sB", sd) is None)
    pins = lambda sess: [r[0] for r in sqlite3.connect(sd / "guard.sqlite3").execute("SELECT plan FROM session_pins WHERE session=?", (sess,)).fetchall()]
    check("the pin ROW survives the latch (defect 6)", pins("sB") == [str((armed / "SWARM-PLAN.json").resolve())], pins("sB"))
    c2 = open_journal(sd); c2.execute("UPDATE continuations SET latched=0 WHERE session='sB'"); c2.commit(); c2.close()
    pb = resolve_plan(away, "sB", sd)
    check("after the next human message clears the latch the pin governs again", pb is not None and pb[0] == (armed / "SWARM-PLAN.json").resolve(), pb)
    # defect 7: a second armed plan never replaces the first pin; both are evaluated
    armed2 = tmp / "armed2"; armed2.mkdir(); _mkplan(armed2, {"R2-01": 2}, status="running")
    both = resolve_plans(armed2, "sB", sd)
    check("a second armed plan is ADDED, the first pin is kept (defect 7)", [str(x[0]) for x in both] == [str((armed2 / "SWARM-PLAN.json").resolve()), str((armed / "SWARM-PLAN.json").resolve())] and len(pins("sB")) == 2, ([str(x[0]) for x in both], pins("sB")))
    sn = snapshots(away, sd, "sB", reap=False)
    check("snapshots() evaluates every pinned armed plan (owed = union of both)", sorted(x for q in sn for x in q["state"]["owed"]) == ["R-01", "R2-01"], [q["state"]["owed"] for q in sn])
    ok, msg = check_launch({"script": GOOD_SCRIPT, "args": {"workflowId": "R2-01", "units": ["R2-01-U1", "R2-01-U2"], "attemptId": "r2-1"}}, away, session="sB", state_dir=sd, reap=False)
    check("a launch of the second pinned plan's workflow is judged against THAT plan", ok, msg[:200])
    _verdict(armed, "R-01", "PASS", attempt="RA")
    c2 = open_journal(sd); c2.execute("INSERT INTO attempt_ids VALUES(?,?,?,?,?)", (str((armed / "SWARM-PLAN.json").resolve()), "RA", "R-01", "lr", time.time())); c2.commit(); c2.close()
    _journal_verdicts(sd, armed, "R-01")
    resolve_plans(away, "sB", sd)
    check("a finished plan's pin is deleted (only when every workflow is DONE)", pins("sB") == [str((armed2 / "SWARM-PLAN.json").resolve())], pins("sB"))
    # defect 5: a pinned plan whose file vanished while launches are recorded is armed + invalid, never "no plan"
    van = tmp / "van"; van.mkdir(); vp = _mkplan(van, {"V-01": 2}, status="running")
    resolve_plans(van, "sV", sd)
    c2 = open_journal(sd); c2.execute("INSERT INTO launch_tags VALUES('lv','sV','V-01',?,?)", (str(vp.resolve()), time.time())); c2.commit(); c2.close()
    vp.rename(van / "gone.bak")
    rv = resolve_plans(away, "sV", sd)
    sv = snapshot(away, sd, "sV", reap=False)
    check("vanished pinned plan with launches -> governs as ARMED + INVALID 'plan file missing'", len(rv) == 1 and rv[0][1] is None and sv["armed"] and any(e.startswith("plan file missing: ") for e in sv["errors"]), (rv, sv and sv["errors"], sv and sv["armed"]))
    van2 = tmp / "van2"; van2.mkdir(); vp2 = _mkplan(van2, {"V2-01": 2}, status="running")
    resolve_plans(van2, "sV2", sd); vp2.unlink()
    check("vanished pinned plan with NO launch recorded drops the pin (nothing was ever launched)", resolve_plans(away, "sV2", sd) == [] and pins("sV2") == [])
    # defect 18: repair relaunch = exactly the not-yet-PASS units; first launch = all units
    rep_ = tmp / "rep"; rep_.mkdir(); rp = _mkplan(rep_, {"Q-01": 4}, status="running", maw=1)
    rdoc = json.loads(rp.read_text()); q4 = unit_ids(workflows(rdoc)[0])
    _verdict(rep_, "Q-01", "PASS", attempt="QA1", unit_ids_=q4[:2]); _verdict(rep_, "Q-01", "FAIL", attempt="QA1", unit_ids_=q4[2:])
    c2 = open_journal(sd); c2.execute("INSERT INTO attempt_ids VALUES(?,?,?,?,?)", (str(rp.resolve()), "QA1", "Q-01", "lq", time.time())); c2.commit(); c2.close()
    _journal_verdicts(sd, rep_, "Q-01")
    qobj = lambda ids_: [json.loads(json.dumps(u)) for u in workflows(rdoc)[0]["units"] if u["unit_id"] in ids_]
    for label, units_, aid_, want_ok, needle in (
            ("repair relaunch with exactly the 2 not-yet-PASS units (objects) allowed", qobj(q4[2:]), "q-r1", True, ""),
            ("repair relaunch with the not-yet-PASS unit ids allowed", q4[2:], "q-r2", True, ""),
            ("full relaunch of all 4 units while 2 already PASS blocked (repair = only the pending ones)", q4, "q-r3", False, "a repair relaunch must carry exactly the 2 not-yet-PASS units"),
            ("repair relaunch re-running a PASS unit blocked", [q4[0], q4[2], q4[3]], "q-r4", False, "a repair relaunch must carry exactly the 2 not-yet-PASS units"),
            ("repair relaunch with only 1 of the 2 pending units blocked", q4[3:], "q-r5", False, "a repair relaunch must carry exactly the 2 not-yet-PASS units")):
        ok, msg = check_launch({"script": GOOD_SCRIPT, "args": {"workflowId": "Q-01", "units": units_, "attemptId": aid_}}, rep_, session="sQ", state_dir=sd, reap=False)
        check(label, ok == want_ok and (ok or needle in msg), msg[:300])
    check("pending_units() lists exactly the not-yet-PASS unit objects", [u["unit_id"] for u in pending_units(rp, rdoc, workflows(rdoc)[0], sd)] == q4[2:])
    # defect 12: the cap is MEASURED at launch, not just typed in the plan; cached per session for 10 minutes
    pr = tmp / "probe"; pr.mkdir()
    PROBE = lambda: {"per_workflow_cap": 4}
    c4 = launch_agent_cap(doc, pr, "sess1")
    PROBE = lambda: {"per_workflow_cap": 9}
    check("live probe lowers the plan cap (plan 10, probe 4 -> 4) and the result is cached per session", c4 == 4 and launch_agent_cap(doc, pr, "sess1") == 4, c4)
    check("another session measures afresh; the probe can never RAISE the plan cap", launch_agent_cap(doc, pr, "sess2") == 9 and launch_agent_cap(json.loads(_mkplan(tmp / "c6", {"W6-01": 8}, cap=6).read_text()), pr, "sess3") == 6)
    check("cache expires after 10 minutes", probed_cap(pr, "sess1", now=time.time() + 601) == 9 and probed_cap(pr, "sess1", now=time.time() + 30) == 9)
    PROBE = lambda: (_ for _ in ()).throw(OSError("probe broke"))
    check("a failing probe leaves the plan cap in force", launch_agent_cap(doc, tmp / "probe2", "x") == 10)
    PROBE = lambda: {"per_workflow_cap": 10}
    pc = tmp / "pcap"; pc.mkdir(); _mkplan(pc, {"P-01": 8}, maw=1)
    PROBE = lambda: {"per_workflow_cap": 6}
    ok, msg = check_launch({"script": GOOD_SCRIPT, "args": {"workflowId": "P-01", "units": unit_ids(workflows(json.loads((pc / "SWARM-PLAN.json").read_text()))[0]), "attemptId": "p1"}}, pc, state_dir=tmp / "probe3", reap=False)
    check("8 units, plan cap 10, probe measures 6: unwindowed launch blocked by the MEASURED cap", not ok and "per-workflow cap of 6 agents at once for 8 units" in msg, msg[:300])
    PROBE = lambda: {"per_workflow_cap": 10}
    # #5 exact concurrency window: min(cap, units), helper forbidden when units fit
    for label, scr, cap_, n_, needle in (
            ("window 1 with 7 units cap 10 refused (fewer agents than units)", _windowed(GOOD_SCRIPT, 1), 10, 7, "forbidden"),
            ("window helper with 7 units cap 10 refused (units fit the cap)", _windowed(GOOD_SCRIPT, 10), 10, 7, "forbidden"),
            ("window helper with 10 units cap 10 refused (units == cap)", _windowed(GOOD_SCRIPT, 10), 10, 10, "forbidden"),
            ("12 units cap 10 window 10 allowed", _windowed(GOOD_SCRIPT, 10), 10, 12, None),
            ("12 units cap 10 window 9 refused (window < cap)", _windowed(GOOD_SCRIPT, 9), 10, 12, "exactly 10"),
            ("12 units cap 10 window 1 refused", _windowed(GOOD_SCRIPT, 1), 10, 12, "exactly 10"),
            ("8 units cap 6 window 6 allowed", _windowed(GOOD_SCRIPT, 6), 6, 8, None),
            ("8 units cap 6 window 5 refused", _windowed(GOOD_SCRIPT, 5), 6, 8, "exactly 6"),
            ("7 units cap 10 plain pipeline allowed", GOOD_SCRIPT, 10, 7, None)):
        wp = window_problem(scr, cap_, n_)
        check(label, (wp is None) if needle is None else (wp is not None and needle in wp), wp)
    # #6 actual model families and who wrote the verdict
    fx = tmp / "fam"; fx.mkdir(); fp = _mkplan(fx, {"F-01": 2}); fdoc = json.loads(fp.read_text()); fwf = workflows(fdoc)[0]
    _verdict(fx, "F-01"); FA = {"F-01": {"A1"}}
    fr = lambda: _file_records(fx, "F-01")
    _tx, frun = _mkrun(fx, "F-01")
    fproof = lambda w="qc": _proof(fx, "F-01", w)
    check("control: qc agent writes, builder opus vs checker sonnet (actual meta.json) -> done", compute(fp, fdoc, attempts=FA, records=fr(), proof=fproof())["done"] == ["F-01"])
    check("builder agent writing its own PASS is not done (writer label is build:, not qc:)", compute(fp, fdoc, attempts=FA, records=fr(), proof=fproof("bu"))["done"] == [])
    check("proof missing -> not done (fail closed)", compute(fp, fdoc, attempts=FA, records=fr())["done"] == [])
    _mkrun(fx, "F-01", builder="opus", checker="claude-opus-4-5")
    check("builder and checker ACTUALLY both opus -> not done even though the verdict JSON claims opus vs sonnet", compute(fp, fdoc, attempts=FA, records=fr(), proof=fproof())["done"] == [])
    _mkrun(fx, "F-01")
    for f_ in frun.glob("agent-qc-*.meta.json"):
        f_.unlink()
    check("checker actual model unreadable (no meta.json) -> not done", compute(fp, fdoc, attempts=FA, records=fr(), proof=fproof())["done"] == [])
    _mkrun(fx, "F-01")
    PIN = lambda b, c: GOOD_SCRIPT.replace("model: 'opus'", "model: '%s'" % b).replace("model: 'sonnet'", "model: '%s'" % c)
    check("launch script with builder and checker pins of the same family refused", family_pin_problem(PIN("opus", "claude-opus-4-5")) is not None and family_pin_problem(PIN("opus", "sonnet")) is None)
    print("staffing.py selftest: %s" % ("ALL PASS" if not fails else "%d FAILED: %s" % (len(fails), ", ".join(fails))))
    return 1 if fails else 0


def main(argv):
    if len(argv) > 1 and argv[1] == "--selftest":
        return selftest()
    if len(argv) > 1 and argv[1] == "start":
        cwd = os.getcwd()
        if "--cwd" in argv and argv.index("--cwd") + 1 < len(argv):
            cwd = argv[argv.index("--cwd") + 1]
        return cmd_start(cwd)
    if len(argv) > 1 and argv[1] == "status":
        cwd, sd, js = os.getcwd(), None, False
        i = 2
        while i < len(argv):
            if argv[i] == "--cwd" and i + 1 < len(argv):
                cwd = argv[i + 1]
                i += 1
            elif argv[i] == "--state-dir" and i + 1 < len(argv):
                sd = argv[i + 1]
                i += 1
            elif argv[i] == "--json":
                js = True
            i += 1
        return cmd_status(cwd, sd, js)
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
