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
import { accessSync, constants, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { platformRefusal, } from './types.js';
/**
 * Filesystems whose contents do not survive the container or the boot. Any
 * data directory backed ONLY by one of these is refused.
 */
export const EPHEMERAL_FS_TYPES = new Set([
    'aufs',
    'autofs',
    'binfmt_misc',
    'bpf',
    'cgroup',
    'cgroup2',
    'configfs',
    'debugfs',
    'devpts',
    'devtmpfs',
    'fusectl',
    'hugetlbfs',
    'mqueue',
    'nsfs',
    'overlay',
    'proc',
    'pstore',
    'ramfs',
    'securityfs',
    'squashfs',
    'sysfs',
    'tmpfs',
    'tracefs',
]);
/** Filesystems accepted as durable backing stores. */
export const PERSISTENT_FS_TYPES = new Set([
    'apfs',
    'btrfs',
    'exfat',
    'ext2',
    'ext3',
    'ext4',
    'f2fs',
    'hfs',
    'hfsplus',
    'jfs',
    'msdos',
    'nilfs2',
    'ntfs',
    'ntfs3',
    'reiserfs',
    'ufs',
    'vfat',
    'xfs',
    'zfs',
]);
/**
 * Anything not named above (9p, virtiofs, fuse.*, ...) stays `undetermined`.
 * A bind mount of a host volume can be durable, but nothing in the mount
 * entry PROVES it, so the adapter refuses instead of guessing.
 */
export function classifyMountType(fsType) {
    const value = fsType.trim().toLowerCase();
    if (EPHEMERAL_FS_TYPES.has(value))
        return 'ephemeral';
    if (PERSISTENT_FS_TYPES.has(value))
        return 'persistent';
    return 'undetermined';
}
/** mountinfo octal escaping: `\040` space, `\011` tab, `\012` newline, `\134` backslash. */
export function unescapeMountField(value) {
    return value.replace(/\\([0-7]{3})/g, (_match, octal) => String.fromCharCode(Number.parseInt(octal, 8)));
}
/**
 * Parse Linux `/proc/self/mountinfo`.
 *
 * A line is whitespace-separated; optional fields precede a literal `-`,
 * after which come `fs_type`, `mount_source`, `super_options`. Unparseable
 * lines are skipped rather than guessed at, and `parseMountInfo` reports how
 * many it could not read.
 */
export function parseMountInfo(text) {
    const records = [];
    let unparsed = 0;
    for (const line of text.split('\n')) {
        if (line.trim().length === 0)
            continue;
        const fields = line.split(' ');
        const separator = fields.indexOf('-');
        if (separator < 6 || fields.length < separator + 4) {
            unparsed += 1;
            continue;
        }
        const mountPoint = unescapeMountField(fields[4]);
        const mountOptions = fields[5].split(',');
        const superOptions = (fields[separator + 3] ?? '').split(',');
        records.push({
            mount_point: mountPoint,
            fs_type: fields[separator + 1],
            device: unescapeMountField(fields[separator + 2]),
            read_only: mountOptions.includes('ro') || superOptions.includes('ro'),
        });
    }
    return { records, unparsed };
}
/** Read a Linux mount table. Never throws; every outcome is reported. */
export function readLinuxMountTable(path = '/proc/self/mountinfo') {
    try {
        const text = readFileSync(path, 'utf8');
        const parsed = parseMountInfo(text);
        return {
            observed: true,
            records: parsed.records,
            source: path,
            error: parsed.unparsed > 0 ? `${parsed.unparsed} mountinfo line(s) could not be parsed` : null,
            checked: [path],
        };
    }
    catch (error) {
        return {
            observed: false,
            records: [],
            source: path,
            error: error instanceof Error ? error.message : String(error),
            checked: [path],
        };
    }
}
/**
 * Default observer for mount-table platforms. Only Linux exposes a mount
 * table this adapter can read. Windows uses the volume observer in
 * `./windows.ts` (no mount table exists there), and any platform without an
 * observer is an explicit BLOCKED_PLATFORM with the reason named: the macOS
 * durable-mount observer is deferred to a real host unit.
 */
export function defaultMountTable(platform = process.platform) {
    if (platform !== 'linux') {
        return {
            observed: false,
            records: [],
            source: `no mount table observer for ${platform}`,
            error: `This adapter reads Linux /proc/self/mountinfo only; ${platform} has no equivalent observer in this slice.`,
            checked: [],
        };
    }
    return readLinuxMountTable();
}
function normalizeDir(path) {
    const resolved = resolve(path);
    return resolved.length > 1 ? resolved.replace(/\/+$/, '') : resolved;
}
/**
 * The mount that actually backs `dataDir`: the deepest recorded mount point
 * containing it. Segment-boundary aware, so `/data2` never matches `/data`.
 */
export function backingMount(dataDir, records) {
    const target = normalizeDir(dataDir);
    let best = null;
    let bestLength = -1;
    for (const record of records) {
        const mountPoint = normalizeDir(record.mount_point);
        const contains = mountPoint === '/'
            ? target.startsWith('/')
            : target === mountPoint || target.startsWith(`${mountPoint}${sep}`);
        if (!contains)
            continue;
        if (mountPoint.length > bestLength) {
            best = record;
            bestLength = mountPoint.length;
        }
    }
    return best;
}
/** True when `child` is `parent`, or sits below it on a segment boundary. */
export function isInside(child, parent) {
    const a = normalizeDir(child);
    const b = normalizeDir(parent);
    if (b === '/')
        return a.startsWith('/');
    return a === b || a.startsWith(`${b}${sep}`);
}
/**
 * Canonical form of a path for boundary comparison. A directory that does
 * not exist yet is canonicalized through its nearest existing ancestor, so a
 * symlinked ancestor cannot smuggle the data dir into a replaceable tree.
 */
export function canonicalPath(path) {
    let current = resolve(path);
    const tail = [];
    for (;;) {
        try {
            const real = realpathSync(current);
            return tail.length === 0 ? real : join(real, ...tail);
        }
        catch {
            const parent = dirname(current);
            if (parent === current)
                return resolve(path);
            tail.unshift(current.slice(parent.length).replace(/^[\\/]+/, ''));
            current = parent;
        }
    }
}
/** Shared writability probe: the path or its nearest existing ancestor. */
export function defaultWritable(path) {
    let current = resolve(path);
    for (;;) {
        try {
            accessSync(current, constants.W_OK);
            return true;
        }
        catch {
            const parent = dirname(current);
            if (parent === current)
                return false;
            current = parent;
        }
    }
}
/**
 * Decide whether a data directory is durable.
 *
 * Order matters: absolute path, outside replaceable trees, mount table
 * observed, a backing mount recorded, mount classified persistent, mount not
 * read-only, directory writable. Every failure is a typed refusal carrying
 * the observed reason — the caller never receives a silent "probably fine".
 */
export function evaluateDataDir(options) {
    const checked = [...options.mounts.checked];
    const unknowns = [];
    const raw = options.dataDir;
    if (typeof raw !== 'string' || raw.trim().length === 0 || !isAbsolute(raw)) {
        return platformRefusal({
            code: 'PLATFORM_DATA_DIR_NOT_ABSOLUTE',
            condition: 'DATA_DIR_NOT_ABSOLUTE',
            detail: `The data directory ${JSON.stringify(raw)} is not an absolute path; a relative path would make durability depend on the process working directory.`,
            recovery: 'Pass the absolute per-user council data directory (see src/cli/paths.ts resolveDataDir).',
            checked,
        });
    }
    const dataDir = resolve(raw);
    const canonicalDataDir = canonicalPath(dataDir);
    checked.push(dataDir);
    for (const root of options.replaceableRoots ?? []) {
        const canonicalRoot = canonicalPath(root);
        checked.push(canonicalRoot);
        if (isInside(canonicalDataDir, canonicalRoot)) {
            return platformRefusal({
                code: 'PLATFORM_DATA_DIR_INSIDE_REPLACEABLE_TREE',
                condition: 'DATA_DIR_INSIDE_REPLACEABLE_TREE',
                detail: `The data directory ${dataDir} is inside the replaceable tree ${root}. An update that replaces that tree would destroy durable council state.`,
                recovery: 'Move the data directory outside the skill folder and the runtime release directory, then re-run platform resolution.',
                checked,
            });
        }
    }
    if (!options.mounts.observed) {
        return platformRefusal({
            code: 'BLOCKED_PLATFORM',
            condition: options.mounts.checked.length === 0
                ? 'MOUNT_TABLE_NOT_AVAILABLE_ON_THIS_PLATFORM'
                : 'MOUNT_TABLE_UNREADABLE',
            detail: `No mount table was observed (${options.mounts.source})${options.mounts.error ? `: ${options.mounts.error}` : '.'} Durability of ${dataDir} cannot be proven, so it is not assumed.`,
            recovery: 'Run on the real host, or inject a platform mount observer. A real VPS/container host is required to prove this.',
            requires_real_host: true,
            checked,
            unknowns: ['backing mount and filesystem type of the data directory'],
        });
    }
    const mount = backingMount(dataDir, options.mounts.records);
    if (!mount) {
        unknowns.push('no recorded mount point contains the data directory');
        return platformRefusal({
            code: 'BLOCKED_PLATFORM',
            condition: 'MOUNT_NOT_OBSERVED_FOR_DATA_DIR',
            detail: `The mount table ${options.mounts.source} has no entry containing ${dataDir}. Durability is undetermined, not assumed.`,
            recovery: 'Confirm the data directory exists on a declared mount of the real host, or inject the host mount table.',
            requires_real_host: true,
            checked,
            unknowns,
        });
    }
    checked.push(`${mount.mount_point} (${mount.fs_type})`);
    const persistence = classifyMountType(mount.fs_type);
    if (persistence === 'ephemeral') {
        return platformRefusal({
            code: 'PLATFORM_DATA_DIR_EPHEMERAL',
            condition: 'DATA_DIR_EPHEMERAL_MOUNT',
            detail: `The data directory ${dataDir} is backed by ${mount.mount_point} on filesystem "${mount.fs_type}", which is an ephemeral/short-lived filesystem. Sessions, reservations and the budget ledger would be lost on a container recreate.`,
            recovery: 'Bind a durable host volume over the data directory (a named volume or a host path on ext4/xfs/btrfs/zfs) and re-run platform resolution.',
            checked,
        });
    }
    if (mount.read_only) {
        return platformRefusal({
            code: 'PLATFORM_DATA_DIR_NOT_WRITABLE',
            condition: 'DATA_DIR_READ_ONLY_MOUNT',
            detail: `The data directory ${dataDir} is on ${mount.mount_point} (${mount.fs_type}), which is mounted read-only.`,
            recovery: 'Mount the durable volume read-write and re-run platform resolution.',
            checked,
        });
    }
    if (persistence === 'undetermined') {
        unknowns.push(`filesystem type "${mount.fs_type}" is not classified as durable`);
        return platformRefusal({
            code: 'BLOCKED_PLATFORM',
            condition: 'MOUNT_PERSISTENCE_UNDETERMINED',
            detail: `The data directory ${dataDir} is on filesystem "${mount.fs_type}" at ${mount.mount_point}. Durability cannot be proven from the mount entry, so it is not assumed.`,
            recovery: 'Expose the data directory on a filesystem this adapter classifies as durable, or record an explicit platform verdict for this mount.',
            requires_real_host: true,
            checked,
            unknowns,
        });
    }
    const writable = options.isWritable ?? defaultWritable;
    if (!writable(dataDir)) {
        return platformRefusal({
            code: 'PLATFORM_DATA_DIR_NOT_WRITABLE',
            condition: 'DATA_DIR_NOT_WRITABLE',
            detail: `The data directory ${dataDir} (or its nearest existing ancestor) is not writable by the current process identity.`,
            recovery: 'Fix ownership/permissions on the durable volume for the service UID, then re-run platform resolution.',
            checked,
        });
    }
    return {
        kind: 'persistent',
        data_dir: dataDir,
        mount,
        fs_type: mount.fs_type,
        evidence: checked,
    };
}
