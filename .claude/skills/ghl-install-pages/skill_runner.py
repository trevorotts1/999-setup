"""skill_runner.py — adapter-aware 999 backport of the canonical Skill 06 fixes.

CANONICAL SOURCE (forward-port provenance):
  openclaw-onboarding v27.1.74, merge 6cace0995 (PR #2482, branch
  fix/s06-drive-click-and-instrument) — 06-ghl-install-pages/tools/
  ghl_form_builder.py, ghl_builder.py, and the regression locks in
  tests/test_s06_drive_click_and_instrument.py.

THE FOUR SLICES (completed stable canonical behavior, ported):
  1. VERIFIED-CLICK FALLBACK — ``find text <x> click`` returning rc=0 proves
     NOTHING about activation (live 2026-07-25, row-7 acceptance: the click
     returned '✓ Done' and the Create-new-form modal never opened, while a
     direct DOM .click() on the same button DID — probe-create-modal.json vs
     probe-raw-transport.json). A click whose success matters is verified
     against the step's OWN proof text and, when the text click did not
     activate it, retried ONCE via a direct DOM click; both failing is an
     honest STOP, never a blunder past it.
  2. CONSOLE-DRAIN — agent-browser ``console`` reads a DAEMON-ACCUMULATED
     buffer, not the current navigation's entries (row12-verify/golden-probe-2:
     example.com reproduced byte-identical 3 earlier-page errors). The buffer is
     drained (``console --clear``) IMMEDIATELY BEFORE the navigation; entries
     are attributable to the page ONLY when that drain landed. The zero-console
     gate itself is UNCHANGED — only the measurement is repaired.
  3. PRESERVE-ON-SUCCESS — the pre-fix cleanup deleted the created form on EVERY
     reached path, so a plain success created then instantly deleted its own
     deliverable (form_id/form_url/embed_code pointed at a dead object). A build
     whose body completed is PRESERVED; only a FAILURE deletes what the run
     created (with the existing positive present→absent verification); a
     ``--stop-after-phase`` stop is preserved for ``--resume`` (unchanged).
  4. -I HONESTY — ``python3 -I`` drops the script directory from sys.path, so a
     sibling import (ghl_iframe_drag → Playwright) resolved without ``-I`` and
     vanished under it, and the preflight reported a FALSE Playwright miss. The
     tools/ dir is bootstrapped BEFORE any sibling import and the isolation is
     REPORTED as context — a genuine Playwright miss must never be blamed on
     isolation isolation did not cause, and isolation must never fake a miss.

ADAPTERS PRESERVED (never overwritten — this file ROUTES through them):
  * launch: tools/ghl_builder.browser_cmd (headless-forced, singleton session
    gate) and tools/ghl_form_builder._ab (shlex-quote-per-arg discipline),
    exactly as the 999 distribution spells them.
  * session: tools/ghl_form_builder._canonical_session / browser_manager
    .session_name (ghl-skill6-<loc>, matching browser_manager.sh
    bm_session_name).
  * path: tools/ghl_form_builder._ensure_agent_browser_path (~/.npm-global/bin
    PATH repair) reused on every spawn the dist makes.

RUNTIME ROUTING: ``install()`` wires the four slices onto the loaded 999
modules at their existing module-global seams. NO dist file is edited and no
competing engine is created: every wrapper delegates through an ``._impl``
slot whose default is the distribution's OWN function, so live behavior is the
dist's behavior plus exactly the four canonical deltas. Idempotent.

CHANGED-BEHAVIOR PARITY: ``python3 -I skill_runner.py`` runs the assert-based
self-check — hermetic (no network, no live browser, no GHL) — proving each
slice against the canonical scenario contract AND contrasting it with the
pre-fix behavior it replaces. The dist modules are required (they ship in this
skill's tools/); a missing capability is reported INCOMPLETE, never as done.

Usage (live):  import skill_runner; skill_runner.install()
Usage (check): python3 -I skill_runner.py
"""
from __future__ import annotations

import ast
import contextlib
import hashlib
import importlib
import importlib.util
import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
from typing import Any, Callable, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# SLICE 4: -I honesty. THIS module's skill tools/ dir on sys.path BEFORE any
# sibling import below. ORDER IS LOAD-BEARING: `python3 -I` drops BOTH the
# script directory (sys.path[0] becomes the stdlib zip) AND PYTHONPATH, so a
# sibling module resolves only when the path is bootstrapped here. With this in
# place, importing this module first makes the dist's own soft imports
# (ghl_builder / browser_manager / ghl_iframe_drag) resolve exactly as a
# non-isolated run resolves them — the false-negative trap is routed away.
# ---------------------------------------------------------------------------
_SKILL_ROOT = os.path.dirname(os.path.abspath(__file__))
TOOLS_DIR = os.path.join(_SKILL_ROOT, "tools")
if TOOLS_DIR not in sys.path:
    sys.path.insert(0, TOOLS_DIR)

CANONICAL_VERSION = "v27.1.74"
CANONICAL_MERGE = "6cace0995"          # openclaw-onboarding, PR #2482
CANONICAL_SUITES = "06-ghl-install-pages/tests/test_s06_drive_click_and_instrument.py"

# Canonical iso_note text (F-P9 detail), verbatim from v27.1.74.
ISO_NOTE = (
    " (running under an ISOLATED interpreter: `python3 -I` drops the script "
    "directory from sys.path — this module bootstraps its own tools/ dir, so "
    "the sibling import is unaffected)")


def isolated_mode() -> bool:
    """True when this interpreter runs with ``-I`` / ``-E``-style isolation.

    ``python3 -I`` implies ``-E`` (ignore PYTHON* env) and ``-s`` (no user
    site) and, critically, drops the SCRIPT DIRECTORY from ``sys.path`` — the
    only reason a sibling import could ever fail under ``-I`` while succeeding
    without it. Detection is by OBSERVATION (``sys.flags.isolated``, or the
    tools dir absent from ``sys.path``) — never by guessing from argv."""
    if getattr(sys.flags, "isolated", 0):
        return True
    return TOOLS_DIR not in sys.path


def fp9_report(pw_ok: bool, executable: str, version: str) -> dict:
    """The canonical F-P9 check record, with the isolation context appended
    honestly. The VERDICT is ``pw_ok`` passed through UNTOUCHED — isolation is
    context, never the verdict (the pre-fix report blamed ``-I`` for a
    Playwright miss isolation did not cause, and hid a real miss behind
    're-run without -I')."""
    iso_note = ISO_NOTE if isolated_mode() else ""
    if pw_ok:
        detail = f"Playwright importable under {executable}{iso_note}"
    else:
        detail = (f"Playwright is NOT importable under this interpreter "
                  f"({executable}, python {version}){iso_note}. The LIVE "
                  "walk requires it: F3 rename + F4 field-removal ride "
                  "Playwright-over-CDP (ghl_iframe_drag). Re-run under the "
                  "interpreter that HAS Playwright.")
    return {"check": "F-P9:playwright_interpreter", "pass": bool(pw_ok),
            "detail": detail}


# ---------------------------------------------------------------------------
# SLICE 1: verified-click fallback (canonical _DOM_CLICK_JS / _dom_click_text /
# _click_with_proof, ported). Transports are INJECTED so the 999
# launch/session/path adapters (_ab quoting, canonical session names, PATH
# repair) stay the dist's own code paths.
# ---------------------------------------------------------------------------

# Direct DOM click on the element whose OWN text is exactly ``target`` — the
# mechanism PROVEN to activate GHL's 'Create form' handler where the CLI's
# find-click silently no-ops (probe-create-modal.json). Clicks the first
# VISIBLE match among button / [role=button] / a, exactly like the probe.
DOM_CLICK_JS = (
    "(() => {"
    "  const q = %s;"
    "  const vis = (el) => { const r = el.getBoundingClientRect();"
    "    const s = getComputedStyle(el);"
    "    return r.width > 0 && r.height > 0"
    "      && s.visibility !== 'hidden' && s.display !== 'none'; };"
    "  const nodes = Array.from(document.querySelectorAll('button,[role=button],a'))"
    "    .filter(vis).filter(e => (e.innerText || '').trim() === q);"
    "  if (!nodes.length) return JSON.stringify({clicked: false, n: 0,"
    "    err: 'NO-VISIBLE-MATCH'});"
    "  nodes[0].click();"
    "  return JSON.stringify({clicked: true, n: nodes.length});"
    "})()"
)


def dom_click_text(session: str, target: str, *,
                   eval_fn: Callable[..., str],
                   timeout: int = 15) -> Dict[str, Any]:
    """Click ``target`` through a DIRECT DOM element click (the activation rail
    proven in probe-create-modal.json). EVIDENCE, not a selector guess: the JS
    reports how many visible matches it saw, so a miss is explainable.
    Returns {"clicked": bool, "n": int, "err": str}; never raises."""
    try:
        raw = eval_fn(session, DOM_CLICK_JS % json.dumps(target), timeout=timeout)
        d = json.loads((raw or "").strip() or "{}")
        return {"clicked": bool(d.get("clicked")), "n": int(d.get("n", 0)),
                "err": str(d.get("err", ""))}
    except Exception as exc:  # noqa: BLE001 — a DOM-click miss is reported, never fatal
        return {"clicked": False, "n": 0, "err": f"{type(exc).__name__}: {exc}"}


