/**
 * WS-35 recovery handoff — exact pending question re-raise (spec 20).
 *
 * Owned lane (manifest 9.2 WR-018 / WS-35):
 *   `apps/candice-companion/src-tauri/recovery/**`
 *
 * Bridge between the WS-03 session manager (where the pending question
 * lives durably) and the WS-08 state machine (which consumes the
 * `question:recovered` event). The state machine contract
 * (src/state/machine.ts) is:
 *
 *   - `question:recovered` carries `question` = the exact pending question;
 *   - the reducer IGNORES the event when phase is not `interview`;
 *   - `question:recovered` without a pending question is ignored (no
 *     invented recovery);
 *   - `answer:confirmed` clears `pendingQuestion` and increments the
 *     accounting counter exactly once — recovery never touches the
 *     counter, so a recovered question can never double-count.
 *
 * This module builds the event from a recovered record VERBATIM — the
 * exact `text` and `questionKey` from the durable record, never a
 * re-derived or re-asked question.
 */

import type { PendingQuestion } from "./types.ts";

/** The WS-08 state-machine event type for crash recovery (spec 20). */
export const QUESTION_RECOVERED_EVENT = "question:recovered" as const;

/** The WS-08 status value that mirrors recovery in progress. */
export const RECOVERING_STATUS = "recovering" as const;

export interface RecoveredQuestionEvent {
  readonly type: typeof QUESTION_RECOVERED_EVENT;
  /** The exact pending question text, verbatim from the durable record. */
  readonly question: string;
  /** Stable question key, verbatim (contract-suite pin, WS-41). */
  readonly questionKey: string;
  /** Mirrored accounting flag — the recovery lane never changes it. */
  readonly counted: boolean;
  /** Session id the question belonged to. */
  readonly sessionId: string;
}

/**
 * Build the state-machine event for a recovered pending question.
 * Returns null when the record carries no text — a malformed record is
 * reported, never turned into an invented question.
 */
export function buildRecoveredQuestionEvent(
  pending: PendingQuestion | null | undefined,
  sessionId: string,
): RecoveredQuestionEvent | null {
  if (!pending || typeof pending.text !== "string" || pending.text.length === 0) {
    return null;
  }
  return {
    type: QUESTION_RECOVERED_EVENT,
    question: pending.text,
    questionKey: pending.questionKey,
    counted: pending.counted === true,
    sessionId,
  };
}

/** True when the WS-08 machine's recovered event can legally re-raise the question. */
export function canReRaise(pending: PendingQuestion | null | undefined): boolean {
  return buildRecoveredQuestionEvent(pending, "probe") != null;
}
