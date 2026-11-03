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


# ══════════════════════════════════════════════════════════════════════════════
# ADAPTER SEAMS GATE (ADAPTER.md) — S06-18. Hermetic: no network, no browser.
# ══════════════════════════════════════════════════════════════════════════════

import json
import pytest


@pytest.fixture
def sr(monkeypatch, tmp_path):
    """skill_runner + tools on the path, receipts redirected into tmp."""
    for p in (str(SKILL_ROOT / "tools"), str(SKILL_ROOT)):
        if p not in sys.path:
            sys.path.insert(0, p)
    import skill_runner
    monkeypatch.setenv("SKILL6_SEAMS_RECEIPT_DIR", str(tmp_path / "receipts"))
    return skill_runner


def test_all_four_seams_pass_in_this_tree(sr):
    status = sr.adapter_seams_status()
    assert {n: s["ok"] for n, s in status["seams"].items()} == {n: True for n in sr.SEAM_NAMES}, status


def test_live_form_and_survey_builds_refused(sr, tmp_path):
    """The live executors refuse, not the dry-run planners."""
    import ghl_form_builder as fb
    sr.install()
    with pytest.raises(sr.AdapterSeamsNotPorted, match="ADAPTER-SEAMS-NOT-PORTED"):
        fb._live_build({}, {}, {}, [], {}, {})
    import ghl_survey_builder as sb
    task = {"id": "x", "survey_name": "S", "location_id": "L0", "brief": "a short lead survey"}
    with pytest.raises(sr.AdapterSeamsNotPorted, match="ADAPTER-SEAMS-NOT-PORTED"):
        sb.build_survey(task, str(tmp_path / "ev"), dry_run=False)
    # control: the dry-run planner is NOT refused
    assert sb.build_survey(task, str(tmp_path / "ev2"), dry_run=True)["dry_run"] is True


def test_receipt_opens_the_gate_and_any_adapter_edit_closes_it(sr, monkeypatch):
    assert sr.seams_refusal()                          # closed: no receipt yet
    assert sr.record_seams_receipt()["ok"] is True
    assert sr.seams_refusal() == ""                    # open: all pass + receipt
    monkeypatch.setattr(sr, "_seam_digest", lambda root: "changed")
    assert "no seams receipt matches" in sr.seams_refusal()   # drift re-closes


def test_a_failing_seam_refuses_even_with_a_receipt(sr, monkeypatch):
    assert sr.record_seams_receipt()["ok"] is True
    monkeypatch.setattr(sr, "_seam_launch", lambda root: (False, "engine contract gone"))
    msg = sr.seams_refusal()
    assert msg.startswith("ADAPTER-SEAMS-NOT-PORTED") and "launch: engine contract gone" in msg
    assert sr.record_seams_receipt()["ok"] is False    # and no receipt is written for it


def test_seam4_flags_an_openclaw_path_in_an_adapted_file(sr, tmp_path):
    skills = tmp_path / "skills"
    root = skills / "ghl-install-pages"
    (root / "tools").mkdir(parents=True)
    man = skills / "blackceo-signature-page" / "repo-integration" / "ghl-pack-manifest.json"
    man.parent.mkdir(parents=True)
    man.write_text(json.dumps({"files": [{
        "dest": ".claude/skills/ghl-install-pages/tools/x.py", "class": "adapter"}]}))
    f = root / "tools" / "x.py"
    f.write_text('"""docstring mentions ~/.openclaw and is ignored."""\n# ~/.openclaw in a comment\nX = 1\n')
    assert sr._seam_paths_secrets(str(root))[0] is True       # control: docs and comments pass
    f.write_text('import os\nSTORE = os.path.expanduser("~/.openclaw/secrets/.env")\n')
    ok, detail = sr._seam_paths_secrets(str(root))
    assert ok is False and "tools/x.py(1)" in detail


def test_session_seed_follows_secrets_env(sr):
    class R:  # stands in for ghl_secret_resolver
        ENV_STORES = ("~/.openclaw/secrets/.env",)
    sr.bind_session_seed(R, {"SECRETS_ENV": "/install/secrets.env"})
    assert R.ENV_STORES == ("/install/secrets.env",)
    sr.bind_session_seed(R, {})
    assert R.ENV_STORES == ()


