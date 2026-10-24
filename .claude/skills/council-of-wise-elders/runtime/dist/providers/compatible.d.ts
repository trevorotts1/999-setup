/**
 * OpenAI-compatible HTTP transport (CWE-009; directive Sections 13
 * and 15). One transport instance is bound to ONE pinned CWE-008
 * selection snapshot and ONE configured endpoint. It works for any
 * configured OpenAI-compatible endpoint (OpenRouter, 9Router remote,
 * a direct provider gateway, a local daemon's compatible surface)
 * without assuming URLs, aliases, or model names: the endpoint comes
 * from the binding, the wire model comes from the pinned selection.
 *
 * Guarantees held here:
 * - Route pinning: the request body is built once per operation from
 *   the frozen selection; the model string is byte-identical to the
 *   selection's pinned model (fixed routes) or pinned route reference
 *   (combinations, whose router may resolve only to approved members).
 *   A TransportRequest naming any other route or model is refused
 *   before dispatch. There is no substitution, no cascade, and no
 *   fallback chain in this module.
 * - Resolution honesty: after every completed response, the transport
 *   reports what actually happened through evaluateRouteResolution
 *   (the CWE-008 guard). A refused resolution returns NO model text.
 *   Identity levels come from structured evidence only, and a probe
 *   never claims resolved or qualified identity (Section 13.4).
 * - Deadlines: the route's verified deadline where the binding
 *   carries one, else the clearly displayed initial default of 600
 *   seconds per operation (Section 15.8), enforced separately from
 *   operation leases and shared across the operation's attempts.
 * - Retries: transient network/429/5xx only. In transport retry mode,
 *   at most one retry per attempted network operation, reserved in the
 *   CWE-004 budget ledger as a transport_retry so it counts toward
 *   the session's 50-request ceiling and the 8-retry session ceiling
 *   the ledger enforces. In engine retry mode the transport performs
 *   one attempt and marks transient errors retryable for the engine's
 *   own bounded loop (which reserves identically). 401/403/404,
 *   invalid auth, missing model, policy denial, and unsupported
 *   endpoint errors stop with no blind retry (Section 15.5).
 * - Uncertain completion: provider_submitted_unresolved is a
 *   first-class attempt state; a timed-out or broken submission keeps
 *   its budget reservation (the engine marks it unknown) and is never
 *   assumed failed or duplicated blindly.
 * - Diagnostics: Section 16.6 governs every record. Attempt records
 *   and the diagnostic sink hold safe metadata only; raw bodies are
 *   memory-only during the attempt and are never persisted, logged,
 *   or exported. The credential value exists only in the in-flight
 *   Authorization header and in the sink's in-memory scan set.
 */
