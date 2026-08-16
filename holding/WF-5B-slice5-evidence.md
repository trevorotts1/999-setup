# WF-5B slice 5 evidence — Issue 19 FIX steps 7-8: wire-in points + verification

Date: 2026-08-16. Branch: `fix/19-gauntlet` (clone /Users/blackceomacmini/work-999-setup-fix/WF-5B). Cites WAVE 5 DISPATCH (FIX-LEDGER.md line 74).

## What the slice owns

Issue 19 FIX step 7 (wire-in points) + step 8 (verification), from 999-master-fix-spec-20260815.md lines 427-428:

> 7. Wire-in points: `references/gauntlet.md` owns the mechanical wiring (the three-part block, the blind A/B protocol, the workflow topology §13); the Capacity Ledger (`references/capacity.md`) owns the machine probe and the cap arithmetic; the Parallelism Plan (SKILL.md step 12.7, fail-closed) carries the six workflows by name with exact agent counts.
> 8. Verification: a test build shows the six workflows in the Parallelism Plan with exact counts, the budget declaration in the ledger, and the client-cap line computed from a real probe.

## Wire-in point 1: references/gauntlet.md owns the mechanical wiring — VERIFIED IN PLACE

Full-file read (1252 lines). Evidence, file .claude/skills/spec-protocol/references/gauntlet.md:

- Three-part block: section 1 (lines 20-114) — THE TASK (1.1), THE BUILD METHOD (1.2), THE BAR TO HIT (1.3); templates section 6 (lines 355-591); GL-001..GL-008 validation rules section 7 (line 593).
- Blind A/B protocol: section 5 (lines 266-353), the frozen-reference comparison.
- Workflow topology: section 13 (lines 799-1051) — the six workflow types at 13.1 (lines 821-906), budget 13.2 (lines 937-960), CAPACITY RULE 13.3 (lines 962-973), scaling 13.4 (lines 975-996), repair reconciliation 13.6, loop engineering 13.7.
- clientCap block added by slice 4 (uncommitted, gauntlet.md lines 818-831): clientCap = min(systemConcurrentMax, cores−2), declared-max authoritative, env read REPORTING ONLY, UNDETERMINED refuses to plan, bar never shrinks.

## Wire-in point 2: references/capacity.md owns the machine probe + cap arithmetic — VERIFIED IN PLACE (slice 4 uncommitted) + RESOLVER MECHANICAL (this slice)

