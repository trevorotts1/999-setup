/**
 * Transcript confirmation/edit/retry — pure presentation model
 * (Master Spec 0E WS-18, spec 6 / 5.1).
 *
 * Pure functions of REAL inputs only (WS-08 machine state, the in-progress
 * edit buffer). No clock, no IO, no DOM, no invented progress: every
 * display decision derives from a real state the bridge delivered. The
 * SUBMISSION LATCH is the load-bearing invariant (E.1 WS-18): once an
 * answer has been confirmed (`answer:confirmed` fired), the latch flips
 * and everything that could re-submit is closed — USE ANSWER cannot
 * re-fire, EDIT cannot resurrect the row, and TRY AGAIN starts a fresh
 * capture whose unconfirmed transcript is never auto-submitted.
 *
 * Unknown statuses degrade to a neutral transcript state instead of
 * throwing (spec 20).
 *
 * @module
 */

import type { CandiceState } from '../../state/machine.ts';
import { TRANSCRIPT_LABELS, TRANSCRIPT_MAX_TEXT_LENGTH } from './config.ts';

/**
 * Edit draft validation. Mirrors the wire contract (answer-event
 * `answerText` minLength 1 / max 4096; WS-04 validate.js MAX_TEXT_LENGTH)
 * so the edit surface can never produce an answer the schema rejects.
 */
export interface TranscriptEditValidity {
  ok: boolean;
  /** Machine-readable reason when not ok. */
  reason: 'empty' | 'too-long' | null;
  /** Exact user-facing error (TRANSCRIPT_LABELS). */
  error: string | null;
}

export function validateTranscriptEdit(text: string): TranscriptEditValidity {
  if (text.trim().length === 0) {
    return { ok: false, reason: 'empty', error: TRANSCRIPT_LABELS.EMPTY_ERROR };
  }
  if (text.length > TRANSCRIPT_MAX_TEXT_LENGTH) {
    return { ok: false, reason: 'too-long', error: TRANSCRIPT_LABELS.TOO_LONG_ERROR };
  }
  return { ok: true, reason: null, error: null };
}

/** Fields the controller renders. */
export interface TranscriptModel {
  /**
   * The heard prompt (spec 6 step 3) — shown when a transcript is on
   * display. Exact `Here is what I heard…` wording.
   */
  heardLabel: string | null;
  /**
   * The transcript awaiting confirmation. `null` when there is no
   * transcript on display (no transcription, editing in progress, or
   * nothing-heard state).
   */
  transcript: string | null;
  /** True while the confirmation row (USE ANSWER / EDIT / TRY AGAIN) shows. */
  confirming: boolean;
  /**
   * The confirmation row is visible ONLY while actually confirming with a
   * real transcript. After the answer is confirmed (machine leaves
   * `confirming`), the row hides even though the machine keeps the
   * transcript as the record — USE ANSWER can never re-fire (spec 5.1/6
   * no-double-count).
   */
  showConfirmRow: boolean;
  /**
   * True only when the user may confirm right now: status `confirming`
   * with a real transcript and the submission latch open. Guards the
   * USE ANSWER control and the submit transport (double belt).
   */
  canSubmit: boolean;
  /** True when the editor is open over an existing transcript. */
  editing: boolean;
  /** Current editor draft (null when the editor is closed). */
  editDraft: string | null;
  /** Edit validity (null when the editor is closed). */
  editValidity: TranscriptEditValidity | null;
  /** True when TRY AGAIN is usable right now (mic openable from here). */
  retryUsable: boolean;
  /**
   * True when the surface is active at all (interview question flow).
   * Post-interview / ending phases return the neutral state.
   */
  active: boolean;
  /** Exact spec-6 labels (acceptance evidence). */
  labels: {
    heard: string;
    useAnswer: string;
    edit: string;
    tryAgain: string;
    save: string;
    cancel: string;
  };
  /**
   * The exactly-once latch: true once an answer has been confirmed for
   * the current question. While true, nothing that could re-submit is
   * enabled (spec 5.1/6 no-double-count, E.1 WS-18 "counted exactly
   * once").
   */
  submittedOnce: boolean;
  /** True while the mic is live listening (spec 6). */
  listening: boolean;
  /** True while local transcription runs after release (spec 6). */
  transcribing: boolean;
}

/** Neutral state — no transcript surface (post-interview, ending, or no
 * question context). */
const neutral: TranscriptModel = {
  heardLabel: null,
  transcript: null,
  confirming: false,
  showConfirmRow: false,
  canSubmit: false,
  editing: false,
  editDraft: null,
  editValidity: null,
  retryUsable: false,
  active: false,
  labels: {
    heard: TRANSCRIPT_LABELS.HEARD,
    useAnswer: TRANSCRIPT_LABELS.USE_ANSWER,
    edit: TRANSCRIPT_LABELS.EDIT,
    tryAgain: TRANSCRIPT_LABELS.TRY_AGAIN,
    save: TRANSCRIPT_LABELS.SAVE,
    cancel: TRANSCRIPT_LABELS.CANCEL,
  },
  submittedOnce: false,
  listening: false,
  transcribing: false,
};

export interface TranscriptModelOptions {
  /** In-progress edit draft. Only read when `editing` is true. */
  editDraft?: string | null;
  /**
   * Submission latch. Caller-provided: the controller owns the latch
   * because it must flip exactly once, in the same event turn as the
   * machine's `answer:confirmed`. Default false (open).
   */
  submittedOnce?: boolean;
}

