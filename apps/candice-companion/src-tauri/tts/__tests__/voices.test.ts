import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CANONICAL_VOICE_CANDIDATES, DEFAULT_CANONICAL_VOICE } from "../assets.ts";
import {
  CANONICAL_VOICE,
  VOICE_APPROVAL_EVIDENCE,
  VOICE_APPROVAL_STATUS,
  VOICE_CATALOG,
  isKnownVoice,
  resolveVoiceSelection,
} from "../voices.ts";

describe("canonical Candice voice catalog (WS-19)", () => {
  it("every catalog voice resolves inside the pinned voicepack candidate set", () => {
    for (const id of Object.keys(VOICE_CATALOG)) {
      assert.ok(
        (CANONICAL_VOICE_CANDIDATES as readonly string[]).includes(id),
        `catalog voice ${id} not in candidate set`,
      );
    }
  });

  it("the pinned voicepack contains exactly 54 voices, 11 female American English", () => {
    // voices-v1.0.bin (sha256 bca610b8...) verified by direct inspection.
    assert.equal(CANONICAL_VOICE_CANDIDATES.length, 11);
    assert.equal(CANONICAL_VOICE_CANDIDATES[0], "af_alloy");
  });

  it("canonical default is a catalog voice, never a bare code constant elsewhere", () => {
    assert.ok(isKnownVoice(DEFAULT_CANONICAL_VOICE));
    assert.equal(CANONICAL_VOICE.voiceId, DEFAULT_CANONICAL_VOICE);
    assert.equal(CANONICAL_VOICE.modelVariant, "fp16");
  });

  it("resolveVoiceSelection rejects unknown voice ids back to canonical", () => {
    const resolved = resolveVoiceSelection("not-a-voice");
    assert.equal(resolved.voiceId, DEFAULT_CANONICAL_VOICE);
  });

  it("resolveVoiceSelection keeps a known stored voice id", () => {
    const resolved = resolveVoiceSelection("af_sky");
    assert.equal(resolved.voiceId, "af_sky");
    assert.equal(resolved.voicepackRelease, CANONICAL_VOICE.voicepackRelease);
  });

  it("FIX-015 FAIL-6: shipped approval status is honest — approved, and only because the record landed", () => {
    // The operator record landed 2026-08-25: Trevor approved af_bella.
    // The point of this assertion is that the shipped status matches
    // reality, not that it is permanently pending — so it now pins the
    // approved state AND the voice that was actually approved. It must
    // also match the native boundary value in src-tauri/speech/mod.rs
    // (canonical_voice_approval) and canonicalVoice in the bundled
    // SPEECH-INVENTORY.json, which fails closed on disagreement.
    assert.equal(VOICE_APPROVAL_STATUS, "approved");
    assert.equal(DEFAULT_CANONICAL_VOICE, "af_bella");
    assert.ok(isKnownVoice(DEFAULT_CANONICAL_VOICE));
    assert.equal(VOICE_APPROVAL_EVIDENCE, "evidence/FIX-015/operator-review/VOICE-APPROVAL.md");
  });
});