def click_with_proof(session: str, target: str, proof_text: str, *,
                     click_fn: Callable[..., Any],
                     wait_fn: Callable[..., bool],
                     dom_fn: Callable[..., Dict[str, Any]],
                     timeout: int = 15,
                     wait_s: Optional[float] = None) -> Dict[str, Any]:
    """Click ``target`` and PROVE the click ACTIVATED something.

    Two mechanisms, in order, each verified by the SAME observable the click
    list already declares as the step's ``wait_for`` target:

      1. ``find text <target> click`` — the shipped text verb.
      2. A DIRECT DOM ``.click()`` on the visible element whose own text equals
         ``target`` — the mechanism proven on live GHL when (1) returned rc=0
         '✓ Done' and activated nothing.

    Returns ``{"activated", "mechanism", "attempts", "matches", "detail"}``.
    ``activated=False`` means BOTH mechanisms ran and the proof text never
    materialized — the caller must STOP-and-report, never blunder past it."""
    attempts: List[Dict[str, Any]] = []
    cp = click_fn(session, target, timeout=timeout)
    attempts.append({"mechanism": "find-text", "rc": getattr(cp, "returncode", None)})
    if proof_text and wait_fn(session, proof_text, timeout_s=wait_s):
        return {"activated": True, "mechanism": "find-text", "attempts": attempts,
                "matches": -1,
                "detail": f"'{proof_text}' appeared after the text click"}

    dom = dom_fn(session, target, timeout=timeout)
    attempts.append({"mechanism": "dom-click", "clicked": dom.get("clicked"),
                     "matches": dom.get("n"), "err": dom.get("err", "")})
    if dom.get("clicked") and proof_text and wait_fn(session, proof_text,
                                                     timeout_s=wait_s):
        return {"activated": True, "mechanism": "dom-click", "attempts": attempts,
                "matches": dom.get("n"),
                "detail": f"'{proof_text}' appeared after the direct DOM click"}

    return {"activated": False, "mechanism": "", "attempts": attempts,
            "matches": dom.get("n"),
            "detail": (f"neither a find-text click (rc={getattr(cp, 'returncode', None)}) "
                       "nor a direct DOM click on an element whose text is "
                       f"'{target}' "
                       f"({'no visible match' if not dom.get('clicked') else 'clicked but inert'}) "
                       f"made '{proof_text}' appear")}


# ---------------------------------------------------------------------------
# SLICE 2: console-drain (canonical render_check Step 0 + attribution gate).
# ---------------------------------------------------------------------------

DRAIN_FAIL_PREFIX = "console drain (console --clear) failed (exit "


def drain_console(run_fn: Callable[..., Any], cmd_str: str,
                  timeout: int = 30) -> Dict[str, Any]:
    """Step 0 (canonical v18.2.0): DRAIN the console buffer IMMEDIATELY BEFORE
    the navigation. A failed drain is recorded as evidence, never silently
    ignored: an un-drained read cannot be attributed. stderr ONLY is kept for
    the detail — stdout of ``console`` is buffer CONTENT, and replaying it
    would re-inject another page's lines into this page's errors."""
    try:
        cp = run_fn(shlex.split(cmd_str), capture_output=True, text=True,
                    timeout=timeout)
        rc = int(getattr(cp, "returncode", 1))
    except Exception as exc:  # noqa: BLE001 — a drain miss is evidence, not a crash
        return {"drained": False, "rc": -1,
                "detail": (f"{type(exc).__name__}: {exc}"[:300] or "no stderr")}
    detail = ((getattr(cp, "stderr", "") or "").strip() or "no stderr")[:300]
    return {"drained": rc == 0, "rc": rc, "detail": detail}


