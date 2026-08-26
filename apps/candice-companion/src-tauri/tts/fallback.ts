/**
 * Candice system-TTS fallback (WS-19).
 *
 * Used ONLY when the Kokoro runtime is unavailable (Master Spec section 20:
 * "Kokoro fails -> use system TTS if available; otherwise captions only").
 * System speech is never the canonical Candice voice; callers must keep the
 * fallback flag visible in the UI contract (RenderedSpeech consumers show
 * captions regardless of voice state, section 14 acceptance).
 */

import type { RenderedSpeech, TtsErrorReason } from "./types.ts";

/**
 * True when the host OS exposes a usable speech synthesizer.
 *
 * Platform adapters (WR-015 macos / WR-016 windows) own the exact OS calls:
 * macOS NSSpeechSynthesizer / AVSpeechSynthesizer via Tauri command,
 * Windows SAPI via PowerShell. Until an adapter has registered itself this
 * returns false, so the fallback ladder degrades to captions-only — the
 * section 20 lowest rung. Never report capability that is not wired.
 */
export function isSystemTtsAvailable(): boolean {
  return false;
}

export interface SystemTtsOptions {
  onChunk?: (pcm: Float32Array, sampleRate: number) => void;
}

/**
 * Speak via the host OS synthesizer. Returns null when the OS has no
 * synthesizer; the caller then falls through to captions-only mode.
 */
export async function speakWithSystemTts(
  text: string,
  _options: SystemTtsOptions = {},
): Promise<{ ok: true; usedFallback: true } | { ok: false; reason: TtsErrorReason }> {
  if (!isSystemTtsAvailable()) {
    return { ok: false, reason: "engine-unavailable" };
  }
  // Platform adapter dispatch happens here once WR-015/WR-016 land.
  // Until then isSystemTtsAvailable() is false and callers fall through
  // to captions-only — system TTS is fallback, never the canonical voice.
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
