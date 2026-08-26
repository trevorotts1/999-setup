import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isSystemTtsAvailable, speakWithSystemTts, speechToPlayable } from "../fallback.ts";
import { KOKORO_SAMPLE_RATE } from "../types.ts";

describe("system-TTS fallback (WS-19)", () => {
  it("reports unavailable until a platform adapter lands — never fabricates capability", () => {
    assert.equal(isSystemTtsAvailable(), false);
  });

  it("speakWithSystemTts fails closed to captions-only while unavailable", async () => {
    const result = await speakWithSystemTts("hello");
    assert.deepEqual(result, { ok: false, reason: "engine-unavailable" });
  });

  it("speechToPlayable writes a valid 16-bit mono WAV header", () => {
    const pcm = new Float32Array([0.0, 0.5, -0.5, 1.0, -1.0]);
    const { buffer, sampleRate } = speechToPlayable({ pcm, sampleRate: KOKORO_SAMPLE_RATE });
    assert.equal(sampleRate, KOKORO_SAMPLE_RATE);
    assert.equal(buffer.byteLength, 44 + pcm.length * 2);
    const view = new DataView(buffer);
    assert.equal(String.fromCharCode(...new Uint8Array(buffer, 0, 4)), "RIFF");
    assert.equal(String.fromCharCode(...new Uint8Array(buffer, 8, 4)), "WAVE");
    assert.equal(view.getUint32(4, true), 36 + pcm.length * 2);
    assert.equal(view.getUint32(24, true), KOKORO_SAMPLE_RATE);
    assert.equal(view.getUint32(40, true), pcm.length * 2);
  });

  it("speechToPlayable clamps and converts float32 to int16", () => {
    const pcm = new Float32Array([2.0, -2.0, 0.25]);
    const { buffer } = speechToPlayable({ pcm, sampleRate: KOKORO_SAMPLE_RATE });
    const samples = new Int16Array(buffer, 44);
    assert.equal(samples[0], 32767);
    assert.equal(samples[1], -32768);
    // Int16Array assignment truncates toward zero; the clamp path never rounds.
    assert.equal(samples[2], Math.trunc(0.25 * 0x7fff));
  });
});