def test_run_ledger_and_state_roots_are_not_under_tmp(sr, monkeypatch, tmp_path):
    """Acceptance row 2 (second half): on claude-nine the default roots are the
    skill's own durable dir, never the /tmp fallback."""
    import ghl_builder as gb
    import ghl_run_state as rs
    for var in ("GHL_LEDGER_ROOT", "GHL_RUN_STATE_ROOT", "GHL_DURABLE_ROOT",
                "BM_DURABLE_ROOT_OVERRIDE"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))      # no ~/.openclaw anywhere
    state = os.path.join(str(SKILL_ROOT), "state")
    assert gb.ledger_root() == os.path.join(state, "skill6-ledgers")
    assert rs.default_state_root() == os.path.join(state, "skill6-runs")
    if not os.path.realpath(str(SKILL_ROOT)).startswith(("/tmp", "/private/tmp")):
        assert gb.ledger_root_is_ephemeral() is False
    monkeypatch.setenv("GHL_DURABLE_ROOT", str(tmp_path / "durable"))
    assert gb.ledger_root() == str(tmp_path / "durable" / "skill6-ledgers")


# ── Every live executor is refused, not only the form builder (repair 2) ─────

_LIVE_CASES = {
    "pipeline": ("ghl_pipeline_builder", lambda m, ev: m._live_build({}, _PLAN, {}, {}, ev, 0.0)),
    "community": ("ghl_community_builder", lambda m, ev: m._live_build({}, _PLAN, {}, {}, ev, 0.0)),
    "course": ("ghl_course_builder", lambda m, ev: m._live_build({}, _PLAN, {}, {}, ev, 0.0, False)),
    "form": ("ghl_form_builder", lambda m, ev: m._live_build({}, _PLAN, {}, [], {}, {}, ev, 0.0)),
}
_PLAN = {"location_id": "L0", "pipeline_name": "P"}


@pytest.mark.parametrize("which", sorted(_LIVE_CASES))
def test_every_browser_live_executor_refused_before_launch(sr, monkeypatch, tmp_path, which):
    import importlib
    import ghl_form_builder as fb
    modname, call = _LIVE_CASES[which]
    mod = importlib.import_module(modname)

    def _launched(*a, **k):
        raise AssertionError("LAUNCH-REACHED")
    monkeypatch.setattr(fb.browser_manager, "headless_guard", _launched)
    monkeypatch.setattr(fb.browser_manager, "browser_session", _launched)
    ev = str(tmp_path / "ev")
    with pytest.raises(sr.AdapterSeamsNotPorted, match="ADAPTER-SEAMS-NOT-PORTED"):
        call(mod, ev)
    # control: with the gate open the same call reaches the browser sentinel
    monkeypatch.setattr(sr, "seams_refusal", lambda *a, **k: "")
    with pytest.raises(AssertionError, match="LAUNCH-REACHED"):
        call(mod, ev)


