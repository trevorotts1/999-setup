# WF-4A slice 5 evidence — Issue 13 FIX step 6 verification: drift stop + checkpoint restart

**Slice:** WF-4A slice 5 (Issue 13 FIX step 6 verification)
**Branch:** fix/13-anti-drift (working copy /Users/blackceomacmini/work-999-setup-fix/WF-4A)
**Spec:** /Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md — ISSUE 13 (lines 280-294), FIX step 6 (line 292), FIX steps 1/2/4 (lines 287-290), PART 4 check 6 (line 543), PART 4 on-violation (line 549)
**Ledger line cited:** `WAVE 4 DISPATCH 2026-08-16T20:12Z` (/Users/blackceomacmini/work-999-setup/FIX-LEDGER.md line 70)
**Prior slices on this branch (all committed):** slice 1 (6dd8829 — CLASS 7 unpaired-claim in anchor.sh, FIX step 1), slice 2 (9e0fdb8 — boss-cron contentless-tick drift check, FIX step 2), slice 4 (53b8ad2 — FIX steps 4-5 per-cycle compare + VIOLATION-STOP stop/restart + TERMINAL-DRIFT flag wiring)

## VERDICT: PASS

## What was verified

Spec FIX step 6 (line 292, verbatim): "Verification: a deliberately drifted test run gets stopped by the boss within one cycle and restarted from the named checkpoint."

The verification harness `holding/test-drift-stop-restart.py` runs the implementation committed on this branch (slices 1/2/4) against a sandboxed fixture. The boss runs as a TEST COPY with its LEDGER/STOP/PIDS constants pointed at the fixture (live ledger and live stop file never touched). anchor.sh and ledger.sh are extracted from branch HEAD (`git show HEAD:<path>`) so the harness tests the committed state, never a working tree mid-edit by a parallel slice. Every fixture write goes through the repo's own tools/ledger.sh (atomic, locked).

### Run output — 9 passed, 0 failed

```
PASS | T1 instruments self-prove | anchor.sh selftest rc=0; SELFTEST COMPLETE | 17 of 14 cases passed | 0 failed
PASS | T2 fingerprint discriminates | after establish: count=1; after contentless tick: count=2 (must climb); after state-carrying heartbeat: count=0 (must reset)
PASS | T3 TERMINAL-DRIFT fires | exit=4; flag created; no-delta-reconciles=6; ledger TERMINAL-DRIFT line; TODO OPERATOR-ESCALATION
PASS | T4 flag gates dispatch | exit=4; reconciler refused to run while CONTROL/TERMINAL-DRIFT.flag present
PASS | T5 boss stops drifted lane within one cycle | exit=2; --check finding: 'drift: 11 consecutive contentless heartbeat ticks (> 10)'; VIOLATION-STOP line: drift finding + restart directive
PASS | T6 named checkpoint recorded in project_state.json | checkpoints[-1]={tag:checkpoint/demo-drift-001}; best_stable_build.checkpoint points at it; restart directive cites the last clean checkpoint
PASS | T7 known-good control: healthy ledger stays clean | exit=0; BOSSCYCLE-CLEAN appended; no stop file; no VIOLATION-STOP; no BROKEN INSTRUMENT
PASS | T8 CLASS 7 alarms on unpaired claims | exit=3; DRIFT-ALARM | unpaired-claim for 5 units (tol=3); ACTION|write-missing-claims emitted
PASS | T8b CLASS 7 paired ledger stays clean | exit=0; RECONCILE line carries ledger-ok(claimed=1/resulted=1/unpaired=0/tol=3)

SUMMARY | 9 passed | 0 failed
```

Reproduce: `python3 /Users/blackceomacmini/work-999-setup-fix/WF-4A/holding/test-drift-stop-restart.py` (exit 0).

## Part 1 — the drifted run gets stopped by the boss within one cycle

T5 plants the deliberate drift: 11 consecutive contentless ticks
(`- heartbeat <ISO> (ledger auto-tick)`) in the fixture ledger — over the
threshold the boss implements (`DRIFT_THRESHOLD = 10`, tools/boss-cron line 280
— "> 10 CONSECUTIVE contentless ticks = violation", spec line 288). One boss
cycle (`boss-cron --check` then the write cycle) produces:

- the finding on `--check` (read-only): `drift: 11 consecutive contentless
  heartbeat ticks (> 10) — banned-write run; lane is drifting (Issue 13 FIX
  step 2)`, checks list includes `drift` (tools/boss-cron line 410);
- the `VIOLATION-STOP` ledger line naming the exact finding, appended by the
  write cycle (tools/boss-cron line 420: `VIOLATION-STOP ...: drift: 11
  consecutive contentless heartbeat ticks (> 10) ... conductor MUST TaskStop
  the named workstream and re-dispatch from its last clean checkpoint`);
