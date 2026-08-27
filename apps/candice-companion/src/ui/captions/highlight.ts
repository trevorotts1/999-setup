/**
 * Sentence highlighting for a caption that is being spoken aloud.
 *
 * Trevor: "IT WOULD BE NICE IF THE SENTENCE WAS HIGHLIGHTED AS SHE SPOKE"
 *
 * WHAT DRIVES IT. `candice:speech-start` carries the utterance's real Kokoro
 * phoneme timings, so the total spoken duration is MEASURED, not guessed. What
 * those timings cannot give is an alignment from phoneme back to character:
 * the phonemes come out of espeak-ng and carry no offset into the source text.
 *
 * So the mapping here is proportional-by-length against the real duration:
 * a sentence gets a share of the timeline equal to its share of the speakable
 * characters. That is an APPROXIMATION and is documented as one -- it tracks
 * the true audio length exactly, and drifts within it by however much the
 * speaking rate varies between sentences.
 *
 * It is deliberately SENTENCE level, not word level. Sentence granularity
 * absorbs the drift (a highlight that is 200ms early on a 4-second sentence is
 * invisible); word granularity would put the error on display.
 *
 * @module
 */

/** A sentence and the half-open character range it occupies in the source. */
export interface CaptionSentence {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  /** Speakable characters (letters/digits). Whitespace and punctuation are
   *  not spoken and must not earn time on the timeline. */
  readonly weight: number;
}

const SPEAKABLE = /[\p{L}\p{N}]/u;

function weigh(text: string): number {
  let n = 0;
  for (const ch of text) if (SPEAKABLE.test(ch)) n += 1;
  return n;
}

/**
 * Split caption text into sentences, preserving every character.
 *
 * The concatenation of the returned ranges is exactly the input: nothing is
 * dropped, so the view can rebuild the caption from these spans without the
 * displayed text ever differing from the caption it was given.
 */
export function splitSentences(text: string): readonly CaptionSentence[] {
  if (text.length === 0) return [];
  const out: CaptionSentence[] = [];
  // A run with no speakable characters (a bare "...", a stray newline) is not
  // a sentence -- it can never be highlighted, because it earns no time on the
  // timeline. It is CARRIED FORWARD onto the next real sentence instead of
  // being emitted or dropped. Dropping it silently deleted characters from the
  // caption, which would show the user different words than were delivered.
  let pending = '';
  let pendingStart = 0;
  let start = 0;

  const emit = (slice: string, from: number, to: number): void => {
    const combined = pending + slice;
    const begin = pending === '' ? from : pendingStart;
    const w = weigh(combined);
    if (w > 0) {
      out.push({ text: combined, start: begin, end: to, weight: w });
      pending = '';
      return;
    }
    if (out.length > 0) {
      const prev = out[out.length - 1] as CaptionSentence;
      out[out.length - 1] = {
        text: prev.text + combined, start: prev.start, end: to, weight: prev.weight,
      };
      pending = '';
      return;
    }
    pending = combined;
    pendingStart = begin;
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const isBreak = ch === '.' || ch === '!' || ch === '?' || ch === '\n';
    if (!isBreak) continue;
    // Absorb trailing closers and whitespace so a sentence never begins with
    // the space that ended the previous one.
    let j = i + 1;
    while (j < text.length && (text[j] === '"' || text[j] === "'" || text[j] === ')')) j += 1;
    while (j < text.length && /\s/.test(text[j] as string)) j += 1;
    emit(text.slice(start, j), start, j);
    start = j;
    i = j - 1;
  }
  if (start < text.length) emit(text.slice(start), start, text.length);

  if (pending !== '') {
    // Nothing speakable in the entire caption. Keep it whole and weightless:
    // `activeSentenceIndex` returns -1 for a zero-weight set, so it renders
    // plain rather than highlighting punctuation.
    out.push({ text: pending, start: pendingStart, end: text.length, weight: 0 });
  }
  return out;
}

/**
 * Index of the sentence being spoken at `fraction` (0..1) through the
 * utterance, or -1 when nothing should be highlighted.
 *
 * Out-of-range fractions clamp rather than throw: a late timer tick past the
 * end of the audio must leave the last sentence lit, never crash the caption.
 */
export function activeSentenceIndex(
  sentences: readonly CaptionSentence[],
  fraction: number,
): number {
  if (sentences.length === 0) return -1;
  if (!Number.isFinite(fraction)) return -1;
  const total = sentences.reduce((sum, s) => sum + s.weight, 0);
  if (total <= 0) return -1;
  if (fraction <= 0) return 0;
  if (fraction >= 1) return sentences.length - 1;
  const target = fraction * total;
  let acc = 0;
  for (let i = 0; i < sentences.length; i += 1) {
    acc += (sentences[i] as CaptionSentence).weight;
    if (target < acc) return i;
  }
  return sentences.length - 1;
}

/**
 * Total spoken duration in ms from real phoneme timings, or 0 if unusable.
 *
 * `endSec` is the WS-19 contract spelling (camelCase, see `SpeechTiming`).
 * Reading a snake_case spelling as well would be dead code that implies a
 * payload shape the contract does not have -- and it would silently "work"
 * against a wrong payload instead of reporting 0.
 */
export function durationFromTimings(
  timings: readonly { readonly endSec: number }[],
): number {
  let max = 0;
  for (const t of timings) {
    if (Number.isFinite(t.endSec) && t.endSec > max) max = t.endSec;
  }
  return max > 0 ? max * 1000 : 0;
}
