# WF-4A slice 2 evidence — heartbeats carry state; boss-cron contentless-tick check

**Slice:** WF-4A slice 2 (Issue 13 FIX step 2 — the boss-cron contentless-tick half of PART 4 check 6)
**Branch:** fix/13-anti-drift (clone /Users/blackceomacmini/work-999-setup-fix/WF-4A)
**Ledger line cited:** `WAVE 4 DISPATCH 2026-08-16T20:12Z` (FIX-LEDGER.md, Wave 4 dispatch)
**Spec:** /Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md — ISSUE 13 FIX step 2 (line 288) + PART 4 check 6 (line 543) + PART 4 drift checks (line 547)

## What the slice names

Issue 13 FIX step 2 (spec line 288):
> "Heartbeats must CARRY STATE (counts by status, current unit, next item); a contentless 'auto-tick' is a banned write — the boss cron counts contentless ticks and stops the lane at a threshold (any run of > 10 consecutive contentless ticks)."

PART 4 check 6 (spec line 543):
> "Drift check: > 10 consecutive contentless heartbeat ticks = violation; a missing `anchor.sh --mode reconcile` at a wave boundary/tick/compaction = violation."

Scope boundary (named): this slice wires the CONTENTLESS-TICK half of check 6 into the boss cron. The missing-reconcile half is WF-4A slice 3's wiring (anchor.sh call sites, task #24); the heartbeat-state write side (SKILL.md/anti-drift.md doctrine lines 1602-1620) is WF-4A slice 1's slice. Nothing else touched.

## Change

**File:** `tools/boss-cron` (new in this working copy; copied byte-identical from the live `/Users/blackceomacmini/work-999-setup/tools/boss-cron` at the WAVE 4 base — the live file carries NO drift check, verified: its check list is `caps,census,width,wavelock,claims,beat,stop,scope,kill`, line 307, and it has no contentless classifier — then extended).

### Added: `check_drift(lines)` + `drift_classify(line)` — PART 4 check 6 / ISSUE 13 FIX step 2

The two-stage classifier, ported from `tools/anchor.sh`'s AWK classifier (WF-4A/.claude/skills/spec-protocol/tools/anchor.sh lines 269-293) per the anti-drift.md §1 contract:

- **STAGE 1 (marker):** `heartbeat` and `auto-tick` on one line, either order, case-insensitive, hyphen/space/underscore tolerant (`auto tick` / `auto_tick`), anything between — boss-cron lines 299-301. The brittle adjacent literal `heartbeat (ledger auto-tick)` MISSES the real ticks (the timestamp sits between the words) — proven by U6.
- **STAGE 2 (residue):** strip the timestamp, the marker words, and all punctuation; NOTHING left → `TICK` (the banned write); anything left → `TICK-CONTENTFUL` (state-carrying, never drift). A WATCHDOG heartbeat (no auto-tick marker) is `STATE` — the anchor.sh fixture NEG2 contract (anchor.sh line 359: a real WATCHDOG heartbeat with counts + a stale-count correction must classify STATE). Lines 306-326.

**Threshold (line 291):** `DRIFT_THRESHOLD = 10`; any run of **> 10** (11+) CONSECUTIVE contentless ticks = violation (line 350-352). A single state-carrying tick RESETS the run (line 346-349) — a breaker between two 10-runs is clean, proven by T3.

**Self-proving (lines 333-340):** the check re-proves its fixtures on EVERY invocation before reporting — 2 positives and 3 known-negatives, exactly the anchor.sh §7 contract ("BROKEN INSTRUMENT, never ALL CLEAR"). A misclassification returns a BROKEN INSTRUMENT violation instead of any verdict (line 340).

**The fixtures are REAL lines, verbatim from their named sources** — no invented proof. POS (corpus line 55), POS2 (corpus line 56), NEG1 (corpus line 413), NEG2 (corpus line 1989) are all from the measured exhibit `/Users/blackceomacmini/Downloads/GAUNTLET-LOOP-WORK/LEDGER.md`; NEG3 is the worked-example RECONCILE line (references/worked-example.md line 325). Provenance is mechanical: the test suite (holding/test-drift-check.py, F0) re-verifies every fixture is verbatim in its source on every run. This corrects a defect in the prior evidence: the earlier POS2 was a bracket-format line that appears nowhere in the corpus, and the earlier NEG3 carried an invented anchor hash (`1a2b3c4d`) instead of a real RECONCILE line.

**Wiring:** main() calls `check_drift(lines)` with findings prefixed `drift: ` (line 407-408); the checks string gains `drift` (line 424). Violations flow through the existing VIOLATION-STOP + stop-file machinery (main(), lines 301-328 of the base) — the boss stops the lane and the conductor re-dispatches from the last clean checkpoint, per PART 4 "On violation".

**`BOSS_LEDGER` env override (new in this slice):** `read_ledger()` and the write-cycle append now read `os.environ.get("BOSS_LEDGER", LEDGER)` (lines 88-98, 432). E2E tests and sandboxed runs point the boss at a temp ledger without touching the live one. STOP/PIDS stay live-file constants. This closes the second critic defect: with `LEDGER` hardcoded, claim 2 was unreproducible as described.

