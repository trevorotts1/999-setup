/**
 * Candice canonical voice catalog (WS-19).
 *
 * The voice id is data, never a UI/bridge code constant. The canonical voice
 * for production is operator-approved (Master Spec section 7 late-bound gate).
 */

import {
  DEFAULT_CANONICAL_VOICE,
  KOKORO_VOICEPACK_RELEASE,
} from "./assets.ts";
import type { VoiceSelection } from "./types.ts";

/** Voices available in the pinned voicepack (54 voices; female American English shown). */
export const VOICE_CATALOG: Readonly<Record<string, { label: string }>> = {
  af_alloy: { label: "Alloy" },
  af_aoede: { label: "Aoede" },
  af_bella: { label: "Bella" },
  af_heart: { label: "Heart" },
  af_jessica: { label: "Jessica" },
  af_kore: { label: "Kore" },
  af_nicole: { label: "Nicole" },
  af_nova: { label: "Nova" },
  af_river: { label: "River" },
  af_sarah: { label: "Sarah" },
  af_sky: { label: "Sky" },
};

/**
 * Current canonical voice selection. Single write point for the operator
 * approval gate: change `voiceId` here (and the checksum row in assets.ts
 * when a new voicepack is pinned) — nothing else in the app changes.
 */
export const CANONICAL_VOICE: VoiceSelection = {
  voiceId: DEFAULT_CANONICAL_VOICE,
  voicepackRelease: KOKORO_VOICEPACK_RELEASE,
  modelVariant: "fp16",
  speed: 1.0,
};

export function isKnownVoice(voiceId: string): boolean {
  return voiceId in VOICE_CATALOG;
}

/** Resolve a stored preference to a selection, rejecting unknown voice ids. */
export function resolveVoiceSelection(voiceId: string): VoiceSelection {
  if (!isKnownVoice(voiceId)) {
    return { ...CANONICAL_VOICE };
  }
  return { ...CANONICAL_VOICE, voiceId };
}
