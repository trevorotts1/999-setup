"""W10B2 — focused entry-point wiring proof for ``skill_runner.install()``.

The merged W10A helper (``skill_runner.py``) reaches live behavior ONLY if the
installed execution path DISPATCHES into it. This suite proves that dispatch,
hermetically (no network, no browser, no live GHL):

  1. ``tools/v2_dispatcher.py::dispatch_one`` — the SOP-mandated coded entry
     (``v2-autonomous-build-sop.md`` §1 Option B: "the executor MUST default to
     the bounded dispatcher tools/v2_dispatcher.py (dispatch_one)").
  2. ``tools/ghl_form_builder.py::build_form`` — the SKILL.md step-15 form
     entry (also what ``main()`` / ``dispatch_one``'s auto-resolve call).
  3. ``tools/ghl_survey_builder.py::build_survey`` — the SKILL.md step-12
     survey entry (also what ``dispatch_one``'s auto-resolve calls).

Each probe runs the REAL entry in a fresh ``python3 -I`` subprocess and
requires BOTH ``skill_runner._ROUTING['installed']`` AND the routed wrappers
live on the dist modules (``._impl`` slots — the 999 launch/session/path
adapters stay underneath, untouched).

NEGATIVE CONTROL (the load-bearing half): the same dispatch probe against a
copy of ``v2_dispatcher.py`` with the wiring REMOVED must report WIRE_MISSING
and fail. If it reported WIRE_OK these probes would prove nothing.

Run: ``python3 -m pytest tests/test_s06_entry_wiring_skill_runner.py -q``
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parents[1]

# The wiring block inserted at each entry point (kept here verbatim so the
# negative control removes exactly what shipped — and fails loudly if the
# block's shape ever changes).
WIRING_BLOCK = """    _sr_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if _sr_root not in sys.path:
        sys.path.insert(0, _sr_root)
    import skill_runner
    skill_runner.install()
"""

_DISPATCH_DRIVER = r'''
import os, sys, tempfile
root = sys.argv[1]
sys.path.insert(0, os.path.join(root, "tools"))
sys.path.insert(0, root)
import v2_dispatcher as d
tmp = tempfile.mkdtemp(prefix="w10b2-dispatch-")
task = {"id": "w10b2-probe", "brand": "probe", "brief": "probe",
        "location_id": "L0", "pages": [], "reprobe": True}
try:
    d.dispatch_one(
        task, tmp,
        builder=lambda t, e: {"pages": [], "location_gate_ok": True,
                              "duration_s": 0.0},
        verifier=lambda *a, **k: {"ok": True},
        telemetry_glob=[], live=False)
except Exception as exc:  # build outcome is NOT under test — the wiring is
    print("dispatch raised (not under test): %s" % exc)
import skill_runner, ghl_form_builder as fb
ok = (skill_runner._ROUTING is not None
      and skill_runner._ROUTING.get("installed") is True
      and getattr(fb._live_build, "_impl", None) is not None)
print("WIRE_OK" if ok else "WIRE_MISSING")
sys.exit(0 if ok else 1)
'''

_FORM_DRIVER = r'''
import os, sys, tempfile
root = sys.argv[1]
sys.path.insert(0, os.path.join(root, "tools"))
sys.path.insert(0, root)
import ghl_form_builder as fb
tmp = tempfile.mkdtemp(prefix="w10b2-form-")
task = {"id": "w10b2-probe", "form_name": "W10B2 Probe", "location_id": "L0",
        "form_fields": fb._reference_fields(), "tags": []}
try:
    fb.build_form(task, tmp, dry_run=True)
except Exception as exc:  # build outcome is NOT under test — the wiring is
    print("build_form raised (not under test): %s" % exc)
import skill_runner
ok = (skill_runner._ROUTING is not None
      and skill_runner._ROUTING.get("installed") is True
      and getattr(fb._live_build, "_impl", None) is not None)
print("WIRE_OK" if ok else "WIRE_MISSING")
sys.exit(0 if ok else 1)
'''

_SURVEY_DRIVER = r'''
import os, sys, tempfile
root = sys.argv[1]
sys.path.insert(0, os.path.join(root, "tools"))
sys.path.insert(0, root)
import ghl_survey_builder as sb
tmp = tempfile.mkdtemp(prefix="w10b2-survey-")
task = {"id": "w10b2-probe", "survey_name": "W10B2 Probe", "location_id": "L0"}
try:
    sb.build_survey(task, tmp, dry_run=True)
except Exception as exc:  # build outcome is NOT under test — the wiring is
    print("build_survey raised (not under test): %s" % exc)
import skill_runner, ghl_builder as gb
ok = (skill_runner._ROUTING is not None
      and skill_runner._ROUTING.get("installed") is True
      and getattr(gb.render_check, "_impl", None) is not None)
print("WIRE_OK" if ok else "WIRE_MISSING")
sys.exit(0 if ok else 1)
'''


def _run_probe(driver: str, root: Path, tmp_path: Path) -> subprocess.CompletedProcess:
    env = dict(os.environ, TMPDIR=str(tmp_path))  # probe artifacts stay in tmp
    return subprocess.run(
        [sys.executable, "-I", "-c", driver, str(root)],
        capture_output=True, text=True, timeout=180, env=env)


def test_dispatch_one_dispatches_into_skill_runner_install(tmp_path):
    r = _run_probe(_DISPATCH_DRIVER, SKILL_ROOT, tmp_path)
    assert "WIRE_OK" in r.stdout, f"dispatch entry not wired:\n{r.stdout}\n{r.stderr}"
    assert r.returncode == 0


def test_build_form_dispatches_into_skill_runner_install(tmp_path):
    r = _run_probe(_FORM_DRIVER, SKILL_ROOT, tmp_path)
    assert "WIRE_OK" in r.stdout, f"form entry not wired:\n{r.stdout}\n{r.stderr}"
    assert r.returncode == 0


def test_build_survey_dispatches_into_skill_runner_install(tmp_path):
    r = _run_probe(_SURVEY_DRIVER, SKILL_ROOT, tmp_path)
    assert "WIRE_OK" in r.stdout, f"survey entry not wired:\n{r.stdout}\n{r.stderr}"
    assert r.returncode == 0


def test_negative_control_unwired_entry_fails_probe(tmp_path):
    """Remove the wiring -> the SAME probe must fail. This is what makes the
    positive arms meaningful: without it, a probe that always passes would
    'prove' the wiring even when the import is gone."""
    stripped = tmp_path / "stripped-skill"
    shutil.copytree(SKILL_ROOT, stripped)
    entry = stripped / "tools" / "v2_dispatcher.py"
    text = entry.read_text(encoding="utf-8")
    assert WIRING_BLOCK in text, (
        "wiring block no longer matches this control — update WIRING_BLOCK")
    entry.write_text(text.replace(WIRING_BLOCK, ""), encoding="utf-8")
    assert "import skill_runner" not in entry.read_text(encoding="utf-8")

    r = _run_probe(_DISPATCH_DRIVER, stripped, tmp_path)
    assert "WIRE_OK" not in r.stdout, (
        "NEGATIVE CONTROL FAILED: probe passed with the wiring removed — "
        "it cannot detect a missing import and proves nothing")
    assert r.returncode != 0
    assert "WIRE_MISSING" in r.stdout
