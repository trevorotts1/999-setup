/**
 * Transcript confirmation/edit/retry configuration (Master Spec 0E WS-18,
 * spec 6 / 5.1).
 *
 * Canonical WS-18 declarations for the transcript confirmation surface.
 * The exact user-facing strings come from spec 6 — the acceptance
 * criterion (CHECKLIST E.1 WS-18) names the flow verbatim:
 *
 *   Release:
 *    1. Stop recording. 2. Transcribe locally. 3. Display
 *       "Here is what I heard…". 4. Show the transcript. 5. Offer
 *       USE ANSWER / EDIT / TRY AGAIN.
 *
 * Do not submit a voice transcription to the skill until the user
 * confirms it. EDIT and TRY AGAIN must work; a confirmed answer is
 * counted exactly once (E.1 WS-18).
 *
 * Boundary (PROJECT-MANIFEST 9.2, WS-09 contract): the WS-09
 * answer-controls lane renders the in-row intent strip (USE ANSWER /
 * EDIT / TRY AGAIN buttons) and reports intent through its transports;
 * THIS lane owns the full edit/retry/confirmation UX — the heard prompt,
 * the transcript display, the edit editor with validation, the retry
 * semantics, and the exactly-once submission gate.
 *
 * Spec 19 resource discipline: no continuous animation owned here; the
 * same reduced-motion class the ptt/answer lanes consume (WS-14 defines
 * it; this lane only consumes the name).
 *
 * @module
 */

/** Version bump on any breaking shape change of the transcript surface. */
export const TRANSCRIPT_CONTRACT_VERSION = 1;

/** Root class marking the transcript confirmation surface. */
export const TRANSCRIPT_ROOT_CLASS = 'candice-transcript';

/** Heard-prompt class ("Here is what I heard…", spec 6 step 3). */
export const TRANSCRIPT_HEARD_CLASS = 'candice-transcript-heard';

/** Editable transcript class (EDIT mode). */
export const TRANSCRIPT_EDITOR_CLASS = 'candice-transcript-editor';

/** Confirmation actions row class (USE ANSWER / EDIT / TRY AGAIN). */
export const TRANSCRIPT_ACTIONS_CLASS = 'candice-transcript-actions';

/** Exported style id, so the style tag can be asserted/mounted once. */
export const TRANSCRIPT_STYLE_ID = 'candice-transcript-style';

/**
 * Reduced-motion class consumed from the WS-14 lane (never defined here).
 * Matches `PTT_REDUCED_MOTION_CLASS` / `ANSWER_REDUCED_MOTION_CLASS`:
 * the single shared class all animation lanes consume.
 */
export const TRANSCRIPT_REDUCED_MOTION_CLASS = 'candice-reduced-motion';

/**
 * Edit length bound — MIRROR of the WS-01/WS-04 accepted range:
 * answer-event.schema.json `answerText` minLength 1, and the WS-04 MCP
 * runtime rule MAX_TEXT_LENGTH = 4096
 * (plugins/candice-integration/mcp/ask-user/validate.js). The schema is
 * the wire authority; this lane enforces the same bounds client-side so
 * an edit can never produce an answer the schema would reject.
 */
export const TRANSCRIPT_MAX_TEXT_LENGTH = 4096;

/** Exact spec-6 labels (acceptance evidence; do not rephrase). */
export const TRANSCRIPT_LABELS = {
  /** Spec 6 step 3 — shown after release, before/around the transcript. */
  HEARD: 'Here is what I heard…',
  /** Spec 6 step 5 — the confirm action. */
  USE_ANSWER: 'USE ANSWER',
  /** Spec 6 step 5 — fix the transcript before confirming. */
  EDIT: 'EDIT',
  /** Spec 6 step 5 — re-record; nothing submitted until reconfirmed. */
  TRY_AGAIN: 'TRY AGAIN',
  /** Editor affordances. */
  EDIT_PLACEHOLDER: 'Correct your answer…',
  SAVE: 'SAVE',
  CANCEL: 'CANCEL',
  /** Editor hint (aria/visible aid, not a spec string). */
  EDIT_HINT: 'Fix what I heard, then press SAVE or USE ANSWER.',
  /** Confirming with no transcript (STT produced nothing). */
  NOTHING_HEARD: 'I didn’t hear anything — TRY AGAIN, or type your answer.',
  /** Edit validation failures (never submit an invalid answer, WS-01). */
  EMPTY_ERROR: 'There’s nothing here yet — type your answer first.',
  TOO_LONG_ERROR: 'That’s too long — please keep it under 4,096 characters.',
} as const;