def _read_console_entries(console_path: Optional[str]) -> Optional[List[dict]]:
    """Read the console.json the dist's render_check wrote (its exact parsed
    entries). None ⇒ unavailable (attribution cannot be recomputed)."""
    try:
        if not console_path or not os.path.isfile(console_path):
            return None
        with open(console_path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else None
    except Exception:  # noqa: BLE001
        return None


def attribute_console(record: Dict[str, Any], drain: Dict[str, Any], *,
                      is_error_fn: Callable[[str], bool]) -> Dict[str, Any]:
    """Apply the canonical attribution gate to a dist render_check record.

    drained=True  ⇒ the buffer was emptied before the navigation, so the
    entries describe THIS page: the record is unchanged except for
    ``console_drained``. drained=False ⇒ entries are UNATTRIBUTABLE: the
    console-promoted lines are MOVED to ``console_unattributed`` (kept as
    evidence, never reported as this page's error) and ONE drain-failure error
    is recorded instead — the check still FAILS, it just does not blame the
    wrong page twice. The zero-console gate itself is UNCHANGED.

    Conservative floor: when the recorded entries cannot be re-read, the
    original errors are LEFT IN PLACE (a spurious failure beats a silent pass)
    and the drain failure still forces ``ok=False``."""
    record["console_drained"] = bool(drain.get("drained"))
    if drain.get("drained"):
        return record

    moved: List[str] = []
    entries = _read_console_entries(record.get("console_path"))
    if entries is not None:
        def _promoted(entry: dict) -> Optional[str]:
            # Reconstruct exactly what the dist promoted: f"{kind or 'console'}:
            # {msg}"[:400], kind from type/level then text/message/raw.
            kind = (entry.get("type") or entry.get("level") or "").lower()
            msg = entry.get("text") or entry.get("message") or entry.get("raw") or ""
            if kind in ("pageerror", "error", "severe") or is_error_fn(msg):
                return f"{kind or 'console'}: {msg}"[:400]
            return None

        promoted = {p for p in (_promoted(e) for e in entries) if p}
        kept: List[str] = []
        for err in record.get("render_errors", []):
            (moved if err in promoted else kept).append(err)
        record["render_errors"] = kept
    if moved:
        record.setdefault("console_unattributed", []).extend(moved)

    record.setdefault("render_errors", []).append(
        f"{DRAIN_FAIL_PREFIX}{drain.get('rc')}): {drain.get('detail')} "
        "— console entries below may belong to a PREVIOUS navigation")
    record["ok"] = False
    return record


# ---------------------------------------------------------------------------
# SLICE 3: PRESERVE-on-success (canonical _live_build cleanup policy).
# ---------------------------------------------------------------------------

_PRESERVE_SKIP = ("build SUCCEEDED — the created form is the deliverable "
                  "and is PRESERVED for readback/render_check; delete it "
                  "explicitly if a scratch object was intended")


def cleanup_action(phase: str, stopped_after: str = "") -> str:
    """The canonical cleanup decision, as a pure function of run outcome.

    ``phase`` is the build-body progress this runner observes at cleanup time
    ("receipt_done"/"verified" = the build body ran to completion = canonical
    ``build_ok`` at the end of the try body; anything else = a failure reached
    cleanup). The pre-fix 999 policy deleted on EVERY reached path — this
    returns the v27.1.74 policy instead: success PRESERVES, failure DELETES,
    an operator ``--stop-after-phase`` stop PRESERVES for ``--resume``."""
    if stopped_after:
        return "preserve_for_resume"
    if phase in ("receipt_done", "verified"):
        return "preserve"
    return "delete"


def preserve_record(form_id: str) -> Dict[str, Any]:
    """The canonical cleanup record for a PRESERVED deliverable. Returned by
    the routed delete/residue seams so ``cleanup.update(...)`` carries the
    truthful state (attempted False, nothing deleted, why)."""
    return {"attempted": False, "deleted": False, "verified_gone": False,
            "preserved": True, "skipped_reason": _PRESERVE_SKIP,
            "form_id": form_id or ""}


# ---------------------------------------------------------------------------
# Runtime routing — install() wires the slices onto the dist modules at their
# existing module-global seams. Every wrapper delegates through an ``._impl``
# slot whose default is the distribution's OWN function; no dist file is
# modified. Idempotent.
# ---------------------------------------------------------------------------

# Verified-activation table for the routed click→wait interceptor: click TARGET
# -> the proof text that proves it activated. The interceptor reproduces
# click_with_proof semantics at the seams the 999 drive loop already uses
# (``_click`` then ``_wait_text_polling``), so the F2 create-modal pair (the
# live-proven defect) becomes verified activation WITHOUT rewriting
# _walk_click_list. Pairs NOT in the table pass through UNCHANGED (parity:
# canonical changed only the F2 call site).
DEFAULT_PROOF_PAIRS: Dict[str, str] = {"Create form": "Start from Scratch"}


class _RunState:
    """Per-``_live_build`` observable progress + pending click proof."""

    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self.phase = "idle"   # idle → walking → walk_done → receipt_done → verified | failed
        self.pending: Optional[dict] = None

    def fail(self) -> None:
        self.phase = "failed"


_RUN = _RunState()


class _RoutedClick:
    def __init__(self, impl: Callable[..., Any], pairs: Dict[str, str]) -> None:
        self._impl = impl
        self._pairs = pairs

    def __call__(self, session: str, target: str, timeout: int = 15) -> Any:
        cp = self._impl(session, target, timeout=timeout)
        proof = self._pairs.get(target)
        if proof is not None:
            _RUN.pending = {"session": session, "target": target,
                            "proof": proof, "dom_tried": False}
        else:
            _RUN.pending = None
        return cp


class _RoutedWait:
    def __init__(self, impl: Callable[..., bool],
                 dom_fn: Callable[..., Dict[str, Any]]) -> None:
        self._impl = impl
        self.dom_fn = dom_fn

    def __call__(self, session: str, text: str,
                 timeout_s: Optional[float] = None,
                 subcall_s: Optional[float] = None,
                 poll_s: Optional[float] = None) -> bool:
        ok = bool(self._impl(session, text, timeout_s=timeout_s,
                            subcall_s=subcall_s, poll_s=poll_s))
        p = _RUN.pending
        if ok:
            _RUN.pending = None
            return True
        if (p is None or p["session"] != session or p["proof"] != text
                or p["dom_tried"]):
            _RUN.pending = None
            return False
        # canonical _click_with_proof: ONE direct-DOM retry, proof-gated.
        p["dom_tried"] = True
        dom = self.dom_fn(session, p["target"])
        if dom.get("clicked"):
            ok = bool(self._impl(session, text, timeout_s=timeout_s,
                                 subcall_s=subcall_s, poll_s=poll_s))
        _RUN.pending = None
        return ok


class _RoutedWalk:
    def __init__(self, impl: Callable[..., Any]) -> None:
        self._impl = impl

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        out = self._impl(*args, **kwargs)   # raises ⇒ phase stays below build_ok
        if _RUN.phase == "walking":
            _RUN.phase = "walk_done"
        return out


class _RoutedWriteJson:
    def __init__(self, impl: Callable[..., None]) -> None:
        self._impl = impl

    def __call__(self, path: str, data: Any) -> None:
        try:
            self._impl(path, data)
        except Exception:
            _RUN.fail()
            raise
        if os.path.basename(str(path)) == "form-built.json":
            # canonical ``build_ok = True`` sits AFTER the receipt write (and the
            # optional verify); the receipt completing is the first observable
            # point past which only verify can still fail the build body.
            if _RUN.phase == "walk_done":
                _RUN.phase = "receipt_done"


class _RoutedVerify:
    def __init__(self, impl: Callable[..., Any]) -> None:
        self._impl = impl

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        try:
            out = self._impl(*args, **kwargs)
        except Exception:
            _RUN.fail()
            raise
        _RUN.phase = "verified"
        return out


class _RoutedDelete:
    def __init__(self, impl: Callable[..., Any]) -> None:
        self._impl = impl

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        if cleanup_action(_RUN.phase) == "preserve":
            return preserve_record(str(args[2]) if len(args) >= 3 else "")
        return self._impl(*args, **kwargs)


class _RoutedResidue:
    def __init__(self, impl: Callable[..., Any]) -> None:
        self._impl = impl

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        if cleanup_action(_RUN.phase) == "preserve":
            return preserve_record("")
        return self._impl(*args, **kwargs)


class _RoutedLiveBuild:
    def __init__(self, impl: Callable[..., Any]) -> None:
        self._impl = impl

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        # The live GHL write: refused until the four adapter seams pass (ADAPTER.md).
        require_adapter_seams()
        _RUN.reset()
        _RUN.phase = "walking"
        return self._impl(*args, **kwargs)


class _RoutedRender:
    def __init__(self, impl: Callable[..., Any], browser_cmd: Callable[..., str],
                 is_error_fn: Callable[[str], bool]) -> None:
        self._impl = impl
        self.browser_cmd = browser_cmd
        self.is_error_fn = is_error_fn
        self.run = subprocess.run          # slot: the drain transport

    def __call__(self, preview_url: str, marker: str, **kwargs: Any) -> Dict[str, Any]:
        # Step 0 (canonical v18.2.0): the drain is the FIRST agent-browser call
        # and precedes the navigation the dist's render_check performs. Same
        # invocation style as render_check's own console read (browser_cmd
        # WITHOUT --session — the default-daemon semantics are the dist's).
        drain = drain_console(self.run, self.browser_cmd("console", "--clear"))
        record = self._impl(preview_url, marker, **kwargs)
        return attribute_console(record, drain, is_error_fn=self.is_error_fn)


class _RoutedPreflight:
    def __init__(self, impl: Callable[..., Any],
                 isolated_fn: Optional[Callable[[], bool]] = None) -> None:
        self._impl = impl
        # Consults the DIST's own _isolated_mode seam at call time — the same
        # global the canonical preflight reads (kept patchable, never frozen).
        self.isolated_fn = isolated_fn or isolated_mode

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        pre = self._impl(*args, **kwargs)
        if self.isolated_fn():
            for check in pre.get("checks", []):
                if (isinstance(check, dict)
                        and check.get("check") == "F-P9:playwright_interpreter"
                        and ISO_NOTE not in str(check.get("detail", ""))):
                    check["detail"] = str(check.get("detail", "")) + ISO_NOTE
        return pre


def _repair_soft_imports(fb: Any) -> List[str]:
    """Slice 4's runtime half: restore the dist's soft sibling imports when a
    bare isolated entry left them None (the modules ship in this tools/ dir, so
    this RESTORES real capability — it never fabricates one)."""
    repaired: List[str] = []
    for name in ("ghl_builder", "browser_manager", "ghl_iframe_drag"):
        if getattr(fb, name, None) is None:
            try:
                setattr(fb, name, importlib.import_module(name))
                repaired.append(name)
            except Exception:  # noqa: BLE001 — genuinely absent stays honest
                pass
    return repaired


_ROUTING: Optional[Dict[str, Any]] = None


# =============================================================================
# ADAPTER SEAMS GATE (ADAPTER.md): the four pack seams -- launch, session seed,
# teardown, paths and secrets -- are checked here, and a LIVE GHL write is
# REFUSED with ADAPTER-SEAMS-NOT-PORTED until every one passes AND a seams
# receipt recorded for the CURRENT adapter files exists. The receipt is
# written only by `python3 skill_runner.py seams --record` after all four pass;
# any edit to a file the checks read changes the digest and re-closes the gate.
# =============================================================================
SEAMS_REFUSAL_CODE = "ADAPTER-SEAMS-NOT-PORTED"
SEAM_NAMES = ("launch", "session-seed", "teardown", "paths-secrets")
SEAMS_RECEIPT_NAME = "adapter-seams-receipt.json"
_MANIFEST_REL = os.path.join("blackceo-signature-page", "repo-integration",
                             "ghl-pack-manifest.json")
_SESSIONS_REL = os.path.join("blackceo-signature-page", "scripts", "browser_sessions.py")
_CONTRACT_REL = os.path.join("blackceo-signature-page", "references",
                             "browser-engine-contract.md")
_SEAM4_TOKENS = re.compile(
    r"~/\.openclaw|/\.openclaw|\.openclaw/|\"\.openclaw\"|'\.openclaw'|"
    r"MASTER_FILES_FOLDER|OPENCLAW_SKILLS_DIR|~/clawd|\$HOME/clawd|/clawd/")
# Adapter files that may still name an OpenClaw path, each for a stated reason
# (never a write path in this harness). Anything else naming one fails seam 4.
SEAM4_DECLARED = {
    "tools/capability_probe.py": "read-only OpenClaw lane detection; the lane is structurally absent here (seam 1)",
    "tools/browser_manager.py": "deny-list marker for a personal OpenClaw profile (refusal, not a path in use)",
    "tools/ghl_run_state.py": "pre-S06-05 legacy read fallback so an old run stays resumable (SK6002)",
    "tools/ghl_env_matrix_ground_truth.py": "refusal guards that REJECT an OpenClaw root in a receipt",
    "tools/openclaw_browser_adapter.sh": "gated off: refuses every verb with exit 75",
    "scripts/install-github-archive-reconcile-cron.sh": "host scheduling, the declared fifth seam (carried unadapted)",
    "scripts/install-page-inventory-lifecycle-cron.sh": "host scheduling, the declared fifth seam (carried unadapted)",
    "scripts/install-routing-drift-check-cron.sh": "host scheduling, the declared fifth seam (carried unadapted)",
    "scripts/install-selector-drift-probe-cron.sh": "host scheduling, the declared fifth seam (carried unadapted)",
    "scripts/install-skill6-maintenance-crons.sh": "host scheduling, the declared fifth seam (carried unadapted)",
    "tools/ghl_vps_mount_proof.py": "VPS mount proof pair, the declared fifth seam (carried unadapted)",
}


def _read(path: str) -> str:
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return ""


def _load_by_path(name: str, path: str) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod  # a @dataclass in the loaded module looks itself up here
    try:
        spec.loader.exec_module(mod)  # type: ignore[union-attr]
    finally:
        sys.modules.pop(name, None)
    return mod


def nine_env_stores(env: Optional[Dict[str, str]] = None) -> Tuple[str, ...]:
    """Seam 2: the install's secrets env file ($SECRETS_ENV) is the one store."""
    env = os.environ if env is None else env
    designated = (env.get("SECRETS_ENV") or "").strip()
    return (designated,) if designated else ()


def bind_session_seed(resolver: Any, env: Optional[Dict[str, str]] = None) -> None:
    """Seam 2: point the shared resolver's store list (read at call time) at the
    install's secrets env instead of its OpenClaw-side default."""
    resolver.ENV_STORES = nine_env_stores(env)


def nine_public_engine_root() -> str:
    """Seam 4 (paths): ``ghl_public_client`` walks up for onboarding's
    ``44-convert-and-flow-operator``; in this repo Skill 44 is the sibling
    ``convert-and-flow-operator`` skill, so its engine root is named here."""
    return os.path.join(os.path.dirname(_SKILL_ROOT), "convert-and-flow-operator",
                        "tools", "engine")


def harness_hygiene_dir(bm: Any, env: Optional[Dict[str, str]] = None) -> str:
    env = os.environ if env is None else env
    return (env.get("SKILL6_BROWSER_HYGIENE_DIR") or "").strip() or os.path.join(
        bm.durable_root(), "skill6-browser-hygiene")


def wrap_browser_session(orig_cm: Callable[..., Any], sessions: Any,
                         run_dir_fn: Callable[[], str], *,
                         stage: str = "skill6-build",
                         teardown_cmd_fn: Optional[Callable[[str], str]] = None) -> Callable[..., Any]:
    """Seam 3: every session the pack opens is registered at open and closed,
    with the stage's browser-hygiene receipt written, under Skill 71's Item 33
    registry (blackceo-signature-page/scripts/browser_sessions.py)."""
    @contextlib.contextmanager
    def _wrapped(slug: Optional[str] = None):
        with orig_cm(slug) as name:
            run_dir = run_dir_fn()
            sessions.register_open(
                run_dir, session_name=name, stage=stage, engine="agent-browser",
                binding="claude-nine", client_slug=str(slug or ""),
                owner_pid=os.getpid(),
                teardown_cmd=teardown_cmd_fn(name) if teardown_cmd_fn else None)
            try:
                yield name
            finally:
                sessions.register_close(run_dir, name, closed_by="normal")
                sessions.write_stage_receipt(run_dir, stage)
    _wrapped._seam3 = True  # type: ignore[attr-defined]
    return _wrapped


def _seam_launch(root: str) -> Tuple[bool, str]:
    skills = os.path.dirname(root)
    miss = []
    if not os.path.isfile(os.path.join(skills, _CONTRACT_REL)):
        miss.append("blackceo-signature-page browser-engine-contract.md absent")
    if "999 HARNESS FORM" not in _read(os.path.join(root, "tools", "openclaw_browser_adapter.sh")):
        miss.append("openclaw_browser_adapter.sh is not in its 999 gated-off form")
    if "not part of the Claude" not in _read(os.path.join(root, "tools", "capability_probe.py")):
        miss.append("capability_probe.py does not report the OpenClaw lane structurally absent")
    return (not miss, "; ".join(miss) or "agent-browser engine contract present; OpenClaw lane gated off")


def _seam_session_seed(root: str) -> Tuple[bool, str]:
    try:
        res = _load_by_path("_seam_probe_resolver", os.path.join(root, "tools", "ghl_secret_resolver.py"))
        bind_session_seed(res, {"SECRETS_ENV": "/seam/probe.env"})
        bound = tuple(res.ENV_STORES)
        bind_session_seed(res, {})
        empty = tuple(res.ENV_STORES)
    except Exception as exc:  # noqa: BLE001
        return False, f"resolver not loadable: {type(exc).__name__}"
    if bound != ("/seam/probe.env",) or empty != ():
        return False, "resolver store list does not follow $SECRETS_ENV"
    if "bind_session_seed" not in install.__code__.co_names:
        return False, "install() does not bind the resolver to $SECRETS_ENV"
    return True, "resolver stores follow $SECRETS_ENV; install() binds them"


def _seam_teardown(root: str) -> Tuple[bool, str]:
    skills = os.path.dirname(root)
    try:
        sessions = _load_by_path("_seam_probe_sessions", os.path.join(skills, _SESSIONS_REL))
    except Exception as exc:  # noqa: BLE001
        return False, f"browser_sessions.py not loadable: {type(exc).__name__}"
    if "wrap_browser_session" not in install.__code__.co_names:
        return False, "install() does not wrap browser_session in the session registry"

    @contextlib.contextmanager
    def fake(slug=None):
        yield "seam-probe-session"

    with tempfile.TemporaryDirectory(prefix="seam3-") as tmp:
        with wrap_browser_session(fake, sessions, lambda: tmp)("probe"):
            pass
        c = sessions.stage_counts(tmp, "skill6-build")
        ok = (c["sessions_opened"], c["sessions_closed"], c["unaccounted"]) == (1, 1, 0)
        receipt = os.path.isfile(os.path.join(tmp, "skill6-build", "browser-hygiene.json"))
    if not (ok and receipt):
        return False, "a registered session did not fold to opened=1 closed=1 unaccounted=0 with a receipt"
    return True, "every session is registered, closed and receipted (Item 33)"


def _py_code_lines(path: str) -> List[Tuple[int, str]]:
    src = _read(path)
    lines = src.split("\n")
    skip = set()
    try:
        for node in ast.walk(ast.parse(src)):
            if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                body = node.body
                if (body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant)
                        and isinstance(body[0].value.value, str)):
                    skip.update(range(body[0].lineno, (body[0].end_lineno or body[0].lineno) + 1))
    except SyntaxError:
        pass
    return [(i + 1, l) for i, l in enumerate(lines)
            if (i + 1) not in skip and not l.lstrip().startswith("#")]


