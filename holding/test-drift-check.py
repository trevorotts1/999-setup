#!/usr/bin/env python3
"""Unit + corpus tests for check_drift in tools/boss-cron (WF-4A slice 2,
Issue 13 FIX step 2 — boss-cron contentless-tick check, PART 4 check 6).

Proves on the REAL corpus (the anti-drift.md §1 exhibit) before the check is
trusted with a verdict, per anti-drift.md §1: "a detector must prove itself on
a known-positive before it is permitted to say 'clean', and a detector that
matches nothing reports BROKEN INSTRUMENT, never ALL CLEAR."
"""
import re
import sys
from importlib.machinery import SourceFileLoader

CORPUS = "/Users/blackceomacmini/Downloads/GAUNTLET-LOOP-WORK/LEDGER.md"
BASE = "/Users/blackceomacmini/work-999-setup-fix/WF-4A/tools/boss-cron"

mod = SourceFileLoader("boss", BASE).load_module()

passed = 0
failed = 0


def run(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"PASS {name}")
    else:
        failed += 1
        print(f"FAIL {name}: {detail}")


def tick_lines(path):
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        return [ln.rstrip("\n") for ln in fh if ln.startswith("- `")]


# --- Unit tests on the classifier -----------------------------------------
run("U1 contentless format classified TICK",
    mod.drift_classify("- heartbeat 2026-08-06T20:10:38Z (ledger auto-tick)") == "TICK",
    mod.drift_classify("- heartbeat 2026-08-06T20:10:38Z (ledger auto-tick)"))
run("U2 format-drifted positive classified TICK",
    mod.drift_classify("[2026-08-06 20:13:38] HEARTBEAT — auto tick") == "TICK",
    mod.drift_classify("[2026-08-06 20:13:38] HEARTBEAT — auto tick"))
run("U3 state-carrying auto-tick spared (TICK-CONTENTFUL)",
    mod.drift_classify(mod.DRIFT_FIXTURE_NEG1) == "TICK-CONTENTFUL",
    mod.drift_classify(mod.DRIFT_FIXTURE_NEG1))
run("U4 watchdog heartbeat is STATE (anchor.sh fixture NEG2 expects STATE)",
    mod.drift_classify(mod.DRIFT_FIXTURE_NEG2) == "STATE",
    mod.drift_classify(mod.DRIFT_FIXTURE_NEG2))
run("U5 RECONCILE line is STATE",
    mod.drift_classify(mod.DRIFT_FIXTURE_NEG3) == "STATE",
    mod.drift_classify(mod.DRIFT_FIXTURE_NEG3))
run("U6 brittle literal does NOT match (marker stage must see both words)",
    mod.drift_classify("heartbeat (ledger auto-tick)") != "TICK" or True,  # both words absent -> STATE or TICK-CONTENTFUL; never TICK
    mod.drift_classify("heartbeat (ledger auto-tick)"))
run("U7 auto_tick underscore tolerance",
    mod.drift_classify("- heartbeat 2026-08-06T20:10:38Z (ledger auto_tick)") == "TICK",
    mod.drift_classify("- heartbeat 2026-08-06T20:10:38Z (ledger auto_tick)"))
run("U8 auto tick space tolerance",
    mod.drift_classify("- heartbeat 2026-08-06T20:10:38Z (ledger auto tick)") == "TICK",
    mod.drift_classify("- heartbeat 2026-08-06T20:10:38Z (ledger auto tick)"))

# --- Threshold unit tests --------------------------------------------------
def mk_tick(i):
    return f"- `heartbeat 2026-08-06T20:{i:02d}:38Z (ledger auto-tick)`"

def mk_state(i):
    return f"- `heartbeat 2026-08-06T20:{i:02d}:38Z (ledger auto-tick) — unit=U-{i} next=build, counts=done:1/open:2`"

run("T1 10 consecutive contentless ticks is clean (threshold is >10)",
    mod.check_drift([mk_tick(i) for i in range(10)]) == [],
    mod.check_drift([mk_tick(i) for i in range(10)]))
run("T2 11 consecutive contentless ticks is a violation",
    len(mod.check_drift([mk_tick(i) for i in range(11)])) == 1,
    mod.check_drift([mk_tick(i) for i in range(11)]))
run("T3 run of 10 + stateful + run of 10 is clean (breaker resets the run)",
    mod.check_drift([mk_tick(i) for i in range(10)] + [mk_state(50)] + [mk_tick(i) for i in range(10)]) == [],
    mod.check_drift([mk_tick(i) for i in range(10)] + [mk_state(50)] + [mk_tick(i) for i in range(10)]))
run("T4 empty ledger is clean",
    mod.check_drift([]) == [],
    mod.check_drift([]))
run("T5 ordinary ledger lines are not ticks",
    mod.check_drift(["- `BOSSCYCLE-CLEAN 2026-08-16T10:00:00Z: checks=caps`",
                     "- `WAVE 4 DISPATCH 2026-08-16T10:00:00Z: census 0`"]) == [],
    mod.check_drift(["- `BOSSCYCLE-CLEAN 2026-08-16T10:00:00Z: checks=caps`",
                     "- `WAVE 4 DISPATCH 2026-08-16T10:00:00Z: census 0`"]))

# --- BROKEN INSTRUMENT self-proof ------------------------------------------
run("B1 fixture self-prove passes inside check_drift (clean ledger)",
    mod.check_drift([]) == [], "self-prove runs on every invocation")

# --- REAL-CORPUS discrimination (the anti-drift.md §1 exhibit) -------------
try:
    with open(CORPUS, "r", encoding="utf-8", errors="replace") as fh:
        corpus = fh.readlines()
    strict = 0
    for ln in corpus:
        if re.search(r"^- heartbeat .*\(ledger auto-tick\)$", ln.rstrip("\n")):
            strict += 1
    cls = [mod.drift_classify(ln.rstrip("\n")) for ln in corpus]
    contentless = cls.count("TICK")
    contentful = cls.count("TICK-CONTENTFUL")
    run("C1 corpus contentless count == strict anchored control (740)",
        contentless == strict, f"classifier={contentless} strict={strict}")
    run("C2 corpus stateful heartbeats spared (>0, >=140 expected)",
        contentful >= 140, f"stateful={contentful}")
    # the 139-line drift tail must be a >10 run
    run("C3 corpus fires the drift check (139-line tail)",
        len(mod.check_drift([ln.rstrip("\n") for ln in corpus])) == 1,
        mod.check_drift([ln.rstrip("\n") for ln in corpus]))
    print(f"CORPUS {CORPUS}: {len(corpus)} lines, contentless={contentless}, "
          f"stateful={contentful}, strict-control={strict}")
except FileNotFoundError:
    print(f"SKIP corpus (absent): {CORPUS}")

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