def test_every_live_build_names_its_session_before_the_browser():
    """Fails if a future sync adds a live executor that skips the choke point."""
    import ast

    def _dotted(n):
        parts = []
        while isinstance(n, ast.Attribute):
            parts.append(n.attr)
            n = n.value
        if isinstance(n, ast.Name):
            parts.append(n.id)
        return ".".join(reversed(parts))

    found = set()
    for path in sorted((SKILL_ROOT / "tools").glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for fn in (n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_live_build"):
            found.add(path.stem)
            calls = sorted((c for c in ast.walk(fn) if isinstance(c, ast.Call)),
                           key=lambda c: (c.lineno, c.col_offset))
            names = [_dotted(c.func) for c in calls]
            sess = [i for i, n in enumerate(names) if n.endswith("_canonical_session")]
            browser = [i for i, n in enumerate(names) if "browser_manager." in n]
            assert sess, f"{path.name}: _live_build never names its session"
            assert not browser or sess[0] < browser[0], f"{path.name}: browser touched before the gate"
    assert found >= {"ghl_form_builder", "ghl_pipeline_builder",
                     "ghl_community_builder", "ghl_course_builder"}, found


# ── The real CLI entry of every browser builder is refused (repair 3) ───────
# In-process main(): the exact CLI path minus the interpreter boundary. The real
# gate stays closed (empty receipt dir, seams_refusal NOT patched); only the
# browser launch is a sentinel. The control opens the gate and must reach it.

_CLI_ARGV = ["--no-dry-run", "--location-id", "loc123"]


@pytest.mark.parametrize("which", ["form", "pipeline", "community", "course"])
def test_cli_main_live_run_refused_before_launch(sr, monkeypatch, tmp_path, capsys, which):
    import importlib
    import ghl_form_builder as fb
    mod = importlib.import_module(_LIVE_CASES[which][0])
    reached = []

    def _launched(*a, **k):
        reached.append(1)
        raise RuntimeError("LAUNCH-REACHED")
    monkeypatch.setattr(fb.browser_manager, "headless_guard", _launched)
    monkeypatch.setattr(fb.browser_manager, "browser_session", _launched)
    extra = []
    if which == "course":
        plan = tmp_path / "plan.json"
        plan.write_text(json.dumps({"modules": [{"title": "M1", "lessons": [{"title": "L1", "body": "x"}]}]}))
        extra = ["--plan-json", str(plan)]

    def run(tag):
        argv = _CLI_ARGV + ["--evidence-root", str(tmp_path / ("ev-" + tag)),
                            "--state-root", str(tmp_path / ("st-" + tag))] + extra
        mod.main(argv)
        cap = capsys.readouterr()
        return cap.out + cap.err

    out = run("closed")
    assert "ADAPTER-SEAMS-NOT-PORTED" in out and not reached, out
    # control: gate open -> the same CLI call reaches the launch sentinel
    monkeypatch.setattr(sr, "seams_refusal", lambda *a, **k: "")
    out = run("open")
    assert reached and "LAUNCH-REACHED" in out, out


# ── REST write executors: media library + bulk workflow enroll (repair 3) ────

class _Net(Exception):
    pass


def _tiny_png(path):
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 32)
    return str(path)


def test_media_live_upload_refused(sr, monkeypatch, tmp_path):
    import urllib.request
    import ghl_media
    reached = []

    def _urlopen(*a, **k):
        reached.append(1)
        raise _Net("NETWORK-REACHED")
    monkeypatch.setattr(urllib.request, "urlopen", _urlopen)
    png = _tiny_png(tmp_path / "a.png")
    calls = (lambda **kw: ghl_media.upload_media(png, "L0", "n", "pit", **kw),
             lambda **kw: ghl_media.create_media_folder("f", "L0", "pit", **kw))
    for call in calls:
        with pytest.raises(sr.AdapterSeamsNotPorted, match="ADAPTER-SEAMS-NOT-PORTED"):
            call(opener=None)
        assert not reached
        # an injected opener is the test seam: not gated, so it is called
        seen = []

        def _fake(req, timeout, seen=seen):
            seen.append(1)
            raise _Net("fake transport")
        with pytest.raises(Exception):
            call(opener=_fake)
        assert seen and not reached
    # control: gate open -> the real transport is reached
    monkeypatch.setattr(sr, "seams_refusal", lambda *a, **k: "")
    for call in calls:
        reached.clear()
        with pytest.raises(Exception):
            call(opener=None)
        assert reached


def test_bulk_enroll_live_write_refused(sr, monkeypatch):
    import requests
    import ghl_bulk_workflow_enroll as be
    reached = []

    def _net(*a, **k):
        reached.append(1)
        raise _Net("NETWORK-REACHED")
    for verb in ("post", "delete", "get"):
        monkeypatch.setattr(requests, verb, _net)
    client = be.GhlHttpClient(token="x")
    writes = (lambda: client.enroll_contact_in_workflow("c1", "w1"),
              lambda: client.delete_contact("c1"))
    for w in writes:
        with pytest.raises(sr.AdapterSeamsNotPorted, match="ADAPTER-SEAMS-NOT-PORTED"):
            w()
    assert not reached
    # dry-run reads are never refused, even with the gate closed
    with pytest.raises(_Net):
        client.search_contacts("L0", "tag")
    with pytest.raises(_Net):
        client.get_contact("c1")
    # control: gate open -> both writes reach the network
    monkeypatch.setattr(sr, "seams_refusal", lambda *a, **k: "")
    for w in writes:
        reached.clear()
        with pytest.raises(_Net):
            w()
        assert reached
