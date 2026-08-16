# WF-4A slice 4 evidence — Issue 13 FIX steps 4-5: boss stop/restart + TERMINAL-DRIFT capture-proof stop

Branch: fix/13-anti-drift (clone /Users/blackceomacmini/work-999-setup-fix/WF-4A, base dc688c7).
Commit: `53b8ad2165ff18bf3ad62f6fa10006f93d7ae627` — one unit, one commit, cites `WAVE 4 DISPATCH 2026-08-16T20:12Z` (FIX-LEDGER.md line 63, WAVE 4 row).

## Slice scope

Issue 13 FIX step 4 (boss cron compares ledger vs script every cycle, STOPS violating
workstreams via `VIOLATION-STOP` ledger line with the finding, RESTARTS from the last
clean checkpoint) and FIX step 5 (`CONTROL/TERMINAL-DRIFT.flag` stays the capture-proof
stop — while it exists, nothing dispatches). Spec: `/Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md` line 398 (FIX steps 4-5).

## What exists already (read in full, named)

- `tools/anchor.sh` (1366 lines) — the reconciler. Line 433: `FLAG="$HOME_DIR/CONTROL/TERMINAL-DRIFT.flag"`. Lines 436-441: precondition-0 gate — `if [[ -f "$FLAG" ]]; then printf 'TERMINAL-DRIFT | nothing dispatches while this file exists...'; exit 4`. Flag is created on fire (exit 4 path, lines 415-424 of references/anti-drift.md §6).
- `references/anti-drift.md` §6 (lines 364-441) — TERMINAL-DRIFT stop doctrine: precondition #0 (line 430-431), recovery is a human act (lines 437-440), nothing in the skill removes it automatically.
- `references/anti-drift.md` §9 (lines 619-646 at HEAD) — cron-tick contract: precondition #0 (lines 637-638), RECONCILE-not-re-plan (lines 639-641), ultracode never from cron (lines 642-644). (Re-check critic: earlier cite used a chimera range — corrected to the actual HEAD line numbers.)
- `references/workflows.md` §7 (lines 290-320) — same contract, precondition #0 (308-309).
- `references/loops.md` THE TICK step 0 (lines 479-481) — TERMINAL-DRIFT GATE.
- `references/agent-team.md` (line 1147) — flag gate on resume.
- Live boss cron `/Users/blackceomacmini/work-999-setup/tools/boss-cron` (read; owned by WF-4E): on violation appends `VIOLATION-STOP <ts>: <finding> — conductor MUST TaskStop the named workstream and re-dispatch from its last clean checkpoint` (lines 978, 982), kill path `kill_pids` (line 853), stop file `/Users/blackceomacmini/work-999-setup/CONTROL/stop-workstream` (line 79).
- `references/pipeline.md` Checkpoints (lines 646-662) — seven moments, `checkpoint/<slug>-<NNN>` annotated tag, `checkpoints[]` + `best_stable_build` in project_state.json, restore = fresh worktree off the tag.
- `references/execution-architecture.md` §11 (lines 426-435) — same checkpoint doctrine.
- SKILL.md S10 swarm-watch row (line 236) — reconcile staleness standard.

## Gap found (the slice's fix)

Nowhere in the skill tree did the per-cycle ledger-vs-script comparison, the
`VIOLATION-STOP` stop/restart outcome, or the checkpoint-restart path exist as the
conductor's contract — the boss was being built by WF-4E against PART 4 while the
skill's own loops said only "flag stops the tick" (loops.md 479-481, workflows.md
308-309), and the "RESTART from last clean checkpoint" half of step 4 had no skill
home at all. Slices 1-3 wire the reconcile call sites; this slice wires steps 4-5.

## Edits (3 files, 5 hunks, all named, all backed up)

Backup (taken before any edit, checksums):
`holding/pre-slice4-backup/SKILL.md` sha256 5f465247a3ff023492cdfe57e092ff87167222cc4464b7f433f6624a47dc01d4
`holding/pre-slice4-backup/anti-drift.md` sha256 d8fc9f404342349a730ba58aa673f2ac9406f4abf98c50a39c6b6cf6af3f38be
`holding/pre-slice4-backup/workflows.md` sha256 dfc518f70d5c0e731a93c5a27407818ac047a76d9c16fee24780a1a5e1ffd76e
`holding/pre-slice4-backup/loops.md` sha256 03053795fb394f30615493d2c7f8f98fdf647fee612a8653144ff992d3021a6b

