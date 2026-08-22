/**
 * WS-35 recovery-lane public surface.
 *
 * Owned lane (manifest 9.2 WR-018 / WS-35):
 *   `apps/candice-companion/src-tauri/recovery/**`
 *
 * One stable import path (`@candice/recovery`), same discipline as
 * `@candice/state` and `@candice/audio-duplex` — no deep imports from the
 * bridge.
 */

export { runStartupRecovery, RECOVERY_VERB, RECOVERY_STATUS, isRecoveryStatus } from "./startup.ts";
export type { StartupRecoveryOptions, Clock } from "./startup.ts";

export {
  buildRecoveredQuestionEvent,
  canReRaise,
  QUESTION_RECOVERED_EVENT,
  RECOVERING_STATUS,
} from "./handoff.ts";
export type { RecoveredQuestionEvent } from "./handoff.ts";

export type {
  Lifecycle,
  PendingQuestion,
  RecoveryEvent,
  RollbackFn,
  StartupOutcome,
  StartupRecoveryResult,
  StartupSweepResult,
  SweepFn,
} from "./types.ts";