def _adapter_runtime_files(root: str) -> List[str]:
    skills = os.path.dirname(root)
    try:
        files = json.loads(_read(os.path.join(skills, _MANIFEST_REL)) or "{}").get("files", [])
    except ValueError:
        files = []
    pre = ".claude/skills/ghl-install-pages/"
    out = []
    for f in files:
        d = f.get("dest", "")
        if f.get("class") != "adapter" or not d.startswith(pre):
            continue
        rel = d[len(pre):]
        base = os.path.basename(rel)
        if base.startswith("test_") or rel.startswith(("tests/", "evidence/", "references/")):
            continue
        if rel.endswith((".py", ".sh")) and (rel.startswith(("tools/", "scripts/")) or "/" not in rel):
            out.append(rel)
    return sorted(out)


def _seam_paths_secrets(root: str) -> Tuple[bool, str]:
    bad = []
    for rel in _adapter_runtime_files(root):
        path = os.path.join(root, rel)
        if rel in SEAM4_DECLARED or not os.path.isfile(path):
            continue
        lines = (_py_code_lines(path) if rel.endswith(".py") else
                 [(i + 1, l) for i, l in enumerate(_read(path).split("\n")) if not l.lstrip().startswith("#")])
        n = sum(1 for _i, l in lines if _SEAM4_TOKENS.search(l))
        if n:
            bad.append(f"{rel}({n})")
    if bad:
        return False, "OpenClaw path in adapted file(s): " + ", ".join(bad[:8])
    return True, "no OpenClaw path in an adapted runtime file outside the declared fifth-seam set"


def _seam_digest(root: str) -> str:
    skills = os.path.dirname(root)
    files = [os.path.join(skills, _MANIFEST_REL), os.path.join(skills, _SESSIONS_REL),
             os.path.join(skills, _CONTRACT_REL), os.path.join(root, "skill_runner.py"),
             os.path.join(root, "tools", "ghl_secret_resolver.py")]
    files += [os.path.join(root, r) for r in _adapter_runtime_files(root)]
    h = hashlib.sha256()
    for p in sorted(set(files)):
        h.update(os.path.relpath(p, skills).encode())
        h.update(b"\0")
        try:
            with open(p, "rb") as f:
                h.update(f.read())
        except OSError:
            h.update(b"<absent>")
        h.update(b"\0")
    return h.hexdigest()


def adapter_seams_status(root: Optional[str] = None) -> Dict[str, Any]:
    """Run the four seam checks. ``ok`` is True only when all four pass."""
    root = root or _SKILL_ROOT
    checks = {"launch": _seam_launch, "session-seed": _seam_session_seed,
              "teardown": _seam_teardown, "paths-secrets": _seam_paths_secrets}
    seams = {}
    for name in SEAM_NAMES:
        try:
            ok, detail = checks[name](root)
        except Exception as exc:  # noqa: BLE001 - a check that crashes is a failed seam
            ok, detail = False, f"check crashed: {type(exc).__name__}"
        seams[name] = {"ok": bool(ok), "detail": detail}
    return {"ok": all(s["ok"] for s in seams.values()), "seams": seams,
            "digest": _seam_digest(root)}


