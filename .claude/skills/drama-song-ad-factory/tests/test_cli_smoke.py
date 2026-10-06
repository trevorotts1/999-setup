#!/usr/bin/env python3
"""Smoke the packaged control CLI — the entrypoint both distributions run.

Asserts the documented envelope and exit-code contract
(references/cli-contract.md) against the packaged copy in scripts/core/.
stdlib only, no framework, no network.

Run: python3 tests/test_cli_smoke.py
"""
import json
import subprocess
import sys
from pathlib import Path

SKILL = Path(__file__).resolve().parents[1]
FACTORY = SKILL / "scripts" / "core" / "intake_preflight" / "factory.py"
BRIEF = SKILL / "assets" / "example-brief.json"

ENVELOPE_KEYS = {
    "schema_version", "tool_version", "command", "run_id", "outcome",
    "reason_code", "next_action", "evidence", "data", "state_version",
}
SCHEMA_VERSION = "blackceo.intake-preflight/envelope/v1"

FAILS = []


def check(name, ok, detail=""):
    print(f"{'ok' if ok else 'FAIL'}: {name}" + (f" ({detail})" if detail and not ok else ""))
    if not ok:
        FAILS.append(name)


def run(args):
    proc = subprocess.run(
        [sys.executable, str(FACTORY), *args],
        capture_output=True, text=True, timeout=120,
    )
    try:
        env = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"FAIL: stdout of {' '.join(args)} is not pure JSON: {exc}\n{proc.stdout[:400]}")
    return proc.returncode, env, proc.stderr


def main():
    check("factory.py present", FACTORY.is_file(), str(FACTORY))
    check("example brief present", BRIEF.is_file(), str(BRIEF))

    # 1. intake on a thin brief -> waiting / missing-essentials, exit 2, <= 3 questions
    rc, env, err = run(["intake", "--brief-file", str(BRIEF)])
    check("intake exit code 2 (waiting)", rc == 2, f"got {rc}")
    check("intake outcome waiting", env.get("outcome") == "waiting", str(env.get("outcome")))
    check("intake reason missing-essentials",
          env.get("reason_code") == "missing-essentials", str(env.get("reason_code")))
    check("intake command field", env.get("command") == "intake", str(env.get("command")))
    questions = (env.get("data") or {}).get("questions") or []
    check("intake batches at most 3 questions", 0 < len(questions) <= 3, str(len(questions)))
    check("intake stderr empty", err == "", err[:200])

    # 2. envelope shape, every command
    check("envelope keys exact", set(env) == ENVELOPE_KEYS, str(sorted(set(env) ^ ENVELOPE_KEYS)))
    check("schema_version pinned", env.get("schema_version") == SCHEMA_VERSION,
          str(env.get("schema_version")))
    check("tool_version present", bool(env.get("tool_version")), str(env.get("tool_version")))
    check("run_id present", bool(env.get("run_id")), str(env.get("run_id")))
    check("summary digest recorded", bool((env.get("data") or {}).get("summary")))
    check("auth_status never assumed", (env.get("data") or {}).get("auth_status") == "missing",
          str((env.get("data") or {}).get("auth_status")))

    # 3. preflight with no auth -> rejected / approval-missing, exit 4
    rc, env, err = run(["preflight"])
    check("preflight exit code 4 (rejected)", rc == 4, f"got {rc}")
    check("preflight outcome rejected", env.get("outcome") == "rejected", str(env.get("outcome")))
    check("preflight reason approval-missing",
          env.get("reason_code") == "approval-missing", str(env.get("reason_code")))
    check("preflight next_action actionable", bool(env.get("next_action")),
          str(env.get("next_action")))
    check("preflight stderr empty", err == "", err[:200])
    check("preflight is NAMES-only (no submission side effects recorded)",
          (env.get("data") or {}).get("checks") is not None, str(sorted((env.get("data") or {}).keys())))

    if FAILS:
        print(f"\n{len(FAILS)} FAILED: " + ", ".join(FAILS))
        return 1
    print("\nALL PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
