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
 */

import {
  PROFILE_DEFAULTS,
  MIGRATIONS,
  LATEST_SCHEMA_VERSION,
  PREFS_FILENAME,
  PREFS_LOCK_SUFFIX,
  PREFS_DIR_OVERRIDE_ENV,
  type CandiceProfile,
} from './schema.ts';

/**
 * Version-gated document upgrade (CHECKLIST WS-34: versioned schema + migration
 * tests). Applies MIGRATIONS step by step, then validates the result's shape.
 * A document with a FUTURE version is preserved at its own version (spec 20:
 * an older lane must never silently downgrade a newer lane's document); the
 * store refuses to persist it and the caller decides how to surface it.
 */
export function migrateProfile(doc: Record<string, unknown>): { profile: CandiceProfile; migrated: boolean } {
  const rawVersion = doc.schemaVersion;
  const startVersion = typeof rawVersion === 'number' && Number.isInteger(rawVersion) && rawVersion >= 1 ? rawVersion : 1;
  if (startVersion > LATEST_SCHEMA_VERSION) {
    // Future document: keep its own version and fields in memory untouched.
    const future = { ...doc, schemaVersion: startVersion };
    return { profile: future as unknown as CandiceProfile, migrated: false };
  }
  let current: Record<string, unknown> = { ...doc };
  let migrated = false;
  let version = startVersion;
  const maxSteps = 64; // bounded; a migration loop can never spin forever
  for (let i = 0; i < maxSteps && MIGRATIONS[version]; i += 1) {
    current = MIGRATIONS[version](current);
    version = (typeof current.schemaVersion === 'number' ? current.schemaVersion : version) + 1;
    migrated = true;
  }
  return {
    profile: normalizeProfile(current),
    migrated,
  };
}

/**
 * Shape-normalize an arbitrary document into a CandiceProfile, applying
 * defaults per field and rejecting values that cannot be typed. Never throws.
 */
export function normalizeProfile(doc: Record<string, unknown>): CandiceProfile {
  const out: CandiceProfile = { schemaVersion: 1 };
  const asStr = (v: unknown): string | undefined =>
    typeof v === 'string' && v.length > 0 ? v : undefined;
  const asBool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
  const asNum = (v: unknown, min: number, max: number, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback;
  const method = doc.lastAnswerMethod;
  if (method === 'voice' || method === 'typed' || method === 'terminal') {
    out.lastAnswerMethod = method;
  }
  const rawVersion = doc.schemaVersion;
  if (typeof rawVersion === 'number' && Number.isInteger(rawVersion) && rawVersion >= 1 && rawVersion <= LATEST_SCHEMA_VERSION) {
    out.schemaVersion = rawVersion;
  }
  const name = asStr(doc.preferredName);
  if (name !== undefined) out.preferredName = name;
  const vOut = asBool(doc.voiceOutputEnabled, PROFILE_DEFAULTS.voiceOutputEnabled ?? true);
  out.voiceOutputEnabled = vOut;
  const vol = asNum(doc.volume, 0, 1, PROFILE_DEFAULTS.volume ?? 1);
  out.volume = vol;
  const rate = asNum(doc.speechRate, 0.5, 2, PROFILE_DEFAULTS.speechRate ?? 1);
  out.speechRate = rate;
  const scale = asNum(doc.textScale, 0.8, 1.6, PROFILE_DEFAULTS.textScale ?? 1);
  out.textScale = scale;
  const motion = asBool(doc.reducedMotion, PROFILE_DEFAULTS.reducedMotion ?? false);
  out.reducedMotion = motion;
  const pos = doc.companionPosition;
  if (
    pos !== null &&
    typeof pos === 'object' &&
    typeof (pos as { left?: unknown }).left === 'number' &&
    typeof (pos as { top?: unknown }).top === 'number' &&
    Number.isFinite((pos as { left: number }).left) &&
    Number.isFinite((pos as { top: number }).top)
  ) {
    out.companionPosition = { left: (pos as { left: number }).left, top: (pos as { top: number }).top };
  }
  const skill = asStr(doc.lastUsedSkill);
  if (skill !== undefined) out.lastUsedSkill = skill;
  const asked = asStr(doc.nameAskedAt);
  if (asked !== undefined) out.nameAskedAt = asked;
  return out;
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
 */
export function defaultProfile(): CandiceProfile {
  return { ...PROFILE_DEFAULTS, schemaVersion: 1 } as CandiceProfile;
}
