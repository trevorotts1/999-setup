/**
 * Platform-safe bounded subprocess transport (WER-008 slice).
 *
 * This transport consumes the WER-006 frozen route snapshot
 * (`wise-elders.route-snapshot/v1`) instead of re-deriving route,
 * model, effort or profile from a mutable global. The snapshot hash is
 * verified before anything is spawned; a tampered or foreign-schema
 * snapshot refuses dispatch.
 *
 * Laws:
 * - Prompt content goes to the child on STDIN only. The launch plan is
 *   an argument vector built from the executable path and the pinned
 *   CLI flags; prompt text is never interpolated into any argument and
 *   never into a shell string. (The one cmd.exe `/c` payload that exists
 *   on Windows is built from the shim path and those same flags.)
 * - Bounds: stdout over `maxStdoutBytes` refuses the operation and kills
 *   the tree; stderr is truncated at its own bound. Both counts are
 *   BYTE counts, not JavaScript string lengths.
 * - Deadline and abort both terminate the WHOLE child process tree.
 * - The operationId/attemptId are recorded BEFORE launch. A timeout,
 *   abort or non-zero exit is `potentially_dispatched`, never
 *   safe-to-retry; only a spawn error (no provider work possible) is
 *   `failed_definitely`.
 *
 * Scope honesty: the resolver and this transport are proven with
 * simulated shims and local Linux/macOS subprocesses. Native Windows
 * host execution, real provider calls and live transport capture are
 * deferred (WER-027) and are NOT claimed here.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { type CouncilRouteSnapshot } from '../providers/route-snapshot.js';
import { type ResolvedInvocation, type ResolverPlatform } from './executable-resolver.js';
import type { ModelTransport, TransportRequest, TransportResponse } from './host-ports.js';
import { OperationAttemptLedger, type AttemptRecord } from './operation-attempts.js';
export declare const DEFAULT_SUBPROCESS_TIMEOUT_MS = 600000;
export declare const DEFAULT_MAX_STDOUT_BYTES: number;
export declare const DEFAULT_MAX_STDERR_BYTES: number;
export type SubprocessTransportErrorCode = 'COUNCIL_ROUTE_SNAPSHOT_REFUSED' | 'COUNCIL_ROUTE_PIN_MISMATCH' | 'COUNCIL_TRANSPORT_SPAWN_FAILED' | 'COUNCIL_TRANSPORT_TIMEOUT' | 'COUNCIL_TRANSPORT_CANCELLED' | 'COUNCIL_TRANSPORT_OUTPUT_BOUND' | 'COUNCIL_TRANSPORT_EXIT_FAILED' | 'COUNCIL_TRANSPORT_EMPTY_OUTPUT';
/** The exact per-call contract frozen from the snapshot. */
export interface PinnedCallProfile {
    routeId: string;
    /** Configured model id for a fixed route; null for a combination alias. */
    modelId: string | null;
    alias: string | null;
    /** Applied reasoning level; null means nothing was applied. */
    effort: string | null;
    configProfile: string;
    snapshotSha256: string;
}
/** Verify schema and pin before any dispatch. */
export declare function assertDispatchableSnapshot(snapshot: CouncilRouteSnapshot): void;
/** Freeze the route/model/effort/profile for every call of this transport. */
export declare function pinCallProfile(snapshot: CouncilRouteSnapshot): PinnedCallProfile;
export declare class TransportRouteError extends Error {
    readonly code: SubprocessTransportErrorCode;
    readonly retryable = false;
    readonly unknownCompletion = false;
    constructor(code: SubprocessTransportErrorCode, message: string);
}
export declare class BoundedSubprocessError extends Error {
    readonly code: SubprocessTransportErrorCode;
    readonly retryable: boolean;
    readonly unknownCompletion: boolean;
    readonly disposition: 'failed_definitely' | 'potentially_dispatched';
    readonly operationId: string;
    readonly attemptId: string;
    constructor(code: SubprocessTransportErrorCode, message: string, options: {
        operationId: string;
        attemptId: string;
        disposition: 'failed_definitely' | 'potentially_dispatched';
        retryable?: boolean;
    });
}
export interface SubprocessTransportOptions {
    /** The frozen WER-006 snapshot this transport is bound to. */
    snapshot: CouncilRouteSnapshot;
    /** Command name or path; resolved structurally (no shell, no WSL). */
    command: string;
    /** Static CLI arguments. Never prompt content. */
    args?: string[];
    /**
     * Flag names used to carry the pinned model/effort when the target
     * accepts them (for example '--model'). Omit for harnesses that own
     * their own model selection; the pin is still enforced on the request.
     */
    modelFlag?: string | null;
    effortFlag?: string | null;
    /** Environment captured ONCE at construction, then frozen. */
    env?: NodeJS.ProcessEnv;
    /** Pre-resolved launch plan; bypasses resolution when supplied. */
    invocation?: ResolvedInvocation;
    timeoutMs?: number;
    maxStdoutBytes?: number;
    maxStderrBytes?: number;
    /** Injected ledger so a host can persist the same records. */
    ledger?: OperationAttemptLedger;
    /** Deterministic attempt ids for tests; defaults to a1, a2, ... */
    attemptIdFactory?: () => string;
    spawnImpl?: typeof spawn;
    killTreeImpl?: (child: ChildProcess) => void;
    platform?: ResolverPlatform;
    now?: () => Date;
}
/** Deterministic operation identity for one logical provider request. */
export declare function operationIdFor(request: TransportRequest): string;
/** Terminate a child AND its descendants. */
export declare function terminateProcessTree(child: ChildProcess, platform?: ResolverPlatform): void;
export declare class BoundedSubprocessTransport implements ModelTransport {
    readonly ledger: OperationAttemptLedger;
    readonly pinnedProfile: PinnedCallProfile;
    private readonly options;
    private readonly childEnv;
    private readonly pinnedArgs;
    private readonly timeoutMs;
    private readonly maxStdoutBytes;
    private readonly maxStderrBytes;
    private attemptCounter;
    private readonly platform;
    constructor(options: SubprocessTransportOptions);
    /** Refuse a request whose policy contradicts the frozen pin. */
    private assertRequestMatchesPin;
    private resolveInvocation;
    generate(request: TransportRequest): Promise<TransportResponse>;
    private nextAttemptId;
    /** Latest recorded attempt for one operation, for host persistence. */
    attemptFor(operationId: string, attemptId: string): AttemptRecord | null;
}
