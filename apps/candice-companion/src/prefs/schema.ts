/**
 * Candice local preference profile — schema contract (Master Spec 0E WS-40, section 9).
 *
 * The profile is a SMALL, LOCAL, PER-USER preference store. It is NOT project or
 * conversation memory (Master Spec section 9): the active Claude skill/project
 * files remain the durable source of truth for project decisions and answers.
 * This module never reads or writes conversation content, question state, or
 * answers.
 *
 * Shape rules:
 * - The JSON Schema is written here so the schema and the runtime defaults live
 *   in the same lane. The canonical published schema remains
 *   `packages/candice-protocol/schemas/preferences.schema.json` (WR-010 lane);
 *   this lane consumes that contract at runtime and proposes changes through
 *   CROSS-LANE-FINDING, never by editing it.
 * - A single integer `schemaVersion` gates migrations (spec 9 "simple versioned
 *   JSON schema"; CHECKLIST WS-34). This lane ships version 1.
 * - Nullable optional fields keep the store valid after partial edits (e.g. the
 *   first-run name ask wrote the file before the user answered).
 * - Never store secrets, tokens, audio, or conversation content here.
 */

/**
 * Field names, shared with `packages/candice-protocol/schemas/preferences.schema.json`
 * (WR-010). If the WR-010 schema bumps, update MIGRATIONS for the delta.
 */
export const PREFS_FIELD_NAMES = [
  'schemaVersion',
  'preferredName',
  'voiceOutputEnabled',
  'volume',
  'speechRate',
  'lastAnswerMethod',
  'textScale',
  'reducedMotion',
  'companionPosition',
  'lastUsedSkill',
  'nameAskedAt',
] as const;

/** Local profile storage location helpers (spec 9 recommended locations). */
export const PREFS_DIR_OVERRIDE_ENV = 'CANDICE_PREFS_DIR';
export const PREFS_FILENAME = 'profile.json';
export const PREFS_LOCK_SUFFIX = '.lock';

/**
 * The newest schema version this lane understands. Bump together with the
 * matching MIGRATIONS entry; the store refuses to persist documents above it.
 */
export const LATEST_SCHEMA_VERSION = 1;

/**
 * The complete JSON document persisted at
 * `~/Library/Application Support/BlackCEO/999/Candice/profile.json` (macOS) or
 * `%LOCALAPPDATA%\BlackCEO\999\Candice\profile.json` (Windows).
 *
 * Any property may be absent when the user has not set it; every consumer must
 * fall back to DEFAULTS (this file), never to a guessed value.
 */
export interface CandiceProfile {
  /**
   * Schema version of the stored document. 1 = this contract. A stored
   * document with a NEWER version is loaded and kept at its own version in
   * memory, but the store refuses to persist it (spec 20: an older lane
   * must never silently downgrade or rewrite a document a newer lane owns).
   */
  schemaVersion: number;
  /**
   * The name the user chose, exactly as stored. Empty string or missing means
   * the name ask has not completed. NEVER inferred from the OS username
   * (spec 4 item 8) — this lane has no code path that reads the OS username.
   */
  preferredName?: string;
  /** Voice responses ON/OFF — a separate persistent preference, independent of answer method (spec 5.2). */
  voiceOutputEnabled?: boolean;
  /** TTS volume, 0..1. */
  volume?: number;
  /** TTS speech rate, 0.5..2. */
  speechRate?: number;
  /** Last-used answer method — a convenience that is never a lock (spec 5.1). */
  lastAnswerMethod?: 'voice' | 'typed' | 'terminal';
  /** Text scale multiplier, 0.8..1.6. */
  textScale?: number;
  /** OS reduced-motion preference mirror (spec 10: respect OS reduced motion). */
  reducedMotion?: boolean;
  /** Companion window screen position, in CSS px (left, top). */
  companionPosition?: { left: number; top: number };
  /** Optional last-used supported skill slug (spec 9). */
  lastUsedSkill?: string;
  /** ISO 8601 UTC timestamp of when the first-run name question was asked. */
  nameAskedAt?: string;
}

/** Defaults applied whenever a stored value is missing. */
export const PROFILE_DEFAULTS: Readonly<CandiceProfile> = Object.freeze({
  schemaVersion: 1,
  voiceOutputEnabled: true,
  volume: 1,
  speechRate: 1,
  textScale: 1,
  reducedMotion: false,
});

/**
 * MIGRATIONS registry (CHECKLIST WS-34 gate: versioned schema + migration tests).
 * A migration is a pure function from one stored document to the next version.
 * Keys are the incoming version; the outgoing version is always
 * (incoming + 1). Unknown or future versions are handled by `migrateProfile`,
 * never by inventing a version.
 */
export const MIGRATIONS: Readonly<Record<number, (doc: Record<string, unknown>) => Record<string, unknown>>> = {
  // 1 is the initial version. There are no migrations yet; the registry exists
  // so that version 2+ lands here without changing the runtime path.
};
