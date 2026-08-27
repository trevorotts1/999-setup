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
 * Kokoro phoneme -> viseme table.
 *
 * MEASURED, not assumed. The pinned stack (kokoro-onnx 0.6.1 driving
 * espeak-ng through EspeakConfig) emits lowercase **IPA**, captured by
 * running the shipped worker in `src-tauri/tts/scripts/runtime.py`:
 *
 *   "Hello, this is Candice speaking about the build."
 *     -> h e l * o U ,   D I s   I z   k * ae n d I s ...   (IPA, elided)
 *   day -> d STRESS e I     my  -> m STRESS a I
 *   she -> S i LONG         thin-> TH STRESS I n
 *
 * Diphthongs arrive as two spans (e + I), affricates as two (t + S).
 * No uppercase Kokoro vocab symbol is ever produced on this path.
 *
 * The previous table held 13 plain-ASCII keys (a e i o u b m p f v w aa ae).
 * Against that measured sentence only 6 of 48 spans matched: 87.5% fell
 * through to "rest", which the renderer draws as a CLOSED mouth. That is
 * why the mouth never moved. Coverage here is the load-bearing property --
 * `visemeTableCoverage()` and its test hold the line at 100%.
 *
 * Shape budget: the build record carries four approved mouth cutouts, so
 * seven viseme ids collapse to four images (closed/rest/mm -> closed,
 * ai/ee -> open-small, oh -> open-medium, wide -> open-wide).
 *
 * Consonants articulated with the tongue (t d k s z n l r S Z TH ...) map to
 * "ai", the neutral slightly-open talking aperture -- NOT to rest. Snapping
 * the mouth shut on every consonant is the second way a face reads as dead.
 * Only silence closes it.
 *
 * Data, not code, so a future WS-11 final-art pass can extend it without
 * touching scheduler logic.
 */
