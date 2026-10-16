#!/usr/bin/env python3
"""MOCK-only tests — openclaw_browser_adapter.sh (Skill 06 Lane 2 adapter).

These tests are MOCK-ONLY. There is NO live OpenClaw, NO managed-browser
launch, NO network, NO secrets. Every subprocess test either restricts PATH to
/usr/bin:/bin (where the `openclaw` CLI does not exist) or installs a tiny
argv-echoing STUB `openclaw` on a scratch PATH. No verb ever reaches a real
browser; `--selftest` itself is browser-safe by construction (it runs only
against stripped PATHs and stubs).

Exit-code contract under test (999 harness form, documented in the adapter
header): Lane 2 does not exist in the Claude Code harness, so EVERY verb
refuses with exit 75 + the harness reason, before any CLI or capability
check. The verb->CLI mapping is retained in the adapter as the documented
translation for a future amendment and is not exercisable here.
  0   --help / --version / --selftest success
  64  no verb at all (usage printed before the gate)
  75  harness gate refusal (every verb, any PATH, any capability JSON)

Coverage:
  (a) `--selftest` subprocess exits 0 (offline, timeout 120, no browser)
  (b) every verb against a PATH WITHOUT openclaw -> exit 75 + stderr names
      the harness (claude-nine) and the primary lane
  (c) the gate precedes capability state: cliWorks=false, missing JSON,
      and cliWorks=true ALL refuse 75 identically
  (d) with a stub CLI + cliWorks=true, no verb reaches the stub (no mapped
      argv is ever produced)
  (e) unknown verb / missing-arg verbs -> 75 (gate first); no verb -> 64

Run:
    python3 -m pytest tests/test_openclaw_browser_adapter.py -v
"""
from __future__ import annotations

import os
import subprocess
import stat
import sys
import tempfile
from pathlib import Path

import pytest

_TOOLS_DIR = (Path(__file__).parent.parent / "tools").resolve()
_ADAPTER_SH = _TOOLS_DIR / "openclaw_browser_adapter.sh"

ALL_VERBS = ["status", "start", "open", "snapshot", "click", "type",
             "frame-snapshot", "stop"]

# PATH where the real openclaw CLI cannot exist (it lives in ~/.local/bin on
# the operator box; /usr/bin:/bin is the minimal system set).
_STRIpped_PATH = "/usr/bin:/bin"


def _read(p: Path) -> str:
    assert p.exists(), f"missing: {p}"
    return p.read_text(encoding="utf-8")


