/**
 * WS-20 audio-cleanup public surface.
 *
 * Owned lane (manifest 9.2 WR-014 / WS-20):
 *   `apps/candice-companion/src-tauri/audio/cleanup/**`
 *
 * One stable import path for the shell bridge; the platform adapters
 * (WR-015/WR-016) resolve the platform temp root (`os.tmpdir()`,
 * `%LOCALAPPDATA%\Temp`) and hand it here as `baseRoot`.
 */

export {
  openSessionTemp,
  deleteArtifact,
  closeSessionTemp,
  InvalidSessionIdError,
  TempRootSafetyError,
  SESSION_DIR_MODE,
  SESSION_MARKER,
  CANDICE_TEMP_ROOT,
} from "./session-temp.ts";
export type { ArtifactDeleteResult, SessionTempOpen, SessionTempLayout } from "./session-temp.ts";

export { sweepStaleTempAudio } from "./sweep.ts";
export type { SweepOptions } from "./sweep.ts";
export type { StaleDirEntry, SweepPolicy, SweepResult } from "./types.ts";
export { SWEEP_DEFAULTS } from "./types.ts";
export type { FsAdapter } from "./types.ts";