def seams_receipt_path(root: Optional[str] = None, env: Optional[Dict[str, str]] = None) -> str:
    env = os.environ if env is None else env
    d = (env.get("SKILL6_SEAMS_RECEIPT_DIR") or "").strip()
    if not d:
        import browser_manager  # tools/ is on sys.path (slice 4 bootstrap above)
        d = os.path.join(browser_manager.durable_root(), "skill6-seams")
    return os.path.join(d, SEAMS_RECEIPT_NAME)


def record_seams_receipt(root: Optional[str] = None, env: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """Write the receipt for the CURRENT adapter files, only when all four pass."""
    status = adapter_seams_status(root)
    if not status["ok"]:
        return status
    path = seams_receipt_path(root, env)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"all_ok": True, "digest": status["digest"], "seams": status["seams"]}, f, indent=2)
    return status


class AdapterSeamsNotPorted(RuntimeError):
    """A live GHL write was attempted on this harness before the four adapter
    seams passed. ``str(exc)`` starts with ``ADAPTER-SEAMS-NOT-PORTED``."""


def seams_refusal(root: Optional[str] = None, env: Optional[Dict[str, str]] = None) -> str:
    """Empty string when a live write may proceed; else the refusal text."""
    status = adapter_seams_status(root)
    failing = [f"{n}: {s['detail']}" for n, s in status["seams"].items() if not s["ok"]]
    if failing:
        return f"{SEAMS_REFUSAL_CODE}: seams not passing ({'; '.join(failing)})"
    try:
        rec = json.loads(_read(seams_receipt_path(root, env)) or "{}")
    except ValueError:
        rec = {}
    if not (rec.get("all_ok") is True and rec.get("digest") == status["digest"]):
        return (f"{SEAMS_REFUSAL_CODE}: all four seams pass but no seams receipt matches the "
                "current adapter files; record one with `python3 skill_runner.py seams --record`")
    return ""


def require_adapter_seams(root: Optional[str] = None, env: Optional[Dict[str, str]] = None) -> None:
    """Gate every LIVE GHL write. Raises AdapterSeamsNotPorted until the seams pass."""
    msg = seams_refusal(root, env)
    if msg:
        raise AdapterSeamsNotPorted(msg)


def install(proof_pairs: Optional[Dict[str, str]] = None, *,
            fb: Any = None, gb: Any = None, bm: Any = None,
            ghl_verify: Any = None) -> Dict[str, Any]:
    """Wire the four canonical slices onto the loaded dist modules (runtime
    routing). Idempotent; returns the routing report. NO dist file is edited
    and no dist helper is replaced — every wrapper delegates to the dist's own
    function through its ``._impl`` slot, so the 999 launch/session/path
    adapters keep doing the work underneath. Optional ``fb``/``gb``/``bm``/
    ``ghl_verify`` inject preloaded modules (tests); default loads the dist
    modules from this skill's tools/ dir."""
    global _ROUTING
    if _ROUTING is not None:
        return _ROUTING
    if fb is None or gb is None or bm is None:
        lfb, lgb, lbm, lgv = _load_dist_modules()
        fb = fb if fb is not None else lfb
        gb = gb if gb is not None else lgb
        bm = bm if bm is not None else lbm
        if ghl_verify is None:
            ghl_verify = lgv
    pairs = dict(DEFAULT_PROOF_PAIRS if proof_pairs is None else proof_pairs)
    wired: List[str] = []
    wired += [f"soft-import repair: {n}" for n in _repair_soft_imports(fb)]

    # -- slice 1: canonical API + pair-scoped verified-activation interceptor --
    fb._DOM_CLICK_JS = DOM_CLICK_JS

    def _dom_fn(session: str, target: str, timeout: int = 15) -> Dict[str, Any]:
        return dom_click_text(session, target, eval_fn=fb._eval, timeout=timeout)

    fb._dom_click_text = _dom_fn
    routed_click = _RoutedClick(fb._click, pairs)
    routed_wait = _RoutedWait(fb._wait_text_polling, _dom_fn)
    # The canonical composite binds the RAW transports (the routed click/wait
    # pair is the drive-loop interceptor; composing it inside _click_with_proof
    # would double the one-shot DOM retry).
    fb._click_with_proof = lambda session, target, proof_text, timeout=15, wait_s=None: click_with_proof(
        session, target, proof_text, click_fn=routed_click._impl,
        wait_fn=routed_wait._impl, dom_fn=_dom_fn, timeout=timeout, wait_s=wait_s)
    fb._click = routed_click
    fb._wait_text_polling = routed_wait
    wired += ["fb._DOM_CLICK_JS", "fb._dom_click_text", "fb._click_with_proof",
              "fb._click (pair-scoped proof interceptor)",
              "fb._wait_text_polling (one-shot DOM fallback)"]

    # -- slice 3: preserve-on-success at the _live_build cleanup seams --
    fb._live_build = _RoutedLiveBuild(fb._live_build)
    fb._walk_click_list = _RoutedWalk(fb._walk_click_list)
    fb._write_json = _RoutedWriteJson(fb._write_json)
    fb._delete_form = _RoutedDelete(fb._delete_form)
    fb._verify_no_residue = _RoutedResidue(fb._verify_no_residue)
    wired += ["fb._live_build (run-state reset)",
              "fb._walk_click_list (build_ok tracking)",
              "fb._write_json (build_ok tracking)",
              "fb._delete_form (preserve-on-success guard)",
              "fb._verify_no_residue (preserve-on-success guard)"]

    # -- slice 2: console-drain on the dist's render_check --
    gb.render_check = _RoutedRender(gb.render_check, gb.browser_cmd,
                                    gb.console_line_is_error)
    wired.append("gb.render_check (console-drain + attribution gate)")

    # verify completion is the tail of the canonical build_ok point
    if ghl_verify is not None and hasattr(ghl_verify, "verify_page"):
        ghl_verify.verify_page = _RoutedVerify(ghl_verify.verify_page)
        wired.append("ghl_verify.verify_page (build_ok tail tracking)")

    # -- seam 4 (paths): the public-route engine lives in the sibling Skill 44 --
    if os.path.isdir(nine_public_engine_root()):
        os.environ.setdefault("GHL_PUBLIC_ENGINE_ROOT", nine_public_engine_root())
    # -- seam 2 (session seed): the shared resolver reads the install's secrets env --
    try:
        bind_session_seed(importlib.import_module("ghl_secret_resolver"))
        wired.append("ghl_secret_resolver.ENV_STORES (seam 2: $SECRETS_ENV)")
    except ImportError:
        pass
    # -- seam 3 (teardown): every browser_session is registered + reaped (Item 33) --
    _sessions_py = os.path.join(os.path.dirname(_SKILL_ROOT), _SESSIONS_REL)
    if os.path.isfile(_sessions_py) and not getattr(bm.browser_session, "_seam3", False):
        bm.browser_session = wrap_browser_session(
            bm.browser_session, _load_by_path("_skill6_browser_sessions", _sessions_py),
            lambda: harness_hygiene_dir(bm),
            teardown_cmd_fn=getattr(bm, "emit_teardown_step", None))
        wired.append("browser_manager.browser_session (seam 3: Item 33 registry)")

    # -- slice 4: honest isolation reporting (soft-import repair above) --
    fb._isolated_mode = isolated_mode
    fb._run_preflight = _RoutedPreflight(
        fb._run_preflight, lambda: bool(fb._isolated_mode()))
    wired += ["fb._isolated_mode", "fb._run_preflight (F-P9 isolation note)"]

    _ROUTING = {
        "installed": True,
        "canonical": {"version": CANONICAL_VERSION, "merge": CANONICAL_MERGE,
                      "suites": CANONICAL_SUITES},
        "wired": wired,
        "adapters_preserved": [
            "launch: ghl_builder.browser_cmd + ghl_form_builder._ab (untouched)",
            "session: ghl_form_builder._canonical_session / browser_manager.session_name (untouched)",
            "path: ghl_form_builder._ensure_agent_browser_path (untouched)",
        ],
        "proof_pairs": dict(pairs),
    }
    return _ROUTING


def _load_dist_modules() -> Tuple[Any, Any, Any, Optional[Any]]:
    """Import the 999 dist modules from this skill's tools/ dir (path adapter)."""
    if TOOLS_DIR not in sys.path:
        sys.path.insert(0, TOOLS_DIR)
    fb = importlib.import_module("ghl_form_builder")
    gb = importlib.import_module("ghl_builder")
    bm = importlib.import_module("browser_manager")
    try:
        ghl_verify = importlib.import_module("ghl_verify")
    except Exception:  # noqa: BLE001 — optional, only used post-build
        ghl_verify = None
    return fb, gb, bm, ghl_verify


