# WF-4A slice 4 evidence — Issue 13 FIX steps 4-5: boss stop/restart + TERMINAL-DRIFT capture-proof stop

Branch: fix/13-anti-drift (clone /Users/blackceomacmini/work-999-setup-fix/WF-4A, base dc688c7).
Commit: `<filled at commit time>` — one unit, one commit, cites `WAVE 4 DISPATCH 2026-08-16T20:12Z` (FIX-LEDGER.md line 70).

## Slice scope

Issue 13 FIX step 4 (boss cron compares ledger vs script every cycle, STOPS violating
workstreams via `VIOLATION-STOP` ledger line with the finding, RESTARTS from the last
clean checkpoint) and FIX step 5 (`CONTROL/TERMINAL-DRIFT.flag` stays the capture-proof
stop — while it exists, nothing dispatches). Spec: `/Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md` lines 290-291.

## What exists already (read in full, named)

- `tools/anchor.sh` (1366 lines) — the reconciler. Line 433: `FLAG="$HOME_DIR/CONTROL/TERMINAL-DRIFT.flag"`. Lines 436-441: precondition-0 gate — `if [[ -f "$FLAG" ]]; then printf 'TERMINAL-DRIFT | nothing dispatches while this file exists...'; exit 4`. Flag is created on fire (exit 4 path, lines 415-424 of references/anti-drift.md §6).
- `references/anti-drift.md` §6 (lines 364-440) — TERMINAL-DRIFT stop doctrine: precondition #0 (line 430-431), recovery is a human act (lines 437-440), nothing in the skill removes it automatically.
- `references/anti-drift.md` §9 (lines 567-594) — cron-tick contract: precondition #0 (585-586), RECONCILE-not-re-plan (587-589), ultracode never from cron (590-591).
- `references/workflows.md` §7 (lines 300-315) — same contract, precondition #0 (308-309).
- `references/loops.md` THE TICK step 0 (lines 479-481) — TERMINAL-DRIFT GATE.
- `references/agent-team.md` (line 1147) — flag gate on resume.
- Live boss cron `/Users/blackceomacmini/work-999-setup/tools/boss-cron` (read; owned by WF-4E): on violation appends `VIOLATION-STOP <ts>: <finding> — conductor MUST TaskStop the named workstream and re-dispatch from its last clean checkpoint` (line 317), kill path line 319, stop file `/Users/blackceomacmini/work-999-setup/CONTROL/stop-workstream` (line 38).
- `references/pipeline.md` Checkpoints (lines 646-662) — seven moments, `checkpoint/<slug>-<NNN>` annotated tag, `checkpoints[]` + `best_stable_build` in project_state.json, restore = fresh worktree off the tag.
- `references/execution-architecture.md` §11 (lines 424-435) — same checkpoint doctrine.
- SKILL.md S10 swarm-watch row (line 226) — reconcile staleness standard.

## Gap found (the slice's fix)

Nowhere in the skill tree did the per-cycle ledger-vs-script comparison, the
`VIOLATION-STOP` stop/restart outcome, or the checkpoint-restart path exist as the
conductor's contract — the boss was being built by WF-4E against PART 4 while the
skill's own loops said only "flag stops the tick" (loops.md 479-481, workflows.md
308-309), and the "RESTART from last clean checkpoint" half of step 4 had no skill
home at all. Slices 1-3 wire the reconcile call sites; this slice wires steps 4-5.

## Edits (3 files, all named, all backed up)

Backup (taken before any edit, checksums):
`holding/pre-slice4-backup/SKILL.md` sha256 5f465247a3ff023492cdfe57e092ff87167222cc4464b7f433f6624a47dc01d4
`holding/pre-slice4-backup/anti-drift.md` sha256 d8fc9f404342349a730ba58aa673f2ac9406f4abf98c50a39c6b6cf6af3f38be
`holding/pre-slice4-backup/workflows.md` sha256 dfc518f70d5c0e731a93c5a27407818ac047a76d9c16fee24780a1a5e1ffd76e
`holding/pre-slice4-backup/loops.md` sha256 03053795fb394f30615493d2c7f8f98fdf647fee612a8653144ff992d3021a6b

