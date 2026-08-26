/**
 * Candice viseme animation shared types (WS-12).
 *
 * These types are the stable viseme bridge between the TTS lane (WS-19)
 * and the face-render lane (WS-11/WS-13). The phoneme side mirrors
 * `src-tauri/tts/types.ts` `PhonemeTiming` (WS-19 contract, owned by
 * WR-014) — the viseme lane consumes it and never redefines it.
 */

/** Known mouth shapes. Values are canonical for all assets and states. */
export type VisemeId =
  | "closed"
  | "rest"
  | "ai"
  | "oh"
  | "ee"
  | "mm"
  | "wide";

/** A mouth state offered to the renderer for one scheduling span. */
export interface VisemeEvent {
  /** Start of the span, seconds, in the same clock as the TTS timings. */
  startSec: number;
  /** End of the span, seconds. Must be > startSec. */
  endSec: number;
  viseme: VisemeId;
}

/** Minimal clock contract used for testing; runtime passes performance.now(). */
export interface Clock {
  now(): number;
}

/**
 * One step in a viseme animation sequence, as driven by `VisemeScheduler`.
 * The face-render lane applies the mouth state for exactly this span.
 */
export interface VisemeStep {
  /** Mouth state to show. */
  viseme: VisemeId;
  /** Span start in scheduler time (ms). */
  startMs: number;
  /** Span end in scheduler time (ms). */
  endMs: number;
}

/**
 * Standard Kokoro phoneme → viseme table (MIT-licensed kokoro-onnx mapping).
 * Phonemes not present fall back to "rest". The mapping is deliberately a
 * data constant, not code, so a future WS-11 final-art pass can extend it
 * without touching scheduler logic.
 */
export const DEFAULT_PHONEME_TO_VISEME: Readonly<Record<string, VisemeId>> = Object.freeze({
  // Vowels.
  a: "ai",
  e: "ai",
  i: "ee",
  o: "oh",
  u: "oh",
  // Consonants with visible lip involvement.
  b: "mm",
  m: "mm",
  p: "mm",
  f: "mm",
  v: "mm",
  w: "mm",
  // Broad mouth openings.
  aa: "wide",
  ae: "wide",
});

/**
 * Runtime cost/quality setting for the viseme scheduler. "direct" switches
 * mouth states on event boundaries; "crossfade" emits inter-viseme steps
 * for the renderer to blend (spec 11A: cross-fades of a few frames, never
 * full-video playback).
 */
export type VisemeBlendMode = "direct" | "crossfade";