# ---------------------------------------------------------------------------
# Self-check — assert-based, hermetic (no network, no live browser, no GHL).
# Proves changed-behavior parity for all four slices against the canonical
# scenario contract (test_s06_drive_click_and_instrument.py at v27.1.74).
# Run: python3 -I skill_runner.py
# ---------------------------------------------------------------------------

class _Check:
    def __init__(self) -> None:
        self.n = 0

    def ok(self, cond: Any, msg: str) -> None:
        self.n += 1
        if not cond:
            raise AssertionError(f"#{self.n} FAILED: {msg}")


_C = _Check()


class _Cp:
    """subprocess.CompletedProcess stand-in for scripted transports."""

    def __init__(self, rc: int = 0, out: str = "", err: str = "") -> None:
        self.returncode, self.stdout, self.stderr = rc, out, err


def _selfcheck_slice1() -> None:
    # --- parity: proven activation never falls back -------------------------
    clicks: List[str] = []
    dom: List[str] = []
    out = click_with_proof(
        "s", "Create form", "Start from Scratch",
        click_fn=lambda s, t, timeout=15: (clicks.append(t), _Cp(0))[1],
        wait_fn=lambda s, text, timeout_s=None: True,
        dom_fn=lambda s, t, timeout=15: (dom.append(t), {"clicked": True})[1])
    _C.ok(out["activated"] is True and out["mechanism"] == "find-text",
          "proven activation reports find-text")
    _C.ok(clicks == ["Create form"] and dom == [],
          "no fallback on a proven activation")

    # --- parity: THE LIVE DEFECT — rc=0 inert click, DOM click rescues ------
    clicks, dom = [], []

    def _fake_click(s, t, timeout=15):
        clicks.append(t)
        return _Cp(0)          # rc=0 — exactly what fooled the live run

    def _fake_wait(s, text, timeout_s=None):
        return bool(dom)       # only true AFTER the DOM click happened

    out = click_with_proof(
        "s", "Create form", "Start from Scratch",
        click_fn=_fake_click, wait_fn=_fake_wait,
        dom_fn=lambda s, t, timeout=15: (dom.append(t),
                                         {"clicked": True, "n": 1, "err": ""})[1])
    _C.ok(out["activated"] is True and out["mechanism"] == "dom-click",
          "the DOM click must rescue an inert find-click")
    _C.ok(clicks == ["Create form"] and dom == ["Create form"], "exactly ONE retry")
    _C.ok([a["mechanism"] for a in out["attempts"]] == ["find-text", "dom-click"],
          "attempt order is find-text then dom-click")

    # --- parity: both inert ⇒ activated=False, honest detail ---------------
    out = click_with_proof(
        "s", "Create form", "Start from Scratch",
        click_fn=lambda s, t, timeout=15: _Cp(0),
        wait_fn=lambda s, text, timeout_s=None: False,
        dom_fn=lambda s, t, timeout=15: {"clicked": True, "n": 2, "err": ""})
    _C.ok(out["activated"] is False, "never a fabricated pass")
    _C.ok("neither a find-text click" in out["detail"], "honest STOP detail")

    # --- parity: DOM JS contract (exact visible-text match, direct click) ---
    _C.ok("(e.innerText || '').trim() === q" in DOM_CLICK_JS, "EXACT text match")
    _C.ok("getBoundingClientRect()" in DOM_CLICK_JS
          and "visibility !== 'hidden'" in DOM_CLICK_JS, "VISIBLE match filter")
    _C.ok("nodes[0].click()" in DOM_CLICK_JS, "DIRECT DOM click")

    # --- parity: DOM-click miss is explainable evidence --------------------
    d = dom_click_text("s", "Create form",
                       eval_fn=lambda s, js, timeout=20: json.dumps(
                           {"clicked": False, "n": 0, "err": "NO-VISIBLE-MATCH"}))
    _C.ok(d == {"clicked": False, "n": 0, "err": "NO-VISIBLE-MATCH"},
          "miss reports match count + reason")

    # --- the routed interceptor reproduces the same semantics at the seams
    #     the 999 drive loop (F2) actually calls ---------------------------
    _RUN.reset()
    clicks2: List[str] = []
    dom2: List[str] = []

    def _impl_click(s, t, timeout=15):
        clicks2.append(t)
        return _Cp(0)                      # rc=0 but inert

    def _impl_wait(s, text, timeout_s=None, subcall_s=None, poll_s=None):
        return bool(dom2)                  # proof appears only after a DOM click

    def _fake_dom(s, t, timeout=15):
        dom2.append(t)
        return {"clicked": True, "n": 1, "err": ""}

    rc = _RoutedClick(_impl_click, DEFAULT_PROOF_PAIRS)
    rw = _RoutedWait(_impl_wait, _fake_dom)
    rc("s", "Create form")
    _C.ok(rw("s", "Start from Scratch") is True and dom2 == ["Create form"],
          "interceptor rescues the F2 pair with ONE DOM click")

    # DOM click inert ⇒ honest False (never a fabricated activation)
    _RUN.reset()
    dom2.clear()
    rw.dom_fn = lambda s, t, timeout=15: {"clicked": True, "n": 2, "err": ""}
    rc("s", "Create form")
    _C.ok(rw("s", "Start from Scratch") is False,
          "both mechanisms inert ⇒ False (caller STOPs honestly)")

    # pairs NOT in the table pass through UNCHANGED (parity: canonical changed
    # only the F2 call site)
    _RUN.reset()
    dom2.clear()
    rc("s", "Delete form")                 # not a proof-paired target
    _C.ok(rw("s", "Start from Scratch") is False and dom2 == [],
          "unpaired click/wait passes through with NO DOM fallback")


def _selfcheck_slice2() -> None:
    tmp = tempfile.mkdtemp(prefix="ghl-delivery-W10A-U1-")

    def _mk_record(errors: List[str], entries: List[dict], ok: bool) -> Dict[str, Any]:
        cpath = os.path.join(tmp, "step.console.json")
        with open(cpath, "w", encoding="utf-8") as f:
            json.dump(entries, f)
        return {"ok": ok, "render_errors": list(errors), "console_path": cpath}

    def _is_error(msg: str) -> bool:
        return "error" in msg.lower()      # dist's rule is injected in live use

    # parity: drained + empty buffer ⇒ NO errors attributed
    rec = _mk_record([], [], True)
    rec = attribute_console(rec, {"drained": True, "rc": 0, "detail": ""},
                            is_error_fn=_is_error)
    _C.ok(rec["console_drained"] is True and rec["render_errors"] == [],
          "drained empty buffer yields NO render errors")

    # gate untouched: a real error of THIS page still fails (drained)
    page_err = "console: [error] TypeError: Cannot read properties of undefined"
    rec = _mk_record([page_err],
                     [{"raw": "[error] TypeError: Cannot read properties of undefined",
                       "text": "[error] TypeError: Cannot read properties of undefined"}],
                     False)
    rec = attribute_console(rec, {"drained": True, "rc": 0, "detail": ""},
                            is_error_fn=_is_error)
    _C.ok(page_err in rec["render_errors"] and rec["ok"] is False,
          "real navigation errors still fail the gate")

    # CHANGED vs pre-fix: failed drain ⇒ stale lines NOT attributed to this page
    stale = "console: [error] BOOM from some other page"
    rec = _mk_record([stale],
                     [{"raw": "[error] BOOM from some other page",
                       "text": "[error] BOOM from some other page"}], False)
    rec = attribute_console(rec, {"drained": False, "rc": 1, "detail": "drain broke"},
                            is_error_fn=_is_error)
    joined = " ".join(rec["render_errors"])
    _C.ok(rec["console_drained"] is False and rec["ok"] is False,
          "failed drain still FAILS the check (never a silent pass)")
    _C.ok("console drain" in joined and "exit 1" in joined,
          "the failure names the drain")
    _C.ok("BOOM from some other page" not in joined,
          "an unattributable line must not be reported as this page's error")
    _C.ok(stale in rec.get("console_unattributed", []),
          "the stale line is kept as EVIDENCE, not dropped")

    # conservative floor: unreadable console.json ⇒ errors kept, fail-closed
    rec = {"ok": True, "render_errors": [stale], "console_path": "/nonexistent/x.json"}
    rec = attribute_console(rec, {"drained": False, "rc": 2, "detail": "d"},
                            is_error_fn=_is_error)
    _C.ok(rec["ok"] is False and stale in rec["render_errors"]
          and "console drain" in " ".join(rec["render_errors"]),
          "unattributable AND unreadable ⇒ conservative failure, never a pass")

    # ORDER is the fix: the drain must precede the navigation (render wrapper)
    order: List[str] = []

    def _fake_run(argv, **kw):
        order.append("drain:" + " ".join(argv[-2:]))
        return _Cp(0)

    def _fake_browser_cmd(*a):
        return " ".join(a)

    def _fake_impl(url, marker, **kw):
        order.append("render:" + url)
        return _mk_record([], [], True)

    r = _RoutedRender(_fake_impl, _fake_browser_cmd, _is_error)
    r.run = _fake_run
    out = r("https://example.test/preview", "MARK")
    _C.ok(order[0] == "drain:console --clear" and order[1].startswith("render:"),
          "the console drain comes FIRST — it must precede the navigation")
    _C.ok(out["console_drained"] is True, "drain state recorded in the result")

    # changed-behavior contrast: the PRE-FIX record attributed stale errors
    pre_fix = _mk_record([stale],
                         [{"raw": "[error] BOOM from some other page",
                           "text": "[error] BOOM from some other page"}], False)
    _C.ok(stale in pre_fix["render_errors"],
          "control: the pre-fix record DID attribute the stale line to the page")


