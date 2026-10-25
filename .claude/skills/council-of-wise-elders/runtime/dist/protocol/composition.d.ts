/**
 * CWE-050 production composition root (ONBOARDING/PORTABLE stream):
 * the full deliberation service composed ONLY from accepted parts.
 *
 * - CWE-024 OpeningRoundExecutor + CWE-025 ChallengeRoundExecutor,
 *   RatificationRoundExecutor, and ConsultExecutor, routed by
 *   operation round behind ONE OperationExecutorPort (the composite
 *   shape CWE-025's runner test documented as CWE-050's).
 * - CWE-027 DurableJobRunner: enqueue, admission-bound claim,
 *   fenced execution, in the supervisor's rhythm: the older modes claim
 *   one operation at a time (CWE-024 flag 8: claiming all seats first
 *   yields admission_refused requeues by design); the council sizes claim
 *   their whole wave under one lease-epoch bump, under CWE-028 capacity.
 * - CWE-049 RunAuthorizationService + RunAdmissionService: preview,
 *   approve, admission; purposes run under their own grants.
 * - CWE-028 DurableBudgetService: the ONLY budget ledger.
 * - CWE-022 context through the executors' material catalog port
 *   (hosts supply the real pack catalog, e.g. the CWE-011 export
 *   adapter in sources/export-v2.ts).
 * - CWE-009 transports resolved per pinned route snapshot; a null
 *   resolution is an honest pre-dispatch refusal, never a silent
 *   substitution.
 *
 * Production resolution discipline (T123): this module imports no
 * fixture transport and no test double; a composition built without a
 * binding reports that binding unbound in readiness() (T129) and
 * refuses to run, naming what is missing. Readiness is derived from
 * the actual bound services, never from a flag.
 *
 * Completion discipline: a scored session completes only through
 * CWE-025's assembleDeliberationOutcome (publication-validated);
 * anything less is a visible BLOCKED partial record, never a smaller
 * council. Hard-constraint findings follow the reconciled CWE-026
 * semantics (deriveHardConstraintFindings): recorded checker results
 * supplied by the host win; unchecked hard constraints are `unknown`
 * and block an unconditional recommendation.
 */
import type { CouncilSettings, HardConstraintFinding, SeatId, Verdict } from '../contracts/index.js';
import type { TrustedPrincipal } from '../authorization/index.js';
import { RunAdmissionService } from '../authorization/admission.js';
import { RunAuthorizationService } from '../authorization/run-grants.js';
import { DurableBudgetService, type DurableBudgetSnapshot } from '../budgets/service.js';
import type { PinnedRouteSnapshot } from '../budgets/route-snapshot.js';
import type { MaterialCatalog } from '../context/types.js';
import type { RouteContextBudget } from '../context/assembly.js';
import type { StoredSession } from '../cli/host-ports.js';
import type { ModelTransport } from '../cli/host-ports.js';
import type { AuthorizationEnvelope } from '../persistence/envelope.js';
import { CouncilJobs } from '../persistence/jobs.js';
import { CouncilRepositories } from '../persistence/repositories.js';
import type { CouncilDatabase } from '../persistence/sqlite.js';
import type { Clock, IdSource } from '../cli/host-ports.js';
import { DurableJobRunner, type DurableJobRunnerDeps, type RunnerTimers } from '../queue/runner.js';
import { RuntimeCapacity } from '../queue/capacity.js';
import { SessionControlsService } from './session-controls.js';
import { SessionHistoryService } from './history.js';
import { FollowUpService } from './follow-up.js';
import { OutcomeReviewService } from './outcomes.js';
/**
 * Default runtime capacity. A claimed wave runs to completion as a unit,
 * so the pool must admit a whole wave without refusing its later members
 * (claimWave raises the total anyway); three waves of head room plus the
 * private reserve keeps one session's wave from starving another's, and
 * the Section 15.7 private share still protects private work.
 */
