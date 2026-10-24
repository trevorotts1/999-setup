/**
 * Platform adapter composition (WER-022 dependency-ready slice).
 *
 * `resolvePlatform` answers, in order, the questions a real VPS/container
 * deployment must answer before the council service may start:
 *
 *   1. container or host (and is that observable at all?);
 *   2. is the data directory on a persistent writable mount outside every
 *      replaceable tree?;
 *   3. which UID and which SERVICE NAME does this process run as?;
 *   4. which network namespace does the loopback bind actually name?
 *
 * Any condition this slice cannot observe is a typed refusal — a
 * `BLOCKED_PLATFORM` with `requires_real_host: true` when only a real host can
 * answer it. Nothing here is satisfied by `host.docker.internal`, by a fixed
 * port, by Command Center or by Vercel.
 *
 * The endpoint acquisition (which free port, without killing an unrelated
 * listener) is `acquireServiceEndpoint` in ./ports.ts, which reuses the
 * WER-021 front door rather than duplicating its contract.
 */
import { type ContainerObservation, type MountTable, type PlatformReceipt, type PlatformRefusal } from './types.js';
import { type ServiceIdentityOptions } from './identity.js';
export interface PlatformOptions {
    /** Absolute durable data directory. Never inside a replaceable tree. */
    dataDir: string;
    /** Skill folder, runtime release dir, scratch: never durable storage. */
    replaceableRoots?: readonly string[];
    /** Injected mount table; defaults to Linux /proc/self/mountinfo. */
    mounts?: MountTable;
    /** Injected container observation; defaults to marker + cgroup detection. */
    container?: ContainerObservation;
    /** UID / service-name inputs. */
    identity?: ServiceIdentityOptions;
    platform?: NodeJS.Platform;
    /** Injected writability probe; defaults to a real access(W_OK) check. */
    isWritable?: (path: string) => boolean;
    /** Injected clock for the receipt. */
    nowUtc?: () => string;
}
/**
 * Resolve the platform or refuse with a typed condition.
 *
 * Returns a value in every case; never throws for an observed condition.
 */
export declare function resolvePlatform(options: PlatformOptions): Promise<PlatformReceipt | PlatformRefusal>;
/** Synchronous guard for callers that must not proceed on a refusal. */
export declare function assertPlatformReady(receipt: PlatformReceipt | PlatformRefusal): PlatformReceipt;
