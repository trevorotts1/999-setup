# Candice recovery — crash/restart/recovery/update rollback (WS-35)

Owned lane: `apps/candice-companion/src-tauri/recovery/**`
(PROJECT-MANIFEST 9.2 WR-018 / WS-35; task-graph snapshot owned_paths).
Dependencies landed: WS-08 state machine (`src/state/**`), WS-33
update/rollback (`scripts/candice-updater/rollback/**`).

## What is proven

Master Spec E.1 WS-35, sections 20/8/21:

1. **Crash recovery restores the exact pending question** — `runStartupRecovery`
   drives the WS-03 lifecycle `recoverPendingQuestion` handoff. The WS-03
   manager hands the durable `{ questionKey, text, answerKind, counted,
   askedAt }` record off EXACTLY ONCE (a second recovery finds nothing), so
   this lane can never re-ask or double-count. The WS-08 state machine's
   `question:recovered` event is built verbatim from the durable record
   (`handoff.ts`) — never a re-derived question.
2. **`recovering` state, event-driven, never invented** — the pass raises
   `recovering` via the lifecycle resume path before the front-end re-raises
   the question; the WS-08 machine already has the `question:recovered`
   branch with the exact-question preservation contract (spec 20).
3. **No re-ask / no increment** — recovery reads `counted` as a mirrored
   flag and never mutates it; `answer:confirmed` clears the pending question
   exactly once on the WS-03 side. Recovery itself performs no counting.
4. **Startup temp-audio cleanup (spec 8 step 6)** — the pass invokes the
   WS-20 `sweepStaleTempAudio` engine with the platform temp root and the
   injected clock; failures are named, never swallowed.
5. **Update rollback (spec 21)** — the WS-33 engine (`atomic-install.mjs
   rollback`) runs BEFORE a failed update starts, never at app startup. This
   lane owns the availability guard: startup probes the rollback surface and
   records a named failure when it is unavailable — it never invokes the
   engine itself.

Failure isolation (spec 20): every leg is total. A throwing lifecycle or
sweep is recorded in `failures` and returned; nothing throws into the caller.
A recovered question without a session id, or a malformed pending record,
is a named failure — never an invented question.

## Files

| File | Purpose |
|---|---|
| `types.ts` | Pure-data contracts: `PendingQuestion`, `Lifecycle`, `SweepFn`, `RollbackFn`, `StartupRecoveryResult`, `StartupSweepResult`, `StartupOutcome`, `RecoveryEvent`. No IO. |
| `startup.ts` | `runStartupRecovery` — deterministic orchestration (injected clock, injected lifecycle/sweep), event sequence, per-leg failure naming. |
| `handoff.ts` | `buildRecoveredQuestionEvent` — verbatim WS-08 `question:recovered` event from the durable record; `canReRaise` guard. |
| `index.ts` | Single-file barrel (`@candice/recovery`). |
| `__tests__/recovery.test.ts` | 11 node:test cases, all surfaces injected. |
| `README.md` | This file. |
| `CHECKPOINT-WS35.md` | Builder handoff record. |

## Wiring contract

```ts
import { runStartupRecovery } from "./recovery/index.ts";
import { sweepStaleTempAudio } from "../audio/cleanup/index.ts";
import { realFsAdapter } from "<platform adapter>"; // node:fs/promises surface

const outcome = await runStartupRecovery({
  lifecycle: sessionManager,       // WS-03 SessionManager (recoverPendingQuestion/resumeSession)
  // WS-20 sweep engine wrapped with the real fs adapter (its own signature
  // takes { fs, baseRoot, nowMs? } — this lane's SweepFn is the subset the
  // startup sequence needs).
  sweep: (opts) => sweepStaleTempAudio({ fs: realFsAdapter, ...opts }),
  tempRoot: platformTempRoot(),    // os.tmpdir() / %LOCALAPPDATA%\Temp
  sessionId: boundSessionId,       // the session this companion is bound to
  rollbackAvailable: () => process.env.CANDICE_UPDATER_ROLLBACK === "1", // WS-33 probe
});
// outcome.recovery.pending -> feed buildRecoveredQuestionEvent(...) into the WS-08 machine
```

## Run tests

```bash
node --test apps/candice-companion/src-tauri/recovery/__tests__/recovery.test.ts
```
