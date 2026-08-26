/**
 * Candice viseme mapping (WS-12).
 *
 * Pure functions converting TTS phoneme timings into viseme events.
 * No TTS, DOM, or asset imports — the lane's only external contract is
 * the shared timing shape documented in `types.ts` (mirror of the WS-19
 * `PhonemeTiming` contract in `src-tauri/tts/types.ts`).
 */

import {
  CARRY_VISEME_PHONEMES,
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
  // A bare space IS a phoneme here (the word gap), so trimming must not be
  // allowed to erase it into the empty string and miss its entry.
  const raw = phoneme === " " ? " " : phoneme.trim();
  // Exact first: Kokoro's full vocab distinguishes case, and lowercasing
  // blind would fold a distinct symbol onto its lowercase twin. The pinned
  // espeak path emits only lowercase IPA, so the fallback is what actually
  // runs today -- but the exact probe keeps a future vocab change honest.
  const hit = table[raw] ?? table[raw.toLowerCase()];
  return hit ?? "rest";
}

/** True for marks that must inherit a neighbour's shape, never force one. */
export function isCarryPhoneme(phoneme: string): boolean {
  return CARRY_VISEME_PHONEMES.has(phoneme === " " ? " " : phoneme.trim());
}

/**
 * Fraction of a phoneme inventory the table actually covers, 0..1.
 *
 * Exposed so a test can assert coverage instead of trusting the table by
 * eye. Falling through to "rest" is what killed lip sync once; a number
 * makes the next regression fail loudly rather than look merely dim.
 */
export function visemeTableCoverage(
  inventory: readonly string[],
  table: Readonly<Record<string, VisemeId>> = DEFAULT_PHONEME_TO_VISEME,
): number {
  if (inventory.length === 0) {
    return 1;
  }
  let covered = 0;
  for (const p of inventory) {
    if (isCarryPhoneme(p) || phonemeToViseme(p, table) !== "rest") {
      covered += 1;
    }
  }
  return covered / inventory.length;
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

/**
 * Convert a whole utterance's timings into viseme events, resolving the
 * carry marks against their neighbours.
 *
 * Per-span mapping cannot do this: `ˈ` has no shape of its own, and what it
 * should show depends on the spans either side of it. A leading mark looks
 * FORWARD to the first real shape (there is nothing behind it yet); every
 * other mark holds the shape BEHIND it, which is how a real jaw behaves
 * through a stress or a lengthened vowel.
 *
 * Invalid spans are dropped exactly as `timingToVisemeEvent` drops them --
 * garbage in, gap out. The mouth lane must never throw on real TTS output.
 */
export function visemeEventsFromTimings(
  timings: ReadonlyArray<{ phoneme: string; startSec: number; endSec: number }>,
): VisemeEvent[] {
  const events: VisemeEvent[] = [];
  // Index into `events` of each carry span still waiting on a shape.
  const pendingCarry: number[] = [];
  let previous: VisemeId | null = null;

  for (const t of timings) {
    const ev = timingToVisemeEvent(t.phoneme, t.startSec, t.endSec);
    if (!ev) {
      continue;
    }
    if (isCarryPhoneme(t.phoneme)) {
      if (previous === null) {
        // Utterance-initial mark: park it and let the first real shape claim it.
        pendingCarry.push(events.length);
        events.push(ev);
      } else {
        events.push({ ...ev, viseme: previous });
      }
      continue;
    }
    // A real shape resolves anything that was waiting on it.
    for (const idx of pendingCarry) {
      events[idx] = { ...events[idx], viseme: ev.viseme };
    }
    pendingCarry.length = 0;
    previous = ev.viseme;
    events.push(ev);
  }

  // An utterance of nothing but marks has no shape to inherit: leave those
  // spans at whatever they mapped to rather than inventing a mouth.
  return events;
}

/** Idle fallback mouth shape used outside speech spans (closed mouth). */
export function idleViseme(): VisemeId {
  return "closed";
}
