/**
 * Subprocess host-call delegate for harness routes (RP-046-1 repair
 * for DEFECT-046-A; directive Section 13.4 adapter 3).
 *
 * Adapter 3 integrates through the host harness's OWN supported
 * surface: the skill invokes the harness executable the client's
 * configuration names (the Claude Code / Claude-Nine launcher found
 * by route discovery) as a subprocess, in print mode, and reads its
 * structured JSON result envelope. The harness keeps its own routing,
 * and its own credentials. It passes NO model flag unless the pinned
 * route snapshot names a model (options.model, the client's explicit
 * choice or the harness default the route choice pinned); otherwise the
 * harness's own configured model applies. It scrapes no OAuth token or cookie, and manufactures no API
 * access from a subscription. What the harness resolves is reported
 * back to the CWE-010 guard by the bridge resolver, never invented
 * here.
 *
 * Failure honesty: a harness that exits non-zero or reports an error
 * envelope fails the operation through the normal transport error
 * path. A delegate killed by the deadline AFTER the harness announced
 * it started (stream-json init line) may or may not have completed
 * provider-side, so that failure carries unknownCompletion = true and
 * the engine never replays it (Section 15.5). A delegate that never
 * announced it started sent nothing to the provider: that failure is
 * retryable, and the runner admits exactly one bounded retry. Response bodies are not persisted by this delegate;
 * only the parsed text and structured identity/usage fields leave it.
 */
import { spawn } from 'node:child_process';
import type { ModelTransport, TransportRequest, TransportResponse } from './host-ports.js';
export declare const DEFAULT_HOST_CALL_TIMEOUT_MS = 600000;
/**
 * Spawn-to-init budget for a stream-json harness. A harness that has not
 * announced it started by then sent nothing to the provider, so it is
 * killed and retried instead of waiting out the whole call deadline.
 */
export declare const DEFAULT_STARTUP_TIMEOUT_MS = 300000;
export declare class HostCallTransportError extends Error {
    readonly retryable: boolean;
    readonly unknownCompletion: boolean;
    /** Raw stdout+stderr, set only for a non-zero exit or an error envelope. */
    readonly rawOutput: string | undefined;
    constructor(message: string, options?: {
        unknownCompletion?: boolean;
        rawOutput?: string;
        retryable?: boolean;
    });
}
export interface HostCallTransportOptions {
    /** Absolute path of the harness executable the configuration names. */
    executable: string;
    /**
     * The harness config root this route serves. Passed to the child as
     * CLAUDE_CONFIG_DIR so a plain harness executable serves the same
     * root the route was discovered from; launcher scripts that set it
     * themselves set the identical value. Omitted for the default
     * ~/.claude root, whose macOS Keychain login is keyed on the variable
     * being unset.
     */
    configDir?: string;
    /** Extra environment for the child, merged over the inherited env. */
    env?: NodeJS.ProcessEnv;
    /**
     * Wire model the pinned route snapshot names. Non-null adds
     * `--model <model>` to the harness call; null/absent passes no model
     * flag, so the harness's own configured default applies.
     */
    model?: string | null;
    /** Verified operation deadline. Default: Section 15.8 initial default. */
    timeoutMs?: number;
    /** Spawn-to-init budget (stream-json harness only). Default 300 s. */
    startupTimeoutMs?: number;
    /** `--help` probe limit. Default 45 s; injectable for tests. */
    helpTimeoutMs?: number;
    /** Injectable spawn for embedding; production uses node:child_process. */
    spawnImpl?: typeof spawn;
    /** Injectable retry sleep for tests; production waits for real time. */
    sleepImpl?: (ms: number) => Promise<void>;
    /**
     * Attempts this transport may make for one operation. Default keeps the
     * historical 3 (one call plus at most two transient retries). A one-shot
     * preparation request passes 1: it never retries, so it can never spend
     * more than the single provider request its budget records.
     */
    maxAttempts?: number;
}
export declare class SubprocessHostCallTransport implements ModelTransport {
    private readonly options;
    constructor(options: HostCallTransportOptions);
    get executable(): string;
    /** Wire model passed as --model, or null when the harness default applies. */
    get model(): string | null;
    generate(request: TransportRequest): Promise<TransportResponse>;
    private runOnce;
}