1. `.claude/skills/spec-protocol/SKILL.md` lines 1620-1634 (anti-drift contract paragraph):
   boss cron (PART 4) compares live ledger vs script every cycle; a violation stops the
   violating workstream the same cycle — `VIOLATION-STOP` ledger line with the exact
   finding; restart from the last clean checkpoint — the checkpoint rules in
   `CONTROL/project_state.json` (seven moments, `checkpoint/<slug>-<NNN>` tag scheme,
   `best_stable_build` pointer; pipeline.md Checkpoints, execution-architecture.md §11);
   one cycle one outcome (`VIOLATION-STOP` + checkpoint restart, or `BOSSCYCLE-CLEAN`);
   conductor reads the stop file at every dispatch point and TaskStops the named
   workstream, then re-dispatches from the checkpoint — never a silent re-plan;
   `CONTROL/TERMINAL-DRIFT.flag` remains the capture-proof stop — while it exists,
   nothing dispatches and no restart happens; a stop is lifted only by naming the
   blocker and removing the flag (anti-drift.md §6).
2. `.claude/skills/spec-protocol/references/workflows.md` §7, lines 310-318: new bullet
   "The boss compares every cycle" — same contract, same-cycle stop,
   `VIOLATION-STOP` line, restart from last clean checkpoint in project_state.json,
   conductor TaskStop at every dispatch point, flag blocks both restart and dispatch
   until the blocker is named and the flag removed.
3. `.claude/skills/spec-protocol/references/loops.md` THE TICK step 0, lines 481-486:
   flag is the capture-proof stop — nothing dispatches, no restart, stop lifted only
   by naming the blocker and removing the flag; on a boss-cycle stop (`VIOLATION-STOP`
   ledger line) the workstream restarts from its last clean checkpoint per
   CONTROL/project_state.json — never from memory.

`references/anti-drift.md` was NOT edited — its §6 already owns the flag doctrine in
full; the three edits cite it rather than duplicate it. No other file touched.

## Verification

FIX step 5 functional proof (the capture-proof stop really stops, on the instrument):
- Control (no flag): fresh temp home `/tmp/slice4-test` (SPEC/GOAL.md, CONTROL/CHECKLIST.md,
  CONTROL/TODO.md present, no snapshot) → `tools/anchor.sh <home> IDLE --mode reconcile
  --tasks CONTROL/task-graph-snapshot.json --state CONTROL/project_state.json` →
  "TOOLING FAILURE (exit 2): --tasks path does not exist" — EXIT=2. The instrument
  discriminates: missing input is a tooling failure, not a flag stop.
- Test (flag present): `CONTROL/TERMINAL-DRIFT.flag` written (count=6) → same command →
  "TERMINAL-DRIFT | flag present: /tmp/slice4-test/CONTROL/TERMINAL-DRIFT.flag" +
  "nothing dispatches while this file exists. Name the blocker, then remove it." +
  flag contents printed — EXIT=4. The reconciler refuses to do anything but report
  while the flag exists (anchor.sh lines 436-441), proving the step-5 contract.
- Test dir removed after; no artifacts left.

FIX step 4 contract (per-cycle compare + stop + checkpoint restart) is wired into the
conductor's three entry points (SKILL.md 1620-1634, workflows.md 310-318, loops.md
481-486) and is consistent with the live boss-cron's enforcement mechanism
(VIOLATION-STOP lines at boss-cron line 317, stop file at line 38, kill path 319,
conductor TaskStop + re-dispatch from last clean checkpoint) and the checkpoint
restore procedure (pipeline.md 646-662, execution-architecture.md 424-435). The
five-minute cadence and BOSSCYCLE-CLEAN outcome are PART 4's own (spec lines 534-557),
now stated as the skill's contract at the same place its loop contract lives.

## Files changed (absolute paths)

- /Users/blackceomacmini/work-999-setup-fix/WF-4A/.claude/skills/spec-protocol/SKILL.md (lines 1620-1634)
- /Users/blackceomacmini/work-999-setup-fix/WF-4A/.claude/skills/spec-protocol/references/workflows.md (lines 310-318)
- /Users/blackceomacmini/work-999-setup-fix/WF-4A/.claude/skills/spec-protocol/references/loops.md (lines 481-486)
- Backups: /Users/blackceomacmini/work-999-setup-fix/WF-4A/holding/pre-slice4-backup/