1. `.claude/skills/spec-protocol/SKILL.md`, hunk 1, lines 145-154 (dispatch precondition
   in THE WIDTH section): before every dispatch, run `tools/anchor.sh <home>
   <unit-or-IDLE> --mode reconcile` first (with `--tasks
   CONTROL/task-graph-snapshot.json --state CONTROL/project_state.json`), execute any
   RECONCILE-ACTIONS it emits and re-run until clean; a dispatch on top of an
   unreconciled alarm, or while `CONTROL/TERMINAL-DRIFT.flag` exists, is a violation
   (S10 — `references/anti-drift.md`).
2. `.claude/skills/spec-protocol/SKILL.md`, hunk 2, lines 190-192 (RULE 4 — DISPATCH
   RULES, new numbered step 0 before the decompose-then-launch step): reconcile first —
   run `tools/anchor.sh --mode reconcile` (with `--tasks` + `--state`), execute any
   RECONCILE-ACTIONS it emits, re-run until clean (S10; `references/anti-drift.md`);
   precondition #0: `CONTROL/TERMINAL-DRIFT.flag` is absent — while it exists, nothing
   dispatches.
3. `.claude/skills/spec-protocol/SKILL.md`, hunk 3, lines 1630-1644 (anti-drift contract
   paragraph, the slice's step-4/5 core): the boss cron (PART 4) compares the live
   ledger against the script on every cycle; a violation stops the violating workstream
   the same cycle — `VIOLATION-STOP` ledger line carrying the exact finding, restart
   from the last clean checkpoint — the checkpoint rules in `CONTROL/project_state.json`
   (seven moments, `checkpoint/<slug>-<NNN>` tag scheme, `best_stable_build` pointer;
   pipeline.md Checkpoints, execution-architecture.md §11); one cycle, one outcome
   (`VIOLATION-STOP` + checkpoint restart, or `BOSSCYCLE-CLEAN`); the conductor reads
   the stop file at every dispatch point and TaskStops the named workstream, then
   re-dispatches it from the checkpoint the right way — never a silent re-plan;
   `CONTROL/TERMINAL-DRIFT.flag` remains the capture-proof stop — while it exists,
   nothing dispatches and no restart happens; a stop is lifted only by naming the
   blocker and removing the flag (anti-drift.md §6).
4. `.claude/skills/spec-protocol/references/workflows.md` §7, lines 310-319: new bullet
   "The boss compares every cycle" — same contract, same-cycle stop, `VIOLATION-STOP`
   line, restart from last clean checkpoint in project_state.json, conductor TaskStop at
   every dispatch point, flag blocks both restart and dispatch until the blocker is
   named and the flag removed.
5. `.claude/skills/spec-protocol/references/loops.md` THE TICK step 0, lines 481-486:
   flag is the capture-proof stop — nothing dispatches, no restart, stop lifted only
   by naming the blocker and removing the flag; on a boss-cycle stop (`VIOLATION-STOP`
   ledger line) the workstream restarts from its last clean checkpoint per
   CONTROL/project_state.json — never from memory.

`references/anti-drift.md` was NOT edited — its §6 already owns the flag doctrine in
full; the five hunks cite it rather than duplicate it. No other file touched.
Commit scope (`git show 53b8ad2 --stat`): SKILL.md +29/-3, workflows.md +10, loops.md
+6, this evidence file. Slice 3 was NOT absorbed: commit 4d41cf0 (slice 3) touched only
capacity.md and pipeline.md; all five hunks above are owned by 53b8ad2.

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
conductor's entry points (SKILL.md hunks at 145-154, 190-192, 1630-1644; workflows.md
310-319; loops.md 481-486) and is consistent with the live boss-cron's enforcement
mechanism (VIOLATION-STOP lines at boss-cron lines 978 and 982, stop file at line 79,
kill path `kill_pids` at line 853, conductor TaskStop + re-dispatch from last clean
checkpoint) and the checkpoint restore procedure (pipeline.md 646-662,
execution-architecture.md 426-435). The five-minute cadence and BOSSCYCLE-CLEAN outcome
are PART 4's own (spec lines 534-557), now stated as the skill's contract at the same
place its loop contract lives.

## Files changed (absolute paths)

- /Users/blackceomacmini/work-999-setup-fix/WF-4A/.claude/skills/spec-protocol/SKILL.md (lines 145-154, 190-192, 1630-1644)
- /Users/blackceomacmini/work-999-setup-fix/WF-4A/.claude/skills/spec-protocol/references/workflows.md (lines 310-319)
- /Users/blackceomacmini/work-999-setup-fix/WF-4A/.claude/skills/spec-protocol/references/loops.md (lines 481-486)
- Backups: /Users/blackceomacmini/work-999-setup-fix/WF-4A/holding/pre-slice4-backup/
