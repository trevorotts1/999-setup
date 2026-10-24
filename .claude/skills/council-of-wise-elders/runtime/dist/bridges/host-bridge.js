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
import { CouncilError, featureNotReady } from '../cli/errors.js';
import { createLocalHost, localScope } from '../cli/local-host.js';
/**
 * The state-authority mode both standalone bridges operate under
 * (Sections 5.4 and 25.6). It is persisted on the bridge instance and on
 * every grant the local composition admits; it is never silently
 * switched. Command Center mode is composed by the Command Center
 * adapter (CWE-007), not by these standalone bridges.
 */
export const STANDALONE_AUTHORITY_MODE = 'local_interactive_owner';
/**
 * Fail closed when a caller asks a standalone bridge for a different
 * state-authority mode than the persisted standalone mode. Switching
 * modes silently would move council state authority without the owner
 * ever seeing it (Section 5.4), so any other mode is an honest
 * FEATURE_NOT_READY naming the owning unit, never a quiet local run.
 */
export function assertStandaloneAuthorityMode(requested) {
    if (requested === undefined || requested === null)
        return;
    if (requested === STANDALONE_AUTHORITY_MODE)
        return;
    throw featureNotReady(`State-authority mode "${requested}" composition`, 'the Command Center adapter (CWE-007); the standalone bridges persist local_interactive_owner and never switch modes silently');
}
// ---------------------------------------------------------------------------
// Route identity levels (Section 13.2). Ordered weakest to strongest.
// ---------------------------------------------------------------------------
export const ROUTE_IDENTITY_LEVELS = [
    'configured',
    'transport_probed',
    'reported_identity',
    'resolved_identity_verified',
    'quality_qualified',
];
export function identityLevelRank(level) {
    return ROUTE_IDENTITY_LEVELS.indexOf(level);
}
/**
 * The exact statement the product must show when a router hides the
 * underlying model identity (Section 13.2).
 */
export const HIDDEN_IDENTITY_STATEMENT = 'Selected route used; underlying model identity not independently exposed.';
export const NO_ROUTE_EVIDENCE = {
    transportProbed: false,
    reportedModelId: null,
    identityVerification: null,
    evaluation: null,
};
export function deriveRouteReadiness(evidence) {
    if (evidence.evaluation?.status === 'passed')
        return 'QUALIFIED';
    if (evidence.transportProbed)
        return 'PROBED';
    return 'UNTESTED';
}
/**
 * The strongest identity level the evidence supports, and no stronger.
 * An evaluation pass is required for `quality_qualified`; a provider
 * report alone never reaches `resolved_identity_verified`.
 */