def _selfcheck_slice3() -> None:
    # --- pure policy parity + pre-fix contrast -----------------------------
    _C.ok(cleanup_action("receipt_done") == "preserve"
          and cleanup_action("verified") == "preserve", "success PRESERVES")
    _C.ok(cleanup_action("walking") == "delete"
          and cleanup_action("walk_done") == "delete"
          and cleanup_action("failed") == "delete", "failure DELETES")
    _C.ok(cleanup_action("walking", stopped_after="F5") == "preserve_for_resume",
          "--stop-after-phase PRESERVES for --resume (unchanged contract)")
    _C.ok(cleanup_action("receipt_done") != "delete",
          "CHANGED behavior: the pre-fix finally deleted a successful build's deliverable")

    # --- integration through the REAL dist _live_build ---------------------
    fb, gb, bm, ghl_verify = _load_dist_modules()
    rep = install()
    _C.ok(rep["installed"] is True, "routing installed")

    calls = {"delete": [], "verify": [], "write": []}

    class _FakeSessionCM:
        def __enter__(self):
            return "sess-fake"

        def __exit__(self, *exc):
            return False

    saved_attrs: Dict[Tuple[int, str], Any] = {}

    def _patch(obj: Any, name: str, value: Any) -> None:
        saved_attrs[(id(obj), name)] = getattr(obj, name)
        setattr(obj, name, value)

    _patch(bm, "headless_guard", lambda: None)
    _patch(bm, "assert_agent_browser_version", lambda env=None: None)
    _patch(bm, "browser_session", lambda slug=None: _FakeSessionCM())
    _patch(fb, "_seed_and_land", lambda s, loc, root: {"landed": "app:/dashboard"})
    _patch(fb, "_screenshot", lambda s, p: None)
    _patch(fb, "_close_session", lambda loc: None)
    _patch(fb, "_ghl_verify_available", lambda: False)
    _patch(fb, "_capture_entry_diag", lambda s: "diag")

    routed_write = fb._write_json
    routed_walk = fb._walk_click_list
    routed_delete = fb._delete_form
    routed_residue = fb._verify_no_residue
    routed_click = fb._click
    routed_wait = fb._wait_text_polling
    saved_impls = (routed_write._impl, routed_walk._impl,
                   routed_delete._impl, routed_residue._impl,
                   routed_click._impl, routed_wait._impl,
                   getattr(routed_wait, "dom_fn", None))

    def _fake_write(path, data):
        calls["write"].append(os.path.basename(str(path)))

    def _fake_delete(*a, **k):
        calls["delete"].append(a[2] if len(a) >= 3 else "")
        return {"deleted": True, "verified_gone": True}

    def _fake_residue(*a, **k):
        calls["verify"].append(a[2] if len(a) >= 2 else "")
        return {"deleted": False}

    routed_write._impl = _fake_write
    routed_delete._impl = _fake_delete
    routed_residue._impl = _fake_residue

    plan = {"location_id": "L", "form_name": "ZHC S06 Acceptance",
            "default_fields_keep": [], "fields": []}

    def _run_live(walk_impl):
        calls["delete"].clear()
        calls["verify"].clear()
        calls["write"].clear()
        routed_walk._impl = walk_impl
        ev = os.path.join(tempfile.mkdtemp(prefix="ghl-delivery-W10A-U1-"), "ev")
        return fb._live_build({"stop_after_phase": ""}, plan, {"steps": []}, [],
                              {"tags": []}, {"pass": True}, ev, 0.0)

    def _ok_walk(*a, **k):
        a[7]["form_id"] = "form-abc"           # walk_state, positional
        a[7]["actual_title"] = "ZHC S06 Acceptance"
        return {"form_id": "form-abc", "form_url": "https://x/widget/form/abc",
                "embed_snippet": "<script src=x></script>",
                "actual_title": "ZHC S06 Acceptance"}

    # 1. SUCCESS PRESERVES the deliverable (the hazard the slice exists for)
    out = _run_live(_ok_walk)
    _C.ok(calls["delete"] == [],
          "a SUCCESSFUL build must NOT delete its own deliverable")
    _C.ok(out["cleanup"]["attempted"] is False
          and out["cleanup"]["preserved"] is True,
          "cleanup truthfully reports the preserve")
    _C.ok(out["cleanup"]["form_id"] == "form-abc", "the preserved id is readback-able")
    _C.ok(out["form_id"] == "form-abc" and out["form_url"].endswith("/abc"),
          "form_id/form_url point at a LIVE object")
    _C.ok("form-built.json" in calls["write"],
          "the build receipt was written (the build_ok path)")

    # 2. FAILURE deletes what the run created (unchanged, with proof)
    def _fail_walk(*a, **k):
        a[7]["form_id"] = "form-xyz"
        a[7]["actual_title"] = "ZHC S06 Acceptance"
        raise fb.StopAndReport("F5.drag", "tile would not place")

    out = _run_live(_fail_walk)
    _C.ok(calls["delete"] == ["form-xyz"], "a FAILED run must clean up after itself")
    _C.ok(out["cleanup"]["deleted"] is True and out["stop_step"] == "F5.drag",
          "failure cleanup is reported with its stop step")

    # 3. --stop-after-phase still preserves for --resume (unchanged contract)
    import ghl_run_state

    def _stop_walk(*a, **k):
        a[7]["form_id"] = "form-half"
        raise ghl_run_state.StopAfterPhase("F5")

    out = _run_live(_stop_walk)
    _C.ok(calls["delete"] == [] and out["stopped_after_phase"] == "F5"
          and out["cleanup"]["attempted"] is False,
          "operator stop preserves the half-built form for --resume")

    # 4. POST-walk body failure still deletes (canonical build_ok sits at the
    #    END of the build body — a receipt crash is NOT a success)
    def _explode_write(path, data):
        if os.path.basename(str(path)) == "form-built.json":
            raise RuntimeError("disk full")     # the mid-body receipt crash
        calls["write"].append(os.path.basename(str(path)))

    routed_write._impl = _explode_write
    out = _run_live(_ok_walk)
    _C.ok(calls["delete"] == ["form-abc"],
          "a build body that crashed mid-receipt must NOT be preserved")
    _C.ok(out["stop_step"] == "unexpected", "the crash is reported, not swallowed")

    # 5. WIRING proof — the REAL dist walk (F2 create-modal pair) stops
    #    honestly at F2.modal through the routed interceptor: two find-text
    #    attempts, each with its ONE DOM retry, then StopAndReport (parity with
    #    canonical _click_with_proof called twice at the F2 call site).
    routed_write._impl = _fake_write
    clicks2: List[str] = []
    dom2: List[str] = []

    def _impl_click(s, t, timeout=15):
        clicks2.append(t)
        return _Cp(0)

    def _impl_wait(s, text, timeout_s=None, subcall_s=None, poll_s=None):
        return False

    def _fake_dom(s, t, timeout=15):
        dom2.append(t)
        return {"clicked": True, "n": 1, "err": ""}

    # The dist now carries the canonical composite natively (S06 sync): its F2 walk
    # calls fb._click_with_proof, whose DOM retry goes through fb._eval.
    _orig_eval = fb._eval

    def _fake_eval(session, js, timeout=15):
        dom2.append("Create form")
        return json.dumps({"clicked": True, "n": 1, "err": ""})

    fb._eval = _fake_eval
    routed_click._impl = _impl_click
    routed_wait._impl = _impl_wait
    routed_wait.dom_fn = _fake_dom
    routed_walk._impl = saved_impls[1]      # the REAL dist _walk_click_list
    _RUN.reset()
    click_list = {"steps": [{"phase": "F2", "action": "click", "target": "Create form"}]}
    ev = os.path.join(tempfile.mkdtemp(prefix="ghl-delivery-W10A-U1-"), "ev")
    raised = None
    try:
        fb._walk_click_list("sess-x", click_list, plan, ev, [0], [], [])
    except fb.StopAndReport as sr:
        raised = sr
    fb._eval = _orig_eval
    _C.ok(raised is not None and raised.step == "F2.modal",
          "the REAL dist walk STOPs honestly at F2.modal (never blunders on)")
    _C.ok(clicks2 == ["Create form", "Create form"] and dom2 == ["Create form", "Create form"],
          "two proof-gated attempts, ONE DOM retry each (canonical F2 semantics)"
          f" [clicks={clicks2} dom={dom2}]")

    (routed_write._impl, routed_walk._impl, routed_delete._impl,
     routed_residue._impl, routed_click._impl, routed_wait._impl,
     routed_wait.dom_fn) = saved_impls
    for (oid, name), value in saved_attrs.items():
        for obj in (fb, gb, bm, ghl_verify):
            if obj is not None and id(obj) == oid:
                setattr(obj, name, value)


