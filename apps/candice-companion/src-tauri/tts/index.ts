/**
 * Candice TTS runtime handle (WS-19).
 *
 * Lazy-loads the pinned Kokoro ONNX runtime (kokoro-onnx 0.6.1 over
 * onnxruntime 1.29.0). The engine is spawned as a subprocess (the Python
 * runtime is not part of the desktop app process); this handle owns its
 * lifecycle and exposes a stable contract to the state machine.
 *
 * Per Master Spec section 19: lazy-load speech engines, unload after idle.
 */

import type { RenderedSpeech, TtsEvent } from "./types.ts";

export interface KokoroEngineOptions {
  modelPath: string;
  voicesPath: string;
  /** "fp16" (canonical) or "int8" (low-end CPU fallback). */
  variant: "fp16" | "int8";
  /** Optional out: engine lifecycle events. */
  onEvent?: (event: TtsEvent) => void;
}

export interface KokoroEngine {
  /** True when the Python runtime process is alive. */
  readonly running: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Synthesize text -> PCM at 24 kHz. Throws on failure. */
  synthesize(text: string, voiceId: string, speed: number): Promise<RenderedSpeech>;
}

/**
 * Command-line contract shared with the Python runtime script. The bridge and
 * UI contract must not depend on anything else.
 */
export interface EngineCommand {
  kind: "synthesize";
  text: string;
  voiceId: string;
  speed: number;
  withTimings: boolean;
}

export interface EngineResult {
  ok: boolean;
  /** Base64 float32 PCM or a temp wav path when the transport is file-based. */
  pcmB64?: string;
  sampleRate?: number;
  timings?: Array<{ phoneme: string; startSec: number; endSec: number }>;
  error?: string;
}
