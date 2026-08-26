/**
 * WS-20 audio-cleanup types — temp-audio lifecycle (Master Spec section 8).
 *
 * Owned lane (manifest 9.2 WR-014 / WS-20):
 *   `apps/candice-companion/src-tauri/audio/cleanup/**`
 *
 * Spec 8 requirements this lane enforces:
 *   1. a temporary audio file exists only inside a Candice-owned per-session
 *      temp directory (never an arbitrary path);
 *   2. that directory has restrictive permissions (0o700);
 *   3. the file is deleted immediately after transcription succeeds or fails;
 *   4. cleanup runs again when the session ends;
 *   5. startup cleanup removes stale temp audio left by crashes;
 *   6. no abandoned audio accumulates over time.
 *
 * The preferred path stays `microphone -> in-memory ring buffer -> whisper
 * -> transcript -> discard` (WS-17 ring buffer, zero disk audio). The temp
 * file path exists only for the whisper.cpp transport, which accepts a WAV
 * file path; when that transport is used, every artifact goes through this
 * lane and nothing else ever writes audio to disk.
 */

/** One session's temp root. */
export interface SessionTempLayout {
  /** Absolute path of the per-session temp directory. */
  dirPath: string;
  /** Absolute path of a transcriptable WAV inside the session dir. */
  wavPath: string;
  /** The session id the directory was created for. */
  sessionId: string;
}

/** Outcome of a create-or-reopen call. */
export interface SessionTempOpen {
  layout: SessionTempLayout;
  /** True when this call created the directory; false when it was recovered. */
  created: boolean;
  /** True when orphaned files from a previous (crashed) session were removed. */
  swept: boolean;
}

/** Result of a delete-after-transcribe call. */
export interface ArtifactDeleteResult {
  wavPath: string;
  deleted: boolean;
  /** True when the file did not exist at delete time (idempotent). */
  alreadyGone: boolean;
  /** Machine-readable failure reason when `deleted` is false. */
  reason?: string;
}

/** One stale temp directory found by the startup sweep. */
export interface StaleDirEntry {
  dirPath: string;
  sessionId: string | null;
  ageMs: number;
}

/** Result of a sweep. */
export interface SweepResult {
  /** Dirs examined for staleness. */
  scanned: number;
  /** Dirs removed. */
  removed: number;
  /** Dirs left (fresh sessions, or protected roots). */
  kept: number;
  /** Dirs that could not be removed (reason recorded in caller logs; audio never kept silently). */
  failed: number;
  /** Newest kept dir age in ms (audit). */
  oldestKeptAgeMs: number | null;
}

/**
 * Minimal mkdir/readdir/rm surface — injectable so tests run on real tmpfs
 * with no mocking, and the bridge can point the lane at the real platform
 * temp root.
 */
export interface FsAdapter {
  mkdir(path: string, mode: number): Promise<void>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<{ isDirectory: boolean; isFile: boolean; mtimeMs: number; mode: number }>;
  rm(path: string, opts: { recursive: boolean }): Promise<void>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  realpath(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
}

/** Ownership rules for the startup sweep. */
export interface SweepPolicy {
  /** Session dirs older than this are orphans (crash leftovers). */
  staleAfterMs: number;
  /** Marker file name identifying Candice-owned session dirs. */
  markerName: string;
  /** Max dirs removed per sweep (crash storm guard). */
  maxRemovals: number;
}

export const SWEEP_DEFAULTS: Required<SweepPolicy> = {
  staleAfterMs: 24 * 60 * 60 * 1000,
  markerName: ".candice-session",
  maxRemovals: 128,
};