export const DEFAULT_PHONEME_TO_VISEME: Readonly<Record<string, VisemeId>> = Object.freeze({
  // --- Lips together or lip-to-teeth: the mouth reads as CLOSED. ---
  p: "mm", b: "mm", m: "mm", f: "mm", v: "mm",
  "\u0278": "mm",  // ɸ  bilabial fricative
  "\u03b2": "mm",  // β  bilabial fricative (voiced)
  "\u028b": "mm",  // ʋ  labiodental approximant
  "\u1d5d": "mm",  // ᵝ  labialisation diacritic (Kokoro vocab)
  "\u0271": "mm",  // ɱ  labiodental nasal

  // --- Rounded / protruded: medium open. ---
  o: "oh", u: "oh", w: "oh",
  "\u0254": "oh",  // ɔ  as in "water"
  "\u028a": "oh",  // ʊ  as in "put"
  "\u0252": "oh",  // ɒ  open back rounded
  "\u00f8": "oh",  // ø
  "\u0153": "oh",  // œ
  "\u0264": "oh",  // ɤ
  "\u026f": "oh",  // ɯ
  "\u0265": "oh",  // ɥ  rounded palatal glide

  // --- Wide jaw: open vowels. ---
  a: "wide",
  "\u0251": "wide", // ɑ  as in "father"
  "\u0250": "wide", // ɐ  as in "about"
  "\u00e6": "wide", // æ  as in "cat"
  "\u028c": "wide", // ʌ  as in "cup"

  // --- Close / spread front: small open. ---
  i: "ee", e: "ee", y: "ee", j: "ee",
  "\u026a": "ee",  // ɪ  as in "sing"
  "\u0268": "ee",  // ɨ
  "\u1d7b": "ee",  // ᵻ
  "\u029d": "ee",  // ʝ
  "\u0255": "ee",  // ɕ

  // --- Reduced central vowels: small open, genuinely neutral. ---
  "\u0259": "ai",  // ə  as in "hello"    (unstressed schwa)
  "\u025a": "ai",  // ɚ  as in "measure"  (r-coloured schwa)
  "\u1d4a": "ai",  // ᵊ

  // --- STRESSED open-mid vowels: rounded UP to the wide jaw. ---
  // These two carry the syllable in words whose consonants are all tongue
  // articulations -- "church" is t ʃ ˈ ɜ ː t ʃ and "red" is ɹ ˈ ɛ d. Leaving
  // them on the same small aperture as their neighbours renders the whole
  // word as one motionless shape, which is the dead-face bug in miniature
  // even with the table otherwise fully covered. With four cutouts to spend,
  // rounding an open-mid vowel up buys the contrast that reads as speech.
  "\u025b": "wide", // ɛ  as in "red"
  "\u025c": "wide", // ɜ  as in "bird", "church"

  // --- Tongue consonants: neutral talking aperture, never closed. ---
  t: "ai", d: "ai", k: "ai", g: "ai", n: "ai", s: "ai", z: "ai",
  l: "ai", r: "ai", h: "ai", c: "ai", q: "ai", x: "ai",
  "\u0261": "ai",  // ɡ  script g (espeak emits this, NOT ASCII "g")
  "\u03b8": "ai",  // θ  as in "thin"
  "\u00f0": "ai",  // ð  as in "this"
  "\u0283": "ai",  // ʃ  as in "she"
  "\u0292": "ai",  // ʒ  as in "measure"
  "\u0281": "ai",  // ʁ
  "\u0279": "ai",  // ɹ  as in "red"
  "\u027b": "ai",  // ɻ
  "\u027e": "ai",  // ɾ  flap, as in "water"
  "\u027d": "ai",  // ɽ
  "\u014b": "ai",  // ŋ  as in "sing"
  "\u0273": "ai",  // ɳ
  "\u0272": "ai",  // ɲ
  "\u0274": "ai",  // ɴ
  "\u0282": "ai",  // ʂ
  "\u0288": "ai",  // ʈ
  "\u0256": "ai",  // ɖ
  "\u025f": "ai",  // ɟ
  "\u00e7": "ai",  // ç
  "\u03c7": "ai",  // χ
  "\u0263": "ai",  // ɣ
  "\u028e": "ai",  // ʎ
  "\u0270": "ai",  // ɰ
  "\u0294": "ai",  // ʔ  glottal stop
  "\u02a4": "ai",  // ʤ  affricate (single-symbol form)
  "\u02a7": "ai",  // ʧ
  "\u02a3": "ai",  // ʣ
  "\u02a5": "ai",  // ʥ
  "\u02a6": "ai",  // ʦ
  "\u02a8": "ai",  // ʨ
  "\uab67": "ai",  // ꭧ
  " ": "ai",        // word gap: connected speech does not close the mouth

  // --- Silence: the only thing that closes the mouth mid-utterance. ---
  ",": "closed", ".": "closed", ";": "closed", ":": "closed",
  "!": "closed", "?": "closed", '"': "closed",
  "(": "closed", ")": "closed",
  "\u2014": "closed", // —
  "\u2026": "closed", // …
  "\u201c": "closed", // “
  "\u201d": "closed", // ”
  "\u2193": "closed", // ↓ prosody
  "\u2192": "closed", // →
  "\u2197": "closed", // ↗
  "\u2198": "closed", // ↘
});

/**
 * Phonemes that carry NO aperture of their own and must hold the shape
 * around them instead of forcing one.
 *
 * This is load-bearing. espeak places the stress mark BETWEEN the onset
 * consonant and its vowel -- "day" is `d STRESS e I` -- and the length mark
 * AFTER a vowel it prolongs ("she" is `S i LONG`). Giving either its own
 * mouth state snaps the jaw shut in the middle of a syllable, so a table
 * that maps them to "rest" produces a stuttering face even when every other
 * phoneme is mapped correctly.
 */
export const CARRY_VISEME_PHONEMES: ReadonlySet<string> = Object.freeze(
  new Set([
    "\u02c8", // ˈ primary stress
    "\u02cc", // ˌ secondary stress
    "\u02d0", // ː length
    "\u02b0", // ʰ aspiration
    "\u02b2", // ʲ palatalisation
    "\u0303", // ̃  nasalisation (combining)
  ]),
) as ReadonlySet<string>;
/**
 * Runtime cost/quality setting for the viseme scheduler. "direct" switches
 * mouth states on event boundaries; "crossfade" emits inter-viseme steps
 * for the renderer to blend (spec 11A: cross-fades of a few frames, never
 * full-video playback).
 */
export type VisemeBlendMode = "direct" | "crossfade";