/**
 * Derive the transcript presentation model from the machine's REAL state.
 *
 * - status `confirming` + transcript => confirmation row visible,
 *   canSubmit true (latch open), heard prompt shown, retry usable;
 * - status `transcribing` => heard progress only (spec 6 step 2-3), no
 *   submit;
 * - status `listening` => nothing shown (the PTT lane owns the live
 *   surface);
 * - an empty transcript with `confirming` (STT returned nothing) =>
 *   NOTHING_HEARD neutral state (the MCP path rejects blank answers;
 *   never submit a blank answer, spec 20);
 * - anything else in the interview phase => no confirmation surface;
 * - post-interview / ending => neutral, never a question surface.
 */
export function transcriptModel(
  state: CandiceState,
  opts: TranscriptModelOptions = {},
): TranscriptModel {
  const { editDraft = null, submittedOnce = false } = opts;
  const status = state.status;

  if (state.phase !== 'interview') {
    return { ...neutral, submittedOnce };
  }

  const editing = editDraft !== null && status === 'confirming';
  const listening = status === 'listening';
  const transcribing = status === 'transcribing';

  if (editing) {
    const validity = validateTranscriptEdit(editDraft);
    return {
      heardLabel: TRANSCRIPT_LABELS.HEARD,
      transcript: state.transcript,
      confirming: true,
      showConfirmRow: false, // editor replaces the action row
      canSubmit: false, // submission is blocked while editing
      editing: true,
      editDraft,
      editValidity: validity,
      retryUsable: false, // no re-record while editing a draft
      active: true,
      labels: {
        heard: TRANSCRIPT_LABELS.HEARD,
        useAnswer: TRANSCRIPT_LABELS.USE_ANSWER,
        edit: TRANSCRIPT_LABELS.EDIT,
        tryAgain: TRANSCRIPT_LABELS.TRY_AGAIN,
        save: TRANSCRIPT_LABELS.SAVE,
        cancel: TRANSCRIPT_LABELS.CANCEL,
      },
      submittedOnce,
      listening,
      transcribing,
    };
  }

  // Confirming without a transcript: STT produced nothing and the machine
  // still sits in `confirming` (spec 20 empty-transcript doctrine; the
  // WS-16 runtime returns `empty-transcript` as a failure, never a blank
  // answer). Type remains available (WS-09 owns that surface); no submit
  // here and no "submit blank".
  if (status === 'confirming' && state.transcript === null) {
    return {
      heardLabel: null,
      transcript: null,
      confirming: true,
      showConfirmRow: false,
      canSubmit: false,
      editing: false,
      editDraft: null,
      editValidity: null,
      retryUsable: true,
      active: true,
      labels: {
        heard: TRANSCRIPT_LABELS.HEARD,
        useAnswer: TRANSCRIPT_LABELS.USE_ANSWER,
        edit: TRANSCRIPT_LABELS.EDIT,
        tryAgain: TRANSCRIPT_LABELS.TRY_AGAIN,
        save: TRANSCRIPT_LABELS.SAVE,
        cancel: TRANSCRIPT_LABELS.CANCEL,
      },
      submittedOnce,
      listening,
      transcribing,
    };
  }

  if (status === 'confirming') {
    // The row hides once the latch is closed (same rule WS-09 applies via
    // showConfirmRow): the machine keeps the transcript as the record,
    // but the surface must never offer a second submit (spec 5.1/6).
    const latchOpen = !submittedOnce;
    return {
      heardLabel: latchOpen ? TRANSCRIPT_LABELS.HEARD : null,
      transcript: state.transcript,
      confirming: true,
      showConfirmRow: latchOpen,
      canSubmit: latchOpen,
      editing: false,
      editDraft: null,
      editValidity: null,
      retryUsable: latchOpen,
      active: true,
      labels: {
        heard: TRANSCRIPT_LABELS.HEARD,
        useAnswer: TRANSCRIPT_LABELS.USE_ANSWER,
        edit: TRANSCRIPT_LABELS.EDIT,
        tryAgain: TRANSCRIPT_LABELS.TRY_AGAIN,
        save: TRANSCRIPT_LABELS.SAVE,
        cancel: TRANSCRIPT_LABELS.CANCEL,
      },
      submittedOnce,
      listening,
      transcribing,
    };
  }

  if (transcribing) {
    return {
      heardLabel: TRANSCRIPT_LABELS.HEARD,
      transcript: null,
      confirming: false,
      showConfirmRow: false,
      canSubmit: false,
      editing: false,
      editDraft: null,
      editValidity: null,
      retryUsable: false,
      active: true,
      labels: {
        heard: TRANSCRIPT_LABELS.HEARD,
        useAnswer: TRANSCRIPT_LABELS.USE_ANSWER,
        edit: TRANSCRIPT_LABELS.EDIT,
        tryAgain: TRANSCRIPT_LABELS.TRY_AGAIN,
        save: TRANSCRIPT_LABELS.SAVE,
        cancel: TRANSCRIPT_LABELS.CANCEL,
      },
      submittedOnce,
      listening: false,
      transcribing: true,
    };
  }

  if (listening) {
    return {
      ...neutral,
      active: true,
      listening: true,
      submittedOnce,
    };
  }

  // All other interview statuses (idle, thinking, speaking, recovering,
  // text-fallback): no transcript surface.
  return {
    ...neutral,
    active: true,
    submittedOnce,
  };
}
