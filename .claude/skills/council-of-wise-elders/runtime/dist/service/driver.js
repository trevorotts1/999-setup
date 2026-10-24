/**
 * Council service driver (W28, decisions 2 and 5).
 *
 * A session convened through the service must actually be deliberated:
 * create the session, approve the run, then hand it to runSession in the
 * background over the service's own database, so the existing
 * repositories journal every transition, card and verdict into
 * council_events (which the SSE route streams).
 *
 * CONVENING = APPROVAL (Trevor decision 2026-10-19). The client chose
 * the model and pays for it, so the driver builds the run preview and
 * approves it on the owner's behalf in the same call, using the existing
 * authority mode 'local_interactive_owner' with interactive_confirmation
 * true: the confirmation IS the client's convene act. The authority enum
 * and DB CHECK are untouched (no migration). There is no money ceiling
 * and no extra prompt. The approval row plus one append-only JSONL audit
 * line per run is the audit record. The 50-provider-request ceiling is
 * the protocol's own runaway guard, not a spend gate.
 *
 * No content is invented: the sample path only rebinds the built-in
 * synthetic sample brief (cli/fixture-transport.ts) to a new session id,
 * and every card comes from the resolved route's transport.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildSampleSession } from '../cli/fixture-transport.js';
import { canonicalHash, SEAT_IDS, validateDecisionBrief, validateSessionSpec, } from '../contracts/index.js';
export class DriverRefusal extends Error {
    code;
    recovery;
    http_status;
    detail;
    constructor(code, message, recovery, http_status, detail = {}) {
        super(message);
        this.code = code;
        this.recovery = recovery;
        this.http_status = http_status;
        this.detail = detail;
        this.name = 'DriverRefusal';
    }
}
const APPROVAL_BASIS = 'convening_is_approval (Trevor decision 2026-10-19)';
const DEFAULT_PACK_VERSION = 'live-elder-knowledge/v1';
/**
 * Protocol runaway guard only; money and token ceilings stay unset.
 * Sized for the nine-seat, three-round council: 27 operations, each
 * allowed its one repair (27), plus the 8 transport retries = 62, so a
 * real model that needs a repair on most operations cannot starve the
 * session (real run: 9 repairs were spent by mid Round 2).
 */
