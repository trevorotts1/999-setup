/**
 * WS-47 — upgrade fixture documents (backward-compatibility fixtures).
 *
 * Every fixture is a REAL document a machine could hold when the new
 * Spec Protocol + Candice bootstrap arrives (Master Spec sections 9/21):
 *   - PRE_VERSIONED: a profile written before the version mechanism existed
 *     (no schemaVersion field at all). The migration chain must treat it as
 *     version 1 and migrate with defaults — never crash, never drop fields.
 *   - DIRTY_V1: the v1 store shape with out-of-range values (volume 99,
 *     speechRate 0.1, textScale -3) that the v1 normalization contract must
 *     repair before migration (WS-40 runtime guarantee, spec 20).
 *   - V1_FULL / V1_PARTIAL: the REAL v1 fixtures shared with the WS-40 lane
 *     (apps/candice-companion/tests/prefs/fixtures/profiles.ts) — pinned
 *     byte-for-byte through the chain.
 *   - PROTOCOL_DOC: the WR-010 protocol-contract shape written with the
 *     string schemaVersion "1.0" — must resolve to integer v2 semantics,
 *     never be misread as runtime v1 (which would drop its fields).
 *   - FUTURE_V9: a document a NEWER lane wrote (v9). An older lane must
 *     preserve it untouched and never persist it (spec 20).
 *   - V2_FULL: the v2 intermediate shape (WR-010 contract names) — the
 *     v2 -> v3 step must migrate it losslessly (nameAskedAt -> nameAsked).
 *
 * "Expected" fixtures pin migration output field-by-field.
 */

/** A profile written before the version mechanism existed (no schemaVersion). */
export const PRE_VERSIONED_V1 = {
  preferredName: 'Trevor',
  voiceOutputEnabled: true,
  volume: 0.7,
  speechRate: 1.0,
  lastAnswerMethod: 'voice',
  textScale: 1.1,
  reducedMotion: true,
  companionPosition: { left: 12, top: 34 },
  lastUsedSkill: 'kaizen',
};

/** v1 document with out-of-range values — v1 normalization must repair first. */
export const DIRTY_V1 = {
  schemaVersion: 1,
  preferredName: 'Trevor',
  volume: 99,
  speechRate: 0.1,
  textScale: -3,
  companionPosition: { left: 0, top: 0 },
};

/** Protocol-contract document written with the string "1.0" schemaVersion (WR-010 shape). */
export const PROTOCOL_DOC = {
  schemaVersion: '1.0',
  preferredName: 'Trevor',
  voiceOutputEnabled: false,
  volume: 0.7,
  speechRate: 1.2,
  lastUsedAnswerMethod: 'voice',
  textSize: 'large',
  reducedMotion: true,
  companionScreenPosition: { x: 12, y: 34, anchor: 'right' },
  lastUsedSkill: 'kaizen',
  nameAskedAt: '2026-08-20T10:00:00.000Z',
};

/** A document a NEWER lane wrote — an older lane must preserve it untouched. */
export const FUTURE_V9 = {
  schemaVersion: 9,
  preferredName: 'Newer',
  voiceOutputEnabled: true,
  volume: 0.5,
  speechRate: 1.4,
  lastUsedAnswerMethod: 'type',
  textSize: 'small',
  reducedMotion: false,
  companionScreenPosition: { x: 100, y: 200, anchor: 'floating' },
  lastUsedSkill: 'eli5',
  nameAsked: { askedAt: '2026-08-21T00:00:00.000Z', dismissedAt: null },
  futureField: 'written by a newer lane — must survive untouched',
};

/** A real v2 document (v2 -> v3 step input), WR-010 contract names. */
export const V2_FULL = {
  schemaVersion: 2,
  preferredName: 'Trevor',
  voiceOutputEnabled: false,
  volume: 0.7,
  speechRate: 1.2,
  lastUsedAnswerMethod: 'voice',
  textSize: 'large',
  reducedMotion: true,
  companionScreenPosition: { x: 12, y: 34, anchor: 'right' },
  lastUsedSkill: 'kaizen',
  nameAskedAt: '2026-08-20T10:00:00.000Z',
};

/** Byte-exact expected v3 output of V2_FULL (matches tests/migrations fixtures, WS-34-pinned). */
export const EXPECTED_V3_FROM_V2 = {
  schemaVersion: 3,
  preferredName: 'Trevor',
  voiceOutputEnabled: false,
  volume: 0.7,
  speechRate: 1.2,
  lastUsedAnswerMethod: 'voice',
  textSize: 'large',
  reducedMotion: true,
  characterHidden: false,
  companionScreenPosition: { x: 12, y: 34, anchor: 'right' },
  lastUsedSkill: 'kaizen',
  nameAsked: { askedAt: '2026-08-20T10:00:00.000Z' },
};