import type { BudgetLedger, ModelTransport, TransportRequest, TransportResponse } from '../cli/host-ports.js';
import { TransportDiagnosticSink } from './diagnostics.js';
import { TransportError } from './errors.js';
import { type FetchLike } from './http-core.js';
import { type ReasoningParamStyle } from './reasoning.js';
import { type CouncilRouteSelection, type RouteIdentityLevel, type RouteResolutionOutcome } from './selection.js';
import { type EndpointAssessment } from './url-policy.js';
/** Section 15.8 initial default provider deadline: 600 seconds per operation. */
export declare const DEFAULT_OPERATION_DEADLINE_MS = 600000;
/** Default cap on a single retry delay, whatever Retry-After asks for. */
export declare const DEFAULT_MAX_RETRY_DELAY_MS = 30000;
/** Fallback backoff when a transient response carries no Retry-After. */
export declare const DEFAULT_RETRY_BASE_DELAY_MS = 1000;
export type TransportRetryMode = 'transport' | 'engine' | 'none';
export interface CompatibleTransportBinding {
    /** The pinned CWE-008 selection snapshot this transport serves. */
    selection: CouncilRouteSelection;
    /** Configured provider base URL (authorized configuration path only). */
    baseUrl: string;
    /** Path appended to baseUrl. Default '/chat/completions'. */
    chatCompletionsPath?: string;
    /** Explicit opt-in for plain http to a public endpoint. Default false. */
    allowInsecureRemoteHttp?: boolean;
    /**
     * Host credential resolver path (the CWE-008 pattern): returns the
     * credential VALUE for the in-flight request only. The value is
     * never recorded. Required unless the selection's credential state
     * is not_required.
     */
    credentialResolver?: (selection: CouncilRouteSelection) => Promise<string | null>;
    /**
     * Route-specific verified deadline in milliseconds (Section 15.8),
     * from verified route data. Absent: the initial default applies and
     * is displayed as such.
     */
    verifiedDeadlineMs?: number;
    /** Request the streaming form of the compatible API. Default false. */
    stream?: boolean;
    /** Reasoning parameter style for this endpoint family. Default 'reasoning_effort'. */
    reasoningParamStyle?: ReasoningParamStyle;
    /** Retry ownership. Default: 'transport' when a budget ledger is composed, else 'engine'. */
    retryMode?: TransportRetryMode;
    /** Budget ledger (CWE-004 port). Required in transport retry mode. */
    budget?: BudgetLedger;
    /** Diagnostic sink. Default: a new sink under the default retention policy. */
    diagnostics?: TransportDiagnosticSink;
    /** Observer for route-resolution outcomes (route-change records). */
    onRouteResolution?: (outcome: RouteResolutionOutcome) => void;
    /** Injectable fetch for tests and host embedding. Default: global fetch. */
    fetchImpl?: FetchLike;
    /** Injectable clock (milliseconds) for deadline accounting. */
    nowMs?: () => number;
    /** Injectable sleep for retry delays. Default: real timers. */
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    /** Injectable random source for bounded jitter. Default Math.random. */
    random?: () => number;
    /** Cap on one retry delay. Default DEFAULT_MAX_RETRY_DELAY_MS. */
    maxRetryDelayMs?: number;
}
/** One network attempt, recorded with safe metadata only (Section 16.6). */
export interface TransportAttemptRecord {
    attemptId: string;
    sessionId: string;
    routeId: string;
    routeRevision: number;
    selectionSha256: string;
    /** The exact model string placed on the wire for this attempt. */
    wireModel: string;
    endpointOrigin: string;
    endpointLocality: EndpointAssessment['locality'];
    /** 0 for the initial attempt, 1 for the single permitted retry. */
    retryIndex: 0 | 1;
    /**
     * Attempt state. provider_submitted_unresolved is the transport name
     * for the canonical provider_completion_unknown operation status.
     */
    state: 'accepted' | 'failed' | 'provider_submitted_unresolved' | 'substitution_refused' | 'cancelled';
    canonicalOperationStatus: 'accepted' | 'failed' | 'provider_completion_unknown' | 'cancelled';
    httpStatus: number | null;
    providerRequestId: string | null;
    reportedModelId: string | null;
    /** Strongest identity level the structured evidence supports after this attempt. */
    identityLevelAfter: RouteIdentityLevel;
    identityStatement: string | null;
    /** Resolved combination member, when the provider exposed one (T030). */
    combinationMemberResolved: string | null;
    errorCode: string | null;
    deadlineMs: number;
    deadlineSource: 'route_verified' | 'initial_default';
    responseBytes: number | null;
    responseSha256: string | null;
    startedAt: string;
    durationMs: number;
}
export interface TransportDescription {
    routeId: string;
    routeRevision: number;
    providerSlug: string;
    routeKind: CouncilRouteSelection['routeKind'];
    selectionSha256: string;
    endpointOrigin: string;
    endpointLocality: EndpointAssessment['locality'];
    deadlineMs: number;
    deadlineSource: 'route_verified' | 'initial_default';
    /** Human display, for readiness surfaces (Sections 15.8, 17.3). */
    deadlineDisplay: string;
    credentialState: CouncilRouteSelection['credential']['state'];
    /** Precise readiness blocker, or null when the route can be called (T027). */
    readinessBlocker: string | null;
    identityLevelAtBind: RouteIdentityLevel;
    stream: boolean;
}
/** Classify an HTTP error status (Section 15.5). Returns a typed error. */
export declare function classifyHttpStatus(status: number, retryAfterMs: number | null): TransportError;
export declare class CompatibleHttpTransport implements ModelTransport {
    readonly selection: CouncilRouteSelection;
    readonly selectionSha256: string;
    private readonly endpoint;
    private readonly binding;
    private readonly diagnostics;
    private readonly retryMode;
    private readonly deadlineMs;
    private readonly deadlineSource;
    private readonly attemptLog;
    private readonly resolutions;
    private callSequence;
    constructor(binding: CompatibleTransportBinding);
    /** Readiness and identity description for operator surfaces. */
    describe(): TransportDescription;
    /** T027: a missing credential is a precise blocker, never a borrowed one. */
    private readinessBlocker;
    /** Safe attempt records, in order. Bodies and credentials are never present. */
    attempts(): readonly TransportAttemptRecord[];
    /** Route-resolution outcomes reported by this transport, in order. */
    routeResolutions(): readonly RouteResolutionOutcome[];
    /** The wire model for the pinned selection. Byte-identical by construction. */
    private wireModel;
    /**
     * Refuse any request that does not name the pinned route and model.
     * Runs before credential resolution, budget activity, and dispatch.
     */
    private assertPinning;
    private resolveCredential;
    /** Build the request body once per operation: retries send identical bytes. */
    private buildBody;
    /** Bounded jittered retry delay: honors Retry-After, capped, never negative. */
    private retryDelayMs;
    generate(request: TransportRequest): Promise<TransportResponse>;
    private recordAttempt;
}
/** Factory mirroring the other council module constructors. */
export declare function createCompatibleTransport(binding: CompatibleTransportBinding): CompatibleHttpTransport;
/**
 * Registry entries for the CWE-004 host composition
 * (createLocalHost's `transports` option and MapTransportRegistry):
 * each transport registers under exactly its pinned route id. This is
 * the registry re-point the CWE-008 acceptance flagged: hosts register
 * these pinned transports instead of any unpinned adapter, so the
 * engine's route lookup can only ever reach the selected route.
 */
export declare function pinnedTransportEntries(transports: CompatibleHttpTransport[]): Array<{
    routeId: string;
    transport: CompatibleHttpTransport;
}>;