const CONVENING_CEILINGS = {
    max_provider_requests: 62,
    max_output_repairs: 27,
    max_transport_retries: 8,
    max_input_tokens: null,
    max_output_tokens: null,
    max_money: null,
};
// ponytail: the six typed route-choice codes map to a fixed status; a
// route-choice error with an unknown code is rethrown untouched.
const ROUTE_STATUS = {
    ROUTE_CHOICE_REQUIRED: 422,
    ROUTE_MODEL_NOT_OFFERED: 422,
    ROUTE_NOT_CONFIGURED: 409,
    ROUTE_NOT_COMPOSABLE: 409,
    ROUTE_MODEL_LIST_UNAVAILABLE: 503,
    ROUTE_LATEST_FLASH_NOT_FOUND: 503,
};
function invalid(message, detail = {}) {
    return new DriverRefusal('CONVENE_INPUT_INVALID', message, 'Send either sample:true or a valid decision brief, plus requested_by, then convene again.', 422, detail);
}
function errorCode(error) {
    const code = error?.code;
    return typeof code === 'string' ? code : 'RUN_FAILED';
}
export function createCouncilDriver(deps) {
    const running = new Set();
    async function route(request) {
        try {
            return await deps.resolveRoute(request);
        }
        catch (error) {
            const code = errorCode(error);
            if (code in ROUTE_STATUS) {
                const e = error;
                throw new DriverRefusal(code, e.message, e.recovery ?? 'Choose a route from GET /api/council/routes and convene again.', ROUTE_STATUS[code], { summary: e.message });
            }
            throw error;
        }
    }
    function buildSession(input, sessionId, resolved) {
        const now = deps.clock.nowUtc();
        const sample = input.sample === true;
        if (sample === (input.brief !== undefined)) {
            throw invalid(sample
                ? 'Send sample:true or a brief, not both.'
                : 'Nothing to convene: send sample:true or a decision brief.');
        }
        let baseSpec;
        let brief;
        if (sample) {
            const built = buildSampleSession();
            baseSpec = built.spec;
            brief = { ...built.brief, created_at: now };
        }
        else {
            brief = { ...input.brief };
            baseSpec = {
                schema_version: 'wise-elders.session/v1',
                session_id: sessionId,
                mode: 'full',
                visibility: 'company',
                brief_revision: 1,
                brief_sha256: '',
                options: brief.options.map((o) => ({ ...o })),
                seat_ids: [...SEAT_IDS],
                model_policy: resolved.model_policy,
                source_pack_version: deps.sourcePackVersion ?? DEFAULT_PACK_VERSION,
                execution_policy: 'advisory_only',
                created_at: now,
                display_timezone: brief.display_timezone,
            };
        }
        brief = {
            ...brief,
            brief_id: `brief-${sessionId}`,
            session_id: sessionId,
            revision: 1,
        };
        const briefCheck = validateDecisionBrief(brief);
        if (!briefCheck.ok) {
            throw invalid('The decision brief failed validation.', { issues: briefCheck.issues });
        }
        const spec = {
            ...baseSpec,
            session_id: sessionId,
            brief_revision: 1,
            brief_sha256: canonicalHash(brief),
            mode: input.mode ?? baseSpec.mode,
            visibility: input.visibility ?? baseSpec.visibility,
            seat_ids: input.seat_ids ? [...input.seat_ids] : baseSpec.seat_ids,
            model_policy: resolved.model_policy,
            created_at: now,
        };
        const specCheck = validateSessionSpec(spec);
        if (!specCheck.ok) {
            throw invalid('The session settings failed validation.', { issues: specCheck.issues });
        }
        return {
            spec,
            brief,
            scope: { ...deps.scope },
            state: {
                schema_version: 'wise-elders.session-state/v1',
                session_id: sessionId,
                mode: spec.mode,
                state: 'DRAFT',
                state_version: 0,
                brief_revision: 1,
                resume_phase: null,
                cancel_generation: 0,
                revocation_generation: 0,
                attempt: 1,
                lease_epoch: 0,
                archived: false,
                updated_at: now,
            },
            sample,
        };
    }
    /** A run that threw leaves its session mid-round; make that visible as BLOCKED. */
    function blockStranded(sessionId) {
        try {
            const stored = deps.deliberation.repositories.getSession(deps.envelope, sessionId);
            if (stored && !['COMPLETED', 'BLOCKED', 'CANCELLED'].includes(stored.state.state)) {
                deps.deliberation.repositories.transitionState(deps.envelope, sessionId, 'BLOCKED', stored.state.state_version);
            }
        }
        catch {
            // best effort: the typed error still reaches onSettled
        }
    }
    async function convene(input) {
        const readiness = deps.deliberation.readiness();
        if (!readiness.ready) {
            const unbound = readiness.checks.filter((c) => !c.bound);
            throw new DriverRefusal('COMPOSITION_NOT_READY', `The council is not ready to convene: ${unbound.map((c) => c.name).join(', ')} not bound.`, 'Bind the missing services (see detail.checks), then convene again.', 503, {
                unbound: unbound.map((c) => c.name),
                checks: unbound.map((c) => ({ name: c.name, detail: c.detail })),
            });
        }
        if (typeof input.requested_by !== 'string' || input.requested_by.trim() === '') {
            throw invalid('requested_by is required.');
        }
        const resolved = await route(input.route ?? {});
        const sessionId = `sess-${deps.ids.newId()}`;
        const session = buildSession(input, sessionId, resolved);
        const repos = deps.deliberation.repositories;
        repos.createSession(deps.envelope, session);
        if (input.fresh_facts?.length)
            deps.recordFreshFacts?.(sessionId, input.fresh_facts);
        const grants = deps.deliberation.grants;
        const preview = grants.previewRun(deps.envelope, {
            session_id: sessionId,
            purpose: 'council_run',
            route_snapshot: resolved.snapshot,
            route_policy_sha256: canonicalHash({ route_snapshot: resolved.snapshot }),
            ceilings: CONVENING_CEILINGS,
        });
        const grant = grants.approveRun(deps.envelope, preview.preview_id, {
            principal: deps.principal,
            authority_mode: 'local_interactive_owner',
            interactive_confirmation: true,
            expected_session_id: sessionId,
        });
        mkdirSync(dirname(deps.auditLogPath), { recursive: true });
        appendFileSync(deps.auditLogPath, `${JSON.stringify({
            at: deps.clock.nowUtc(),
            session_id: sessionId,
            route_id: resolved.snapshot.routeId,
            model_label: resolved.model_label,
            selection_source: resolved.selection_source,
            harness: resolved.harness,
            grant_id: grant.grant_id,
            requested_by: input.requested_by,
            approval_basis: APPROVAL_BASIS,
        })}\n`);
        // Background run: never awaited by the caller. runSession and the
        // service's own workers share one store; the settle callback gets
        // the typed result (or a typed error code), never a swallowed one.
        const run = (async () => {
            let settled;
            try {
                settled = await deps.deliberation.runSession(deps.envelope, sessionId, {
                    grant_id: grant.grant_id,
                    route_snapshot: resolved.snapshot,
                });
            }
            catch (error) {
                settled = { status: 'error', code: errorCode(error) };
                blockStranded(sessionId);
            }
            try {
                deps.onSettled?.(sessionId, settled);
            }
            catch {
                // an observer failure must not turn a finished run into an unhandled rejection
            }
        })();
        running.add(run);
        void run.finally(() => running.delete(run));
        return {
            session_id: sessionId,
            state: repos.getSession(deps.envelope, sessionId)?.state.state ?? session.state.state,
            sample: session.sample,
            route_id: resolved.snapshot.routeId,
            model_label: resolved.model_label,
            selection_source: resolved.selection_source,
            grant_id: grant.grant_id,
            session_path: `/council/${sessionId}`,
            events_path: `/api/council/sessions/${sessionId}/events`,
        };
    }
    return {
        convene,
        inFlight: () => running.size,
        drain: async () => {
            while (running.size > 0)
                await Promise.allSettled([...running]);
        },
    };
}
