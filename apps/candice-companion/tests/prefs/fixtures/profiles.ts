/**
 * WS-40 / WS-34 fixture profiles (CHECKLIST WS-34: migration fixtures).
 *
 * Version-1 documents in three states a real store can hold:
 * - full: every preference field set (post-first-run user);
 * - partial: pre-name-ask document (the store wrote defaults, then the name
 *   question was asked but not yet answered);
 * - corrupt shape: a document with out-of-range values that normalization must
 *   repair without data loss of the valid fields.
 *
 * These fixtures are version-1 TODAY. When WR-010/WS-34 lands version 2, the
 * migration test in this lane consumes the v1 fixtures and proves the v1 -> v2
 * path with zero data loss — do not delete the v1 fixtures.
 */
export const FIXTURE_PROFILE_FULL_V1 = {
  schemaVersion: 1,
  preferredName: 'Trevor',
  voiceOutputEnabled: false,
  volume: 0.7,
  speechRate: 1.2,
  lastAnswerMethod: 'voice',
  textScale: 1.1,
  reducedMotion: true,
  companionPosition: { left: 12, top: 34 },
  lastUsedSkill: 'kaizen',
  nameAskedAt: '2026-08-20T10:00:00.000Z',
} as const;

export const FIXTURE_PROFILE_PARTIAL_V1 = {
  schemaVersion: 1,
  nameAskedAt: '2026-08-20T10:00:00.000Z',
} as const;

export const FIXTURE_PROFILE_DIRTY_V1 = {
  schemaVersion: 1,
  preferredName: 'Trevor',
  volume: 99,
  speechRate: 0.1,
  textScale: -3,
  companionPosition: { left: 0, top: 0 },
} as const;
