/**
 * Push-to-talk control configuration (Master Spec 0E WS-09, sections 5.1
 * / 6 / 19).
 *
 * Canonical WS-09 declarations for the floating PTT control. The exact
 * user-facing strings come straight from spec 6 — the acceptance criterion
 * (CHECKLIST E.1 WS-09) names them verbatim:
 *
 *   Idle button:  🎙 HOLD TO TALK
 *   Pressed:      🔴 LISTENING — LET GO WHEN FINISHED
 *   Transcribing: Here is what I heard…
 *
 * The listening visual state must be UNMISTAKABLE (spec 6): a red glow
 * pulse plus the explicit label — never a tiny icon-only state.
 *
 * Spec 19 resource discipline: the only continuous animation this lane
 * owns is the listening glow pulse (1 element, GPU-composited opacity/
 * box-shadow), dropped under OS reduced motion via the WS-14 reduced-motion
 * class (same class name the WS-10 compact lane consumes; never defined
 * here, only consumed).
 *
 * @module
 */

/** Version bump on any breaking shape change of the PTT surface. */
export const PTT_CONTRACT_VERSION = 1;

/**
 * Reduced-motion class consumed from the WS-14 lane (never defined here).
 * Matches `COMPACT_REDUCED_MOTION_CLASS` in the WS-10 compact lane: the
 * single shared class all animation lanes consume.
 */
export const PTT_REDUCED_MOTION_CLASS = 'candice-reduced-motion';

/** Root class marking the PTT control. */
export const PTT_ROOT_CLASS = 'candice-ptt';

/** Class toggled while the mic is live (unmistakable listening state). */
export const PTT_LISTENING_CLASS = 'candice-ptt-listening';

/** Class toggled while transcription is in flight. */
export const PTT_TRANSCRIBING_CLASS = 'candice-ptt-transcribing';

/** Glow/pulse element class (the visual state, never icon-only). */
export const PTT_GLOW_CLASS = 'candice-ptt-glow';

/** Lightweight waveform container class (optional waveform, spec 6). */
export const PTT_WAVE_CLASS = 'candice-ptt-wave';

/** Single waveform bar element class. */
export const PTT_WAVE_BAR_CLASS = 'candice-ptt-wave-bar';

/** Exported style id, so the style tag can be asserted/mounted once. */
export const PTT_STYLE_ID = 'candice-ptt-style';

/** Exact spec-6 labels (acceptance evidence; do not rephrase). */
export const PTT_LABELS = {
  /** Idle button (spec 6). */
  HOLD: '🎙 HOLD TO TALK',
  /** While pressed (spec 6). */
  LISTENING: '🔴 LISTENING — LET GO WHEN FINISHED',
  /** Shown on release, before the transcript appears (spec 6). */
  TRANSCRIBING: 'Here is what I heard…',
} as const;

/**
 * Default number of waveform bars. Tiny by design (spec 19: lightweight).
 */
export const PTT_WAVE_BAR_COUNT = 6;

/**
 * Listening glow pulse duration. One element, one keyframe pair, dropped
 * under reduced motion (spec 19).
 */
export const PTT_GLOW_PULSE_MS = 900;
