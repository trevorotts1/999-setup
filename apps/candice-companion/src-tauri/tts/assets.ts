/**
 * Candice TTS asset pins — versioned, checksummed, replaceable (WS-19).
 *
 * The canonical voice/voicepack is a configuration value here. Swapping it
 * (operator approval gate, Master Spec section 7) touches ONLY this file and
 * the checksum row; the bridge and UI contracts never change.
 *
 * All checksums verified by direct download on 2026-08-21.
 */

export interface TtsAssetPin {
  /** Stable local filename (no release-channel filenames in production code). */
  filename: string;
  /** SHA-256 of the exact pinned file. */
  sha256: string;
  /** Source URL the deterministic fetcher downloads from (operator-controlled release channel in production). */
  sourceUrl: string;
  /** Download size guard in bytes (refuse surprising sizes). */
  sizeBytes: number;
}

export const KOKORO_MODEL_FP16: TtsAssetPin = {
  filename: "kokoro-v1.0.fp16.onnx",
  sha256: "f3a290d384fbb27966d462905c71a46cef9e5fd00516b40df32a0b4afe77ac96",
  sourceUrl:
    "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.fp16.onnx",
  sizeBytes: 163527961,
};

export const KOKORO_MODEL_INT8: TtsAssetPin = {
  filename: "kokoro-v1.0.int8.onnx",
  sha256: "ae315a79b623f244700e4afb9246c46a26066782e049ba174bf3ba433970ee9c",
  sourceUrl:
    "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.int8.onnx",
  sizeBytes: 114119327,
};

export const KOKORO_VOICES_V1: TtsAssetPin = {
  filename: "voices-v1.0.bin",
  sha256: "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
  sourceUrl:
    "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin",
  sizeBytes: 28214398,
};

/** Runtime pins — same matrix proven on macOS arm64 and Windows amd64 (cp312 wheels). */
export const KOKORO_RUNTIME_PINS = {
  kokoroOnnx: "0.6.1",
  onnxruntime: "1.29.0",
  espeakngLoader: "0.2.4",
  python: "3.12",
} as const;

/** Voicepack release tag — every voice id below resolves inside this single file. */
export const KOKORO_VOICEPACK_RELEASE = "model-files-v1.1";

/**
 * Female American English voices in voices-v1.0.bin (prefix `af_`). Rendered
 * by scripts/render_candidates.py for the operator approval gate.
 */
export const CANONICAL_VOICE_CANDIDATES = [
  "af_alloy",
  "af_aoede",
  "af_bella",
  "af_heart",
  "af_jessica",
  "af_kore",
  "af_nicole",
  "af_nova",
  "af_river",
  "af_sarah",
  "af_sky",
] as const;

/**
 * DEFAULT_CANONICAL_VOICE — pre-approval default. Operator picks the final
 * canonical voice before production release (spec section 7 gate); changing
 * this value is a config change, not a contract change.
 */
export const DEFAULT_CANONICAL_VOICE = "af_heart";