export declare const DEFAULT_WAVE_CAPACITY: {
    total_slots: number;
    private_reserved_slots: number;
};
export interface DeliberationCompositionDeps {
    db: CouncilDatabase;
    clock: Clock;
    ids: IdSource;
    /** CWE-022 material catalog; null means unbound (readiness fails). */
    catalog: MaterialCatalog | null;
    /** Trusted principal per-seat assemblies run as (CWE-007/CWE-022). */
    resolvePrincipal: ((session: StoredSession) => TrustedPrincipal) | null;
    /** CWE-009 transport for a pinned route snapshot; null = unbound. */
    resolveTransport: ((snapshot: PinnedRouteSnapshot, session: StoredSession) => ModelTransport | null | Promise<ModelTransport | null>) | null;
    /** The pinned route's verified limits (Section 9.5); null = unbound. */
    routeBudget: ((snapshot: PinnedRouteSnapshot) => Omit<RouteContextBudget, 'system_rules_bytes'> | null) | null;
    loadSeatBriefing?: (seatId: SeatId) => Promise<{
        briefing_text: string;
    } | null>;
    priceActual?: (info: {
        response: import('../cli/host-ports.js').TransportResponse;
        snapshot: PinnedRouteSnapshot;
    }) => number | null;
    /** Recorded hard-constraint checker results, when the host has any. */
    recordedHardConstraintFindings?: (session: StoredSession) => readonly HardConstraintFinding[];
    settings?: CouncilSettings;
    /**
     * CWE-028 runtime capacity admission. Defaults to a wave-sized pool
     * (see DEFAULT_WAVE_CAPACITY) so claimWave's capacity guarantee is real
     * in production, not just in tests; a host may pass its own.
     */
    capacity?: RuntimeCapacity;
    timers?: RunnerTimers;
    /** Poll interval while waiting for another worker's round jobs; default 250ms. */
    roundWaitPollMs?: number;
    workerId?: string;
    distributable?: boolean;
    /** Reported when a paid response is discarded by a fenced settle. */
    onFencedSettle?: DurableJobRunnerDeps['onFencedSettle'];
}
export interface CompositionReadiness {
    ready: boolean;
    checks: Array<{
        name: string;
        bound: boolean;
        detail: string;
    }>;
}
export type RunSessionResult = {
    status: 'completed';
    verdict: Verdict;
    budget: DurableBudgetSnapshot;
} | {
    status: 'incomplete';
    detail: string;
    missing: Array<{
        round: number;
        seat_id: SeatId;
    }>;
    budget: DurableBudgetSnapshot;
} | {
    status: 'readiness_failed';
    readiness: 'CONTEXT_TOO_SMALL';
    detail: string;
    budget: DurableBudgetSnapshot;
};
export declare class DeliberationService {
    private readonly deps;
    readonly repositories: CouncilRepositories;
    readonly jobs: CouncilJobs;
    readonly budget: DurableBudgetService;
    readonly grants: RunAuthorizationService;
    readonly admission: RunAdmissionService;
    readonly runner: DurableJobRunner;
    readonly controls: SessionControlsService;
    readonly history: SessionHistoryService;
    readonly followUp: FollowUpService;
    readonly outcomes: OutcomeReviewService;
    private readonly opening;
    private readonly challenge;
    private readonly ratification;
    private readonly consult;
    private readonly workerId;
    constructor(deps: DeliberationCompositionDeps);
    /** The worker envelope a session's committed cards are read under. */
    private envelopeFor;
    /**
     * Readiness derived from the actual bound services (T129): every
     * capability the deliberation needs is checked against the deps
     * this composition was really built with. A scaffold composition
     * (any binding null) reports not ready and names the gaps.
     */
    readiness(): CompositionReadiness;
    private assertReady;
    /**
     * Drive one session end to end: frozen brief to validated verdict.
     * The caller previews and approves first (CWE-049); admission inside
     * the runner enforces the grant on every operation.
     */
    runSession(envelope: AuthorizationEnvelope, sessionId: string, options: {
        grant_id: string;
        route_snapshot: PinnedRouteSnapshot;
        /** Admission purpose the grant was approved under (default council_run). */
        purpose?: string;
        /**
         * Seats claimed per wave. Default 1 = one claim at a time, today's
         * behaviour. Every claim of a wave is awaited together before the
         * next wave is claimed.
         */
        parallel_limit?: number;
        /**
         * Route used to re-run seats that failed on a transport or rate-limit
         * class failure and committed no card (Ollama routes only). The
         * grant's route pin is a security invariant, so a fallback route
         * needs its own approved grant: pass it as fallback_grant_id.
         * Without one the fallback job is admitted under grant_id and the
         * route pin refuses it, leaving today's failure path in place.
         */
        fallback_route_snapshot?: PinnedRouteSnapshot | null;
        /** Approved grant pinned to fallback_route_snapshot, when there is one. */
        fallback_grant_id?: string;
    }): Promise<RunSessionResult>;
}
/** Compose the production deliberation service over one store. */
export declare function composeDeliberationService(deps: DeliberationCompositionDeps): DeliberationService;
