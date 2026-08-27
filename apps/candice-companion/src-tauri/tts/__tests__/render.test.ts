import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { KokoroEngine } from "../index.ts";
import {
  assertCanonicalVoiceInvariant,
  normalizeTimings,
  renderSpeech,
  type RenderOutcome,
} from "../render.ts";
import { KOKORO_SAMPLE_RATE } from "../types.ts";

function fakeEngine(overrides: Partial<KokoroEngine> = {}): KokoroEngine {
  return {
    running: true,
    start: async () => {},
    stop: async () => {},
    synthesize: async (text: string, voiceId: string, speed: number) => ({
      pcm: new Float32Array(2400),
      sampleRate: KOKORO_SAMPLE_RATE,
      timings: [{ phoneme: "h", startSec: 0.1, endSec: 0.2 }],
    }),
    ...overrides,
  };
}

describe("TTS render orchestration (WS-19)", () => {
  it("renders through Kokoro when the engine is healthy", async () => {
    const engine = fakeEngine();
    const calls: string[] = [];
    engine.synthesize = async (text, voiceId, speed) => {
      calls.push(`${text}|${voiceId}|${speed}`);
      return { pcm: new Float32Array(2400), sampleRate: KOKORO_SAMPLE_RATE };
    };
    const outcome = await renderSpeech(engine, {
      text: "hello",
      selection: { voiceId: "af_heart", voicepackRelease: "model-files-v1.1", modelVariant: "fp16", speed: 1.0 },
      withTimings: true,
    });
    assert.equal(outcome.rung, "kokoro");
    assert.ok(outcome.speech);
    assert.deepEqual(calls, ["hello|af_heart|1"]);
  });

  it("starts a stopped engine before synthesizing", async () => {
    let started = false;
    const engine = fakeEngine({ running: false });
    engine.start = async () => {
      started = true;
    };
    await renderSpeech(engine, {
      text: "hello",
      selection: { voiceId: "af_heart", voicepackRelease: "model-files-v1.1", modelVariant: "fp16", speed: 1.0 },
      withTimings: false,
    });
    assert.ok(started);
  });

  it("falls to captions-only when the engine fails (never throws)", async () => {
    const engine = fakeEngine({
      synthesize: async () => {
        throw new Error("boom");
      },
    });
    // FIX-015 FAIL-2: inject a false system-TTS probe so the ladder rung
    // is deterministic regardless of the host OS synthesizer.
    const outcome = await renderSpeech(engine, {
      text: "hello",
      selection: { voiceId: "af_heart", voicepackRelease: "model-files-v1.1", modelVariant: "fp16", speed: 1.0 },
      withTimings: false,
      systemTtsProbe: () => false,
    });
    assert.equal(outcome.rung, "captions-only");
    assert.equal(outcome.speech, null);
  });

  it("falls to system-tts rung when the engine fails and the OS synthesizer is available", async () => {
    const engine = fakeEngine({
      synthesize: async () => {
        throw new Error("boom");
      },
    });
    let spoken: string | null = null;
    const outcome = await renderSpeech(engine, {
      text: "hello",
      selection: { voiceId: "af_heart", voicepackRelease: "model-files-v1.1", modelVariant: "fp16", speed: 1.0 },
      withTimings: false,
      systemTtsProbe: () => true,
      systemTtsSpeaker: async (text) => {
        spoken = text;
        return true;
      },
    });
    assert.equal(outcome.rung, "system-tts");
    assert.equal(outcome.speech, null);
    assert.equal(spoken, "hello");
  });

  it("honors an aborted signal with interrupted reason", async () => {
    const engine = fakeEngine();
    const controller = new AbortController();
    controller.abort();
    const outcome = await renderSpeech(engine, {
      text: "hello",
      selection: { voiceId: "af_heart", voicepackRelease: "model-files-v1.1", modelVariant: "fp16", speed: 1.0 },
      withTimings: false,
      signal: controller.signal,
    });
    assert.deepEqual(outcome, {
      speech: null,
      rung: "captions-only",
      reason: "interrupted",
    } satisfies RenderOutcome);
  });

  it("assertCanonicalVoiceInvariant passes canonical af_ voices", () => {
    assertCanonicalVoiceInvariant({
      voiceId: "af_heart",
      voicepackRelease: "model-files-v1.1",
      modelVariant: "fp16",
      speed: 1.0,
    });
    assertCanonicalVoiceInvariant({
      voiceId: "af_sky",
      voicepackRelease: "model-files-v1.1",
      modelVariant: "fp16",
      speed: 1.0,
    });
  });

  it("assertCanonicalVoiceInvariant throws on non-af voice ids", () => {
    assert.throws(() =>
      assertCanonicalVoiceInvariant({
        voiceId: "am_adam",
        voicepackRelease: "model-files-v1.1",
        modelVariant: "fp16",
        speed: 1.0,
      }),
    );
  });

  it("normalizeTimings drops malformed entries, keeps valid ones", () => {
    const good = { phoneme: "h", startSec: 0.1, endSec: 0.2 };
    const bad = { phoneme: 42, startSec: "x", endSec: null };
    const normalized = normalizeTimings([good, bad, null, "junk"]);
    assert.deepEqual(normalized, [good]);
  });

  it("normalizeTimings returns undefined for empty or non-array input", () => {
    assert.equal(normalizeTimings(undefined), undefined);
    assert.equal(normalizeTimings("nope"), undefined);
    assert.equal(normalizeTimings([]), undefined);
  });
});
