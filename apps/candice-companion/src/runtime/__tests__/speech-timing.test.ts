/**
 * FIX-016 speech-timing channel tests.
 *
 * Proves the webview half of the TTS timing channel: payload parsing
 * rejects malformed traffic, and the channel feeds the WS-12
 * `VisemeScheduler` from native speech-start/boundary/drain events.
 * The Tauri event API is stubbed with a tiny in-memory emitter, so the
 * tests run with zero deps on Node >= 22.6 (node:test + TS
 * type-stripping), same convention as the WS-12 suite.
 *
 *   node --test --experimental-strip-types \
 *     apps/candice-companion/src/runtime/__tests__/speech-timing.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { VisemeScheduler } from "../../animation/viseme/scheduler.ts";
import type { Clock } from "../../animation/viseme/types.ts";
import {
  attachSpeechTimingChannel,
  parseSpeechMarker,
  parseSpeechStart,
  SPEECH_BOUNDARY_EVENT,
  SPEECH_DRAIN_EVENT,
  SPEECH_START_EVENT,
  SPEECH_TIMING_SCHEMA_VERSION,
  type SpeechTimingChannel,
  type SpeechTimingListenApi,
} from "../speech-timing.ts";

// ------------------------------------------------------------------ helpers

class FakeClock implements Clock {
  t = 0;
  now(): number {
    return this.t;
  }
}

interface FakeListenApi extends SpeechTimingListenApi {
  handlers: Map<string, Array<(event: { payload: unknown }) => void>>;
}

function createFakeListenApi(): FakeListenApi {
  const handlers = new Map<string, Array<(event: { payload: unknown }) => void>>();
  return {
    handlers,
    listen(event, handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return Promise.resolve(() => {
        const current = handlers.get(event) ?? [];
        const index = current.indexOf(handler);
        if (index >= 0) current.splice(index, 1);
      });
    },
  };
}

function emit(api: FakeListenApi, event: string, payload: unknown): void {
  for (const handler of api.handlers.get(event) ?? []) {
    handler({ payload });
  }
}

// Real espeak-ng IPA. The channel test below asserts "ai" for the first
// span, and schwa is what the pinned TTS actually emits for that shape.
const TIMINGS = [
  { phoneme: "ə", startSec: 0.1, endSec: 0.2 },
  { phoneme: "o", startSec: 0.3, endSec: 0.4 },
  { phoneme: "m", startSec: 0.4, endSec: 0.5 },
];

interface PayloadShape {
  schemaVersion: string;
  utteranceId: string;
  timings: Array<{ phoneme: string; startSec: number; endSec: number }>;
}

function startPayload(
  utteranceId = "engine-42",
  timings: Array<{ phoneme: string; startSec: number; endSec: number }> = TIMINGS,
): PayloadShape {
  return { schemaVersion: SPEECH_TIMING_SCHEMA_VERSION, utteranceId, timings };
}

function markerPayload(utteranceId = "engine-42"): Omit<PayloadShape, "timings"> {
  return { schemaVersion: SPEECH_TIMING_SCHEMA_VERSION, utteranceId };
}

async function channelWith(
  api: FakeListenApi,
  clock: FakeClock,
): Promise<{ channel: SpeechTimingChannel; scheduler: VisemeScheduler }> {
  const scheduler = new VisemeScheduler({ clock });
  const channel = await attachSpeechTimingChannel(scheduler, { listenApi: api });
  return { channel, scheduler };
}

// ------------------------------------------------------------------ parsing

test("parseSpeechStart accepts a valid payload and rejects malformed traffic", () => {
  const parsed = parseSpeechStart(startPayload());
  assert.ok(parsed);
  assert.equal(parsed.utteranceId, "engine-42");
  assert.equal(parsed.timings.length, 3);
  assert.equal(parsed.timings[0].phoneme, "ə");

  // The pinned voice emits IPA and separates words with a bare space. An
  // ASCII-only rule here silently starved the mouth of every vowel.
  const ipa = (phoneme: string) =>
    parseSpeechStart({ ...startPayload(), timings: [{ phoneme, startSec: 0.1, endSec: 0.2 }] });
  for (const p of ["ə", "æ", "ŋ", "ˈ", "ː", "ʃ", " "]) {
    assert.ok(ipa(p), `phoneme ${JSON.stringify(p)} must be accepted`);
  }
  // ...but control and format characters still must not be.
  assert.equal(ipa("a\u001b[31m"), null, "terminal escape");
  assert.equal(ipa("a‮b"), null, "bidi override");
  assert.equal(ipa("a​b"), null, "zero-width space");

  assert.equal(parseSpeechStart(null), null);
  assert.equal(parseSpeechStart("nope"), null);
  assert.equal(parseSpeechStart({ ...startPayload(), schemaVersion: "0.9" }), null);
  assert.equal(parseSpeechStart({ ...startPayload(), utteranceId: "" }), null);
  assert.equal(parseSpeechStart({ ...startPayload(), utteranceId: "bad\nid" }), null);
  assert.equal(parseSpeechStart({ ...startPayload(), timings: "nope" }), null);
  assert.equal(parseSpeechStart({ ...startPayload(), timings: [{ phoneme: "a", startSec: 0.2, endSec: 0.1 }] }), null);
  assert.equal(parseSpeechStart({ ...startPayload(), timings: [{ phoneme: "a", startSec: Number.NaN, endSec: 0.1 }] }), null);
  assert.equal(parseSpeechStart({ ...startPayload(), timings: [{ phoneme: "", startSec: 0.1, endSec: 0.2 }] }), null);
  assert.equal(parseSpeechStart({ ...startPayload(), timings: [{ phoneme: "a", startSec: -1, endSec: 0.1 }] }), null);
});

test("parseSpeechStart accepts an empty timing list (scheduler maps it to idle)", () => {
  const parsed = parseSpeechStart(startPayload("engine-42", []));
  assert.ok(parsed);
  assert.deepEqual(parsed.timings, []);
});

test("parseSpeechStart rejects an oversized timing burst", () => {
  const burst = Array.from({ length: 4097 }, (_, i) => ({
    phoneme: "a", startSec: i, endSec: i + 0.5,
  }));
  assert.equal(parseSpeechStart(startPayload("engine-42", burst)), null);
});

test("parseSpeechMarker accepts valid markers and rejects malformed traffic", () => {
  const parsed = parseSpeechMarker(markerPayload());
  assert.ok(parsed);
  assert.equal(parsed.utteranceId, "engine-42");

  assert.equal(parseSpeechMarker(null), null);
  assert.equal(parseSpeechMarker({ ...markerPayload(), schemaVersion: "0.9" }), null);
  assert.equal(parseSpeechMarker({ ...markerPayload(), utteranceId: "bad id" }), null);
  assert.equal(parseSpeechMarker({ ...markerPayload(), utteranceId: 42 }), null);
});

// ------------------------------------------------------------------ channel

test("channel feeds speech-start timings into the scheduler", async () => {
  const api = createFakeListenApi();
  const clock = new FakeClock();
  clock.t = 10_000;
  const { channel, scheduler } = await channelWith(api, clock);

  assert.equal(channel.listening, true);
  assert.equal(channel.activeUtteranceId, null);
  assert.equal(scheduler.active, false);

  emit(api, SPEECH_START_EVENT, startPayload());
  assert.equal(channel.activeUtteranceId, "engine-42");
  assert.equal(scheduler.active, true);
  // The scheduler's lead (60 ms) puts the first viseme in place before
  // the audio span at 10_100 ms; the second span (0.3-0.4 s) leads into
  // "oh" at 10_240 ms, leaving a 40 ms "rest" gap between the two.
  assert.equal(scheduler.visemeAt(10_050), "ai");
  assert.equal(scheduler.visemeAt(10_150), "ai");
  assert.equal(scheduler.visemeAt(10_200), "rest");
  assert.equal(scheduler.visemeAt(10_250), "oh");
  assert.equal(scheduler.visemeAt(10_350), "oh");
});

test("channel ignores malformed events and never throws", async () => {
  const api = createFakeListenApi();
  const clock = new FakeClock();
  clock.t = 10_000;
  const { channel, scheduler } = await channelWith(api, clock);

  emit(api, SPEECH_START_EVENT, { schemaVersion: "0.9", utteranceId: "x", timings: [] });
  emit(api, SPEECH_START_EVENT, null);
  emit(api, SPEECH_BOUNDARY_EVENT, { schemaVersion: SPEECH_TIMING_SCHEMA_VERSION, utteranceId: "" });
  emit(api, SPEECH_DRAIN_EVENT, "garbage");
  assert.equal(channel.activeUtteranceId, null);
  assert.equal(scheduler.active, false);
});

test("speech-boundary stops the current utterance", async () => {
  const api = createFakeListenApi();
  const clock = new FakeClock();
  clock.t = 10_000;
  const { channel, scheduler } = await channelWith(api, clock);

  emit(api, SPEECH_START_EVENT, startPayload());
  assert.equal(scheduler.active, true);
  emit(api, SPEECH_BOUNDARY_EVENT, markerPayload());
  assert.equal(channel.activeUtteranceId, null);
  assert.equal(scheduler.active, false);
  assert.equal(scheduler.visemeAt(10_150), "closed");
});

test("speech-drain stops the current utterance and returns the mouth to closed", async () => {
  const api = createFakeListenApi();
  const clock = new FakeClock();
  clock.t = 10_000;
  const { channel, scheduler } = await channelWith(api, clock);

  emit(api, SPEECH_START_EVENT, startPayload());
  assert.equal(scheduler.active, true);
  emit(api, SPEECH_DRAIN_EVENT, markerPayload());
  assert.equal(channel.activeUtteranceId, null);
  assert.equal(scheduler.active, false);
  assert.equal(scheduler.visemeAt(10_150), "closed");
});

test("a stale marker for a different utterance is ignored", async () => {
  const api = createFakeListenApi();
  const clock = new FakeClock();
  clock.t = 10_000;
  const { channel, scheduler } = await channelWith(api, clock);

  emit(api, SPEECH_START_EVENT, startPayload("engine-42"));
  emit(api, SPEECH_DRAIN_EVENT, markerPayload("engine-99"));
  assert.equal(channel.activeUtteranceId, "engine-42");
  assert.equal(scheduler.active, true);
});

test("a new speech-start replaces the current utterance", async () => {
  const api = createFakeListenApi();
  const clock = new FakeClock();
  clock.t = 10_000;
  const { channel, scheduler } = await channelWith(api, clock);

  emit(api, SPEECH_START_EVENT, startPayload("engine-42"));
  emit(api, SPEECH_START_EVENT, startPayload("engine-43", [
    { phoneme: "i", startSec: 0.0, endSec: 0.1 },
  ]));
  assert.equal(channel.activeUtteranceId, "engine-43");
  assert.equal(scheduler.active, true);
  assert.equal(scheduler.visemeAt(10_000), "ee");
});

test("dispose detaches listeners and stops the scheduler", async () => {
  const api = createFakeListenApi();
  const clock = new FakeClock();
  clock.t = 10_000;
  const { channel, scheduler } = await channelWith(api, clock);

  emit(api, SPEECH_START_EVENT, startPayload());
  assert.equal(scheduler.active, true);
  channel.dispose();
  assert.equal(channel.listening, false);
  assert.equal(channel.activeUtteranceId, null);
  assert.equal(scheduler.active, false);

  // Late events after dispose must not re-arm the scheduler.
  emit(api, SPEECH_START_EVENT, startPayload("engine-44"));
  assert.equal(scheduler.active, false);
  assert.equal(channel.activeUtteranceId, null);

  // Double dispose is a no-op.
  channel.dispose();
  assert.equal(channel.listening, false);
});

test("channel stays inert when the Tauri event API is absent", async () => {
  const clock = new FakeClock();
  clock.t = 10_000;
  const scheduler = new VisemeScheduler({ clock });
  const channel = await attachSpeechTimingChannel(scheduler);
  assert.equal(channel.listening, false);
  assert.equal(channel.activeUtteranceId, null);
  assert.equal(scheduler.active, false);
  channel.dispose();
});