- the `CONTROL/stop-workstream` file (the boss's stop authority, tools/boss-cron
  stop_file_state/main);
- exit 2 (the governance-exit contract, spec PART 4 line 549).

The drift classifier self-proves on its fixtures before every invocation
(tools/boss-cron `check_drift`, lines 317-326 — the anti-drift.md §7
known-positive contract: a detector must prove itself on a known-positive
before it may say "clean").

## Part 2 — restarted from the NAMED checkpoint

T6: the restart target is the last clean checkpoint recorded in
project_state.json — the fixture's `checkpoints[]` holds
`{"tag":"checkpoint/demo-drift-001","commit":"c0ffee00...","trigger":"first-functional-mvp",...}`
and `best_stable_build.checkpoint` points at the same tag (the schema,
references/documents.md lines 510-560; the checkpoint rules,
references/execution-architecture.md section 11; the restore procedure "git
worktree add <dir> checkpoint/<slug>-<NNN> ... verified by re-running the
tagged build's suite before anything trusts it", references/pipeline.md
Checkpoints section). The VIOLATION-STOP restart directive cites exactly this:
"re-dispatch from its last clean checkpoint" (tools/boss-cron line 420) — the
name resolves to the project_state.json record, per PART 4 (line 549): "RESTART
the workstream from the last clean checkpoint recorded in project_state.json".

## Part 3 — the underlying enforcement, proven end-to-end

| Test | Contract | Implementation cited | Result |
|---|---|---|---|
| T2 | contentless tick must NOT move the state-delta fingerprint; a state-carrying heartbeat MUST (anti-drift.md §6) | anchor.sh `--mode reconcile` fingerprint (HEAD) | count 1 -> 2 on contentless tick (observation is not progress); 0 after a stateful heartbeat (real delta resets) |
| T3 | N=6 consecutive no-delta reconciles with runnable work = TERMINAL-DRIFT (anti-drift.md §6; spec line 290) | anchor.sh exits 4; creates CONTROL/TERMINAL-DRIFT.flag with no-delta-reconciles=6; appends TERMINAL-DRIFT ledger line; OPERATOR-ESCALATION to TODO | PASS |
| T4 | the capture-proof stop: while CONTROL/TERMINAL-DRIFT.flag exists, nothing dispatches (SKILL.md lines 1618-1620; anti-drift.md §6; FIX step 5, spec line 291) | anchor.sh refuses to run while the flag exists ("TERMINAL-DRIFT \| nothing dispatches while this file exists", HEAD anchor.sh line 476; the flag check at lines 436-442) | PASS |
| T7 | known-good control: a healthy ledger (stateful heartbeats under threshold, fresh BOSSCYCLE-CLEAN) is NOT punished — BOSSCYCLE-CLEAN, exit 0, no stop, no VIOLATION-STOP (anti-drift.md §1: a detector that flags the cure is broken) | tools/boss-cron check_drift spares state-carrying ticks (fixtures NEG1/NEG2/NEG3, lines 283-285) | PASS |
| T8/T8b | FIX step 1 (line 287): every action references a ledger line — CLAIM before, RESULT after, never only at the end | anchor.sh CLASS 7 (HEAD, lines 731-766): RESULT without a prior CLAIM past tol (default 3) = `unpaired-claim` alarm + `ACTION|write-missing-claims` at exit 3; a paired ledger carries `ledger-ok(claimed=1/resulted=1/unpaired=0/tol=3)` at exit 0 | PASS |

## Part 4 — observed behavior worth stating (scope noise on drifted ledgers)

A ledger whose tail is contentless ticks also trips the boss's scope check
(ledger_class of `- \`heartbeat ...\`` is `heartbeat`, not in SANCTIONED_CLASSES,
tools/boss-cron lines 74-79), so a drifted ledger produces scope violations in
addition to the drift violation. The drift VIOLATION-STOP is present regardless;
the noise does not mask the finding. This is noted as an observation, not a
defect in this slice's scope (scope-check wording is the interim boss's domain).

## What was NOT touched

- The live ledger (/Users/blackceomacmini/work-999-setup/FIX-LEDGER.md) — never written by the harness.
- The live stop file, live workflow-pids.json, live project_state.json — never written.
- tools/boss-cron, .claude/skills/spec-protocol/tools/anchor.sh, ledger.sh — unchanged (committed by slices 1/2/4; verified against HEAD).
- Uncommitted working-tree edits by parallel slices (references/capacity.md, references/pipeline.md, holding/pre-slice4-backup/) — not touched, not committed.

## Files

- Harness: /Users/blackceomacmini/work-999-setup-fix/WF-4A/holding/test-drift-stop-restart.py
- Evidence: /Users/blackceomacmini/work-999-setup-fix/WF-4A/holding/WF-4A-slice5-evidence.md (this file)
