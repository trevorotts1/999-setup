/**
 * Host bridge shared machinery (CWE-010; directive Sections 13, 14, 25).
 *
 * The two host bridges (OpenClaw and Claude-Nine) sit behind the CWE-004
 * host ports so the SAME portable core runs under either harness. This
 * module is the harness-neutral half both bridges share:
 *
 * - The explicit route catalog semantics of CWE-008, mirrored into the
 *   canonical package from the CC-side catalog at commit fb714b7b
 *   (src/lib/council/providers.ts and src/lib/council/explicit-selection.ts,
 *   read in full by this unit). The CC module imports Command Center host
 *   functions and cannot be imported across repos or across harnesses, so
 *   the semantics live here in the canonical package and the parity
 *   surface (parity.ts) proves both bridges apply them identically.
 * - A guarded transport that wraps a harness delegate transport: the
 *   client's selected route reaches execution unchanged, a host attempt
 *   to execute a different model is refused or, only under a
 *   client-approved fallback policy with an approval record, surfaced as
 *   a recorded route-change event. Substitution is never silent.
 * - A bridge host composition over the CWE-004 standalone local host:
 *   council state is read and written ONLY through the CWE-004 ports
 *   (the shared local store in the per-user data directory), never a
 *   per-bridge private store, and the persisted state-authority mode is
 *   never silently switched (see assertStandaloneAuthorityMode).
 *
 * Identity law (Section 13.2): route identity has five distinct levels
 * and they are never conflated. A successful request is not proof of a
 * particular backend model, and runtime identity is never inferred from
 * a model's own prose response: a prose claim is recorded as ignored.
 *
 * Secret law (Sections 13.1, 28.5): credential VALUES never enter any
 * structure this module emits. Catalogs and selections carry credential
 * presence (env-var name and store label) only.
 *
 * Model law: this module prescribes no named model anywhere. The client
 * selects the route, or their configured default applies; the bridges
 * only carry the selection through unchanged.
 */
import type { Clock, ModelPolicy, ScopeFields } from '../contracts/index.js';
import type { CouncilHost, CouncilStore, ModelTransport, TransportRequest, TransportResponse } from '../cli/host-ports.js';
import type { RouteDiscoveryInfo } from '../cli/route-discovery.js';
export type BridgeHarness = 'openclaw' | 'claude-nine';
/**
 * The state-authority mode both standalone bridges operate under
 * (Sections 5.4 and 25.6). It is persisted on the bridge instance and on
 * every grant the local composition admits; it is never silently
 * switched. Command Center mode is composed by the Command Center
 * adapter (CWE-007), not by these standalone bridges.
 */
export declare const STANDALONE_AUTHORITY_MODE: "local_interactive_owner";
export type StandaloneAuthorityMode = typeof STANDALONE_AUTHORITY_MODE;
/**
 * Fail closed when a caller asks a standalone bridge for a different
 * state-authority mode than the persisted standalone mode. Switching
 * modes silently would move council state authority without the owner
 * ever seeing it (Section 5.4), so any other mode is an honest
 * FEATURE_NOT_READY naming the owning unit, never a quiet local run.
 */
export declare function assertStandaloneAuthorityMode(requested: string | null | undefined): void;
export declare const ROUTE_IDENTITY_LEVELS: readonly ["configured", "transport_probed", "reported_identity", "resolved_identity_verified", "quality_qualified"];
export type RouteIdentityLevel = (typeof ROUTE_IDENTITY_LEVELS)[number];
export declare function identityLevelRank(level: RouteIdentityLevel): number;
/**
 * The exact statement the product must show when a router hides the
 * underlying model identity (Section 13.2).
 */