export function deriveIdentityLevel(evidence) {
    if (evidence.evaluation?.status === 'passed')
        return 'quality_qualified';
    if (evidence.identityVerification?.verified)
        return 'resolved_identity_verified';
    if (evidence.reportedModelId)
        return 'reported_identity';
    if (evidence.transportProbed)
        return 'transport_probed';
    return 'configured';
}
export function buildRouteCatalog(routes, evidenceByRouteId = new Map()) {
    return routes.map((route) => {
        const evidence = evidenceByRouteId.get(route.routeId) ?? NO_ROUTE_EVIDENCE;
        const readiness = deriveRouteReadiness(evidence);
        return {
            routeId: route.routeId,
            providerSlug: route.providerSlug,
            displayLabel: route.displayLabel,
            kind: route.kind,
            modelId: route.modelId,
            combinationMembers: [...route.combinationMembers],
            providerAccountRef: route.providerAccountRef,
            capability: {
                contextWindowTokens: route.capability.contextWindowTokens,
                maxOutputTokens: route.capability.maxOutputTokens,
                capabilities: [...route.capability.capabilities],
                supportedReasoningLevels: route.capability.supportedReasoningLevels
                    ? [...route.capability.supportedReasoningLevels]
                    : null,
            },
            credential: {
                state: route.credential.state,
                envVar: route.credential.envVar,
                source: route.credential.source,
                checked: [...route.credential.checked],
            },
            identityLevel: deriveIdentityLevel(evidence),
            readiness,
            qualityQualified: readiness === 'QUALIFIED',
        };
    });
}
export function findCatalogEntry(catalog, routeId) {
    return catalog.find((entry) => entry.routeId === routeId) ?? null;
}
export class BridgeSelectionError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'BridgeSelectionError';
        this.code = code;
    }
}
export function trustedScopeFromScopeFields(scope) {
    return {
        tenantId: scope.tenant_id,
        companyId: scope.company_id,
        installationId: scope.installation_id,
        ownerSubject: scope.owner_subject,
    };
}
export function scopeFieldsFromTrustedScope(scope) {
    return {
        tenant_id: scope.tenantId,
        company_id: scope.companyId,
        installation_id: scope.installationId,
        owner_subject: scope.ownerSubject,
    };
}
/** Field names a client body may never use to establish scope. */
const SCOPE_FIELD_NAMES = [
    'tenant_id',
    'tenantId',
    'company_id',
    'companyId',
    'installation_id',
    'installationId',
    'owner_subject',
    'ownerSubject',
];
function assertNoConflictingScopeFields(request, scope) {
    const trustedByField = {
        tenant_id: scope.tenantId,
        tenantId: scope.tenantId,
        company_id: scope.companyId,
        companyId: scope.companyId,
        installation_id: scope.installationId,
        installationId: scope.installationId,
        owner_subject: scope.ownerSubject,
        ownerSubject: scope.ownerSubject,
    };
    for (const field of SCOPE_FIELD_NAMES) {
        const supplied = request[field];
        if (supplied === undefined || supplied === null)
            continue;
        if (String(supplied) !== String(trustedByField[field] ?? '')) {
            throw new BridgeSelectionError('UNTRUSTED_SCOPE_FIELD', `Body-supplied ${field} conflicts with the trusted scope and is not proof of scope.`);
        }
    }
}
function resolveReasoning(requested, capability) {
    if (requested === null) {
        return { requested: null, applied: null, supported: null, limitation: null };
    }
    // `auto` is preserved as no forced vendor-specific reasoning parameter.
    if (requested === 'auto') {
        return { requested, applied: 'auto', supported: true, limitation: null };
    }
    const supportedLevels = capability.supportedReasoningLevels;
    if (supportedLevels === null) {
        return {
            requested,
            applied: null,
            supported: null,
            limitation: `Reasoning preference "${requested}" is recorded, but this route has not been probed ` +
                'for reasoning support, so the preference is not claimed active.',
        };
    }
    if (supportedLevels.includes(requested)) {
        return { requested, applied: requested, supported: true, limitation: null };
    }
    return {
        requested,
        applied: null,
        supported: false,
        limitation: `Reasoning preference "${requested}" is not supported by this route. ` +
            `Supported levels: ${supportedLevels.join(', ') || 'none documented'}. ` +
            'The requested value is retained as requested; it was not renamed to another level ' +
            'and is not claimed active.',
    };
}
/**
 * Create the pinned selection snapshot for a session revision. The
 * catalog entry is the frozen route fact source; the scope is the
 * trusted host argument only.
 */
