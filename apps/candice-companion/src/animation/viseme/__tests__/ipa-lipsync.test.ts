/**
 * FIX — lip sync was dead: the phoneme table did not speak the TTS's alphabet.
 *
 * Every inventory below was CAPTURED from the shipped worker
 * (`src-tauri/tts/scripts/runtime.py`, kokoro-onnx 0.6.1 + espeak-ng,
 * voice af_bella) — not transcribed from a reference chart. If the pinned
 * TTS ever changes its alphabet, these fixtures are what should be
 * re-captured, and this file is where the change surfaces.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  isCarryPhoneme,
  phonemeToViseme,
  visemeEventsFromTimings,
  visemeTableCoverage,
} from "../mapping.ts";
import {
  CARRY_VISEME_PHONEMES,
  DEFAULT_PHONEME_TO_VISEME,
  type VisemeId,
} from "../types.ts";
import { VisemeScheduler } from "../scheduler.ts";

/** Measured: "Hello, this is Candice speaking about the build." */
const MEASURED_SENTENCE: readonly string[] = [
  "h", "ə", "l", "ˈ", "o", "ʊ", ",", " ",
  "ð", "ɪ", "s", " ", "ɪ", "z", " ",
  "k", "ˈ", "æ", "n", "d", "ɪ", "s", " ",
  "s", "p", "ˈ", "i", "ː", "k", "ɪ", "ŋ", " ",
  "ɐ", "b", "ˌ", "a", "ʊ", "t", " ",
  "ð", "ə", " ", "b", "ˈ", "ɪ", "l", "d", ".",
];

/** Measured single words, each probing a different corner of the inventory. */
const MEASURED_WORDS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["day", ["d", "ˈ", "e", "ɪ"]],
  ["my", ["m", "ˈ", "a", "ɪ"]],
  ["go", ["ɡ", "ˈ", "o", "ʊ"]],
  ["now", ["n", "ˈ", "a", "ʊ"]],
  ["boy", ["b", "ˈ", "ɔ", "ɪ"]],
  ["she", ["ʃ", "i", "ː"]],
  ["church", ["t", "ʃ", "ˈ", "ɜ", "ː", "t", "ʃ"]],
  ["thin", ["θ", "ˈ", "ɪ", "n"]],
  ["measure", ["m", "ˈ", "ɛ", "ʒ", "ɚ"]],
  ["sing", ["s", "ˈ", "ɪ", "ŋ"]],
  ["bird", ["b", "ˈ", "ɜ", "ː", "d"]],
  ["cat", ["k", "ˈ", "æ", "t"]],
  ["father", ["f", "ˈ", "ɑ", "ː", "ð", "ɚ"]],
  ["put", ["p", "ˈ", "ʊ", "t"]],
  ["cup", ["k", "ˈ", "ʌ", "p"]],
  ["red", ["ɹ", "ˈ", "ɛ", "d"]],
  ["yes", ["j", "ˈ", "ɛ", "s"]],
  ["water", ["w", "ˈ", "ɔ", "ː", "ɾ", "ɚ"]],
  ["toy", ["t", "ˈ", "ɔ", "ɪ"]],
  ["hair", ["h", "ˈ", "ɛ", "ɹ"]],
  ["jail", ["d", "ʒ", "ˈ", "e", "ɪ", "l"]],
  ["huge", ["h", "j", "ˈ", "u", "ː", "d", "ʒ"]],
];

const ALL_MEASURED: readonly string[] = [
  ...MEASURED_SENTENCE,
  ...MEASURED_WORDS.flatMap(([, ph]) => ph),
];

test("the table covers every phoneme the pinned TTS actually emits", () => {
  const uncovered = [...new Set(ALL_MEASURED)].filter(
    (p) => !isCarryPhoneme(p) && phonemeToViseme(p) === "rest",
  );
  assert.deepEqual(
    uncovered,
    [],
    `these fall through to "rest" (drawn as a CLOSED mouth): ${uncovered
      .map((p) => JSON.stringify(p))
      .join(" ")}`,
  );
  assert.equal(visemeTableCoverage(ALL_MEASURED), 1);
});

test("MUTATION: gutting the table back to ASCII makes coverage collapse", () => {
  // The exact regression that shipped: 13 plain-ASCII keys against an IPA
  // stream. If this ever stops failing, the coverage assertion above has
  // stopped being able to detect the bug it exists to catch.
  const ASCII_ONLY: Readonly<Record<string, VisemeId>> = {
    a: "ai", e: "ai", i: "ee", o: "oh", u: "oh",
    b: "mm", m: "mm", p: "mm", f: "mm", v: "mm", w: "mm",
    aa: "wide", ae: "wide",
  };
  const before = visemeTableCoverage(MEASURED_SENTENCE, ASCII_ONLY);
  // Measured on the real capture: 6 of 48 spans mapped, the rest went to
  // "rest". Carry marks are excused by visemeTableCoverage, so the number
  // lands a little above 6/48 — it must still be nowhere near covered.
  assert.ok(
    before < 0.5,
    `the old table should leave most of the sentence shapeless, got ${before}`,
  );
  assert.equal(visemeTableCoverage(MEASURED_SENTENCE), 1, "the shipped table covers it");
});

