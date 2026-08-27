/**
 * Candice preference profile — webview IPC persistence (FIX-014).
 *
 * The webview cannot import `store.ts` (it pulls `node:fs` into the Vite
 * bundle). This module is the browser-safe persistence seam: it talks to the
 * native `cmd_load_profile` / `cmd_save_profile` commands (dumb IO in
 * `src-tauri/src/runtime.rs`) and runs the WS-34 migration chain here, in
 * TypeScript, so the schema authority never moves to Rust.
 *
 * Failure behavior (spec 20): every function degrades to defaults or false;
 * none throws. A future-version document is loaded untouched and never
 * persisted by this lane.
 */

import { defaultProfile, migrateProfile } from './profile.ts';
import { LATEST_SCHEMA_VERSION, type CandiceProfile } from './schema.ts';

/** Minimal invoke surface; the real Tauri `invoke` satisfies it. */
export interface PrefsIpcAdapter {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
}

/** Result of an attempted profile load through the native seam. */
export interface PrefsLoadResult {
  ok: boolean;
  profile: CandiceProfile;
  recoveredFromCorruption: boolean;
  error?: string;
}

interface NativeProfileLoadResponse {
  ok?: unknown;
  doc?: unknown;
  recoveredFromCorruption?: unknown;
  error?: unknown;
}

/**
 * Load the raw profile document from native, then migrate + normalize it
 * here (WS-34 authority stays in TypeScript). Never throws.
 */
export async function loadProfileViaIpc(adapter: PrefsIpcAdapter): Promise<PrefsLoadResult> {
  try {
    const raw = (await adapter.invoke('cmd_load_profile')) as NativeProfileLoadResponse | null;
    if (raw === null || typeof raw !== 'object') {
      return { ok: false, profile: defaultProfile(), recoveredFromCorruption: false, error: 'malformed native profile response' };
    }
    if (raw.ok === false) {
      return {
        ok: false,
        profile: defaultProfile(),
        recoveredFromCorruption: raw.recoveredFromCorruption === true,
        error: typeof raw.error === 'string' ? raw.error : 'profile load failed',
      };
    }
    if (raw.doc === null || raw.doc === undefined) {
      return { ok: true, profile: defaultProfile(), recoveredFromCorruption: raw.recoveredFromCorruption === true };
    }
    if (typeof raw.doc !== 'object' || Array.isArray(raw.doc)) {
      return { ok: false, profile: defaultProfile(), recoveredFromCorruption: false, error: 'profile document is not an object' };
    }
    const { profile } = migrateProfile(raw.doc as Record<string, unknown>);
    return { ok: true, profile, recoveredFromCorruption: raw.recoveredFromCorruption === true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, profile: defaultProfile(), recoveredFromCorruption: false, error: message };
  }
}

/**
 * Persist the profile through the native atomic write. Refuses future-version
 * documents (spec 20: an older lane never rewrites a newer lane's file).
 * Never throws.
 */
export async function saveProfileViaIpc(adapter: PrefsIpcAdapter, profile: CandiceProfile): Promise<boolean> {
  if (profile.schemaVersion > LATEST_SCHEMA_VERSION) return false;
  try {
    return (await adapter.invoke('cmd_save_profile', { doc: profile as unknown as Record<string, unknown> })) === true;
  } catch {
    return false;
  }
}
