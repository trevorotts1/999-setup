/**
 * Captions model (Master Spec 0E WS-14, spec 5.2 / 6).
 *
 * Pure text pipeline — no DOM, no document, no window. Consumes the
 * WS-08 machine's real `captions:show` effect payloads and the machine
 * state so tests can prove the E.1 WS-14 shape:
 *
 *   captions always shown regardless of voice state.
 *
 * The model never invents caption text on its own; the machine is the
 * source of truth. Truncation is display-side only and never applies to
 * the question contract.
 *
 * @module
 */

import { CAPTIONS_MAX_CHARS } from './config.ts';

export interface CaptionEntry {
  /** Exact text from the machine effect, or a generated accessibility label. */
  text: string;
  /** True when the content reflects a question or answer the user must see. */
  important: boolean;
  /** Stable monotonic counter (never reused, never reset mid-session). */
  seq: number;
}

/** Current caption view state (pure, testable without a DOM). */
export interface CaptionsModelState {
  /** Last shown non-empty entry, or null when nothing has been shown. */
  current: CaptionEntry | null;
  /** Monotonic counter of every entry ever shown. */
  shownCount: number;
}

/** Trim a caption to the display bound (never truncates the contract). */
export function clipCaption(text: string, max = CAPTIONS_MAX_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/**
 * Normalize a machine caption effect into a display entry. Empty text
 * means "clear" — it yields an entry with empty text that the view treats
 * as a reset, so stale content can never linger (spec 5.2).
 */
export function captionFromEffect(
  caption: string | null,
  seq: number,
  important = false,
): CaptionEntry {
  return {
    text: caption ?? '',
    important,
    seq,
  };
}

/** Classify an entry as empty (reset marker) vs content. */
export function isEmptyCaption(entry: CaptionEntry | null): boolean {
  return entry === null || entry.text === '';
}

export function createCaptionsModel(): {
  state: CaptionsModelState;
  push(entry: CaptionEntry): void;
} {
  let current: CaptionEntry | null = null;
  let seq = 0;
  let shownCount = 0;

  return {
    get state() {
      return { current, shownCount };
    },
    push(entry: CaptionEntry): void {
      seq += 1;
      shownCount += 1;
      current = { ...entry, seq };
    },
  };
}
