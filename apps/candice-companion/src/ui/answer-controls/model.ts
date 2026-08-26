/**
 * Floating answer controls — pure presentation model (Master Spec 0E
 * WS-09, spec 5.1 / 5.2 / 6).
 *
 * Pure functions of REAL inputs only (WS-08 machine state, transcript,
 * profile preferences). No clock, no IO, no DOM, no invented progress:
 * every display decision derives from an event the bridge actually
 * delivered. Unknown statuses degrade to a neutral question view instead
 * of throwing (spec 20).
 *
 * @module
 */

import type { CandiceStatus } from '../../state/status.ts';
import type { CandiceState } from '../../state/machine.ts';
import type { AnswerMethod } from './config.ts';
import { ANSWER_CONTROLS_LABELS, LAST_METHOD_VALUES } from './config.ts';

/** Fields the controller renders. */
export interface AnswerControlsModel {
  /** True when both answer methods are offered (every question, spec 5.1). */
  presentingQuestion: boolean;
  /** The transcript awaiting confirmation (null when none, spec 6). */
  transcript: string | null;
  /** True while the confirmation row (USE ANSWER / EDIT / TRY AGAIN) shows. */
  confirming: boolean;
  /**
   * The confirmation row is visible ONLY while actually confirming with a
   * real transcript. After the answer is confirmed (status leaves
   * `confirming`), the row hides even though the machine keeps the
   * transcript as the record — USE ANSWER can never re-fire (spec 5.1/6
   * no-double-count).
   */
  showConfirmRow: boolean;
  /**
   * True only when the user may confirm right now: status `confirming`
   * with a real transcript. Guards the confirmation buttons.
   */
  canConfirm: boolean;
  /** True when the PTT hold-prompt is usable right now. */
  pttUsable: boolean;
  /** True while the mic is live (listening, spec 6). */
  listening: boolean;
  /** True while local transcription runs after release (spec 6). */
  transcribing: boolean;
  /** True when user is typing is allowed (every question — never locked). */
  typedUsable: boolean;
  /** True when the voice-output toggle shows ON (spec 5.2). */
  voiceEnabled: boolean;
  /** Voice toggle label: exact `Voice responses ON/OFF` wording (spec 5.2). */
  voiceToggleLabel: string;
  /** Button label for the toggle (short form for the button face). */
  voiceButtonLabel: string;
  /** Answer-in-Claude path available (never double-counts, spec 5.1). */
  delegateUsable: boolean;
  /** The transcript-action labels (exact spec-6 wording). */
  confirmLabels: { use: string; edit: string; tryAgain: string };
  /** Whether "type" is the currently-active convenience (never a lock). */
  activeMethod: AnswerMethod;
  /** True when the surface is a question surface at all (interview only). */
  inQuestionFlow: boolean;
}

/** Neutral question view — fallback for statuses with no question context. */
const questionDefaults: AnswerControlsModel = {
  presentingQuestion: true,
  transcript: null,
  confirming: false,
  showConfirmRow: false,
  canConfirm: false,
  pttUsable: true,
  listening: false,
  transcribing: false,
  typedUsable: true,
  voiceEnabled: true,
  voiceToggleLabel: ANSWER_CONTROLS_LABELS.VOICE_ON,
  voiceButtonLabel: ANSWER_CONTROLS_LABELS.VOICE_ON_BUTTON,
  delegateUsable: true,
  confirmLabels: {
    use: ANSWER_CONTROLS_LABELS.USE,
    edit: ANSWER_CONTROLS_LABELS.EDIT,
    tryAgain: ANSWER_CONTROLS_LABELS.TRY_AGAIN,
  },
  activeMethod: 'typed',
  inQuestionFlow: true,
};

/**
 * Derive the presentation model from the machine's REAL state.
 *
 * `lastUsedMethod` is a convenience, never a lock (spec 5.1); it only
 * picks the initial active control. `voice` and `typed` are always both
 * present on every question.
 */
export function answerControlsModel(
  state: CandiceState,
  opts: {
    /** Native fact: is a speech-to-text engine installed? Undefined = not told. */
    sttAvailable?: boolean;
    lastUsedMethod?: AnswerMethod | null;
    voiceEnabled?: boolean;
  } = {},
): AnswerControlsModel {
  const method = normalizeMethod(opts.lastUsedMethod);
  const voice = opts.voiceEnabled !== false; // default ON (spec 5.2)
  const status = state.status;

  // Post-interview / ending phases: no question surface. The compact lane
  // (WS-10) owns those surfaces; this lane never renders into them.
  if (state.phase !== 'interview') {
    return { ...questionDefaults, inQuestionFlow: false, voiceEnabled: voice };
  }

  const confirming = status === 'confirming' || status === 'transcribing';
  const listening = status === 'listening';
  const transcribing = status === 'transcribing';
  // Text-fallback means the user chose "Answer in Claude instead" for this
  // question: the answer surface belongs to the terminal now (spec 13.3)
  // and must not double-render an answer path (spec 5.1 no-double-count).
  const delegateActive = status === 'text-fallback';

  const voiceToggleLabel = voice
    ? ANSWER_CONTROLS_LABELS.VOICE_ON
    : ANSWER_CONTROLS_LABELS.VOICE_OFF;
  const voiceButtonLabel = voice
    ? ANSWER_CONTROLS_LABELS.VOICE_ON_BUTTON
    : ANSWER_CONTROLS_LABELS.VOICE_OFF_BUTTON;

  return {
    presentingQuestion: true,
    transcript: state.transcript,
    confirming,
    showConfirmRow: confirming && state.transcript !== null && state.transcript !== '',
    canConfirm: status === 'confirming' && state.transcript !== null && state.transcript !== '',
    // `sttAvailable === false` is the native fact that this machine has no
    // speech-to-text engine (SpeechHealth.stt_engine_ready). The control
    // is not built at all in that case; the model agrees so anything else
    // reading it reaches the same conclusion. Undefined means "not told",
    // which stays usable -- the shell always tells it.
    pttUsable: !delegateActive && opts.sttAvailable !== false,
    listening,
    transcribing,
    typedUsable: !delegateActive,
    voiceEnabled: voice,
    voiceToggleLabel,
    voiceButtonLabel,
    delegateUsable: true,
    confirmLabels: {
      use: ANSWER_CONTROLS_LABELS.USE,
      edit: ANSWER_CONTROLS_LABELS.EDIT,
      tryAgain: ANSWER_CONTROLS_LABELS.TRY_AGAIN,
    },
    activeMethod: method,
    inQuestionFlow: true,
  };
}

/** Normalize the last-used method (never a lock; unknown -> typed). */
export function normalizeMethod(value: unknown): AnswerMethod {
  return LAST_METHOD_VALUES.includes(value as AnswerMethod) ? (value as AnswerMethod) : 'typed';
}

/** True when the status is a real question-prompt state (spec 5.1). */
export function isQuestionPromptStatus(status: CandiceStatus): boolean {
  return (
    status === 'idle' ||
    status === 'waiting-for-user' ||
    status === 'listening' ||
    status === 'transcribing' ||
    status === 'confirming'
  );
}
