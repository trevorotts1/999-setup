/**
 * Persistent vs ephemeral mount detection (WER-022).
 *
 * Durable council data (sessions, reservations, budget ledger, journal) MUST
 * live on a mount that survives a container recreate. A tmpfs, an overlay
 * writable layer or a read-only mount is REFUSED with a concrete reason: the
 * service never starts against a data directory that disappears with the
 * container.
 *
 * Observation is injected so this stays deterministic and testable. The
 * default observer reads Linux `/proc/self/mountinfo`. Windows is observed
 * separately in `./windows.ts` from real volume facts (`statfsSync`, volume
 * root, `SystemDrive`) instead of a mount table; macOS keeps the explicit
 * BLOCKED_PLATFORM — never an assumption that some other filesystem is
 * durable.
 */
import { type MountPersistence, type MountRecord, type MountTable, type PlatformRefusal } from './types.js';
/**
 * Filesystems whose contents do not survive the container or the boot. Any
 * data directory backed ONLY by one of these is refused.
 */
export declare const EPHEMERAL_FS_TYPES: ReadonlySet<string>;
/** Filesystems accepted as durable backing stores. */
export declare const PERSISTENT_FS_TYPES: ReadonlySet<string>;
/**
 * Anything not named above (9p, virtiofs, fuse.*, ...) stays `undetermined`.
 * A bind mount of a host volume can be durable, but nothing in the mount
 * entry PROVES it, so the adapter refuses instead of guessing.
 */
export declare function classifyMountType(fsType: string): MountPersistence;
/** mountinfo octal escaping: `\040` space, `\011` tab, `\012` newline, `\134` backslash. */
export declare function unescapeMountField(value: string): string;
/**
 * Parse Linux `/proc/self/mountinfo`.
 *
 * A line is whitespace-separated; optional fields precede a literal `-`,
 * after which come `fs_type`, `mount_source`, `super_options`. Unparseable
 * lines are skipped rather than guessed at, and `parseMountInfo` reports how
 * many it could not read.
 */
export declare function parseMountInfo(text: string): {
    records: MountRecord[];
    unparsed: number;
};
/** Read a Linux mount table. Never throws; every outcome is reported. */
export declare function readLinuxMountTable(path?: string): MountTable;
/**
 * Default observer for mount-table platforms. Only Linux exposes a mount
 * table this adapter can read. Windows uses the volume observer in
 * `./windows.ts` (no mount table exists there), and any platform without an
 * observer is an explicit BLOCKED_PLATFORM with the reason named: the macOS
 * durable-mount observer is deferred to a real host unit.
 */
export declare function defaultMountTable(platform?: NodeJS.Platform): MountTable;
/**
 * The mount that actually backs `dataDir`: the deepest recorded mount point
 * containing it. Segment-boundary aware, so `/data2` never matches `/data`.
 */
export declare function backingMount(dataDir: string, records: readonly MountRecord[]): MountRecord | null;
/** True when `child` is `parent`, or sits below it on a segment boundary. */
export declare function isInside(child: string, parent: string): boolean;
/**
 * Canonical form of a path for boundary comparison. A directory that does
 * not exist yet is canonicalized through its nearest existing ancestor, so a
 * symlinked ancestor cannot smuggle the data dir into a replaceable tree.
 */
export declare function canonicalPath(path: string): string;
export type DataDirVerdict = {
    kind: 'persistent';
    data_dir: string;
    mount: MountRecord;
    fs_type: string;
    evidence: string[];
} | PlatformRefusal;
export interface DataDirOptions {
    dataDir: string;
    /** Skill folder, runtime release dir, temp dirs: never durable storage. */
    replaceableRoots?: readonly string[];
    mounts: MountTable;
    /** Injected writability probe; defaults to a real access(W_OK) check. */
    isWritable?: (path: string) => boolean;
}
/** Shared writability probe: the path or its nearest existing ancestor. */
export declare function defaultWritable(path: string): boolean;
/**
 * Decide whether a data directory is durable.
 *
 * Order matters: absolute path, outside replaceable trees, mount table
 * observed, a backing mount recorded, mount classified persistent, mount not
 * read-only, directory writable. Every failure is a typed refusal carrying
 * the observed reason — the caller never receives a silent "probably fine".
 */
export declare function evaluateDataDir(options: DataDirOptions): DataDirVerdict;
