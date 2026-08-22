/**
 * Candice TTS shared types (WS-19).
 *
 * These types form the stable bridge/UI contract for speech output. Per Master
 * Spec section 7, voicepack/version replacement must never change this contract.
 */

/** Sample rate produced by the pinned Kokoro runtime (kokoro-onnx SAMPLE_RATE). */
export const KOKORO_SAMPLE_RATE = 24000;

/** One phoneme span inside synthesized audio (viseme sync input for WS-12). */
export interface PhonemeTiming {
  phoneme: string;
  startSec: number;
  endSec: number;
}

/** A rendered utterance: float32 PCM at KOKORO_SAMPLE_RATE plus optional timings. */
export interface RenderedSpeech {
  /** Float32 PCM samples, one channel, KOKORO_SAMPLE_RATE Hz. */
  pcm: Float32Array;
  sampleRate: number;
  /** Phoneme-level timings when the runtime exposes them (viseme input). */
  timings?: PhonemeTiming[];
}

/** Speech output event emitted by the TTS lane to the state machine / UI. */
export type TtsEvent =
  | { type: "speech-start"; utteranceId: string }
  | { type: "speech-chunk"; utteranceId: string; pcm: Float32Array; sampleRate: number }
  | { type: "speech-end"; utteranceId: string }
  | { type: "speech-error"; utteranceId: string; reason: TtsErrorReason };

/** Why speech failed; maps to the Master Spec section 20 fallback ladder. */
export type TtsErrorReason =
  | "model-missing"
  | "model-corrupt"
  | "runtime-unavailable"
  | "engine-unavailable"
  | "interrupted";

/** Result of one text -> speech request. */
export interface TtsResult {
  utteranceId: string;
  speech: RenderedSpeech | null;
  /** True when system speech synthesis was used (fallback, never canonical). */
  usedFallback: boolean;
  error?: TtsErrorReason;
}

/** Versioned voice selection, held in preferences (WS-40) and replaceable. */
export interface VoiceSelection {
  /** Canonical voice id, e.g. "af_heart". Kept in config, never a code constant. */
  voiceId: string;
  /** Voicepack release tag the voice id refers to, e.g. "model-files-v1.1". */
  voicepackRelease: string;
  /** Model variant: "fp16" (canonical) or "int8" (low-end CPU fallback). */
  modelVariant: "fp16" | "int8";
  speed: number;
}
