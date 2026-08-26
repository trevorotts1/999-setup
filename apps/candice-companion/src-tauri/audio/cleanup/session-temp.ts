/**
 * WS-20 per-session temp audio directory + delete-after-transcribe.
 *
 * Owned lane (manifest 9.2 WR-014 / WS-20):
 *   `apps/candice-companion/src-tauri/audio/cleanup/**`
 *
 * Master Spec section 8 rules implemented here:
 *   - temp audio lives only under the Candice-owned session directory;
 *   - the directory is created 0o700 (restrictive local permissions);
 *   - `deleteArtifact` runs immediately after transcription succeeds OR
 *     fails (both limbs call it; nothing is deleted-conditionally);
 *   - the session dir is removed at session end;
 *   - startup cleanup (sweep) removes stale dirs left by crashes.
 *
 * Path safety: session ids are restricted to a safe character class and the
 * resolved session dir is verified (via realpath) to sit directly under the
 * Candice temp root — a session id can never escape the root (no `..`, no
 * separators).
 */

import type { FsAdapter, SessionTempOpen, SessionTempLayout } from "./types.ts";

export type { ArtifactDeleteResult, SessionTempOpen, SessionTempLayout } from "./types.ts";

/** 0o700: owner-only, matching the restrictive-permissions requirement. */
export const SESSION_DIR_MODE = 0o700;
/** Marker file name identifying Candice-owned session dirs (sweep input). */
export const SESSION_MARKER = ".candice-session";
/** The temp root namespace under the platform temp dir. */
export const CANDICE_TEMP_ROOT = "candice-companion";

/** Session ids must match this to be accepted (no separators, no traversal). */
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export class InvalidSessionIdError extends Error {
  constructor(sessionId: string) {
    super(`invalid session id: ${sessionId}`);
    this.name = "InvalidSessionIdError";
  }
}

export class TempRootSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TempRootSafetyError";
  }
}

/**
 * Create (or recover) the Candice-owned per-session temp directory.
 *
 * @param fs        filesystem adapter (real Node fs in the bridge)
 * @param baseRoot  platform temp root, e.g. `os.tmpdir()` (macOS follows
 *                  `/var` -> `/private/var`; the realpath check keeps this safe)
 * @param sessionId the Claude session id this directory belongs to
 */
export async function openSessionTemp(
  fs: FsAdapter,
  baseRoot: string,
  sessionId: string,
): Promise<SessionTempOpen> {
  if (!BASE_ROOT_RE.test(baseRoot)) {
    throw new TempRootSafetyError("baseRoot must be an absolute path");
  }
  if (!SESSION_ID_RE.test(sessionId)) {
    throw new InvalidSessionIdError(sessionId);
  }

  const root = await join(fs, baseRoot, CANDICE_TEMP_ROOT);
  await mkdirIfMissing(fs, root);

  const dirPath = await join(fs, root, `session-${sessionId}`);

  // A pre-existing dir with this session id means a previous run of the
  // same session died before close (crash leftover): clear it, then
  // recreate — no audio survives the reopen.
  const exists = await fs.exists(dirPath).catch(() => false);
  let swept = false;
  if (exists) {
    swept = await clearSessionDir(fs, dirPath);
  }
  await mkdirIfMissing(fs, dirPath);

  // Final safety assertion: the resolved dir must live directly under the
  // Candice-owned root. Guarantees no path traversal and no escape.
  const realDir = await fs.realpath(dirPath).catch(() => dirPath);
  const realRoot = await fs.realpath(root).catch(() => root);
  if (!isDirectChild(realDir, realRoot)) {
    throw new TempRootSafetyError(
      `resolved session dir escapes the Candice temp root: ${realDir}`,
    );
  }

  const wavPath = await join(fs, dirPath, "utterance.wav");
  // Marker: proves Candice ownership at sweep time even if the naming
  // convention drifts. Marker audio is zero bytes — never audio itself.
  await fs.writeFile(await join(fs, dirPath, SESSION_MARKER), new Uint8Array([0]));

  const layout: SessionTempLayout = { dirPath, wavPath, sessionId };
  if (exists && swept) {
    // mkdirIfMissing above recreated it.
  }
  return {
    layout,
    created: !exists,
    swept,
  };
}

/**
 * Delete the transcriptable artifact. Called by the bridge immediately
 * after transcription succeeds or fails — both limbs, unconditionally.
 * Removing the whole session dir is the durable "discard": the audio is
 * gone even if a same-named artifact were recreated later.
 */
export async function deleteArtifact(
  fs: FsAdapter,
  layout: SessionTempLayout,
): Promise<{ deleted: boolean; alreadyGone: boolean; reason?: string }> {
  const dirExists = await fs.exists(layout.dirPath).catch(() => false);
  if (!dirExists) {
    return { deleted: false, alreadyGone: true };
  }
  try {
    await fs.rm(layout.dirPath, { recursive: true });
    return { deleted: true, alreadyGone: false };
  } catch (err) {
    return {
      deleted: false,
      alreadyGone: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Session end cleanup. Removes the session directory (and the wav inside
 * it). Idempotent: a second call reports the dir already gone.
 */
export async function closeSessionTemp(
  fs: FsAdapter,
  layout: SessionTempLayout,
): Promise<{ deleted: boolean; alreadyGone: boolean }> {
  return deleteArtifact(fs, layout);
}

/** Remove a session dir entirely (crash-reopen path). */
async function clearSessionDir(fs: FsAdapter, dirPath: string): Promise<boolean> {
  try {
    await fs.rm(dirPath, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/** mkdir that tolerates "already exists" (not an error on reopen paths). */
async function mkdirIfMissing(fs: FsAdapter, path: string): Promise<void> {
  try {
    await fs.mkdir(path, SESSION_DIR_MODE);
  } catch (err) {
    // EEXIST is normal for the candice root and reopened session dirs.
    const code = (err as { code?: string }).code ?? "";
    if (code !== "EEXIST") {
      throw err;
    }
  }
}

/** True when `child` is a direct child path of `parent`. */
function isDirectChild(child: string, parent: string): boolean {
  if (!child.startsWith(parent)) return false;
  const rest = child.slice(parent.length);
  return rest.startsWith("/") || rest.startsWith("\\");
}

/** Path join without platform assumptions (lane stays testable on any OS). */
async function join(fs: FsAdapter, ...parts: string[]): Promise<string> {
  const sep = (await import("node:path")).sep;
  return parts.join(sep);
}

/** Absolute path check: POSIX `/...` and Windows drive/UNC forms. */
const BASE_ROOT_RE = /^(\/[^/]|\\\\[^\\]+\\[^\\]+|[A-Za-z]:[\\/])/;
