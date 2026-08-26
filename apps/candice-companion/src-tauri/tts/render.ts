/**
 * Candice TTS render orchestration (WS-19).
 *
 * Text -> 24 kHz PCM through the pinned Kokoro runtime; phoneme timings are
 * passed through for viseme synchronization (WS-12). Fallback ladder per
 * Master Spec section 20: Kokoro -> system TTS -> captions only.
 */

import type { PhonemeTiming, RenderedSpeech, TtsErrorReason, VoiceSelection } from "./types.ts";
import type { KokoroEngine } from "./index.ts";
import { speakWithSystemTts } from "./fallback.ts";

export interface RenderRequest {
  text: string;
  selection: VoiceSelection;
  withTimings: boolean;
  /** Abort when the user presses PTT while Candice speaks (WS-20). */
  signal?: AbortSignal;
}

export interface RenderOutcome {
  speech: RenderedSpeech | null;
  /** One of the section 20 ladder rungs actually used. */
  rung: "kokoro" | "system-tts" | "captions-only";
  reason?: TtsErrorReason;
}

/**
 * Render an utterance. Never throws for model/runtime failures — it falls
 * back down the ladder so Candice speech can never block the user's project
 * (Master Spec section 20).
 */
export async function renderSpeech(
  engine: KokoroEngine,
  request: RenderRequest,
): Promise<RenderOutcome> {
  if (request.signal?.aborted) {
    return { speech: null, rung: "captions-only", reason: "interrupted" };
  }

  try {
    if (!engine.running) {
      await engine.start();
    }
    const speech = await engine.synthesize(
      request.text,
      request.selection.voiceId,
      request.selection.speed,
    );
    return { speech, rung: "kokoro" };
  } catch {
    // Kokoro unavailable -> system TTS fallback (never canonical voice).
    const fallback = await speakWithSystemTts(request.text);
    if (fallback.ok) {
      return { speech: null, rung: "system-tts" };
    }
    return { speech: null, rung: "captions-only", reason: fallback.reason };
  }
}

/**
 * Voice-identity guard: the canonical Candice voice must be the same on
 * macOS and Windows. The voice id resolves inside the single pinned voicepack
 * (voices-v1.0.bin) on both platforms — byte-identical asset, same id, same
 * identity. This assertion documents that invariant at the render seam.
 */
export function assertCanonicalVoiceInvariant(selection: VoiceSelection): void {
  if (!selection.voiceId.startsWith("af_") && selection.voiceId !== "af_heart") {
    // Unknown voices are rejected by resolveVoiceSelection; reaching here with
    // a non-catalog voice id means a preference/config corruption.
    throw new Error(`voice-id-out-of-catalog: ${selection.voiceId}`);
  }
}

/** Normalize engine timings to the shared contract (defensive). */
export function normalizeTimings(raw: unknown): PhonemeTiming[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const out: PhonemeTiming[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as PhonemeTiming).phoneme === "string" &&
      typeof (item as PhonemeTiming).startSec === "number" &&
      typeof (item as PhonemeTiming).endSec === "number"
    ) {
      out.push(item as PhonemeTiming);
    }
  }
  return out.length > 0 ? out : undefined;
}
