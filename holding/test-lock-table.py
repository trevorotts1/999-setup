#!/usr/bin/env python3
"""Unit tests for the wave-lock checks in tools/boss-cron (WF-4C).

Two suites, same SourceFileLoader pattern:
  L1-L7: check_locked_table (WF-4C slice 4, Issue 15 FIX step 5)
  T1-T16: check_wave_growth (WF-4C slice 2, Issue 15 FIX step 2)

Every input line uses REAL ledger format: "- `CLASS <timestamp>: body`"
exactly as ledger_lines() feeds the checks — a bare body line is not a
ledger line and proves nothing.
"""
import sys
from importlib.machinery import SourceFileLoader

mod = SourceFileLoader("boss", "/Users/blackceomacmini/work-999-setup-fix/WF-4C/tools/boss-cron").load_module()

passed = 0
failed = 0

def run(name, check_fn, lines, predicate, expect_clean=False):
    global passed, failed
    v = check_fn(lines)
    if expect_clean:
        ok = v == []
    else:
        ok = predicate(v)
    if ok:
        passed += 1
        print(f"PASS {name}")
    else:
        failed += 1
        print(f"FAIL {name}: {v}")

def lt(name, lines, predicate=None, expect_clean=False):
    run(name, mod.check_locked_table, lines, predicate, expect_clean)

def wg(name, lines, predicate=None, expect_clean=False):
    run(name, mod.check_wave_growth, lines, predicate, expect_clean)

# --- L: check_locked_table (slice 4, Issue 15 FIX step 5) ---

# L1: clean — locked waves 1-6 only, no violations
lt("L1 locked waves 1-6 clean", [
    "- `WAVE 1 DISPATCH 2026-08-16T09:00:00Z: full PART 2 scripted width`",
    "- `WAVE 2 DISPATCH 2026-08-16T14:02:00Z: full PART 2 scripted width`",
    "- `WAVE 3 DISPATCH 2026-08-16T17:07:00Z: full PART 2 scripted width`",
    "- `WAVE 4 DISPATCH 2026-08-16T20:12:00Z: full PART 2 scripted width`",
    "- `WAVE 5 DISPATCH 2026-08-16T22:00:00Z: full PART 2 scripted width`",
    "- `WAVE 6 DISPATCH 2026-08-17T08:00:00Z: full PART 2 scripted width`",
], expect_clean=True)

# L2: wave 0 mentioned (boss bootstrap) — locked, no violation
lt("L2 wave 0 locked", [
    "- `ISSUE-18-EARLY 2026-08-16T13:42:00Z: interim boss-cron detect-first install — WAVE 0 BOOTSTRAP per Issue 18`",
], expect_clean=True)

# L3: wave 7 in ledger, no NEW-WAVE-7 line = VIOLATION
lt("L3 undocumented wave 7", [
    "- `WAVE 7 DISPATCH 2026-08-17T10:00:00Z: full PART 2 scripted width`",
], lambda v: any("wave 7 in ledger not in locked table" in x for x in v))

# L4: wave 7 with NEW-WAVE-7 dependency line = allowed
lt("L4 wave 7 with NEW-WAVE-7 dep", [
    "- `NEW-WAVE-7 2026-08-17T09:00:00Z: wave 7 opened — consumes wave 6's merged skill state`",
    "- `WAVE 7 DISPATCH 2026-08-17T10:00:00Z: full PART 2 scripted width`",
], expect_clean=True)

# L5: wave 8 with only a NEW-WAVE-7 line = violation (dependency line number must match)
lt("L5 wave 8 wrong dep number", [
    "- `NEW-WAVE-7 2026-08-17T09:00:00Z: wave 7 opened — consumes wave 6's output`",
    "- `WAVE 8 DISPATCH 2026-08-17T11:00:00Z: full PART 2 scripted width`",
], lambda v: any("wave 8 in ledger not in locked table" in x for x in v))

# L6: NEW-WAVE-N class name alone (no number) does not open anything
lt("L6 bare NEW-WAVE-N class", [
    "- `NEW-WAVE-N 2026-08-17T09:00:00Z: additional waves only via dependency lines`",
    "- `WAVE 9 DISPATCH 2026-08-17T11:00:00Z`",
], lambda v: any("wave 9" in x for x in v))

