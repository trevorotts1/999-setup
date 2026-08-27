/**
 * End-to-end guard for the dead-mouth bug, driven by REAL TTS output.
 *
 * The fixture beside this file was captured from the shipped worker, not
 * written by hand. That distinction is the whole point: every unit test in
 * this lane passed while lip sync was completely dead in the packaged app,
 * because every one of them was written in an alphabet the voice engine
 * does not emit.
 *
 * Measured on that capture before the fix:
 *   - 48 spans left the TTS
 *   - 28 were silently dropped by `filter_map` in engines.rs (ASCII rule)
 *   - of the 20 that survived, the phoneme table drew a CLOSED mouth for 17
 *
 * A frame-difference measurement of the packaged app agreed: the mouth
 * region moved 1.01x as much as a cheek patch of the same size, i.e. only
 * global drift. The cutout never swapped.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  SPEECH_TIMING_SCHEMA_VERSION,
  parseSpeechStart,
} from "../speech-timing.ts";
import { VisemeScheduler } from "../../animation/viseme/scheduler.ts";
import { phonemeToViseme, isCarryPhoneme } from "../../animation/viseme/mapping.ts";

const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/kokoro-real-utterance.json", import.meta.url)),
    "utf8",
  ),
) as { timings: Array<{ phoneme: string; startSec: number; endSec: number }> };

/**
 * What the FRONTEND actually receives.
 *
 * The fixture is raw worker output. `engines.rs` forwards spans through a
 * `filter_map` that drops non-positive durations, and real Kokoro output
 * ends on a zero-length span for the closing full stop. Modelling that here
 * keeps the fixture honest (it stays verbatim TTS output) while testing the
 * payload the parser is actually handed.
 */
const DROPPED_BY_ENGINE = FIXTURE.timings.filter((t) => t.endSec <= t.startSec);
const REAL_TIMINGS = FIXTURE.timings.filter((t) => t.endSec > t.startSec);

test("the engine drops exactly the trailing zero-length span", () => {
  // Pinned so a change in what the TTS emits surfaces here rather than as a
  // mysteriously quiet mouth.
  assert.equal(DROPPED_BY_ENGINE.length, 1, "expected one non-positive span");
  assert.equal(DROPPED_BY_ENGINE[0].phoneme, ".");
  assert.equal(REAL_TIMINGS.length, FIXTURE.timings.length - 1);
});

function payload(timings = REAL_TIMINGS) {
  return {
    schemaVersion: SPEECH_TIMING_SCHEMA_VERSION,
    utteranceId: "engine-42",
    timings,
  };
}

test("the parser accepts a real captured utterance whole", () => {
  const parsed = parseSpeechStart(payload());
  assert.ok(parsed, "parseSpeechStart rejected genuine TTS output");
  assert.equal(
    parsed.timings.length,
    REAL_TIMINGS.length,
    "spans were lost between the engine and the scheduler",
  );
});

test("CONTROL: the parser still rejects the malformed shapes it always did", () => {
  // Without this, the test above could pass because validation was gutted
  // rather than corrected.
  assert.equal(parseSpeechStart(null), null);
  assert.equal(parseSpeechStart({ ...payload(), schemaVersion: "0.9" }), null);
  assert.equal(parseSpeechStart({ ...payload(), utteranceId: "bad id" }), null);
  assert.equal(
    parseSpeechStart({ ...payload(), timings: [{ phoneme: "a[31m", startSec: 0, endSec: 0.1 }] }),
    null,
    "a terminal escape must not pass as a phoneme",
  );
  assert.equal(
    parseSpeechStart({ ...payload(), timings: [{ phoneme: "a‮b", startSec: 0, endSec: 0.1 }] }),
    null,
    "a bidi override must not pass as a phoneme",
  );
  assert.equal(
    parseSpeechStart({ ...payload(), timings: [{ phoneme: "a", startSec: 0.2, endSec: 0.1 }] }),
    null,
  );
});

test("every span of a real utterance resolves to a mouth shape", () => {
  const shapeless = REAL_TIMINGS.filter(
    (t) => !isCarryPhoneme(t.phoneme) && phonemeToViseme(t.phoneme) === "rest",
  ).map((t) => t.phoneme);
  assert.deepEqual(shapeless, [], `spans with no mouth shape: ${shapeless.join(" ")}`);
});

test("the mouth is open for most of a real utterance, not shut", () => {
  // The regression drew a closed mouth for 85% of the forwarded audio. The
  // bar here is deliberately about the OUTCOME a viewer sees, not about
  // which table entry fired.
  const parsed = parseSpeechStart(payload());
  assert.ok(parsed);

  let t = 0;
  const scheduler = new VisemeScheduler({ clock: { now: () => t } });
  scheduler.start(parsed.timings);

  const endMs = Math.max(...REAL_TIMINGS.map((x) => x.endSec)) * 1000;
  const counts = new Map<string, number>();
  let samples = 0;
  for (let ms = 0; ms < endMs; ms += 16) {
    t = ms;
    const v = scheduler.visemeAt(ms);
    counts.set(v, (counts.get(v) ?? 0) + 1);
    samples += 1;
  }

  // "mm" is a real shape but renders on the same closed cutout, so it
  // counts as shut for the purpose of "does this face look alive".
  const shut =
    (counts.get("closed") ?? 0) + (counts.get("rest") ?? 0) + (counts.get("mm") ?? 0);
  const openFraction = 1 - shut / samples;
  assert.ok(
    openFraction > 0.6,
    `mouth open only ${(openFraction * 100).toFixed(0)}% of the utterance ` +
      `(${[...counts].map(([k, v]) => `${k}:${v}`).join(" ")})`,
  );
});

test("the mouth reaches several distinct shapes across a real utterance", () => {
  const parsed = parseSpeechStart(payload());
  assert.ok(parsed);
  let t = 0;
  const scheduler = new VisemeScheduler({ clock: { now: () => t } });
  scheduler.start(parsed.timings);
  const endMs = Math.max(...REAL_TIMINGS.map((x) => x.endSec)) * 1000;
  const seen = new Set<string>();
  for (let ms = 0; ms < endMs; ms += 16) {
    t = ms;
    seen.add(scheduler.visemeAt(ms));
  }
  assert.ok(
    seen.size >= 4,
    `only ${seen.size} shapes across the whole sentence: ${[...seen].join(",")}`,
  );
});

test("the fixture is genuine espeak-ng IPA, not ASCII stand-ins", () => {
  // If someone "fixes" a future failure by rewriting the fixture into ASCII,
  // these tests would go green while shipping a dead mouth again. That is
  // precisely how this bug survived its own test suite.
  const nonAscii = REAL_TIMINGS.filter((t) => /[^\x21-\x7e]/.test(t.phoneme));
  assert.ok(
    nonAscii.length > 20,
    `fixture has only ${nonAscii.length} non-ASCII spans; it is no longer real TTS output`,
  );
});