export declare const HIDDEN_IDENTITY_STATEMENT = "Selected route used; underlying model identity not independently exposed.";
export type RouteKind = 'fixed_model' | 'combination';
export type CredentialSourceName = 'process.env' | 'env_file' | 'openclaw_json' | 'openclaw_auth_store';
export interface CredentialPresence {
    state: 'present' | 'absent' | 'not_required';
    /** Env-var NAME the credential was found under. Never the value. */
    envVar: string | null;
    /** Store the credential was found in. Never the value. */
    source: CredentialSourceName | null;
    /** Candidate env-var names checked when absent. Names only. */
    checked: string[];
}
export interface RouteCapabilitySnapshot {
    contextWindowTokens: number | null;
    maxOutputTokens: number | null;
    capabilities: string[];
    /**
     * Reasoning levels the route is documented or probed to support, in
     * the route's own vocabulary. Null means not yet probed: support is
     * unknown and no preference may be claimed active.
     */
    supportedReasoningLevels: string[] | null;
}
export interface ProviderRouteDescriptor {
    /** Stable route reference, unique within the installation. */
    routeId: string;
    providerSlug: string;
    displayLabel: string;
    kind: RouteKind;
    /** The one named model for a fixed_model route. Null for combinations. */
    modelId: string | null;
    /**
     * Ordered, pinned member model ids for a combination route. The
     * approved combination is exactly this list. Empty for fixed routes.
     */
    combinationMembers: string[];
    /**
     * Opaque reference to the provider account this route is bound to.
     * Never a credential value.
     */
    providerAccountRef: string | null;
    capability: RouteCapabilitySnapshot;
    credential: CredentialPresence;
}
export interface RouteEvidence {
    /** A real transport probe reached the endpoint for this route. */
    transportProbed: boolean;
    /** Identity the transport or provider reported, when it exposes one. */
    reportedModelId: string | null;
    /** Independent identity verification record, when one exists. */
    identityVerification: {
        verified: boolean;
        method: string;
    } | null;
    /** Recorded quality evaluation, when one exists. */
    evaluation: {
        status: 'passed' | 'failed' | 'not_run';
        evaluationId: string | null;
        recordedAt: string | null;
    } | null;
}
export declare const NO_ROUTE_EVIDENCE: RouteEvidence;
/**
 * Route readiness. A route that is merely listed is UNTESTED. A
 * transport probe raises it to PROBED, which is still not qualified.
 * Only a recorded, passing evaluation makes a route QUALIFIED.
 */
export type RouteReadiness = 'UNTESTED' | 'PROBED' | 'QUALIFIED';
export declare function deriveRouteReadiness(evidence: RouteEvidence): RouteReadiness;
/**
 * The strongest identity level the evidence supports, and no stronger.
 * An evaluation pass is required for `quality_qualified`; a provider
 * report alone never reaches `resolved_identity_verified`.
 */
export declare function deriveIdentityLevel(evidence: RouteEvidence): RouteIdentityLevel;
export interface RouteCatalogEntry {
    routeId: string;
    providerSlug: string;
    displayLabel: string;
    kind: RouteKind;
    modelId: string | null;
    combinationMembers: string[];
    providerAccountRef: string | null;
    capability: RouteCapabilitySnapshot;
    credential: CredentialPresence;
    identityLevel: RouteIdentityLevel;
    readiness: RouteReadiness;
    /** True only when a recorded evaluation passed. Listed is not qualified. */
    qualityQualified: boolean;
}
export declare function buildRouteCatalog(routes: ProviderRouteDescriptor[], evidenceByRouteId?: ReadonlyMap<string, RouteEvidence>): RouteCatalogEntry[];
export declare function findCatalogEntry(catalog: RouteCatalogEntry[], routeId: string): RouteCatalogEntry | null;
export type BridgeSelectionErrorCode = 'ROUTE_NOT_IN_CATALOG' | 'UNTRUSTED_SCOPE_FIELD' | 'INVALID_SELECTION' | 'COMBINATION_MEMBER_REQUIRED';
export declare class BridgeSelectionError extends Error {
    readonly code: BridgeSelectionErrorCode;
    constructor(code: BridgeSelectionErrorCode, message: string);
}
export interface TrustedScope {
    tenantId: string;
    companyId: string;
    installationId: string;
    ownerSubject: string | null;
}
export declare function trustedScopeFromScopeFields(scope: ScopeFields): TrustedScope;
export declare function scopeFieldsFromTrustedScope(scope: TrustedScope): ScopeFields;
export type BridgeModelSelectionSource = 'explicit' | 'client_default' | 'route_default';
export type BridgeFallbackPolicy = 'none' | 'client_approved_only';
export interface ReasoningPreferenceOutcome {
    /** Exactly what the client asked for. Never renamed. */
    requested: string | null;
    /** What will actually be applied. Null when nothing may be claimed active. */
    applied: string | null;
    /** True/false when support is known; null when the route is unprobed. */
    supported: boolean | null;
    /** Plain-language limitation, present whenever applied differs from asked. */
    limitation: string | null;
}
export interface CouncilRouteSelection {
    schema: 'wise-elders.route-selection/v1';
    selectionSource: BridgeModelSelectionSource;
    routeId: string;
    routeRevision: number;
    routeKind: RouteKind;
    providerSlug: string;
    /** Exact requested route reference (the catalog route id). */
    requestedRoute: string;
    /** Requested model or alias for a fixed route. Null for combinations. */
    requestedModelOrAlias: string | null;
    /** Pinned, ordered combination members. Null for fixed routes. */
    combinationMembers: string[] | null;
    reasoning: ReasoningPreferenceOutcome;
    fallbackPolicy: BridgeFallbackPolicy;
    providerAccountRef: string | null;
    capabilitySnapshot: RouteCapabilitySnapshot;
    credential: CredentialPresence;
    /** Identity level at selection time; never stronger than the evidence. */
    identityLevel: RouteIdentityLevel;
    scope: TrustedScope;
    createdAt: string;
}
/**
 * Untrusted client input. Every field is a request, never evidence.
 * Scope fields are detected only so a conflict can be rejected; they are
 * never read as authority.
 */