export function createRouteSelection(entry, request, trustedScope, options) {
    if (request.routeId !== entry.routeId) {
        throw new BridgeSelectionError('ROUTE_NOT_IN_CATALOG', `Requested route ${request.routeId} does not match catalog entry ${entry.routeId}.`);
    }
    assertNoConflictingScopeFields(request, trustedScope);
    if (entry.kind === 'fixed_model') {
        const requestedModel = request.requestedModelOrAlias ?? entry.modelId;
        if (!requestedModel || requestedModel !== entry.modelId) {
            throw new BridgeSelectionError('INVALID_SELECTION', 'A fixed-model selection must name the exact catalog model for the route.');
        }
    }
    if (entry.kind === 'combination' && entry.combinationMembers.length === 0) {
        throw new BridgeSelectionError('COMBINATION_MEMBER_REQUIRED', 'A combination route must carry its pinned member list.');
    }
    const fallbackPolicy = request.fallbackPolicy ?? 'none';
    const reasoning = resolveReasoning(request.reasoningPreference ?? null, entry.capability);
    return {
        schema: 'wise-elders.route-selection/v1',
        selectionSource: request.selectionSource ?? 'explicit',
        routeId: entry.routeId,
        routeRevision: options.routeRevision,
        routeKind: entry.kind,
        providerSlug: entry.providerSlug,
        requestedRoute: entry.routeId,
        requestedModelOrAlias: entry.kind === 'fixed_model' ? entry.modelId : null,
        combinationMembers: entry.kind === 'combination' ? [...entry.combinationMembers] : null,
        reasoning,
        fallbackPolicy,
        providerAccountRef: request.providerAccountRef ?? entry.providerAccountRef,
        capabilitySnapshot: {
            contextWindowTokens: entry.capability.contextWindowTokens,
            maxOutputTokens: entry.capability.maxOutputTokens,
            capabilities: [...entry.capability.capabilities],
            supportedReasoningLevels: entry.capability.supportedReasoningLevels
                ? [...entry.capability.supportedReasoningLevels]
                : null,
        },
        credential: {
            state: entry.credential.state,
            envVar: entry.credential.envVar,
            source: entry.credential.source,
            checked: [...entry.credential.checked],
        },
        identityLevel: entry.identityLevel,
        scope: { ...trustedScope },
        createdAt: options.createdAt,
    };
}
/**
 * Build the pinned selection from a frozen session spec's model policy
 * (CWE-003 ModelPolicy). This is how a bridge binds the route the
 * session actually selected: the spec is the frozen fact, never a live
 * re-read of the catalog at execution time.
 */
