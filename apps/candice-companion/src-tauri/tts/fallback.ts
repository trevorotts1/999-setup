/**
 * Candice system-TTS fallback (WS-19).
 *
 * Used ONLY when the Kokoro runtime is unavailable (Master Spec section 20:
 * "Kokoro fails -> use system TTS if available; otherwise captions only").
 * System speech is never the canonical Candice voice; callers must keep the
 * fallback flag visible in the UI contract (RenderedSpeech consumers show
 * captions regardless of voice state, section 14 acceptance).
 *
 * FIX-015 FAIL-2: capability is now REAL, not hardcoded. The default probe
 * runs the macOS `say` binary (exists + `--version` succeeds) and the
 * default speaker shells out to it; everywhere else (Windows until the
 * WR-016 SAPI adapter lands, Linux) the truthful answer stays false and
 * speech falls through to captions-only. Tests and platform adapters may
 * inject probe/speaker functions — the DI shape keeps the ladder
 * deterministic without a global registry.
 */

import { spawn, spawnSync } from "node:child_process";

import type { RenderedSpeech, TtsErrorReason } from "./types.ts";

/** Injected capability probe; defaults to the real macOS `say` check. */
export type SystemTtsProbe = () => boolean;

/** Injected speaker; returns true when the OS accepted the utterance. */
export type SystemTtsSpeaker = (text: string, options: SystemTtsOptions) => Promise<boolean>;

/**
 * Real macOS probe: `/usr/bin/say` must exist AND run. `say -v '?'` lists
 * installed voices — a read-only capability check: no audio, no TCC
 * prompt, no side effect. (macOS `say` has no `--version` flag.)
 * Non-darwin: false until a platform adapter injects a working probe.
 */
function defaultSystemTtsProbe(): boolean {
  if (process.platform !== "darwin") {
    return false;
  }
  try {
    const r = spawnSync("/usr/bin/say", ["-v", "?"], {
      encoding: "utf8",
      timeout: 5000,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

/** Real macOS speaker: the OS synthesizer renders and plays the text. */
function defaultSystemTtsSpeaker(text: string): Promise<boolean> {
  if (process.platform !== "darwin") {
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    const child = spawn("/usr/bin/say", [text], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    child.once("error", () => resolve(false));
    child.once("exit", (code) => resolve(code === 0));
  });
}

/**
 * True when the host OS exposes a usable speech synthesizer.
 *
 * A caller-provided probe (platform adapter) wins; otherwise the real
 * macOS `say` check runs. Never report capability that is not wired.
 */
export function isSystemTtsAvailable(probe?: SystemTtsProbe): boolean {
  return (probe ?? defaultSystemTtsProbe)();
}

export interface SystemTtsOptions {
  onChunk?: (pcm: Float32Array, sampleRate: number) => void;
  /** Injected capability probe (tests/platform adapters); defaults to the
   * real macOS `say` check. */
  probe?: SystemTtsProbe;
  /** Injected speaker (tests/platform adapters); defaults to macOS `say`. */
  speak?: SystemTtsSpeaker;
}

/**
 * Speak via the host OS synthesizer. Returns a labeled fallback failure
 * when the OS has no synthesizer; the caller then falls through to
 * captions-only mode. The macOS default renders through `say` (system
 * voice — never the canonical Kokoro voice).
 */
export async function speakWithSystemTts(
  text: string,
  options: SystemTtsOptions = {},
): Promise<{ ok: true; usedFallback: true } | { ok: false; reason: TtsErrorReason }> {
  if (!isSystemTtsAvailable(options.probe)) {
    return { ok: false, reason: "engine-unavailable" };
  }
  const speaker = options.speak ?? defaultSystemTtsSpeaker;
  const spoken = await speaker(text, options);
  if (!spoken) {
    return { ok: false, reason: "engine-unavailable" };
  }
  return { ok: true, usedFallback: true };
}

/** Convert RenderedSpeech to a playable buffer for the audio lane (WS-17/WS-20). */
export function speechToPlayable(speech: RenderedSpeech): {
  buffer: ArrayBuffer;
  sampleRate: number;
} {
  const pcm = speech.pcm;
  const int16 = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i += 1) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  const buffer = new ArrayBuffer(44 + bytes.length);
  const view = new DataView(buffer);

  // RIFF/WAVE header, 16-bit mono, KOKORO_SAMPLE_RATE
  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) {
      view.setUint8(offset + i, s.charCodeAt(i));
    }
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + bytes.length, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, speech.sampleRate, true);
  view.setUint32(28, speech.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, bytes.length, true);
  new Uint8Array(buffer, 44).set(bytes);
  return { buffer, sampleRate: speech.sampleRate };
}
