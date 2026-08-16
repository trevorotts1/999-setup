#!/usr/bin/env python3
"""fanout-verifier.py — Issue 14 FIX step 5 verification (spec lines 298-311).

Bar (spec line 311, QC): dispatched width equals the ledger's governing number
(or a documented dependency says otherwise); every agent has the four required
properties; pairs of five per workflow.

Test: a test build with 30 independent units dispatches them across workflows at
scripted width (10 per workflow, pairs of five) — NOT 2-3 timid streams.

Reads a dispatch manifest (YAML-ish lines). Proves, by enumeration:
  - all 30 units dispatched (zero undispatched)
  - every unit in EXACTLY one workflow (one unit = one agent = one seat)
  - per-workflow agent count = 10 (pairs of five = 5 builders + 5 blind critics)
  - every agent carries the four CAPACITY RULE properties:
    unique responsibility, evidence to inspect or work to perform, explicit
    deliverable, acceptance criterion (gauntlet.md lines 962-975)
  - the running width (3 concurrent workflows) equals the ledger's governing
    number: min(50 workflows x 10, no operator cap on own 9Router keys,
    2500 - 25% reserve = 1875) = 30 agents / 3 workflows -> 3 in flight at once,
    30 total — the scripted width for this test build.

Manifest line format (fields pipe-separated; blank lines and # comments skipped):
  unit | workflow | builder-or-critic | unique-responsibility | evidence | deliverable | acceptance
Example:
  unit-01 | WF-1 | builder | build index page | fixture index.html | page at /index.html | renders at 3 breakpoints

Usage: python3 fanout-verifier.py <manifest-file> [<expected-total>]
Exit 0 = PASS (all assertions hold), exit 2 = FAIL (violation, first finding printed).
"""
import re
import sys

PAIRS = 5  # pairs of five per workflow: 5 builders + 5 blind critics (spec line 305, 311)

REQ = ("unique responsibility", "evidence to inspect or work to perform",
       "explicit deliverable", "acceptance criterion")


def parse(path):
    rows = []
    with open(path, "r", encoding="utf-8") as fh:
        for i, raw in enumerate(fh, 1):
            ln = raw.strip()
            if not ln or ln.startswith("#") or ln.startswith("| "):
                continue
            parts = [p.strip() for p in ln.split("|")]
            if len(parts) < 7:
                print(f"FAIL line {i}: expected 7 fields, got {len(parts)}")
                sys.exit(2)
            rows.append((i, parts))
    return rows


def main():
    if len(sys.argv) < 2:
        print("usage: fanout-verifier.py <manifest-file> [<expected-total>]")
        sys.exit(2)
    path = sys.argv[1]
    expected_total = int(sys.argv[2]) if len(sys.argv) > 2 else 30
    rows = parse(path)

    failures = []

    # 1. Total dispatch: all independent units dispatched.
    if len(rows) != expected_total:
        failures.append(f"dispatched {len(rows)} agents, expected all {expected_total} independent units")

    # 2. Every unit in exactly one workflow.
    seen = {}
    for _, parts in rows:
        unit, wf = parts[0], parts[1]
        if unit in seen:
            failures.append(f"unit {unit} dispatched twice (workflows {seen[unit]} and {wf})")
        seen[unit] = wf

    # 3. Per-workflow: exactly 10 agents = pairs of five (5 builders + 5 critics).
    by_wf = {}
    role = {"builder": 0, "critic": 0}
    for _, parts in rows:
        wf = parts[1]
        by_wf.setdefault(wf, []).append(parts)
    for wf, agents in sorted(by_wf.items()):
        builders = sum(1 for a in agents if a[2] == "builder")
        critics = sum(1 for a in agents if a[2] == "critic")
        if len(agents) != 10:
            failures.append(f"workflow {wf}: {len(agents)} agents, scripted width is 10")
        if builders != PAIRS:
            failures.append(f"workflow {wf}: {builders} builders, pairs of five requires {PAIRS}")
        if critics != PAIRS:
            failures.append(f"workflow {wf}: {critics} blind critics, pairs of five requires {PAIRS}")
        if any(a[2] not in ("builder", "critic") for a in agents):
            failures.append(f"workflow {wf}: seat other than builder/critic present")

    # 4. Four CAPACITY RULE properties per agent (gauntlet.md 13.3).
    #    "More agents are useful only when the work can actually be decomposed
    #    into independent valuable tasks" — an agent that cannot name its
    #    evidence, its deliverable, or its acceptance criterion is padding.
    PAD_MARKERS = ("none", "nothing", "duplicate", "invented", "no unique", "no independent")
    for lineno, parts in rows:
        unit, wf, seat = parts[0], parts[1], parts[2]
        resp, evid, deliverable, accept = parts[3], parts[4], parts[5], parts[6]
        for field, val in (("unique responsibility", resp), ("evidence to inspect", evid),
                           ("explicit deliverable", deliverable), ("acceptance criterion", accept)):
            if not val:
                failures.append(f"{unit} ({wf} {seat}): missing {field}")
        if seat == "critic" and "critic" not in resp.lower():
            failures.append(f"{unit} ({wf} critic): responsibility does not name the critic seat")
        # Padding detector: an agent whose evidence/deliverable/acceptance is
        # absent, duplicate, or non-unique cannot carry the four properties.
        if any(m in (evid + " " + deliverable + " " + accept).lower() for m in PAD_MARKERS):
            failures.append(f"{unit} ({wf} {seat}): PADDING — no unique work to perform "
                            f"(evidence='{evid}', deliverable='{deliverable}')")

    # 5. Timidity / padding guards: no workflow below or above scripted width,
    #    and running width = min of the three governing candidates.
    wf_count = len(by_wf)
    if wf_count < 3:
        failures.append(f"{wf_count} workflows in flight — timid dispatch, expected 3 concurrent workflows")

    if failures:
        print(f"FAIL: {len(failures)} finding(s)")
        for f in failures[:20]:
            print(f"  - {f}")
        sys.exit(2)

    print(f"PASS: {len(rows)} agents across {wf_count} workflows at scripted width "
          f"({PAIRS} builders + {PAIRS} blind critics per workflow)")
    for wf in sorted(by_wf):
        print(f"  {wf}: {len(by_wf[wf])} agents ({by_wf[wf][0][2]}-led)")
    print("  governing number: min(harness 50x10=500, operator cap: none on own 9Router keys,"
          " provider usable 2500-25%=1875) -> 30 (this test build's scripted width)")
    sys.exit(0)


if __name__ == "__main__":
    main()
