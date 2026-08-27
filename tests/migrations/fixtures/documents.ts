/**
 * WS-34 migration fixtures (CHECKLIST E.1 WS-34: "schema bumps migrate
 * without data loss"; spec 27 migration fixtures).
 *
 * Every fixture is a REAL document the store can hold at its version:
 *   - v2 is the WR-010 protocol contract shape (field names aligned);
 *   - v3 is the restructured shape (nameAsked object);
 *   - the v1 fixtures are shared with the WS-40 lane
 *     (`apps/candice-companion/tests/prefs/fixtures/profiles.ts`) — the
 *     migration chain consumes those REAL v1 documents, not a copy.
 *
 * The "expected" fixtures pin the migration output byte-for-byte on every
 * field: a step that renames, drops, or floats a value fails a test.
 */

/** A real v2 document: full profile, WR-010 contract names. */
export const FIXTURE_V2_FULL = {
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
} as const;

/** A real v2 document: pre-name-ask (partial — nothing answered yet, no ask recorded). */
export const FIXTURE_V2_PARTIAL = {
  schemaVersion: 2,
  preferredName: null,
  voiceOutputEnabled: true,
  volume: 1,
  speechRate: 1,
  lastUsedAnswerMethod: null,
  textSize: 'medium',
  reducedMotion: null,
  companionScreenPosition: null,
  lastUsedSkill: null,
  nameAskedAt: null,
} as const;

/**
 * Expected v3 output for the v1 full fixture — differs from the v2-derived
 * expectation ONLY in `anchor`: v1 stored no anchor (companionPosition had
 * left/top only), so the migration defaults it to 'floating'. The v2-derived
 * 'right' is a real stored choice; the v1-derived 'floating' preserves the
 * v1 semantics (no bound-anchor choice was ever made).
 */
export const EXPECTED_V3_FROM_V1_FULL = {
  schemaVersion: 3,
  preferredName: 'Trevor',
  voiceOutputEnabled: false,
  volume: 0.7,
  speechRate: 1.2,
  lastUsedAnswerMethod: 'voice',
  textSize: 'large',
  reducedMotion: true,
  characterHidden: false,
  companionScreenPosition: { x: 12, y: 34, anchor: 'floating' },
  lastUsedSkill: 'kaizen',
  nameAsked: { askedAt: '2026-08-20T10:00:00.000Z' },
} as const;

/** Expected v3 output for FIXTURE_V2_FULL. */
export const EXPECTED_V3_FROM_V2_FULL = {
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
} as const;

/** Expected v3 output for FIXTURE_V2_PARTIAL (nameAskedAt null -> nameAsked null). */
export const EXPECTED_V3_FROM_V2_PARTIAL = {
  schemaVersion: 3,
  preferredName: null,
  voiceOutputEnabled: true,
  volume: 1,
  speechRate: 1,
  lastUsedAnswerMethod: null,
  textSize: 'medium',
  reducedMotion: null,
  characterHidden: false,
  companionScreenPosition: null,
  lastUsedSkill: null,
  nameAsked: null,
} as const;

/** v3 full profile — the current version. */
export const FIXTURE_V3_FULL = {
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
} as const;
