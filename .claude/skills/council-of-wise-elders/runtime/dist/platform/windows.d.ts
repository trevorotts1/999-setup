/**
 * Windows durable-volume observation (WER-027, Windows half A).
 *
 * Windows has no `/proc/self/mountinfo`. The facts that ARE observable from
 * Node without a shell are:
 *
 * - the resolved (realpath) location of the data directory, which resolves
 *   8.3 short names and junction/symlink targets;
 * - the volume root from `path.win32.parse(...).root` (a drive letter or a
 *   UNC `\\server\share\` path);
 * - free-space geometry from `fs.statfsSync` (`bsize`, `blocks`, `bfree`,
 *   `bavail`, `files`, `ffree`);
 * - `SystemDrive`, which names the volume Windows booted from. Only that
 *   volume is PROVEN fixed; a different drive letter cannot be proven fixed
 *   or removable without a native `GetDriveTypeW` call, so it stays
 *   `undetermined` and is refused rather than assumed durable.
 *
 * Temporary roots (`TEMP`, `TMP`, `%USERPROFILE%\AppData\Local\Temp`,
 * `%LOCALAPPDATA%\Temp`, `%SystemRoot%\Temp`) are REFUSED for durable state.
 * Every comparison uses `path.win32` so these rules are testable on any host
 * and never depend on the POSIX separator.
 *
 * Nothing here executes a shell command, reads the network, or registers a
 * service. A real Windows host is still required to prove actual volume
 * geometry, junction targets and drive type; this module records what it can
 * observe and refuses the rest.
 */
import { type DataDirVerdict } from './mounts.js';
/** Free-space facts read from `fs.statfsSync`. */
export interface WindowsVolumeSpace {
    bsize: number;
    blocks: number;
    bfree: number;
    bavail: number;
    files: number;
    ffree: number;
}
export type WindowsVolumeKind = 'fixed' | 'network' | 'undetermined';
export interface WindowsVolumeObservation {
    /** True when the volume kind is characterised (fixed or network). */
    ok: boolean;
    /** `C:` or `\\server\share`. */
    drive: string;
    /** `C:\` or `\\server\share\`. */
    root: string;
    kind: WindowsVolumeKind;
    /** Never presented as a Linux filesystem type. */
    fs_type: string;
    /** null when read-only state cannot be observed. */
    read_only: boolean | null;
    space: WindowsVolumeSpace | null;
    evidence: string[];
    checked: string[];
    error: string | null;
}
export interface WindowsVolumeOptions {
    dataDir: string;
    /** Already-resolved path; observed when omitted. */
    canonicalDataDir?: string;
    env?: NodeJS.ProcessEnv;
    /** Injected for tests; defaults to `fs.statfsSync`. */
    statfs?: (path: string) => WindowsVolumeSpace;
    /** Injected for tests; defaults to `fs.realpathSync.native`. */
    realpath?: (path: string) => string;
}
/**
 * Strip a `\\?\` extended-length prefix. `\\?\UNC\server\share` becomes
 * `\\server\share`; `\\?\C:\dir` becomes `C:\dir`.
 */
export declare function stripExtendedPrefix(value: string): string;
export interface CanonicalWindowsPath {
    path: string;
    /** True when a realpath observation (not the lexical fallback) answered. */
    resolved: boolean;
    error: string | null;
}
/**
 * Windows-aware canonical path with its provenance. Resolves the nearest
 * existing ancestor when the tail does not exist yet, and falls back to the
 * lexical absolute path when `realpath` fails (for example when the test host
 * is not Windows). The fallback is reported, never silent.
 */
export declare function canonicalWindowsPathDetailed(path: string, realpath?: (path: string) => string): CanonicalWindowsPath;
export declare function canonicalWindowsPath(path: string, realpath?: (path: string) => string): string;
/** `child` is `parent` or sits below it on a case-insensitive boundary. */
export declare function isInsideWindows(child: string, parent: string): boolean;
/** Every Windows temporary root the process can name, with its source. */
export declare function windowsTempRoots(env?: NodeJS.ProcessEnv): Array<{
    root: string;
    source: string;
}>;
/**
 * Observe the volume behind `dataDir` from real Windows facts.
 *
 * Classification order:
 *   1. UNC root -> network (observed, never assumed durable);
 *   2. drive letter equal to `SystemDrive` -> fixed (boot volume);
 *   3. anything else -> undetermined, with the reason named.
 *
 * `statfs` is attempted on the resolved data directory and, when that fails,
 * on the volume root. Its values are recorded as evidence in every case.
 */
export declare function observeWindowsVolume(options: WindowsVolumeOptions): WindowsVolumeObservation;
export interface WindowsDataDirOptions {
    dataDir: string;
    replaceableRoots?: readonly string[];
    env?: NodeJS.ProcessEnv;
    /** Injected observation; defaults to `observeWindowsVolume`. */
    volume?: WindowsVolumeObservation;
    realpath?: (path: string) => string;
    statfs?: (path: string) => WindowsVolumeSpace;
    isWritable?: (path: string) => boolean;
}
/**
 * Decide whether a Windows data directory is durable.
 *
 * Order: absolute win32 path, resolve junctions/short names, refusal of any
 * temporary root, refusal of replaceable trees, observed volume, durable
 * volume kind, writability. Every failure is a typed refusal naming the
 * concrete path and rule; an uncharacterisable volume is BLOCKED_PLATFORM,
 * never an `ok`.
 */
export declare function evaluateWindowsDataDir(options: WindowsDataDirOptions): DataDirVerdict;