export interface RouteSelectionRequest {
    routeId: string;
    selectionSource?: BridgeModelSelectionSource;
    requestedModelOrAlias?: string | null;
    reasoningPreference?: string | null;
    fallbackPolicy?: BridgeFallbackPolicy;
    providerAccountRef?: string | null;
    [key: string]: unknown;
}
/**
 * Create the pinned selection snapshot for a session revision. The
 * catalog entry is the frozen route fact source; the scope is the
 * trusted host argument only.
 */
export declare function createRouteSelection(entry: RouteCatalogEntry, request: RouteSelectionRequest, trustedScope: TrustedScope, options: {
    routeRevision: number;
    createdAt: string;
}): CouncilRouteSelection;
/**
 * Build the pinned selection from a frozen session spec's model policy
 * (CWE-003 ModelPolicy). This is how a bridge binds the route the
 * session actually selected: the spec is the frozen fact, never a live
 * re-read of the catalog at execution time.
 */
export declare function selectionFromModelPolicy(entry: RouteCatalogEntry, policy: ModelPolicy, scope: ScopeFields, options: {
    routeRevision: number;
    createdAt: string;
}): CouncilRouteSelection;
export type HostResolutionSource = 'explicit_route' | 'cascade' | 'sovereign_default' | 'runtime_reconcile' | 'combination_member' | 'fallback';
export interface ClientFallbackApproval {
    approvalRef: string;
    reason: string;
    /** Cost implications of the change, stated by the approval record. */
    costImplication: string;
}
export interface HostResolutionAttempt {
    source: HostResolutionSource;
    /** Model the host used or tried to use, when the transport exposes one. */
    attemptedModelId: string | null;
    /**
     * Identity reported by the transport or provider through a structured
     * field. This is the only reported-identity input. Null when the
     * router hides the underlying model.
     */
    reportedModelId?: string | null;
    /**
     * A model identity claimed in a model's own prose response. Accepted
     * only so the outcome can record that it was ignored: prose is never
     * identity evidence (Section 13.2).
     */
    proseClaimedModelId?: string | null;
    /** Client approval for a fallback change, when one exists. */
    approval?: ClientFallbackApproval | null;
}
export interface RouteChangeRecord {
    reason: string;
    originalRoute: string;
    replacementRoute: string;
    costImplications: string;
    newRouteRevision: number;
    approvalRef: string;
}
export type RouteResolutionEvent = {
    type: 'route_resolution_accepted';
    routeId: string;
    effectiveModelId: string | null;
    source: HostResolutionSource;
} | {
    type: 'substitution_refused';
    routeId: string;
    requestedModelOrAlias: string | null;
    attemptedModelId: string | null;
    source: HostResolutionSource;
    reason: string;
} | {
    type: 'substitution_approved';
    routeId: string;
    change: RouteChangeRecord;
} | {
    type: 'combination_member_resolved';
    routeId: string;
    memberModelId: string;
} | {
    type: 'identity_not_exposed';
    routeId: string;
    statement: string;
} | {
    type: 'prose_identity_claim_ignored';
    routeId: string;
    claimedModelId: string;
};
export interface RouteResolutionOutcome {
    outcome: 'accepted' | 'refused' | 'substituted_with_approval';
    /** The model the council may proceed with. Null when refused. */
    effectiveModelId: string | null;
    /** Strongest identity level the structured evidence supports. */
    identityLevel: RouteIdentityLevel;
    /** Set when the underlying identity is hidden and must be disclosed. */
    identityStatement: string | null;
    changeRecord: RouteChangeRecord | null;
    events: RouteResolutionEvent[];
}
export declare function applyHostResolution(selection: CouncilRouteSelection, attempt: HostResolutionAttempt): RouteResolutionOutcome;
export declare function selectionClientPayload(selection: CouncilRouteSelection): {
    schema: "wise-elders.route-selection/v1";
    routeId: string;
    routeRevision: number;
    routeKind: RouteKind;
    providerSlug: string;
    requestedRoute: string;
    requestedModelOrAlias: string | null;
    combinationMembers: string[] | null;
    reasoning: {
        /** Exactly what the client asked for. Never renamed. */
        requested: string | null;
        /** What will actually be applied. Null when nothing may be claimed active. */
        applied: string | null;
        /** True/false when support is known; null when the route is unprobed. */
        supported: boolean | null;
        /** Plain-language limitation, present whenever applied differs from asked. */
        limitation: string | null;
    };
    fallbackPolicy: BridgeFallbackPolicy;
    providerAccountRef: string | null;
    capability: {
        contextWindowTokens: number | null;
        maxOutputTokens: number | null;
        capabilities: string[];
        supportedReasoningLevels: string[] | null;
    };
    credential: {
        state: "not_required" | "present" | "absent";
        envVar: string | null;
        source: CredentialSourceName | null;
    };
    identityLevel: "configured" | "transport_probed" | "reported_identity" | "resolved_identity_verified" | "quality_qualified";
    companyId: string;
};
export interface RouteResolutionRecord {
    harness: BridgeHarness;
    route_id: string;
    session_id: string | null;
    outcome: RouteResolutionOutcome;
    recorded_at: string;
}
export declare class RouteResolutionJournal {
    private readonly records;
    record(entry: RouteResolutionRecord): void;
    list(): RouteResolutionRecord[];
    /** All recorded route-change events (refusals and approved changes). */
    routeChanges(): RouteResolutionRecord[];
}
/** Thrown when the guard refuses a host resolution. Never retryable. */
export declare class RouteResolutionRefusedError extends Error {
    readonly retryable = false;
    readonly outcome: RouteResolutionOutcome;
    constructor(selection: CouncilRouteSelection, outcome: RouteResolutionOutcome);
}
export interface GuardedTransportOptions {
    harness: BridgeHarness;
    selection: CouncilRouteSelection;
    delegate: ModelTransport;
    /**
     * The harness's own report of what it resolved for this request,
     * inside its own harness only. Supplied by the bridge (OpenClaw or
     * Claude-Nine), never by the other harness.
     */
    reportAttempt: (selection: CouncilRouteSelection, request: TransportRequest) => HostResolutionAttempt | Promise<HostResolutionAttempt>;
    journal: RouteResolutionJournal;
    clock: Clock;
}
export declare class GuardedTransport implements ModelTransport {
    private readonly options;
    constructor(options: GuardedTransportOptions);
    get selection(): CouncilRouteSelection;
    generate(request: TransportRequest): Promise<TransportResponse>;
}
export interface BridgeRouteBinding {
    routeId: string;
    /** The harness delegate transport that performs accepted requests. */
    delegate: ModelTransport;
    /** The harness's resolution report for each request. */
    reportAttempt: (selection: CouncilRouteSelection, request: TransportRequest) => HostResolutionAttempt | Promise<HostResolutionAttempt>;
    /** Frozen session model policy, when the binding serves a session spec. */
    policy?: ModelPolicy;
    /** Explicit selection request, used when no policy is supplied. */
    request?: RouteSelectionRequest;
    /** Trusted scope for the selection. Defaults to the bridge scope. */
    scope?: ScopeFields;
    routeRevision?: number;
}
export interface BridgeHostOptions {
    dataDir?: string;
    skillRoot?: string;
    /**
     * Requested state-authority mode. Anything other than the persisted
     * standalone mode fails closed (assertStandaloneAuthorityMode); the
     * mode is never silently switched.
     */
    authorityMode?: string;
    /** Configured route descriptors for this installation's catalog. */
    routes?: ProviderRouteDescriptor[];
    evidenceByRouteId?: ReadonlyMap<string, RouteEvidence>;
    bindings?: BridgeRouteBinding[];
    /** Trusted scope for selections. Defaults to the standalone local scope. */
    scope?: ScopeFields;
    /** Home directory route discovery reads under. Default: the OS home. */
    homeDir?: string;
    /** Environment route discovery and credential presence read. Default: process.env. */
    env?: NodeJS.ProcessEnv;
    /** Compose real transports for discovered routes. Default true. */
    discoverRoutes?: boolean;
}
export interface BridgeInstance {
    harness: BridgeHarness;
    host: CouncilHost;
    dataDir: string;
    store: CouncilStore;
    catalog: RouteCatalogEntry[];
    /**
     * Secret-free route-discovery diagnostics from the SAME local host the
     * bridge composes (RP-046-1). Carried through so a wrapper that hands
     * the bridge to the CLI never swallows `models`/`doctor` diagnostics.
     */
    routeDiscovery: RouteDiscoveryInfo[];
    selections: ReadonlyMap<string, CouncilRouteSelection>;
    journal: RouteResolutionJournal;
    authorityMode: typeof STANDALONE_AUTHORITY_MODE;
}
export declare function composeBridgeHost(harness: BridgeHarness, options?: BridgeHostOptions): BridgeInstance;
