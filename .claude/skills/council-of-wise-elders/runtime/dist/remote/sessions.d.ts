/**
 * Remote session resolution and reauthentication (WER-023).
 *
 * Reuses the merged WER-021 shapes rather than inventing parallel ones:
 * `sessionUrl` builds the true URL from a bound origin, and the session
 * authority vocabulary (`standalone` | `managed`) is the existing one.
 *
 * Guarantees proven by the colocated tests:
 * - remote access is opt-in: a disabled configuration refuses remote
 *   resolution with a typed reason and never emits a localhost URL;
 * - one session resolves to exactly ONE verified HTTPS endpoint URL, or a
 *   typed failure — an ambiguous ownership record is refused, never
 *   guessed;
 * - reauthentication resumes the SAME durable session id and issues ZERO
 *   billable Start calls;
 * - connection loss is a transport state, never a cancellation, and the
 *   durable session survives token expiry and reconnect;
 * - a cross-user attempt is refused with the SAME reason as an unknown
 *   session, so it cannot confirm that the other subject's session exists.
 */
import { createAccessJwksSource, expectedIssuer } from './access-jwt.js';
import type { JwksSource, RemoteConfiguration, RemoteConnectionLoss, RemoteEndpoint, RemoteHeaders, RemoteIdentity, RemoteSessionResolution, SessionLookup } from './types.js';
export declare class RemoteConfigurationError extends Error {
    readonly code: 'REMOTE_CONFIG_INVALID';
    constructor(detail: string);
}
export interface RemoteConfigurationInput {
    enabled: boolean;
    team_domain?: string;
    audience?: string;
    allowed_origins?: readonly string[];
    endpoints?: readonly RemoteEndpoint[];
    /** Injected JWKS source; defaults to the live Access endpoint for this team. */
    jwks?: JwksSource;
    clock_skew_seconds?: number;
}
/**
 * Build a validated configuration. An absent/disabled configuration is
 * valid and returns the typed disabled variant; only a half-enabled
 * configuration throws, so a partially configured customer never runs.
 */
export declare function buildRemoteConfiguration(input: RemoteConfigurationInput): RemoteConfiguration;
export interface ResolveRemoteSessionInput {
    session_id: string;
    identity: RemoteIdentity;
    config: RemoteConfiguration;
    lookupSession: SessionLookup;
    resumed: boolean;
    billable_starts: number;
}
/**
 * Resolve one session to exactly one verified HTTPS endpoint URL.
 * Ownership, endpoint selection and origin membership are all enforced.
 */
export declare function resolveRemoteSession(input: ResolveRemoteSessionInput): Promise<RemoteSessionResolution>;
export interface RemoteSessionBridgeOptions {
    config: RemoteConfiguration;
    lookupSession: SessionLookup;
    /** Injected clock in epoch seconds; tests fix it. */
    now_seconds?: () => number;
    /** Durable, billable Start. Invoked only on first establishment of a session. */
    startBillable?: (input: {
        session_id: string;
    }) => unknown;
    /** Cancellation port. Never invoked by a connection-loss observation. */
    cancelSession?: (input: {
        session_id: string;
    }) => unknown;
}
export interface RemoteRequest {
    session_id: string;
    headers: RemoteHeaders;
}
/**
 * One durable remote session per phone. Tracks the active session id and
 * the billable Start count so reauthentication can be proven to issue
 * zero Starts.
 */
export declare class RemoteSessionBridge {
    private readonly options;
    private activeSessionId;
    private starts;
    private reauthenticationStarts;
    private cancels;
    constructor(options: RemoteSessionBridgeOptions);
    get sessionId(): string | null;
    get billableStarts(): number;
    /** Starts issued during reauthentication. Always 0 by construction. */
    get reauthenticationBillableStarts(): number;
    get cancellations(): number;
    /** First establishment: may issue the one billable Start for this session. */
    establish(request: RemoteRequest): Promise<RemoteSessionResolution>;
    /** Resume after token expiry. Same durable session id; never a Start. */
    reauthenticate(request: RemoteRequest): Promise<RemoteSessionResolution>;
    /** Resume after connection loss. Same durable session id; never a Start. */
    resume(request: RemoteRequest): Promise<RemoteSessionResolution>;
    /**
     * Observe a transport loss. The durable session id and its live state
     * are preserved; this is never a cancellation.
     */
    connectionLost(input: {
        session_id: string;
    }): RemoteConnectionLoss;
    private run;
}
/** Exposed so the composition root can bind the real team's key source. */
export { createAccessJwksSource, expectedIssuer };