export function selectionFromModelPolicy(entry, policy, scope, options) {
    return createRouteSelection(entry, {
        routeId: entry.routeId,
        selectionSource: policy.selection,
        requestedModelOrAlias: policy.requested_model_id,
        reasoningPreference: policy.reasoning_preference,
        fallbackPolicy: policy.fallback_policy,
    }, trustedScopeFromScopeFields(scope), options);
}
function refusedOutcome(selection, attempt, reason, events) {
    events.push({
        type: 'substitution_refused',
        routeId: selection.routeId,
        requestedModelOrAlias: selection.requestedModelOrAlias,
        attemptedModelId: attempt.attemptedModelId,
        source: attempt.source,
        reason,
    });
    return {
        outcome: 'refused',
        effectiveModelId: null,
        identityLevel: selection.identityLevel,
        identityStatement: null,
        changeRecord: null,
        events,
    };
}
export function applyHostResolution(selection, attempt) {
    const events = [];
    // A prose claim is recorded as ignored and never consulted again below.
    if (attempt.proseClaimedModelId) {
        events.push({
            type: 'prose_identity_claim_ignored',
            routeId: selection.routeId,
            claimedModelId: attempt.proseClaimedModelId,
        });
    }
    const reported = attempt.reportedModelId ?? null;
    let identityLevel = selection.identityLevel;
    if (reported !== null &&
        identityLevelRank(identityLevel) < identityLevelRank('reported_identity')) {
        identityLevel = 'reported_identity';
    }
    if (selection.routeKind === 'combination') {
        return resolveCombination(selection, attempt, reported, identityLevel, events);
    }
    return resolveFixedModel(selection, attempt, reported, identityLevel, events);
}
function resolveFixedModel(selection, attempt, reported, identityLevel, events) {
    const requested = selection.requestedModelOrAlias;
    const attempted = attempt.attemptedModelId ?? reported;
    // The provider-reported identity conflicts with the requested model:
    // the requested and observed identities are kept distinct and the
    // conflict is surfaced, never smoothed over.
    if (reported !== null && requested !== null && reported !== requested) {
        return refusedOutcome(selection, { ...attempt, attemptedModelId: reported }, 'Provider-reported identity differs from the requested model for this fixed-model selection.', events);
    }
    if (attempted !== null && requested !== null && attempted === requested) {
        events.push({
            type: 'route_resolution_accepted',
            routeId: selection.routeId,
            effectiveModelId: attempted,
            source: attempt.source,
        });
        return {
            outcome: 'accepted',
            effectiveModelId: attempted,
            identityLevel,
            identityStatement: null,
            changeRecord: null,
            events,
        };
    }
    if (attempted === null) {
        // The transport exposed no model at all. The selected route was used
        // but its identity is not independently exposed, and that must be said.
        events.push({
            type: 'identity_not_exposed',
            routeId: selection.routeId,
            statement: HIDDEN_IDENTITY_STATEMENT,
        });
        return {
            outcome: 'accepted',
            effectiveModelId: requested,
            identityLevel: selection.identityLevel,
            identityStatement: HIDDEN_IDENTITY_STATEMENT,
            changeRecord: null,
            events,
        };
    }
    // The host resolved a different model than the client selected.
    if (selection.fallbackPolicy === 'client_approved_only' && attempt.approval) {
        const change = {
            reason: attempt.approval.reason,
            originalRoute: selection.requestedRoute,
            replacementRoute: attempted,
            costImplications: attempt.approval.costImplication,
            newRouteRevision: selection.routeRevision + 1,
            approvalRef: attempt.approval.approvalRef,
        };
        events.push({ type: 'substitution_approved', routeId: selection.routeId, change });
        return {
            outcome: 'substituted_with_approval',
            effectiveModelId: attempted,
            identityLevel,
            identityStatement: null,
            changeRecord: change,
            events,
        };
    }
    return refusedOutcome(selection, attempt, selection.fallbackPolicy === 'none'
        ? 'Fallback policy is none: a fixed-model council selection may not be replaced.'
        : 'Fallback requires a client approval record for this session.', events);
}
function resolveCombination(selection, attempt, reported, identityLevel, events) {
    const members = selection.combinationMembers ?? [];
    const exposedMember = attempt.attemptedModelId ?? reported;
    if (exposedMember !== null) {
        if (!members.includes(exposedMember)) {
            return refusedOutcome(selection, attempt, 'Resolved model is not a member of the approved combination. ' +
                'A combination is not permission to add models or cross provider accounts.', events);
        }
        events.push({
            type: 'combination_member_resolved',
            routeId: selection.routeId,
            memberModelId: exposedMember,
        });
        events.push({
            type: 'route_resolution_accepted',
            routeId: selection.routeId,
            effectiveModelId: exposedMember,
            source: attempt.source,
        });
        return {
            outcome: 'accepted',
            effectiveModelId: exposedMember,
            identityLevel,
            identityStatement: null,
            changeRecord: null,
            events,
        };
    }
    // The router hid the member identity. The combination stands, the
    // member is not invented, and the limitation is stated with the exact
    // sentence.
    events.push({
        type: 'identity_not_exposed',
        routeId: selection.routeId,
        statement: HIDDEN_IDENTITY_STATEMENT,
    });
    return {
        outcome: 'accepted',
        effectiveModelId: null,
        identityLevel: selection.identityLevel,
        identityStatement: HIDDEN_IDENTITY_STATEMENT,
        changeRecord: null,
        events,
    };
}
// ---------------------------------------------------------------------------
// Client payload projection. A whitelist copy: only the fields a client
// may see, in a stable shape. Credential presence travels; values never
// exist in the selection, so they cannot leak here.
// ---------------------------------------------------------------------------
export function selectionClientPayload(selection) {
    return {
        schema: selection.schema,
        routeId: selection.routeId,
        routeRevision: selection.routeRevision,
        routeKind: selection.routeKind,
        providerSlug: selection.providerSlug,
        requestedRoute: selection.requestedRoute,
        requestedModelOrAlias: selection.requestedModelOrAlias,
        combinationMembers: selection.combinationMembers
            ? [...selection.combinationMembers]
            : null,
        reasoning: { ...selection.reasoning },
        fallbackPolicy: selection.fallbackPolicy,
        providerAccountRef: selection.providerAccountRef,
        capability: {
            contextWindowTokens: selection.capabilitySnapshot.contextWindowTokens,
            maxOutputTokens: selection.capabilitySnapshot.maxOutputTokens,
            capabilities: [...selection.capabilitySnapshot.capabilities],
            supportedReasoningLevels: selection.capabilitySnapshot.supportedReasoningLevels
                ? [...selection.capabilitySnapshot.supportedReasoningLevels]
                : null,
        },
        credential: {
            state: selection.credential.state,
            envVar: selection.credential.envVar,
            source: selection.credential.source,
        },
        identityLevel: selection.identityLevel,
        companyId: selection.scope.companyId,
    };
}
export class RouteResolutionJournal {
    records = [];
    record(entry) {
        this.records.push(entry);
    }
    list() {
        return [...this.records];
    }
    /** All recorded route-change events (refusals and approved changes). */
    routeChanges() {
        return this.records.filter((r) => r.outcome.outcome === 'refused' ||
            r.outcome.outcome === 'substituted_with_approval');
    }
}
// ---------------------------------------------------------------------------
// Guarded transport. Wraps a harness delegate transport (CWE-009 owns
// the real HTTP/local transports) and enforces the pinned selection on
// every request: the harness reports what it resolved, the guard
// decides, and only an accepted resolution reaches the delegate.
// ---------------------------------------------------------------------------
/** Thrown when the guard refuses a host resolution. Never retryable. */
export class RouteResolutionRefusedError extends Error {
    retryable = false;
    outcome;
    constructor(selection, outcome) {
        const refusal = outcome.events.find((e) => e.type === 'substitution_refused');
        const reason = refusal && refusal.type === 'substitution_refused'
            ? refusal.reason
            : 'The host resolution did not preserve the selected route.';
        super(`Route resolution refused for route ${selection.routeId}: ${reason} ` +
            'The refusal was recorded as a substitution_refused event; the selected route was not replaced.');
        this.name = 'RouteResolutionRefusedError';
        this.outcome = outcome;
    }
}
export class GuardedTransport {
    options;
    constructor(options) {
        this.options = options;
    }
    get selection() {
        return this.options.selection;
    }
    async generate(request) {
        const { selection, journal, clock, harness } = this.options;
        if (request.route_id !== selection.routeId) {
            throw new CouncilError('COUNCIL_ROUTE_UNAVAILABLE', `Request was issued for route ${request.route_id} but this bridge guards route ${selection.routeId}. The selected route is never silently replaced.`, { retryable: false, exitCode: 3 });
        }
        const attempt = await this.options.reportAttempt(selection, request);
        const outcome = applyHostResolution(selection, attempt);
        journal.record({
            harness,
            route_id: selection.routeId,
            session_id: request.session_id,
            outcome,
            recorded_at: clock.nowUtc(),
        });
        if (outcome.outcome === 'refused') {
            throw new RouteResolutionRefusedError(selection, outcome);
        }
        return this.options.delegate.generate(request);
    }
}
export function composeBridgeHost(harness, options = {}) {
    assertStandaloneAuthorityMode(options.authorityMode);
    const { host, dataDir, store, routeDiscovery } = createLocalHost({
        dataDir: options.dataDir,
        skillRoot: options.skillRoot,
        homeDir: options.homeDir,
        env: options.env,
        discoverRoutes: options.discoverRoutes,
    });
    const catalog = buildRouteCatalog(options.routes ?? [], options.evidenceByRouteId ?? new Map());
    const journal = new RouteResolutionJournal();
    const bridgeScope = options.scope ?? localScope();
    const selections = new Map();
    for (const binding of options.bindings ?? []) {
        const entry = findCatalogEntry(catalog, binding.routeId);
        if (!entry) {
            throw new BridgeSelectionError('ROUTE_NOT_IN_CATALOG', `Route ${binding.routeId} is not in this installation's route catalog. The bridge never invents a route.`);
        }
        const scope = binding.scope ?? bridgeScope;
        const createdAt = host.clock.nowUtc();
        const selection = binding.policy
            ? selectionFromModelPolicy(entry, binding.policy, scope, {
                routeRevision: binding.routeRevision ?? 1,
                createdAt,
            })
            : createRouteSelection(entry, binding.request ?? { routeId: binding.routeId }, trustedScopeFromScopeFields(scope), { routeRevision: binding.routeRevision ?? 1, createdAt });
        selections.set(binding.routeId, selection);
        host.transportRegistry.register(binding.routeId, new GuardedTransport({
            harness,
            selection,
            delegate: binding.delegate,
            reportAttempt: binding.reportAttempt,
            journal,
            clock: host.clock,
        }));
    }
    return {
        harness,
        host,
        dataDir,
        store,
        catalog,
        routeDiscovery: routeDiscovery ?? [],
        selections,
        journal,
        authorityMode: STANDALONE_AUTHORITY_MODE,
    };
}
