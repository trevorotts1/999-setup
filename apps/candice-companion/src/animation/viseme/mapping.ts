/**
 * Candice viseme mapping (WS-12).
 *
 * Pure functions converting TTS phoneme timings into viseme events.
 * No TTS, DOM, or asset imports — the lane's only external contract is
 * the shared timing shape documented in `types.ts` (mirror of the WS-19
 * `PhonemeTiming` contract in `src-tauri/tts/types.ts`).
 */

import {
  DEFAULT_PHONEME_TO_VISEME,
  type VisemeBlendMode,
  type VisemeEvent,
  type VisemeId,
} from "./types.ts";

/**
 * Phoneme → viseme for the pinned Kokoro voice. Extensible; falls back to
 * "rest" for phonemes outside the table.
 */
export function phonemeToViseme(
  phoneme: string,
  table: Readonly<Record<string, VisemeId>> = DEFAULT_PHONEME_TO_VISEME,
): VisemeId {
  const key = phoneme.trim().toLowerCase();
  return table[key] ?? "rest";
}

/**
 * Convert one TTS timing span into a viseme event. Returns null for spans
 * that could not map to anything meaningful (non-finite or non-positive
 * duration) — callers should treat null as "keep the current mouth state".
 */
export function timingToVisemeEvent(
  phoneme: string,
  startSec: number,
  endSec: number,
): VisemeEvent | null {
  if (
    !Number.isFinite(startSec) ||
    !Number.isFinite(endSec) ||
    endSec <= startSec
  ) {
    return null;
  }
  return { startSec, endSec, viseme: phonemeToViseme(phoneme) };
}

/**
 * Whether inter-viseme blending is wanted between the two spans: only when
 * both sides have a shape, the shapes differ, and there is a real gap.
 * With mode "direct" no blending is emitted (spec 11A: cross-fade of a few
 * frames is the ceiling, direct swaps remain the default cheap path).
 */
export function shouldBlend(
  mode: VisemeBlendMode,
  a: VisemeEvent,
  b: VisemeEvent,
): boolean {
  if (mode !== "crossfade") {
    return false;
  }
  if (a.viseme === b.viseme) {
    return false;
  }
  return Number.isFinite(a.endSec) && Number.isFinite(b.startSec) && b.startSec > a.endSec;
}

/** Idle fallback mouth shape used outside speech spans (closed mouth). */
export function idleViseme(): VisemeId {
  return "closed";
}
