/**
 * Candice local preference profile — public surface (Master Spec 0E WS-40, section 9).
 *
 * One local JSON document per OS user:
 *   macOS   ~/Library/Application Support/BlackCEO/999/Candice/profile.json
 *   Windows %LOCALAPPDATA%\BlackCEO\999\Candice\profile.json
 *
 * This module owns: preferred name lifecycle (asked at most once per local
 * user, never inferred from the OS username, changeable later, used naturally),
 * voice-output toggle, volume, speech rate, last answer method, text scale,
 * reduced motion, companion position, optional last-used skill, and versioned
 * migration (spec 9; CHECKLIST WS-34).
 *
 * Non-goals (spec 9): this store is NEVER project/conversation memory. It
 * never reads answers, questions, or session content; the active Claude skill
 * and project files remain the durable source of truth.
 *
 * Failure behavior (spec 20): every public function degrades to defaults or a
 * typed error value; none of them throws, and none can block the Claude
 * session.
 */

export {
  type CandiceProfile,
  PROFILE_DEFAULTS,
  PREFS_FIELD_NAMES,
  MIGRATIONS,
  LATEST_SCHEMA_VERSION,
  PREFS_DIR_OVERRIDE_ENV,
  PREFS_FILENAME,
} from './schema.ts';
export { migrateProfile, normalizeProfile, prefsDirPath, defaultProfile } from './profile.ts';
export { loadProfile, saveProfile, mergeProfile, type LoadResult } from './store.ts';
export {
  normalizeName,
  isUsableName,
  needsNameAsk,
  markNameAsked,
  setPreferredName,
  changePreferredName,
  welcomeBackPhrase,
} from './name.ts';