- capacity.md section 3 AXIS 1 (lines 124-151 at HEAD) measured cores; slice 4's uncommitted diff adds the CLIENT-MACHINE PROBE table (cores/RAM/free disk/network and the named thing each gates) + clientCap = min(systemConcurrentMax, cores−2) + declared-max doctrine + never-16 fail-closed.
- THE RESOLVER GAP (this slice's write): tools/capacity-resolver.sh printed `min(16, cores−2)` — a stale formula contradicting the wired clientCap doctrine, so the mechanical instrument could not emit the client-cap line step 8 requires. THIS SLICE WIRED IT:
  - Header doc: SYSTEM_CONCURRENT_MAX key (declared max, authoritative, env read REPORTING ONLY, UNDETERMINED = refuse to plan).
  - Parse: SYSTEM_CONCURRENT_MAX + SYSTEM_CONCURRENT_MAX_SOURCE (case arms).
  - AXIS 1: clientCap = min(systemConcurrentMax, cores−2); missing declared max = exit 3 with "The run refuses to plan (it never defaults to 16)"; non-numeric = exit 2.
  - Card: `Cores: <n> (MEASURED|SUPPLIED) → clientCap = min(systemConcurrentMax, cores−2) = <k>` + provenance line (systemConcurrentMax declared + [MEASURED] cores) + `per-workflow concurrency = clientCap = <k>` + `AGENTS PER WORKFLOW: ≤<k> (= clientCap <k>)` + BATCH SCALING block (batch size = clientCap; 16 slices at 10 → 2 batches (10 + 6); THE BAR NEVER SHRINKS WITH THE MACHINE — ONLY THE WIDTH DOES).
  - Reconciliation rule comment updated to clientCap.
  - Selftest: every scenario answers file gains SYSTEM_CONCURRENT_MAX=10; new assertions for the clientCap card line + provenance; LIVE check parses the last `= ` field; new FAIL-CLOSED scenario (missing declared max → exit 3, names refuse-to-plan + never-16).
  - Result: `capacity-resolver.sh --selftest` PASS 38/38.

## Wire-in point 3: SKILL.md step 12.7 (Parallelism Plan, fail-closed) carries the six workflows by name with exact counts — VERIFIED IN PLACE (slice 1, committed 4411ff2)

Full-file read. SKILL.md step 12.7 (lines 1078-1126 at HEAD) names all six by name with exact counts:

- WORKFLOW 01 BLUEPRINT LOCK = 8 planner-seat agents (no production coding; single batch, 8 ≤ clientCap)
- WORKFLOW 02 PRIMARY BUILD = 16 builder-seat agents (sequential batches of at most clientCap — 2 batches (10 + 6) at clientCap 10)
- WORKFLOW 03 BLIND VISUAL GAUNTLET = 16 blind-visual-judge seats (rendered evidence only, never builder reasoning; same batching)
- WORKFLOW 04 TECHNICAL GAUNTLET = 8 technical-judge seats (single batch, 8 ≤ clientCap)
- WORKFLOW 05 FINAL RELEASE COUNCIL = 4 council-judge seats, RELEASE REQUIRES 4/4 = PASS (single batch, 4 ≤ clientCap)
- WORKFLOW 06 SELECTIVE REPAIR LOOP = 1 repair seat per failed workstream, max 12 per wave (capped at clientCap per wave, remainder batched; NEW blind verifier per repaired visual workstream; ALWAYS rerun the 4-seat council)

plus clientCap = min(systemConcurrentMax, cores−2), counts are slices never concurrency, scaling formula, "THE BAR NEVER SHRINKS WITH THE MACHINE — only the width does", and the fail-closed "No Parallelism Plan, no dispatch — a dispatch that is not in the plan, or a plan section that names no capacity derivation, FAILS."

## Verification (FIX step 8): test build

Test build under holding/WF-5B-slice5-test/ (ledger-card.txt, ledger-card-live.txt, answers.txt, answers-live.txt).

1. SIX WORKFLOWS IN THE PARALLELISM PLAN with exact counts: SKILL.md step 12.7 names all six (above), each with its exact integer count; state-file declaration at step 16.6 (SKILL.md lines 1204-1210) carries the SIX-WORKFLOW declaration with the same counts (BLUEPRINT LOCK 8, PRIMARY BUILD 16, BLIND VISUAL GAUNTLET 16, TECHNICAL GAUNTLET 8, FINAL RELEASE COUNCIL 4, SELECTIVE REPAIR LOOP 1 per failed workstream max 12 per wave).
2. BUDGET DECLARATION IN THE LEDGER: resolver card AGENT BUDGET DECLARATION (all eight §17 quantities) — expected total agent executions 52 (8+16+16+8+4); soft budget 75-125 with the 150 analysis obligation; hard safety cap 200 → HARD STOP, blocker report, run_status=STOPPED_CAP. Present in ledger-card.txt lines 20-28.
3. CLIENT-CAP LINE COMPUTED FROM A REAL PROBE: live run (no CORES supplied) — `Cores: 12 (MEASURED) → clientCap = min(systemConcurrentMax, cores−2) = 10`, with provenance `systemConcurrentMax=10 (declared, authoritative — never an env read; an env read is REPORTING ONLY, never for computing) [RECALLED-CONFIRMED...]; cores [MEASURED sysctl-hw.ncpu ...]`. Cores measured by the instrument itself (sysctl -n hw.ncpu = 12 on this machine); clientCap arithmetic applied: min(10, 12−2) = 10.
4. FAIL-CLOSED proof: an answers file without SYSTEM_CONCURRENT_MAX exits 3 with "The run refuses to plan (it never defaults to 16)" — selftest asserts both strings.

## Files read (full-file, for judgment)

- /Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md (628 lines) — Issue 19 at lines 406-430; FIX step 7 at line 427, step 8 at line 428, QC bar at line 430.
- /Users/blackceomacmini/work-999-setup-fix/WF-5B/.claude/skills/spec-protocol/SKILL.md (1687 lines) — step 12.7 (lines 1078-1126), step 16.6 (lines 1187-1211).
- /Users/blackceomacmini/work-999-setup-fix/WF-5B/.claude/skills/spec-protocol/references/gauntlet.md (1252 lines) — sections 1, 5, 6, 13.
- /Users/blackceomacmini/work-999-setup-fix/WF-5B/.claude/skills/spec-protocol/references/capacity.md (1558 lines at HEAD + slice 4 uncommitted diff) — sections 3, 4, 5, 10, 13.
- /Users/blackceomacmini/work-999-setup-fix/WF-5B/.claude/skills/spec-protocol/tools/capacity-resolver.sh (full read) — edit target.
- /Users/blackceomacmini/work-999-setup/FIX-LEDGER.md + WF-5B/FIX-LEDGER.md (166 lines each) — WAVE 5 DISPATCH line 74; slice 2 line 78.
- holding/WF-5B-slice1-evidence.md, WF-5B-slice3-evidence.md — prior slice ownership (nothing overlapped).

## Slice boundaries

Touched ONLY: tools/capacity-resolver.sh (wire-in point mechanism for capacity.md's cap arithmetic). Verified in place (no write): gauntlet.md, capacity.md (slice 4's uncommitted probe wiring), SKILL.md 12.7 (slice 1 committed). No write to FIX-LEDGER.md of the shared clone (slice 2's line already at HEAD; other slices' uncommitted ledger changes left untouched).

## Commit

`<FILL>` on fix/19-gauntlet in clone WF-5B, message cites WAVE 5 DISPATCH 2026-08-16T21:22Z.
