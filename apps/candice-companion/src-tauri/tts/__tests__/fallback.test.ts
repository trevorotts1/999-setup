import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isSystemTtsAvailable, speakWithSystemTts, speechToPlayable } from "../fallback.ts";
import { KOKORO_SAMPLE_RATE } from "../types.ts";

describe("system-TTS fallback (WS-19)", () => {
  it("injected probe is authoritative — never fabricates capability", () => {
    assert.equal(isSystemTtsAvailable(() => true), true);
    assert.equal(isSystemTtsAvailable(() => false), false);
  });

  it("default probe proves the real macOS say binary on darwin", () => {
    // Deterministic capability, not a mock: this suite runs on the
    // operator Mac; /usr/bin/say --version must succeed here (FAIL-2
    // evidence). On non-darwin hosts the truthful answer is false.
    const available = isSystemTtsAvailable();
    if (process.platform === "darwin") {
      assert.equal(available, true);
    } else {
      assert.equal(available, false);
    }
  });

  it("speakWithSystemTts fails closed to captions-only while unavailable", async () => {
    const result = await speakWithSystemTts("hello", {});
    if (process.platform === "darwin") {
      // Real say speaker: either the OS rendered the utterance or the
      // engine reported failure — never a fabricated ok.
      if (result.ok) {
        assert.equal(result.usedFallback, true);
      } else {
        assert.equal(result.reason, "engine-unavailable");
      }
    } else {
      assert.deepEqual(result, { ok: false, reason: "engine-unavailable" });
    }
  });

  it("injected probe + speaker keep the ladder deterministic", async () => {
    const calls: string[] = [];
    const ok = await speakWithSystemTts("hello", {
      speak: async (text) => {
        calls.push(text);
        return true;
      },
    });
    assert.deepEqual(ok, { ok: true, usedFallback: true });
    assert.deepEqual(calls, ["hello"]);

    const denied = await speakWithSystemTts("hello", {
      speak: async () => false,
    });
    assert.deepEqual(denied, { ok: false, reason: "engine-unavailable" });
  });

  it("unavailable probe short-circuits before any speaker runs", async () => {
    let spoke = false;
    const result = await speakWithSystemTts("hello", {
      probe: () => false,
      speak: async () => {
        spoke = true;
        return true;
      },
    });
    assert.deepEqual(result, { ok: false, reason: "engine-unavailable" });
    assert.equal(spoke, false);
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
