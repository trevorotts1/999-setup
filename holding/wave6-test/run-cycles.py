#!/usr/bin/env python3
"""WF-4C slice 6 — end-to-end boss-cron cycle test (Issue 15 FIX step 6).
Runs the committed tools/boss-cron (e56d374) main() against temp ledgers, full
cycle (non-dry): violation -> VIOLATION-STOP appended + stop file + exit 2;
clean -> BOSSCYCLE-CLEAN + exit 0.
Scenarios: 5-wave locked table (the drift scenario: plan locked at 5 waves),
attempted wave 6 undocumented (must STOP) vs documented via NEW-WAVE-6 (must pass).
"""
import io
import os
import sys
import tempfile
import contextlib

SRC = open("boss-under-test.py").read()
ns = {}
exec(compile(SRC, "boss-under-test.py", "exec"), ns)
bc = ns

tmp = tempfile.mkdtemp(prefix="w6-")
bc["PIDS"] = os.path.join(tmp, "workflow-pids.json")

# The drift scenario: this run's plan locked at 5 waves (spec PROBLEM line 317).
five = {
    1: {"WF-1A": 5, "WF-1B": 5},
    2: {"WF-2A": 5, "WF-2B": 5, "WF-2C": 5, "WF-2D": 5, "WF-2E": 5},
    3: {"WF-3A": 5, "WF-3B": 5, "WF-3C": 5, "WF-3D": 5, "WF-3E": 5},
    4: {"WF-4A": 5, "WF-4B": 5, "WF-4C": 5, "WF-4D": 5, "WF-4E": 5},
    5: {"WF-5A": 5, "WF-5B": 5, "WF-5C": 1},
}
bc["LOCKED_WAVES"] = five

base = open("fixtures/s1-clean.md").read()

scenarios = {
    "S1-clean": base + "## WAVE 5\n- `WAVE 5 CLOSED 2026-08-16T21:30Z`\n",
    "S2-undoc-wave6": base + "## WAVE 5\n- `WAVE 5 CLOSED 2026-08-16T21:30Z`\n## WAVE 6\n- `WAVE 6 DISPATCH 2026-08-16T21:40Z: undocumented wave 6 attempt. Census before dispatch: 0 live agents.`\n",
    "S3-doc-wave6": base + "## WAVE 5\n- `WAVE 5 CLOSED 2026-08-16T21:30Z`\n## WAVE 6\n- `NEW-WAVE-6 2026-08-16T21:40Z: wave 6 opened - consumes wave 5's WF-5C batch-merge output.`\n- `WAVE 6 DISPATCH 2026-08-16T21:40Z: WF-6A status-line config. Census before dispatch: 0 live agents.`\n",
}


def run_cycle(ledger_path, stop_path):
    bc["LEDGER"] = ledger_path
    bc["STOP"] = stop_path
    out = io.StringIO()
    rc = None
    with contextlib.redirect_stdout(out):
        try:
            bc["main"]()
        except SystemExit as e:
            rc = e.code
    return rc, out.getvalue().strip()


sys.argv = ["boss-cron"]
for name, content in scenarios.items():
    p = os.path.join(tmp, name + ".md")
    with open(p, "w") as fh:
        fh.write(content)
    rc, out = run_cycle(p, os.path.join(tmp, "stop-" + name))
    ledger_after = open(p).read()
    vio = [l for l in ledger_after.splitlines() if "VIOLATION-STOP" in l]
    clean = [l for l in ledger_after.splitlines() if "BOSSCYCLE-CLEAN" in l]
    stop = os.path.exists(os.path.join(tmp, "stop-" + name))
    print("=== %s: exit=%s VIOLATION-STOP=%d BOSSCYCLE-CLEAN=%d stopfile=%s" % (name, rc, len(vio), len(clean), stop))
    for v in vio:
        print("   VIO:", v[:200])
    print("   out:", out[:120])
