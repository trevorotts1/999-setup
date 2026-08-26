# WS-35 CHECKPOINT — crash/restart/recovery/update rollback

- Slice: WR-018 (3+3 candice-migrations), unit WS-35
- Date: 2026-08-21
- Branch: `candice/wr001-bootstrap` @ base 6bb00ec, worktree
  `/Users/blackceomacmini/Downloads/999-setup/worktrees/wr001-bootstrap`
- Ownership: `apps/candice-companion/src-tauri/recovery/**` (worktree
  PROJECT-MANIFEST 9.2 WR-018 WS-35; snapshot owned_paths)
- Dependencies (landed, verified on disk): WS-08 `src/state/**` (machine has
  `question:recovered` + `recovering` branches, 27/27 tests per QC), WS-33
  `scripts/candice-updater/rollback/**` (atomic-install + rollback engine).
- Not committed, not pushed (per fan-out rule).

## Acceptance criterion (CONTROL/CHECKLIST.md E.1 WS-35)

> WS-35 PASS: crash recovery restores the exact pending question in Claude
> without re-asking/double-counting; startup cleanup removes stale temp audio
> from crashed sessions.

Status: **all legs satisfied with primary-source evidence; blind QC recheck
REQUIRED.**

## Files (all under the owned glob `src-tauri/recovery/**`)

1. `types.ts` — pure-data contracts: `PendingQuestion` (durable record shape
   from WS-03 session-manager), `Lifecycle`, `SweepFn`, `RollbackFn`,
   `StartupRecoveryResult`, `StartupSweepResult`, `StartupOutcome`,
   `RecoveryEvent`. No clock, no IO.
2. `startup.ts` — `runStartupRecovery` orchestration. Deterministic: injected
   `clock`, injected `lifecycle`, injected `sweep`. Leg order: (1) exact
   pending-question handoff + `recovering` raise via lifecycle resume,
   (2) WS-20 startup temp sweep, (3) WS-33 rollback availability guard —
   probed, never invoked at startup. Every failure named per leg; total
   (nothing throws to the caller).
3. `handoff.ts` — `buildRecoveredQuestionEvent` builds the WS-08
   `question:recovered` event VERBATIM from the durable record (exact text +
   key); null on malformed/empty text (no invented recovery).
4. `index.ts` — barrel (`@candice/recovery`).
5. `__tests__/recovery.test.ts` — 11 node:test cases, zero deps, all surfaces
   injected. Covers: exact verbatim recovery, no double-count (counted
   mirrored never mutated; second handoff finds nothing), no-session-id
   named failure, lifecycle-throw named, malformed record -> no invented
   question, WS-08 event shape, event ordering, injected-clock sweep
   invocation, sweep failure naming, rollback probed-not-invoked, rollback
   unavailability named.
6. `README.md` — contract + wiring.
7. `CHECKPOINT-WS35.md` — this file.

## Dependency integration (verified against real lane code, not assumed)

- WS-08: `src/state/machine.ts` `question:recovered` branch preserves the
  exact `pendingQuestion` and requires phase `interview`; `recovering` is one
  of the nine canonical statuses; `question:recovered` without a pending
  question is ignored (no invented recovery). `machine.test.ts` covers
  `recovering preserves the exact pending question (spec 20)`.
- WS-03: `plugins/candice-integration/session/session-manager.js`
  `recoverPendingQuestion` hands the pending record off exactly once and
  clears it; `resumeSession` returns the session to `active`.
- WS-20: `src-tauri/audio/cleanup/sweep.ts` `sweepStaleTempAudio` — marker
  gated, age gated, bounded, oldest-first (11/11 tests green, run this
  worktree).
- WS-33: `scripts/candice-updater/rollback/atomic-install.mjs` owns
  rollback-on-failure; this lane never invokes it at startup, only probes
  availability (spec 21: rollback runs before a failed update starts).

## Evidence (run 2026-08-21, this worktree, Node v26.7.0)

```
node --test apps/candice-companion/src-tauri/recovery/__tests__/recovery.test.ts
  tests 11  pass 11  fail 0
```

## Notes for QC

- The lane deliberately does NOT write the session store, temp dirs, or any
  update state — it orchestrates surfaces owned by WS-03/WS-20/WS-33.
- Recovery of a question whose session id is unknown at startup (companion
  relaunch before re-bind) is a named failure (`recovery:no-session-id`),
  not a silent skip — the skill-side `candice.ask_user` timeout path already
  re-asks in Claude as the fail-soft (spec 20) when the companion never
  re-binds.
