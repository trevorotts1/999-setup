# conftest.py — rootdir-level pytest config for 06-ghl-install-pages tests.

# P0-6 capability-freshness gate: mock dispatch suites assert the SOP state-
# machine contract, NOT the freshness gate (the gate has its own dedicated
# suite in test_browser_manager_capability_wire.py). On CI / any bare box the
# default receipt (working/skill6-capability.json) is absent, which would flip
# every mock dispatch into STATE_WAITING. Autouse: redirect the dispatcher's
# DEFAULT_CAPABILITY_PATH to a fresh receipt for the duration of each test.
# Suites that test the gate itself inject their own capability_path explicitly
# (test_browser_manager_capability_wire.py), which wins over this default.

import json
import os
import time
from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def _fresh_capability_receipt(tmp_path_factory, monkeypatch):
    try:
        import v2_dispatcher as _disp
    except ImportError:
        return  # suite does not touch the dispatcher
    # OUTSIDE any test's tmp_path: clean-dir / byte-identical tests assert
    # ``list(tmp_path.iterdir()) == []`` — nothing may land there, fixture
    # included. tmp_path_factory gives a per-test dir in pytest's own base.
    capdir = tmp_path_factory.mktemp("capfix")
    cap = capdir / "skill6-capability.json"
    cap.write_text(json.dumps({"selectedLane": "agent_browser",
                               "probedAt": "mock-fixture"}), encoding="utf-8")
    import os as _os
    _os.utime(str(cap), (time.time(), time.time()))
    monkeypatch.setattr(_disp, "DEFAULT_CAPABILITY_PATH", str(cap),
                        raising=False)


@pytest.fixture(autouse=True)
def _default_capability_receipt_on_disk():
    """The default probe receipt (working/skill6-capability.json) is a RUNTIME
    artifact, not a tracked fixture. Suites that shell out to a CLI in a
    SUBPROCESS cannot see the in-process monkeypatch above, and the
    dispatcher's capability-freshness gate flips them to STATE_WAITING when the
    receipt is missing — a red on any bare checkout (exactly the hazard the
    fixture above documents). Recreate it if absent so the on-disk path is as
    deterministic as the committed artifact it replaces.

    Creates only; never deletes. test_capability_probe's stdout-only test still
    owns its own absence assertion (it clears the file itself first)."""
    skill_dir = Path(__file__).resolve().parent.parent
    default = skill_dir / "working" / "skill6-capability.json"
    try:
        if not default.exists():
            default.parent.mkdir(parents=True, exist_ok=True)
            default.write_text(json.dumps({"selectedLane": "agent_browser",
                                           "probedAt": "mock-fixture"}),
                               encoding="utf-8")
    except OSError:
        pass


@pytest.fixture(autouse=True)
def _configured_client_model(monkeypatch):
    """Simulate a configured client box for model resolution.

    Skill 06 resolves every role's model from the client's own configuration
    (tools/model_router.py): the client's explicit choice, else their
    configured default model. Hermetic suites exercise plan building and
    dispatch logic, not the unconfigured stop, so each test runs with a
    neutral configured default, exactly as a real client box would have one.
    The doctrine tests for the unconfigured stop pass explicit env dicts to
    the router and are unaffected by the process environment."""
    monkeypatch.setenv("MODEL_ROUTER_DEFAULT", "client-default:cloud")


# 999 harness adapter (ADAPTER.md): v2_dispatcher.dispatch_one calls
# skill_runner.install() at entry, which re-binds functions on the dist modules
# for the rest of the process. Neutral suites assert the un-wired functions, so
# restore every wired module (and skill_runner's routing flag) after each test.
_WIRED = ("ghl_form_builder", "ghl_builder", "browser_manager", "ghl_verify",
          "ghl_secret_resolver")


@pytest.fixture(autouse=True)
def _undo_skill_runner_wiring():
    import sys
    saved = {n: dict(sys.modules[n].__dict__) for n in _WIRED if n in sys.modules}
    sr = sys.modules.get("skill_runner")
    routing = getattr(sr, "_ROUTING", None)
    yield
    for n, snap in saved.items():
        if n not in sys.modules:
            continue
        d = sys.modules[n].__dict__
        for k in [k for k in d if k not in snap]:
            del d[k]
        d.update(snap)
    sr = sys.modules.get("skill_runner")
    if sr is not None:
        sr._ROUTING = routing


@pytest.fixture(autouse=True)
def _seams_gate_open_for_neutral_suites(request, monkeypatch):
    """Neutral (byte-parity) suites drive live-shaped builds against fakes; the
    ADAPTER-SEAMS-NOT-PORTED gate is proven by its own suite, which keeps the
    real gate (tests/test_s06_entry_wiring_skill_runner.py)."""
    if request.module.__name__.endswith("test_s06_entry_wiring_skill_runner"):
        return
    import sys
    from pathlib import Path
    root = str(Path(__file__).resolve().parent.parent)
    if root not in sys.path:
        sys.path.insert(0, root)
    import skill_runner
    monkeypatch.setattr(skill_runner, "seams_refusal", lambda *a, **k: "")
    if os.path.isdir(skill_runner.nine_public_engine_root()):
        monkeypatch.setenv("GHL_PUBLIC_ENGINE_ROOT", skill_runner.nine_public_engine_root())
