/**
 * Candice preference profile — typed reader/writer (Master Spec 0E WS-40, section 9).
 *
 * The local profile is a small per-user JSON document. It is never used as
 * project/conversation memory (spec 9). The active Claude skill/project files
 * are the durable source of truth; this store only remembers UI/UX choices and
 * the user's chosen name.
 *
 * Determinism and durability rules:
 * - All reads/writes are synchronous and go through one atomic replace
 *   (write-temp-then-rename) so a crash mid-write can never leave a torn file.
 * - Path resolution honors `CANDICE_PREFS_DIR` (tests / sandbox) and falls back
 *   to the spec-9 recommended locations per platform.
 * - Files are created with restrictive permissions (0o600).
 * - A lock file guards against concurrent writers; if the lock is stale it is
 *   broken, never blocking the app (a stuck preference lock must never block
 *   Claude — spec 20).
 * - Reads tolerate corruption by backing up the bad file and starting fresh
 *   from defaults (degrade to text, never fail the session).
 *
 * Migration authority: the versioned schema and the migration chain are owned
 * by the WS-34 lane (`src/preferences/migrations/`). This module CONSUMES
 * `runMigrations` / `normalizeVersionedDoc` / `parseDocVersion` and never
 * duplicates migration logic. This module is browser-safe (no `node:fs`): the
 * filesystem store (`store.ts`) is the only module that imports Node built-ins,
 * so the webview bundle can import this module without pulling in `node:fs`.
 */

import {
  PROFILE_DEFAULTS,
  LATEST_SCHEMA_VERSION,
  PREFS_FILENAME,
  PREFS_LOCK_SUFFIX,
  PREFS_DIR_OVERRIDE_ENV,
  type CandiceProfile,
} from './schema.ts';
import {
  runMigrations,
  normalizeVersionedDoc,
  parseDocVersion,
  CURRENT_SCHEMA_VERSION,
  type Violation,
} from '../preferences/migrations/index.ts';

/**
 * Version-gated document upgrade (CHECKLIST WS-34: versioned schema + migration
 * tests). Delegates to the WS-34 migration chain: integer versions run as-is,
 * protocol string "N.0" resolves to integer N+1, missing/garbage resolves to 1.
 * A document with a FUTURE version is preserved at its own version (spec 20:
 * an older lane must never silently downgrade a newer lane's document); the
 * store refuses to persist it and the caller decides how to surface it.
 */
export function migrateProfile(doc: Record<string, unknown>): {
  profile: CandiceProfile;
  migrated: boolean;
  startVersion: number;
  endVersion: number;
  violations: Violation[];
} {
  const result = runMigrations(doc);
  return {
    profile: result.profile as CandiceProfile,
    migrated: result.migrated,
    startVersion: result.startVersion,
    endVersion: result.endVersion,
    violations: result.violations,
  };
}

/**
 * Shape-normalize an arbitrary document into a CandiceProfile at the CURRENT
 * schema version, applying defaults per field and rejecting values that cannot
 * be typed. Never throws. Delegates to the WS-34 normalizer so the repair
 * rules (wrong type -> default/null, bad enum -> null, out-of-range -> default,
 * unknown field -> dropped, absent nullable -> null) live in one authority.
 */
export function normalizeProfile(doc: Record<string, unknown>): CandiceProfile {
  return normalizeVersionedDoc(doc, CURRENT_SCHEMA_VERSION) as CandiceProfile;
}

/**
 * Normalize a partial patch against the current document, returning the merged
 * profile. Purely functional; does not touch disk. Lives here (not in
 * `store.ts`) so browser-side consumers (name flow, UI wiring) never pull
 * `node:fs` into the webview bundle.
 *
 * A future-version document (schemaVersion > LATEST_SCHEMA_VERSION) is handed
 * back untouched: normalization would stamp the version back down to LATEST
 * and drop fields this lane does not understand (spec 20: an older lane must
 * never destroy a newer lane's data). The patch is still applied in memory so
 * the session keeps working; saveProfile's own version guard refuses to
 * persist it, leaving the newer lane's file byte-identical on disk.
 */
export function mergeProfile(current: CandiceProfile, patch: Partial<CandiceProfile>): CandiceProfile {
  const merged = { ...current, ...patch } as unknown as Record<string, unknown>;
  const version = parseDocVersion(merged);
  if (version > LATEST_SCHEMA_VERSION) {
    return { ...merged } as unknown as CandiceProfile;
  }
  return normalizeProfile(merged);
}

/**
 * Path of the profile directory (spec 9): macOS
 * `~/Library/Application Support/BlackCEO/999/Candice/`, Windows
 * `%LOCALAPPDATA%\BlackCEO\999\Candice\`.
 * `CANDICE_PREFS_DIR` overrides both for tests and sandboxes.
 * `platform` defaults to the host platform; tests pass a literal platform to
 * prove both branches on either OS.
 */
export function prefsDirPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  const override = env[PREFS_DIR_OVERRIDE_ENV];
  if (override && override.length > 0) return override;
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA;
    if (localAppData && localAppData.length > 0) {
      return localAppData + '\\BlackCEO\\999\\Candice';
    }
    // Known-Folders fallback (spec 0.3: user paths via APIs, not hardcoded C:\Users\...)
    const home = env.USERPROFILE;
    if (home && home.length > 0) return home + '\\AppData\\Local\\BlackCEO\\999\\Candice';
    return 'BlackCEO\\999\\Candice';
  }
  const home = env.HOME;
  if (home && home.length > 0) {
    return home + '/Library/Application Support/BlackCEO/999/Candice';
  }
  return '.candice';
}

/**
 * The default profile, as a plain object the store writes for a brand-new user.
 * v3 defaults: nullable fields are null (never invented), textSize 'medium',
 * reducedMotion null (follow the OS — I-10 fix).
 */
export function defaultProfile(): CandiceProfile {
  return { ...PROFILE_DEFAULTS } as CandiceProfile;
}

export { PREFS_FILENAME, PREFS_LOCK_SUFFIX };