**Backup:** the live base file is untouched (`/Users/blackceomacmini/work-999-setup/tools/boss-cron` unmodified). The prior live copy is also preserved as `boss-cron.bak-pre-orphan` (pre-existing). No backup file was overwritten. Working-area drift artifacts are untracked live files, never written by this slice.

## Verification

### Unit tests — 23/23 pass (`holding/test-drift-check.py`, exit 0)

| Test | Result |
|---|---|
| F0 POS fixture verbatim in corpus line 55 | PASS |
| F0 POS2 fixture verbatim in corpus line 56 | PASS |
| F0 NEG1 fixture verbatim in corpus line 413 | PASS |
| F0 NEG2 fixture verbatim in corpus line 1989 | PASS |
| F0 NEG3 fixture verbatim in worked-example.md line 325 | PASS |
| F0 POS/POS2 are DISTINCT real lines (not a duplicated fixture) | PASS |
| U1 contentless format classified TICK | PASS |
| U2 verbatim second contentless tick classified TICK | PASS |
| U3 state-carrying auto-tick spared (TICK-CONTENTFUL) | PASS |
| U4 WATCHDOG heartbeat is STATE (anchor.sh fixture NEG2 contract) | PASS |
| U5 RECONCILE line is STATE | PASS |
| U6 the brittle literal MISSES a real tick (why the marker tolerates anything between) | PASS |
| U7 `auto_tick` underscore tolerance | PASS |
| U8 `auto tick` space tolerance | PASS |
| T1 10 consecutive contentless ticks = clean (>10 is the threshold) | PASS |
| T2 11 consecutive = violation | PASS |
| T3 10 + stateful + 10 = clean (breaker resets the run) | PASS |
| T4 empty ledger = clean | PASS |
| T5 ordinary ledger lines (BOSSCYCLE-CLEAN, WAVE DISPATCH) = clean | PASS |
| B1 fixture self-prove passes on every invocation | PASS |
| C1 REAL CORPUS contentless count == strict anchored control (740 == 740) | PASS |
| C2 REAL CORPUS stateful heartbeats spared (140) | PASS |
| C3 REAL CORPUS fires the check (the 139-line drift tail) | PASS |

Real corpus: `/Users/blackceomacmini/Downloads/GAUNTLET-LOOP-WORK/LEDGER.md` — 2,366 lines, the anti-drift.md §1 exhibit (740 of 2,366 = 31.3% contentless; 139-line tail run ≈ 7h). The classifier reproduces the strict control count EXACTLY (740), spares all 140 state-carrying heartbeats, and fires on the 139-line tail — the exact disease Issue 13 names.

Note: the prior evidence's "17/17" table carried one fabricated proof (POS2 bracket format, invented) and one invented NEG3 anchor hash, and its U6 test was vacuous (`... or True` always passed). Those are corrected here; the true count is 23/23.

### End-to-end — boss-cron one cycle

1. **Clean control on the live ledger:** `boss-cron --check` (this clone, drift check active) against the real `/Users/blackceomacmini/work-999-setup/FIX-LEDGER.md`: **0 violations, exit 0**, `checks run: caps,census,width,wavelock,claims,beat,stop,scope,kill,drift`. The live ledger contains zero contentless ticks — no false positive.
2. **Positive proof — seeded drift via the new `BOSS_LEDGER` override:** temp ledger with 12 consecutive contentless ticks (the banned write, verbatim format), run as `BOSS_LEDGER=$TMP/FIX-LEDGER.md boss-cron --check`: **exit 2**, findings include exactly `drift: 12 consecutive contentless heartbeat ticks (> 10) — banned-write run; lane is drifting (Issue 13 FIX step 2)`. The same run also correctly flags the 12 banned-write lines as scope violations (the `heartbeat` class is not on the PART 4 sanction allowlist — a contentless tick is a banned write on BOTH axes). The temp ledger md5 is unchanged by `--check` (read-only proven); the live ledger md5 is unchanged by the whole run.
3. Syntax: `python3 -m py_compile tools/boss-cron` OK.

Observed base-code limitation (pre-existing, out of this slice's scope — flagged for WF-4E): `line_timestamp()`'s regex requires the minutes field immediately before `Z`, so a BOSSCYCLE-CLEAN stamp carrying seconds (the shape the live ledger uses) does not parse and `check_heartbeat` falls back to its "first cycle baseline" branch. The drift check does not depend on that parse.

### Scope discipline

- Only `tools/boss-cron` (this slice's extension) and `holding/` (this slice's evidence + test) added. The other modifications in this working copy (`references/capacity.md`, `references/pipeline.md`, `holding/pre-slice4-backup/`) belong to WF-4A slices 3/4 — not touched by this slice.
- No edits to the live `/Users/blackceomacmini/work-999-setup/tools/boss-cron` (that is the conductor/WF-4E integration step at merge); the clone copy is the unit of this slice's commit, per the WF-3E/WF-3C boss-cron precedent (WF-3E commit 269ccba: `tools/boss-cron` committed in the clone with its check + tests + evidence).
- No changes to the live FIX-LEDGER.md (the conductor owns ledger writes); this commit cites the WAVE 4 DISPATCH ledger line per the one-unit-one-commit rule.

## Commit

One unit, one commit: `boss-cron: contentless-tick drift check (Issue 13 FIX step 2, WAVE 4 DISPATCH 2026-08-16T20:12Z)` — `tools/boss-cron` + `holding/test-drift-check.py` + this evidence file.
