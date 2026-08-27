/**
 * Candice preference store — filesystem persistence (Master Spec 0E WS-40, section 9).
 *
 * One JSON document per local OS user, atomic write-then-rename, restrictive
 * permissions, stale-lock tolerance, corruption backup. The store NEVER reads
 * the OS username, never logs stored content, and never stores secrets or
 * conversation content. Failure degrades to defaults (spec 20: a Candice error
 * never blocks the session).
 *
 * This is the ONLY prefs module that imports `node:fs` — the webview bundle
 * must never import this module at boot. Pure profile logic (merge, normalize,
 * migrate) lives in `profile.ts`, which is browser-safe.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  LATEST_SCHEMA_VERSION,
  PREFS_FILENAME,
  PREFS_LOCK_SUFFIX,
  PROFILE_DEFAULTS,
  type CandiceProfile,
} from './schema.ts';
import { defaultProfile, migrateProfile, prefsDirPath } from './profile.ts';

/** Result of an attempted profile load. */
export interface LoadResult {
  ok: boolean;
  profile: CandiceProfile;
  /** true when a stored file existed but could not be parsed and was reset. */
  recoveredFromCorruption: boolean;
  /** human-readable reason when ok=false. */
  error?: string;
}

const readJson = (file: string): Record<string, unknown> | null => {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
};

const writeJsonAtomic = (file: string, doc: Record<string, unknown>): void => {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n', { mode: 0o600 });
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // best-effort cleanup; the original file is untouched
    }
    throw err;
  }
};

/**
 * Synchronously load the profile document. Corruption is backed up and reset
 * to defaults; missing file returns defaults. Never throws.
 */
export function loadProfile(env: NodeJS.ProcessEnv = process.env): LoadResult {
  try {
    const dir = prefsDirPath(env);
    const file = path.join(dir, PREFS_FILENAME);
    // The configured location exists but is not a directory: surface it as a
    // real error (ok=false) instead of silently pretending the profile is
    // simply missing. The app degrades to defaults either way (spec 20).
    if (fs.existsSync(dir) && !fs.statSync(dir).isDirectory()) {
      return {
        ok: false,
        profile: defaultProfile(),
        recoveredFromCorruption: false,
        error: 'profile directory path is not a directory',
      };
    }
    if (!fs.existsSync(file)) {
      return { ok: true, profile: defaultProfile(), recoveredFromCorruption: false };
    }
    const doc = readJson(file);
    if (doc === null) {
      // Back up the unreadable file, then start fresh. Do not log its content.
      try {
        fs.renameSync(file, file + '.corrupt-' + process.pid);
      } catch {
        // backup is best-effort; proceed with defaults
      }
      return { ok: true, profile: defaultProfile(), recoveredFromCorruption: true };
    }
    const { profile } = migrateProfile(doc);
    return { ok: true, profile, recoveredFromCorruption: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, profile: defaultProfile(), recoveredFromCorruption: false, error: message };
  }
}

/**
 * Synchronously persist the profile atomically under a per-process lock.
 * The lock is never fatal: a stale lock is broken; a contended fresh lock is
 * bypassed after a bounded wait so the app cannot block (spec 20).
 * Returns true when the write landed.
 */
export function saveProfile(profile: CandiceProfile, env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    // Never silently downgrade a future-version document (spec 20: an older
    // lane must not destroy a newer lane's data). loadProfile hands it back
    // in memory untouched; persisting it is refused so the newer lane owns it.
    if (profile.schemaVersion > LATEST_SCHEMA_VERSION) {
      return false;
    }
    const dir = prefsDirPath(env);
    fs.mkdirSync(dir, { recursive: true });
    const lockFile = path.join(dir, PREFS_LOCK_SUFFIX);
    const deadline = Date.now() + 1500;
    while (true) {
      try {
        const fd = fs.openSync(lockFile, 'wx');
        fs.writeFileSync(fd, String(process.pid));
        fs.closeSync(fd);
        break;
      } catch {
        // Lock exists. Stale (older than 10s) -> break it. Otherwise wait briefly.
        let stale = false;
        try {
          const st = fs.statSync(lockFile);
          stale = Date.now() - st.mtimeMs > 10_000;
        } catch {
          stale = true;
        }
        if (stale) {
          try {
            fs.rmSync(lockFile, { force: true });
          } catch {
            // raced; retry the open
          }
        } else if (Date.now() > deadline) {
          // Bounded wait exhausted: proceed without the lock rather than block.
          break;
        }
        const waitUntil = Date.now() + 50;
        while (Date.now() < waitUntil) {
          // busy-wait is deliberate: synchronous module, no async primitive available
        }
      }
    }
    try {
      writeJsonAtomic(path.join(dir, PREFS_FILENAME), profile as unknown as Record<string, unknown>);
      return true;
    } finally {
      try {
        fs.rmSync(lockFile, { force: true });
      } catch {
        // best-effort
      }
    }
  } catch (err) {
    // Never throw to the caller: a preference write failure degrades to
    // in-memory-only, never blocks the session (spec 20).
    return false;
  }
}

export { PROFILE_DEFAULTS };