def _selfcheck_slice4() -> None:
    # --- isolation detection is by observation, not argv guessing ----------
    _C.ok(isolated_mode() == (bool(getattr(sys.flags, "isolated", 0))
                              or TOOLS_DIR not in sys.path),
          "isolated_mode reflects observable state")
    rep = fp9_report(True, sys.executable, sys.version.split()[0])
    _C.ok(rep["pass"] is True and rep["check"] == "F-P9:playwright_interpreter",
          "fp9 verdict passes pw_ok through UNTOUCHED")
    if isolated_mode():
        _C.ok(ISO_NOTE in rep["detail"],
              "isolation is REPORTED as context when present")

    # --- changed-behavior proof in real -I child interpreters --------------
    here = os.path.abspath(__file__)
    fb_path = os.path.join(TOOLS_DIR, "ghl_form_builder.py")

    legacy_script = (
        "import importlib.util, json;"
        f"spec = importlib.util.spec_from_file_location('ghl_form_builder', {fb_path!r});"
        "m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m);"
        "print(json.dumps({'iframe': m.ghl_iframe_drag is not None}))")

    routed_script = (
        "import importlib.util, json, sys;"
        f"spec = importlib.util.spec_from_file_location('skill_runner', {here!r});"
        "sr = importlib.util.module_from_spec(spec); spec.loader.exec_module(sr);"
        "import ghl_form_builder as m;"
        "print(json.dumps({'iframe': m.ghl_iframe_drag is not None,"
        " 'isolated': sr.isolated_mode()}))")

    env = {k: v for k, v in os.environ.items() if not k.startswith("PYTHON")}
    legacy = subprocess.run([sys.executable, "-I", "-c", legacy_script],
                            capture_output=True, text=True, timeout=120, env=env)
    routed = subprocess.run([sys.executable, "-I", "-c", routed_script],
                            capture_output=True, text=True, timeout=120, env=env)
    _C.ok(legacy.returncode == 0, f"legacy -I child ran: {legacy.stderr[-400:]}")
    _C.ok(routed.returncode == 0, f"routed -I child ran: {routed.stderr[-400:]}")
    a = json.loads(legacy.stdout.strip().splitlines()[-1])
    b = json.loads(routed.stdout.strip().splitlines()[-1])
    _C.ok(a["iframe"] is True,
          "the synced dist bootstraps its own tools/ dir (S06 upstream): a bare "
          "`python3 -I` load already resolves the sibling import")
    _C.ok(b["iframe"] is True,
          "CHANGED behavior: routing the tools/ dir first resolves it under -I")
    _C.ok(b["isolated"] is True, "the -I run reports its isolation honestly")

    # --- F-P9 verdict parity with and without -I (the canonical gate) ------
    preflight_script = (
        "import importlib.util, json, os;"
        f"spec = importlib.util.spec_from_file_location('skill_runner', {here!r});"
        "sr = importlib.util.module_from_spec(spec); spec.loader.exec_module(sr);"
        "import ghl_form_builder as m;"
        "sr.install(fb=m);"
        "t={'location_id':'TESTLOCATION12345678','form_name':'ZHC Test Form'};"
        "f=m._resolve_fields(t);"
        "d=m.plan_dependencies(f,t,existing_field_keys=[],existing_tags=[]);"
        "p=m._run_preflight(t,f,d,live=True);"
        "print(json.dumps({'pass':p['pass'],'isolated':m._isolated_mode(),"
        "'fp9':[c for c in p['checks'] "
        "if c['check']=='F-P9:playwright_interpreter'][0]}))")
    env.setdefault("MODEL_ROUTER_DEFAULT", "selftest-default:cloud")
    iso = subprocess.run([sys.executable, "-I", "-c", preflight_script],
                         capture_output=True, text=True, timeout=120, env=env)
    plain = subprocess.run([sys.executable, "-c", preflight_script],
                           capture_output=True, text=True, timeout=120, env=env)
    _C.ok(iso.returncode == 0, f"-I preflight child ran: {iso.stderr[-600:]}")
    _C.ok(plain.returncode == 0, f"plain preflight child ran: {plain.stderr[-600:]}")
    a = json.loads(iso.stdout.strip().splitlines()[-1])
    b = json.loads(plain.stdout.strip().splitlines()[-1])
    _C.ok(a["fp9"]["pass"] == b["fp9"]["pass"],
          "F-P9 must reach the SAME verdict with and without -I")
    _C.ok(a["isolated"] is True and b["isolated"] is False,
          "each run reports its own isolation state truthfully")

    # --- a REAL Playwright miss is reported WITH context, still hard-fails --
    fb, gb, bm, ghl_verify = _load_dist_modules()
    install()

    class _Stub:
        PLAYWRIGHT_AVAILABLE = False

    saved = (fb.ghl_iframe_drag, fb._isolated_mode)
    fb.ghl_iframe_drag = _Stub
    fb._isolated_mode = lambda: True
    try:
        t = {"location_id": "TESTLOCATION12345678", "form_name": "ZHC Test Form"}
        f = fb._resolve_fields(t)
        d = fb.plan_dependencies(f, t, existing_field_keys=[], existing_tags=[])
        pre = fb._run_preflight(t, f, d, live=True)
        fp9 = [c for c in pre["checks"]
               if c["check"] == "F-P9:playwright_interpreter"][0]
        _C.ok(fp9["pass"] is False, "a REAL Playwright miss must still hard-fail")
        _C.ok("ISOLATED interpreter" in fp9["detail"] and "-I" in fp9["detail"],
              "the isolation context must be reported so the miss is diagnosable")

        class _Stub2:
            PLAYWRIGHT_AVAILABLE = True

        fb.ghl_iframe_drag = _Stub2
        pre = fb._run_preflight(t, f, d, live=True)
        fp9 = [c for c in pre["checks"]
               if c["check"] == "F-P9:playwright_interpreter"][0]
        _C.ok(fp9["pass"] is True and "ISOLATED interpreter" in fp9["detail"],
              "isolation + Playwright importable ⇒ PASS with the honest note")
    finally:
        fb.ghl_iframe_drag, fb._isolated_mode = saved


def self_check() -> int:
    # The slices are proven against hermetic fakes, never a live GHL write; the
    # seams gate has its own suite (tests/test_s06_entry_wiring_skill_runner.py).
    global seams_refusal
    real, seams_refusal = seams_refusal, (lambda *a, **k: "")
    try:
        return _self_check()
    finally:
        seams_refusal = real


def _self_check() -> int:
    print(f"skill_runner self-check — canonical {CANONICAL_VERSION} "
          f"(merge {CANONICAL_MERGE}) slices on the 999 distribution")
    print(f"  isolated_mode={isolated_mode()} tools_dir={TOOLS_DIR}")
    _selfcheck_slice1()
    print(f"  slice 1 verified-click fallback: ok ({_C.n} assertions)")
    _selfcheck_slice2()
    print(f"  slice 2 console-drain attribution: ok ({_C.n} assertions)")
    _selfcheck_slice3()
    print(f"  slice 3 preserve-on-success (real dist _live_build + walk): ok ({_C.n} assertions)")
    _selfcheck_slice4()
    print(f"  slice 4 -I honesty (real -I child interpreters): ok ({_C.n} assertions)")
    print(f"SELF-CHECK OK ({_C.n} assertions)")
    return 0


def seams_cli(argv: List[str]) -> int:
    """``python3 skill_runner.py seams [--record]``: print the four seam verdicts;
    with ``--record`` write the seams receipt (only when all four pass)."""
    status = record_seams_receipt() if "--record" in argv else adapter_seams_status()
    for name in SEAM_NAMES:
        s = status["seams"][name]
        print(f"  seam {name}: {'PASS' if s['ok'] else 'FAIL'} - {s['detail']}")
    msg = seams_refusal()
    print("LIVE WRITES ALLOWED" if not msg else f"LIVE WRITES REFUSED - {msg}")
    return 0 if not msg else 1


if __name__ == "__main__":
    sys.modules.setdefault("skill_runner", sys.modules[__name__])  # one module, not two
    if sys.argv[1:2] == ["seams"]:
        raise SystemExit(seams_cli(sys.argv[2:]))
    try:
        raise SystemExit(self_check())
    except AssertionError as exc:
        print(f"SELF-CHECK FAILED: {exc}")
        raise SystemExit(1)
