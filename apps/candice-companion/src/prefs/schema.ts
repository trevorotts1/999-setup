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
 * - The versioned-schema AUTHORITY is the WS-34 lane
 *   (`src/preferences/migrations/`): version constants, per-version field
 *   contracts, and the migration chain live there. This module CONSUMES that
 *   seam (`CURRENT_SCHEMA_VERSION`, `ProfileV3`) and never owns migrations.
 * - The canonical published schema remains
 *   `packages/candice-protocol/schemas/preferences.schema.json` (WR-010 lane);
 *   this lane consumes that contract at runtime and proposes changes through
 *   CROSS-LANE-FINDING, never by editing it.
 * - A single integer `schemaVersion` gates migrations (spec 9 "simple versioned
 *   JSON schema"; CHECKLIST WS-34). The persisted document carries the integer
 *   (current = 3); the protocol string "1.0" is an INCOMING wire shape only —
 *   WS-34 `parseDocVersion` maps it to integer 2.
 * - Nullable fields keep the store valid after partial edits (e.g. the
 *   first-run name ask wrote the file before the user answered).
 * - Never store secrets, tokens, audio, or conversation content here.
 */

import { CURRENT_SCHEMA_VERSION, type ProfileV3 } from '../preferences/migrations/index.ts';

/**
 * Field names of the current (v3) document, aligned with the WR-010 protocol
 * contract names (WS-34 v2 rename) and the v3 `nameAsked` structure.
 */
export const PREFS_FIELD_NAMES = [
  'schemaVersion',
  'preferredName',
  'voiceOutputEnabled',
  'volume',
  'speechRate',
  'lastUsedAnswerMethod',
  'textSize',
  'reducedMotion',
  'characterHidden',
  'companionScreenPosition',
  'lastUsedSkill',
  'nameAsked',
] as const;

/** Local profile storage location helpers (spec 9 recommended locations). */
export const PREFS_DIR_OVERRIDE_ENV = 'CANDICE_PREFS_DIR';
export const PREFS_FILENAME = 'profile.json';
export const PREFS_LOCK_SUFFIX = '.lock';

/**
 * The newest schema version this lane understands — the WS-34 authority's
 * current version. The store refuses to persist documents above it.
 */
export const LATEST_SCHEMA_VERSION: number = CURRENT_SCHEMA_VERSION;

/**
 * The complete JSON document persisted at
 * `~/Library/Application Support/BlackCEO/999/Candice/profile.json` (macOS) or
 * `%LOCALAPPDATA%\BlackCEO\999\Candice\profile.json` (Windows).
 *
 * The v3 contract (WS-34): nullable fields are present as null when the user
 * has not chosen a value; every consumer must fall back to PROFILE_DEFAULTS
 * (this file), never to a guessed value.
 *
 * A stored document with a NEWER version is loaded and kept at its own version
 * in memory, but the store refuses to persist it (spec 20: an older lane
 * must never silently downgrade or rewrite a document a newer lane owns).
 */
export type CandiceProfile = ProfileV3;

/** Defaults applied whenever a stored value is missing or invalid. */
export const PROFILE_DEFAULTS: Readonly<CandiceProfile> = Object.freeze({
  schemaVersion: LATEST_SCHEMA_VERSION,
  preferredName: null,
  voiceOutputEnabled: true,
  // Visible by default: a companion nobody can see is not the state to boot
  // a first-run user into.
  characterHidden: false,
  volume: 1,
  speechRate: 1,
  lastUsedAnswerMethod: null,
  textSize: 'medium',
  reducedMotion: null,
  companionScreenPosition: null,
  lastUsedSkill: null,
  nameAsked: null,
});
