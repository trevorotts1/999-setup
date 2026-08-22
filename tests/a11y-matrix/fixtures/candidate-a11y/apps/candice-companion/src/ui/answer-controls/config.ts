/**
 * Floating answer controls configuration (Master Spec 0E WS-09, sections
 * 5.1 / 5.2 / 6).
 *
 * Canonical WS-09 declarations. Spec 5.1: the two controls — HOLD TO TALK
 * and TYPE ANSWER — are available on EVERY question; "Answer in Claude
 * instead" falls back to the terminal/Claude input surface without losing
 * state or double-counting. Spec 5.2: voice-output ON/OFF is a separate
 * persistent toggle, independent of answer method — typing while Candice
 * speaks and speaking while muted both work. Spec 6: after PTT release the
 * transcript shows with USE ANSWER / EDIT / TRY AGAIN — nothing is
 * submitted until the user confirms (also E.1 WS-18).
 *
 * The last-used method may be remembered as a convenience but is never a
 * lock (spec 5.1): this lane renders the remembered default as the active
 * control but always keeps both visible.
 *
 * @module
 */

/** Version bump on any breaking shape change of the controls surface. */
export const ANSWER_CONTROLS_CONTRACT_VERSION = 1;

/** Root class marking the floating answer controls surface. */
export const ANSWER_CONTROLS_ROOT_CLASS = 'candice-answer-controls';

/** Class toggled on the confirmation row (post-release transcript actions). */
export const ANSWER_CONFIRM_CLASS = 'candice-answer-confirm';

/** Type-answer input class. */
export const ANSWER_INPUT_CLASS = 'candice-answer-input';

/** Reduced-motion class consumed from the WS-14 lane (never defined here). */
export const ANSWER_REDUCED_MOTION_CLASS = 'candice-reduced-motion';

/** Exported style id so the style tag can be asserted/mounted once. */
export const ANSWER_CONTROLS_STYLE_ID = 'candice-answer-controls-style';

/**
 * Exact spec-5.1/6 labels (acceptance evidence; do not rephrase).
 * `ANSWER_IN_CLAUDE` uses "Answer in Claude instead" (spec 5.1).
 */
export const ANSWER_CONTROLS_LABELS = {
  /** Spec 5.1 — always available alongside HOLD TO TALK. */
  TYPE: 'TYPE ANSWER',
  /** Spec 5.1 — terminal/Claude fallback, never double-counted. */
  ANSWER_IN_CLAUDE: 'Answer in Claude instead',
  /** Spec 5.2 — separate persistent toggle. */
  VOICE_ON: 'Voice responses ON',
  VOICE_OFF: 'Voice responses OFF',
  VOICE_ON_BUTTON: 'Voice: ON',
  VOICE_OFF_BUTTON: 'Voice: OFF',
  /** Spec 6 — transcript actions after release. */
  USE: 'USE ANSWER',
  EDIT: 'EDIT',
  TRY_AGAIN: 'TRY AGAIN',
} as const;

/** Answer methods (spec 5.1). `terminal` is the Answer-in-Claude path. */
export const ANSWER_METHODS = ['voice', 'typed', 'terminal'] as const;
export type AnswerMethod = (typeof ANSWER_METHODS)[number];

/** Answer methods valid for the "last-used" convenience (spec 9 profile). */
export const LAST_METHOD_VALUES: readonly AnswerMethod[] = ['voice', 'typed', 'terminal'];

/**
 * The WS-40 preference shape this lane consumes for the last-used method
 * and the voice toggle. Never read/written here — only the shape is
 * declared so the controller can accept either the WS-40 store's profile
 * or a plain options object (testing).
 */
export interface AnswerControlsPreferences {
  /** Remembered convenience only; never a lock (spec 5.1). */
  lastUsedAnswerMethod?: AnswerMethod | null;
  /** Separate persistent toggle (spec 5.2). */
  voiceOutputEnabled?: boolean;
}
