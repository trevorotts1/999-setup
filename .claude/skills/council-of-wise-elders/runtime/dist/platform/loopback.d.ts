/**
 * Container detection and container-vs-host loopback disambiguation
 * (WER-022).
 *
 * `127.0.0.1` inside a container names THE CURRENT CONTAINER's network
 * namespace. It does not name the host, and `host.docker.internal` is a
 * Desktop convenience that (a) does not exist on Linux Docker by default and
 * (b) proves nothing about reachability even when the name resolves. So:
 *
 * - asking for the HOST loopback from inside a container is an explicit
 *   `PLATFORM_LOOPBACK_AMBIGUOUS` refusal, never a guess;
 * - a caller MAY supply an explicit published host address, but it is
 *   accepted only when an injected reachability probe says reachable —
 *   a name or a fixed port is never proof;
 * - when container evidence cannot be observed at all, the answer is a typed
 *   `BLOCKED_PLATFORM` and not a pass.
 */
import { type ContainerEvidence, type ContainerObservation, type LoopbackObservation, type LoopbackTarget, type PlatformRefusal } from './types.js';
/**
 * Observe whether this process runs inside a container.
 *
 * `present` requires a positive marker. `absent` requires a successfully
 * read cgroup state (on Linux) or a platform where no Linux container marker
 * can apply (macOS). Windows has neither `/.dockerenv` nor a cgroup table, so
 * without a runtime environment marker the answer is `unknown`, which the
 * callers turn into BLOCKED_PLATFORM instead of assuming "not a container".
 * A read failure also leaves the answer `unknown`.
 */
export declare function observeContainer(options?: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
}): ContainerObservation;
export interface LoopbackOptions {
    container: ContainerObservation;
    /** Which network namespace the caller wants. Default: `host`. */
    target?: LoopbackTarget;
    /** The address the service binds. Loopback only in this slice. */
    address?: string;
    /**
     * An explicit host address the caller claims is published. Never trusted
     * on its own: `probeHost` must confirm reachability.
     */
    explicitHostAddress?: string | null;
    probeHost?: (address: string) => Promise<{
        reachable: boolean;
        detail: string;
        checked: string[];
    }>;
}
/**
 * Resolve which namespace a loopback address names.
 *
 * A host process: loopback is the host. A container process asking for the
 * container: loopback is the current container. A container process asking
 * for the host: refused as ambiguous unless an explicit published address is
 * proven reachable.
 */
export declare function resolveLoopback(options: LoopbackOptions): Promise<LoopbackObservation | PlatformRefusal>;
/** Convenience for callers that only need the boolean shape. */
export declare function containerKind(evidence: ContainerEvidence): 'host' | 'container' | 'unknown';