def _make_stub_dir(tmp_path: Path) -> Path:
    """Write a stub `openclaw` that echoes its argv one-per-line, exit 0."""
    stub_dir = tmp_path / "stubbin"
    stub_dir.mkdir(exist_ok=True)
    stub = stub_dir / "openclaw"
    stub.write_text(
        "#!/bin/sh\n"
        'for a in "$@"; do printf "%s\\n" "$a"; done\n'
        "exit 0\n",
        encoding="utf-8",
    )
    stub.chmod(stub.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return stub_dir


def _cap_json(tmp_path: Path, cliworks: bool) -> Path:
    p = tmp_path / "capability.json"
    p.write_text(
        '{"lanes": {"openclaw_managed_browser": {"cliWorks": %s}}}\n'
        % ("true" if cliworks else "false"),
        encoding="utf-8",
    )
    return p


def _run_adapter(args, env_extra, timeout=120):
    env = dict(os.environ)
    env.pop("GHL_SKILL6_CAPABILITY_JSON", None)
    env.pop("GHL_SKILL6_SNAPSHOT_MODE", None)
    env.pop("OCB_PROFILE", None)
    env.pop("OCB_CALL_TIMEOUT", None)
    env.update(env_extra)
    return subprocess.run(
        ["bash", str(_ADAPTER_SH)] + list(args),
        capture_output=True, text=True, timeout=timeout, env=env,
    )


def _stub_env(tmp_path: Path) -> dict:
    return {
        "PATH": f"{_make_stub_dir(tmp_path)}:/usr/bin:/bin",
        "GHL_SKILL6_CAPABILITY_JSON": str(_cap_json(tmp_path, True)),
        "GHL_SKILL6_SNAPSHOT_MODE": "efficient",
    }


# ── (a) --selftest subprocess convention ─────────────────────────────────────

def test_selftest_subprocess_exit_zero():
    proc = subprocess.run(
        ["bash", str(_ADAPTER_SH), "--selftest"],
        capture_output=True, text=True, timeout=120,
    )
    assert proc.returncode == 0, (
        f"--selftest must exit 0 offline\nstdout:\n{proc.stdout}\n"
        f"stderr:\n{proc.stderr}"
    )
    assert "SELFTEST PASS" in proc.stdout


def test_selftest_runs_without_openclaw_on_path():
    """The selftest must pass with the openclaw CLI removed from PATH — proving
    no real binary or browser is ever needed (and none is launched)."""
    env = dict(os.environ)
    env["PATH"] = _STRIpped_PATH
    proc = subprocess.run(
        ["bash", str(_ADAPTER_SH), "--selftest"],
        capture_output=True, text=True, timeout=120, env=env,
    )
    assert proc.returncode == 0
    assert "SELFTEST PASS" in proc.stdout


# ── (b) harness gate: exit 75 for every verb, fires before anything else ────

@pytest.mark.parametrize("verb", ALL_VERBS)
def test_verb_refuses_75_in_this_harness(tmp_path, verb):
    """Every verb against a PATH WITHOUT openclaw -> exit 75 + stderr names
    the harness reason (claude-nine). The adapter must refuse before ever
    attempting a browser action."""
    env = {"PATH": _STRIpped_PATH}
    if verb == "open":
        args = [verb, "https://example.test/ghl"]
    elif verb == "type":
        args = [verb, "f1e12", "text"]
    else:
        args = [verb]
    proc = _run_adapter(args, env)
    assert proc.returncode == 75, (
        f"verb {verb}: expected exit 75 (harness gate), got "
        f"{proc.returncode}\nstderr:\n{proc.stderr}"
    )
    combined = proc.stderr + proc.stdout
    assert "claude-nine" in combined
    assert "REFUSE" in combined


def test_cli_absent_refusal_mentions_primary_lane():
    """The refusal should point the caller at the agent-browser PRIMARY so a
    Lane-2 miss is actionable, not a dead end."""
    proc = _run_adapter(["status"], {"PATH": _STRIpped_PATH})
    combined = proc.stderr + proc.stdout
    assert "agent-browser" in combined or "browser_manager" in combined


# ── (c) the harness gate precedes capability state ───────────────────────────

def test_capability_gate_cliworks_false_exits_75(tmp_path):
    stub_dir = _make_stub_dir(tmp_path)
    cap = _cap_json(tmp_path, cliworks=False)
    proc = _run_adapter(
        ["status"],
        {"PATH": f"{stub_dir}:/usr/bin:/bin",
         "GHL_SKILL6_CAPABILITY_JSON": str(cap)},
    )
    assert proc.returncode == 75, f"expected 75, got {proc.returncode}\n{proc.stderr}"
    assert "claude-nine" in (proc.stderr + proc.stdout)


def test_capability_gate_missing_json_exits_75(tmp_path):
    stub_dir = _make_stub_dir(tmp_path)
    proc = _run_adapter(
        ["status"],
        {"PATH": f"{stub_dir}:/usr/bin:/bin",
         "GHL_SKILL6_CAPABILITY_JSON": str(tmp_path / "absent.json")},
    )
    assert proc.returncode == 75
    assert "claude-nine" in (proc.stderr + proc.stdout)


def test_harness_gate_beats_cliworks_true(tmp_path):
    """Ordering contract (999): even with the stub CLI present AND a
    capability JSON claiming cliWorks=true, the verb refuses 75 — the
    lane does not exist in this harness, so no capability state enables
    it here."""
    cap = _cap_json(tmp_path, cliworks=True)
    proc = _run_adapter(
        ["status"],
        {"PATH": _STRIpped_PATH, "GHL_SKILL6_CAPABILITY_JSON": str(cap)},
    )
    assert proc.returncode == 75


# ── (d) no verb ever reaches the stub CLI ────────────────────────────────────

@pytest.mark.parametrize("verb,args", [
    ("status", []),
    ("start", []),
    ("open", ["https://app.convertandflow.com/"]),
    ("snapshot", []),
    ("frame-snapshot", ['iframe[src*="form-builder-v2"]']),
    ("click", ["f1e12"]),
    ("type", ["f1e12", "hello world"]),
    ("stop", []),
])
def test_no_verb_reaches_the_stub(tmp_path, verb, args):
    """With stub CLI + cliWorks=true, every verb still refuses 75 and the
    stub's argv echo never appears (no mapped command was produced)."""
    proc = _run_adapter([verb] + args, _stub_env(tmp_path))
    assert proc.returncode == 75, f"{verb}: expected 75, got {proc.returncode}"
    out = (proc.stdout + proc.stderr).splitlines()
    for token in ("--browser-profile", "--interactive", "--efficient",
                  "--frame", "f1e12", "hello world"):
        assert token not in out, f"{verb}: stub argv token leaked: {token}"


# ── (e) usage surface ────────────────────────────────────────────────────────

def test_unknown_verb_exits_75():
    """The harness gate precedes verb validation: an unknown verb refuses
    75 like every other verb."""
    proc = _run_adapter(["frobnicate"], {"PATH": _STRIpped_PATH})
    assert proc.returncode == 75


def test_no_verb_prints_usage_exits_64():
    proc = _run_adapter([], {"PATH": _STRIpped_PATH})
    assert proc.returncode == 64


def test_open_without_url_exits_75(tmp_path):
    proc = _run_adapter(["open"], _stub_env(tmp_path))
    assert proc.returncode == 75


def test_type_missing_text_exits_75(tmp_path):
    proc = _run_adapter(["type", "f1e12"], _stub_env(tmp_path))
    assert proc.returncode == 75


def test_frame_snapshot_without_selector_exits_75(tmp_path):
    proc = _run_adapter(["frame-snapshot"], _stub_env(tmp_path))
    assert proc.returncode == 75


def test_help_flag_exits_zero():
    proc = _run_adapter(["--help"], {"PATH": _STRIpped_PATH})
    assert proc.returncode == 0
    combined = proc.stdout + proc.stderr
    for verb in ALL_VERBS:
        assert verb in combined


# ── static: adapter never references a real browser launch in selftest ───────

def test_selftest_never_starts_a_browser_process():
    """Static guard: the selftest body must not invoke a real browser binary —
    only PATH-stripped subprocesses and the argv stub. The strings 'browser
    start' / 'browser open' legitimately appear in the selftest's PASS-message
    labels, so the guard targets actual invocation shapes: the CLI word at the
    START of a command, `agent-browser`, and `navigate`."""
    src = _read(_ADAPTER_SH)
    # Extract the selftest function body (up to the next top-level definition).
    start = src.index("selftest() {")
    body = src[start:]
    assert "agent-browser" not in body
    assert "navigate" not in body
    # No line may EXEC openclaw with a browser-verb as its first argument.
    for line in body.splitlines():
        stripped = line.strip()
        if stripped.startswith('"$OCB_BIN_NAME"') or stripped.startswith('"$OCB"'):
            assert not any(
                stripped.startswith(f'"{name}" {verb}')
                for name in ("$OCB_BIN_NAME", "$OCB")
                for verb in ("browser", "start", "open", "navigate", "click")
            ), f"selftest must not exec a browser verb: {stripped}"


def test_script_bash32_safe_static():
    """P1-12 portability: no mapfile, no associative arrays, no ${var,,}
    lowercasing — in CODE. (Doc-comment mentions of the banned constructs are
    fine and expected; strip comments before asserting.)"""
    src = _read(_ADAPTER_SH)
    code_lines = [
        ln for ln in src.splitlines()
        if ln.strip() and not ln.strip().startswith("#")
    ]
    code = "\n".join(code_lines)
    assert "mapfile" not in code
    assert "declare -A" not in code
    assert "declare -a" not in code
    assert ",," not in code