# L7: VIOLATION-STOP line citing NEW-WAVE-7 is evidence, not an opening
lt("L7 violation citation not an opening", [
    "- `VIOLATION-STOP 2026-08-17T09:30:00Z: NEW-WAVE-7 dependency line missing — conductor MUST TaskStop`",
    "- `WAVE 7 DISPATCH 2026-08-17T10:00:00Z`",
], lambda v: any("wave 7 in ledger not in locked table" in x for x in v))

# --- T: check_wave_growth (slice 2, Issue 15 FIX step 2) ---

# T1: valid opening — names a lower wave it consumes
wg("T1 consumes output of wave 6", [
    "- `NEW-WAVE-7 2026-08-17T09:00:00Z: consumes the output of wave 6`",
], expect_clean=True)

# T2: bare opening — names no dependency = violation
wg("T2 bare opening wave 7", [
    "- `NEW-WAVE-7 2026-08-17T09:00:00Z: opening wave 7`",
], lambda v: any("names no dependency" in x for x in v))

# T3: VIOLATION-STOP citing NEW-WAVE-7 is evidence, not an opening
wg("T3 violation citation not an opening", [
    "- `VIOLATION-STOP 2026-08-17T09:30:00Z: wave 7 missing NEW-WAVE-7 line`",
], expect_clean=True)

# T4: "depends on" hint names wave 6 = valid
wg("T4 depends on wave 6 completing", [
    "- `NEW-WAVE-7 2026-08-17T09:00:00Z: depends on wave 6 completing`",
], expect_clean=True)

# T5: "consumes wave 6 output" = valid
wg("T5 consumes wave 6 output", [
    "- `NEW-WAVE-7 2026-08-17T09:00:00Z: consumes wave 6 output`",
], expect_clean=True)

# T6: empty ledger = clean
wg("T6 empty ledger", [], expect_clean=True)

# T7: colon-glued class token, no dependency = violation
wg("T7 colon class token just opening", [
    "- `NEW-WAVE-7: 2026-08-17T09:00:00Z: just opening`",
], lambda v: any("names no dependency" in x for x in v))

# T8: NEW-WAVE-12 requires wave 11 = valid
wg("T8 requires wave 11 landed", [
    "- `NEW-WAVE-12 2026-08-17T09:00:00Z: requires wave 11 landed`",
], expect_clean=True)

# T9: names a LATER wave = violation
wg("T9 consumes wave 8 (later wave)", [
    "- `NEW-WAVE-7 2026-08-17T09:00:00Z: consumes wave 8`",
], lambda v: any("no prior wave" in x for x in v))

# T10: names its own wave = violation
wg("T10 depends on wave 7 (own wave)", [
    "- `NEW-WAVE-7 2026-08-17T09:00:00Z: depends on wave 7`",
], lambda v: any("no prior wave" in x for x in v))

# T11: own wave named via "output of" phrasing = violation
wg("T11 consumes the output of wave 7", [
    "- `NEW-WAVE-7 2026-08-17T09:00:00Z: consumes the output of wave 7`",
], lambda v: any("no prior wave" in x for x in v))

# T12: hint present but no wave named = violation
wg("T12 no wave named", [
    "- `NEW-WAVE-7 2026-08-17T09:00:00Z: depends on the merge train finishing`",
], lambda v: any("no prior wave" in x for x in v))

# T13: plural "waves 5 and 6" = valid
wg("T13 consumes output of waves 5 and 6", [
    "- `NEW-WAVE-7 2026-08-17T09:00:00Z: consumes output of waves 5 and 6`",
], expect_clean=True)

# T14: dependency named as NEW-WAVE-6 = valid
wg("T14 consumes NEW-WAVE-6 output", [
    "- `NEW-WAVE-7 2026-08-17T09:00:00Z: consumes NEW-WAVE-6 output`",
], expect_clean=True)

# T15: self-mention plus real dependency = valid
wg("T15 wave 7 opened, consumes wave 6", [
    "- `NEW-WAVE-7 2026-08-17T09:00:00Z: wave 7 opened, consumes wave 6`",
], expect_clean=True)

# T16: hint-like word, no dependency = violation
wg("T16 wave flag no dependency", [
    "- `NEW-WAVE-7 2026-08-17T09:00:00Z: wave 7 added per the wave flag`",
], lambda v: any("names no dependency" in x for x in v))

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
