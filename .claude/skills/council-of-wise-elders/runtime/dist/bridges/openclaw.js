/**
 * OpenClaw host bridge (CWE-010; directive Sections 13, 14, 25).
 *
 * Composes the portable council core under the OpenClaw host: the same
 * CWE-004 host ports, the same shared local store and data profile, and
 * a guarded transport per selected route (host-bridge.ts). The bridge
 * resolves the client's selected route inside the OpenClaw harness only.
 *
 * select_model.py is the OpenClaw host's own model machinery. It is
 * READ-ONLY for this build: the bridge never modifies it and never
 * silently rides it. CWE-001 recon read it in full (1,120 lines) and
 * mapped its silent-replacement points; the binding lock (CWE-002,
 * Part 4) carries that map. Every one of those points, if the host
 * engages it for a council request, produces a resolution attempt that
 * this bridge runs through the explicit-selection guard: under
 * fallback_policy none the substitution is REFUSED and recorded as a
 * substitution_refused event; under client_approved_only it proceeds
 * only with a client approval record and is recorded as a route-change
 * event with a new route revision. There is no path around the guard.
 *
 * Expired host OAuth (T035): this bridge never scrapes cookies or
 * tokens and never fabricates API entitlement from a subscription.
 * When the host reports an expired credential, the supported path is
 * the host's own renewal flow; the bridge surfaces the failure through
 * the normal transport error path and the council refuses to spend.
 */
import { invalidInput } from '../cli/errors.js';
import { composeBridgeHost, } from './host-bridge.js';
export const OPENCLAW_REPLACEMENT_POINTS = [
    {
        id: 'forbidden-prefix-filter',
        hostSurface: 'shared-utils/select_model.py FORBIDDEN_PREFIXES',
        source: 'cascade',
        description: 'Models under a forbidden prefix are silently removed before selection, so a council-selected model can vanish from the candidate set without any event.',
    },
    {
        id: 'purpose-tier-cascade',
        hostSurface: 'shared-utils/select_model.py purpose-tier chains',
        source: 'cascade',
        description: 'The purpose-tier cascade picks the first available model in its chain, which can be a different model than the client selected for the council.',
    },
    {
        id: 'cheapest-match-substitution',
        hostSurface: 'shared-utils/select_model.py cheapest-match selection',
        source: 'cascade',
        description: 'Cheapest-match selection substitutes a lower-cost model that merely matches the request class, replacing the selected model on price alone.',
    },
    {
        id: 'department-default-resolution',
        hostSurface: 'shared-utils/select_model.py resolve_dept_default_model',
        source: 'sovereign_default',
        description: 'When no task model resolves, the department default is substituted. A council session has a frozen selected route; a department default is never that route.',
    },
    {
        id: 'sovereignty-last-resort',
        hostSurface: 'fleet sovereignty cascade final rung (AGENTS.md N35)',
        source: 'cascade',
        description: 'The fleet cascade final rung fires a universal last-resort model when earlier tiers fail. For a council selection that is a substitution and is guarded like any other.',
    },
    {
        id: 'agent-model-fallback-array',
        hostSurface: 'openclaw.json agents.list[].model.fallbacks',
        source: 'fallback',
        description: 'Agent model objects carry fallback arrays the host consults when the primary fails. Council sessions default to fallback_policy none, so a fallback entry is never permission to proceed silently.',
    },
    {
        id: 'runtime-model-reconcile',
        hostSurface: 'host runtime model reconciliation',
        source: 'runtime_reconcile',
        description: 'A live runtime model can overwrite the recorded model for work in flight. For a council selection the recorded selected route governs; a reconcile to a different model is a substitution attempt.',
    },
];
export function replacementPointById(id) {
    return OPENCLAW_REPLACEMENT_POINTS.find((p) => p.id === id) ?? null;
}
export function openClawAttemptFromReport(report) {
    let source = 'explicit_route';
    if (report.viaReplacementPoint) {
        const point = replacementPointById(report.viaReplacementPoint);
        if (!point) {
            throw invalidInput(`Unknown OpenClaw replacement point "${report.viaReplacementPoint}". Refusing to guess which host surface engaged; name a mapped replacement point or none.`);
        }
        source = point.source;
    }
    return {
        source,
        attemptedModelId: report.attemptedModelId,
        reportedModelId: report.reportedModelId ?? null,
        proseClaimedModelId: report.proseClaimedModelId ?? null,
        approval: report.approval ?? null,
    };
}
/**
 * The pinned-route resolver for an installation whose OpenClaw config
 * pins the council route as the executing model: the host reports the
 * selected model unchanged and no replacement point is engaged. This is
 * the only resolver this unit ships; wiring a live host probe belongs
 * to the installation packaging (CWE-039/CWE-040) behind this same port.
 */
export class PinnedOpenClawResolver {
    reportResolution(selection) {
        return {
            attemptedModelId: selection.requestedModelOrAlias,
            reportedModelId: null,
        };
    }
}
export function createOpenClawBridge(options = {}) {
    const resolver = options.resolver ?? new PinnedOpenClawResolver();
    const bindings = (options.bindings ?? []).map((binding) => ({
        ...binding,
        reportAttempt: async (selection, request) => openClawAttemptFromReport(await resolver.reportResolution(selection, request)),
    }));
    return composeBridgeHost('openclaw', { ...options, bindings });
}