test("a spoken word produces more than one mouth shape", () => {
  // The failure mode was not "wrong shape" but "one shape forever".
  for (const [word, phonemes] of MEASURED_WORDS) {
    const shapes = new Set(
      phonemes.filter((p) => !isCarryPhoneme(p)).map((p) => phonemeToViseme(p)),
    );
    assert.ok(
      shapes.size >= 2,
      `"${word}" renders as a single mouth shape (${[...shapes].join(",")})`,
    );
  }
});

test("the whole sentence is never parked closed while sound is playing", () => {
  const spans = MEASURED_SENTENCE.map((phoneme, i) => ({
    phoneme,
    startSec: i * 0.06,
    endSec: (i + 1) * 0.06,
  }));
  const events = visemeEventsFromTimings(spans);
  assert.equal(events.length, spans.length, "no span was silently dropped");
  const closed = events.filter((e) => e.viseme === "closed" || e.viseme === "rest");
  // Only the comma and the full stop are silence in this sentence.
  assert.equal(closed.length, 2, "only real punctuation closes the mouth");
});

test("stress and length marks inherit a shape instead of forcing one", () => {
  // "day" = d ˈ e ɪ — the stress mark sits between the consonant and its
  // vowel. Given a shape of its own it snaps the jaw shut mid-syllable.
  const spans = ["d", "ˈ", "e", "ɪ"].map((phoneme, i) => ({
    phoneme,
    startSec: i * 0.05,
    endSec: (i + 1) * 0.05,
  }));
  const events = visemeEventsFromTimings(spans);
  assert.equal(events[1].viseme, events[0].viseme, "the stress mark held the shape behind it");
  assert.notEqual(events[1].viseme, "rest");

  // "she" = ʃ i ː — the length mark trails the vowel it prolongs.
  const she = ["ʃ", "i", "ː"].map((phoneme, i) => ({
    phoneme,
    startSec: i * 0.05,
    endSec: (i + 1) * 0.05,
  }));
  const heldE = visemeEventsFromTimings(she);
  assert.equal(heldE[2].viseme, heldE[1].viseme, "the length mark prolonged the vowel's shape");
});

test("an utterance-opening mark looks forward to the first real shape", () => {
  const spans = ["ˈ", "æ", "t"].map((phoneme, i) => ({
    phoneme,
    startSec: i * 0.05,
    endSec: (i + 1) * 0.05,
  }));
  const events = visemeEventsFromTimings(spans);
  assert.equal(events[0].viseme, "wide", "the leading stress mark took the vowel's shape");
});

test("every carry mark is absent from the shape table", () => {
  // A mark in both places would be ambiguous: the table would win in
  // per-span mapping and the carry logic in batch mapping.
  for (const mark of CARRY_VISEME_PHONEMES) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(DEFAULT_PHONEME_TO_VISEME, mark),
      false,
      `${JSON.stringify(mark)} is both a carry mark and a table entry`,
    );
  }
});

test("the scheduler drives a changing mouth across a real utterance", () => {
  // End to end through the object the renderer actually polls.
  let t = 0;
  const scheduler = new VisemeScheduler({ clock: { now: () => t } });
  scheduler.start(
    MEASURED_SENTENCE.map((phoneme, i) => ({
      phoneme,
      startSec: i * 0.06,
      endSec: (i + 1) * 0.06,
    })),
  );
  const seen = new Set<string>();
  for (let ms = 0; ms < MEASURED_SENTENCE.length * 60; ms += 16) {
    t = ms;
    seen.add(scheduler.visemeAt(ms));
  }
  assert.ok(
    seen.size >= 3,
    `the mouth only ever showed ${[...seen].join(",")} across the utterance`,
  );
  assert.ok(seen.has("wide") || seen.has("oh"), "an open vowel shape was reached");
});

test("a word gap does not slam the mouth shut", () => {
  assert.notEqual(phonemeToViseme(" "), "rest");
  assert.notEqual(phonemeToViseme(" "), "closed");
});

test("unknown phonemes still degrade to rest rather than throwing", () => {
  assert.equal(phonemeToViseme(" not-a-phoneme"), "rest");
  assert.equal(phonemeToViseme(""), "rest");
});
