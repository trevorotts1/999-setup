/**
 * Independent opening-round execution: the Round 1 engine (CWE-024;
 * directive Sections 9.4, 9.5, 11.3, 14.2, 15, and the Section 34
 * CWE-024 build steps).
 *
 * What lives here:
 * - OpeningRoundExecutor, the OperationExecutorPort that CWE-027's
 *   durable runner dispatches through for Round 1 seat operations.
 *   The runner owns admission (CWE-049 admitOperation), consumption
 *   recording (CWE-028's one budget ledger), leases, fencing, and the
 *   bounded follow-on policy (one transport retry, one output repair,
 *   each a distinct admitted operation). This executor owns ONLY the
 *   per-dispatch work: per-seat context assembly, input-manifest
 *   identity, the provider call on the pinned route, and deep card
 *   validation. It commits nothing itself.
 * - The planner surface (planSeat / planOpeningRound) that computes the
 *   exact input identity an enqueueing composition (CWE-050) must use
 *   as the job's input_sha256, so a committed card is findable under
 *   the job's identity and any drift between planning and dispatch is
 *   refused before a provider call is made (Section 15.2: a card with
 *   different inputs is a new operation, not a reused result).
 *
 * Independence is the core invariant (Section 14.2): each seat's
 * operation assembles a FRESH context through CWE-022's bounded
 * authorized assembly in its round_1_opening form (which omits the
 * private preference reference entirely), narrowed to that one seat
 * through the assembler's own controls (seat_ids carries only that
 * seat; every other seat's input budget is zero) and verified
 * fail-closed before use, so no seat's payload can contain another
 * seat's material or output. Independence is never implemented as "clear
 * your head" inside a shared conversation: there is no shared
 * conversation. Each dispatch is one transport request carrying only
 * that seat's assembled context, its Section 7 focus, and its pack
 * briefing.
 *
 * Failure honesty (Sections 15.3, 15.5): a transport failure, an
 * unresolved provider submission, and an invalid card are three
 * distinct outcomes and stay distinct. CWE-009 TransportError honesty
 * flags are translated into the runner's TransportDispatchError with
 * the flags preserved; an invalid card is returned as an author
 * payload so the runner's validation drives the one bounded repair;
 * pre-dispatch refusals (input drift, context too small, no transport
 * composed for the pinned route, an unusable route budget) throw a
 * definite TransportDispatchError with actual_minor 0 BEFORE any
 * provider call, so no spend is ever recorded for a call that did not
 * happen. A seat that cannot produce a valid card ends in the runner's
 * honest recorded failure state; this executor never fabricates a
 * card, an abstention, or seat content.
 */
import { type CouncilCard, type SeatId, type SessionMode } from '../contracts/index.js';
import { type TrustedPrincipal } from '../authorization/index.js';
import { type PinnedRouteSnapshot } from '../budgets/index.js';
import { type MaterialCatalog, type RouteContextBudget } from '../context/index.js';
import type { ModelTransport, StoredSession, TransportResponse } from '../cli/host-ports.js';
import { type OperationDispatchContext, type OperationDispatchResult, type OperationExecutorPort } from '../queue/runner.js';
/**
 * The Section 14.2 logical prompt contract, verbatim. CWE-050
 * consolidation: the single source is OPENING_SYSTEM in cli/engine.ts
 * (the module this file already imports SEAT_FOCUS from); this name is
 * kept as the protocol surface for the same text.
 */
export declare const OPENING_ROUND_SYSTEM: string;
/** Identity kind tag for a Round 1 opening input manifest. */
export declare const OPENING_INPUT_KIND = "wise-elders.opening-input/v1";
/** The exact inputs one opening operation is bound to. */
export interface OpeningInputIdentity {
    readonly session_id: string;
    readonly brief_revision: number;
    /** The frozen brief binding from the session spec. */
    readonly brief_sha256: string;
    readonly seat_id: SeatId;
    readonly pack_version: string;
    /** CWE-022 content hash of this seat's assembled Round 1 context. */
    readonly context_sha256: string;
    /** CWE-028 fingerprint of the pinned route snapshot. */
    readonly route_fingerprint: string;
}
/**
 * The one canonical derivation of an opening operation's input
 * manifest hash. The card a seat returns must echo this value in
 * input_manifest_sha256, and the job's input_sha256 must equal it, or
 * the card is not this operation's card.
 */
export declare function openingInputManifestSha256(identity: OpeningInputIdentity): string;
/** A fully planned opening seat operation, ready to enqueue. */
export interface OpeningSeatPlan {
    readonly seat_id: SeatId;
    readonly pack_version: string;
    readonly context_sha256: string;
    readonly route_fingerprint: string;
    readonly input_manifest_sha256: string;
    /** Evidence IDs this seat's assembled context actually contains. */
    readonly item_evidence_ids: readonly string[];
}
export type OpeningPlanResult = {
    readonly status: 'planned';
    readonly plan: OpeningSeatPlan;
} | {
    readonly status: 'context_too_small';
    readonly readiness: 'CONTEXT_TOO_SMALL';
    readonly minimum_required_bytes: number;
    readonly available_bytes: number;
    readonly supported_lower_context_modes: readonly SessionMode[];
};
/**
 * Composition dependencies. Every port is an accepted surface owned by
 * another unit; this executor composes them and builds nothing
 * parallel: CWE-022's assembly is the only context assembler,
 * CWE-009's transports are the only provider path, CWE-028's service
 * (behind CWE-027's runner) is the only budget ledger.
 */
export interface OpeningRoundDeps {
    /** CWE-022 material catalog: pack and session material, host-composed. */
    readonly catalog: MaterialCatalog;
    /**
     * The trusted principal per-seat assemblies run as. Retrieval
     * authorization is decided by CWE-022/CWE-007 from this principal
     * before any content loads.
     */
    readonly resolvePrincipal: (session: StoredSession) => TrustedPrincipal;
    /**
     * The CWE-009 transport serving the pinned route snapshot, or null
     * when no transport is composed for it. A null resolution is an
     * honest pre-dispatch refusal, never a silent substitution: the
     * pinned route is the only route an opening operation may use.
     */
    readonly resolveTransport: (snapshot: PinnedRouteSnapshot, session: StoredSession) => ModelTransport | null | Promise<ModelTransport | null>;
    /**
     * The pinned route's real limits (Section 9.5), from verified route
     * data: never a guessed family default. context_limit_bytes is the
     * route's actual context limit in canonical bytes. Returns null when
     * the route's limit is not verified, in which case planning reports
     * the seat unplannable and dispatch refuses before any provider
     * call. The executor measures system_rules_bytes itself from the
     * exact prompt it sends and adds it to what this returns.
     */
    readonly routeBudget: (snapshot: PinnedRouteSnapshot) => Omit<RouteContextBudget, 'system_rules_bytes'> | null;
    /**
     * Optional seat pack briefing text through the accepted pack surface
     * (the CWE-004 EvidenceProvider loadSeatPack shape). Absent or null
     * for a seat: the seat deliberates from its assembled context and its
     * Section 7 focus only. Text is consumed as supplied; this executor
     * never invents seat content, quotations, or coverage.
     */
    readonly loadSeatBriefing?: (seatId: SeatId, session?: StoredSession) => Promise<{
        briefing_text: string;
    } | null>;
    /**
     * Optional actual-charge pricer for transports that meter money.
     * Absent (or returning null): the dispatch settles at the
     * operation's reserved estimate. Unknown billed usage is never
     * reported as zero (Section 15.6); settling at the reserved estimate
     * is the conservative branch.
     */
    readonly priceActual?: (info: {
        readonly response: TransportResponse;
        readonly snapshot: PinnedRouteSnapshot;
    }) => number | null;
    /** Assemblies are for internal deliberation unless composed otherwise. */
    readonly distributable?: boolean;
}
export declare class OpeningRoundExecutor implements OperationExecutorPort {
    private readonly deps;
    constructor(deps: OpeningRoundDeps);
    /**
     * Plan one seat's opening operation against the session's pinned
     * route snapshot: assemble the seat's Round 1 context and derive the
     * input identity CWE-050 enqueues with. Deterministic for a fixed
     * catalog, brief, and snapshot: the same inputs plan the same
     * manifest at plan time, dispatch time, and validation time.
     */
    planSeat(session: StoredSession, snapshot: PinnedRouteSnapshot, seatId: SeatId): OpeningPlanResult;
    /** Plan every seated seat of the session, in spec order. */
    planOpeningRound(session: StoredSession, snapshot: PinnedRouteSnapshot): ReadonlyMap<SeatId, OpeningPlanResult>;
    dispatch(ctx: OperationDispatchContext): Promise<OperationDispatchResult>;
    /**
     * Deep validation of a stamped opening card against the exact
     * inputs this operation owns: identity (session, brief revision,
     * seat, round, pack), the input manifest echo, the frozen brief
     * (canonical reference checks), the seat's assembled evidence (a
     * card may cite only material its own context actually contained),
     * quote gating (only host-verified material may carry a quote; in
     * this build no pack record is verified, so no quote validates),
     * and CWE-012's card source-use rules (Jakes lenses, one vote).
     */
    validateCard(ctx: OperationDispatchContext, card: CouncilCard): string[];
    /**
     * Assemble one seat's Round 1 context and derive its plan.
     *
     * CWE-022's assembly retrieves every authorized manifest item and
     * then fills the context: the mandatory minimum is the first item
     * of each seat named in the request, and discretionary fill is
     * capped per seat by seat_budgets. The opening round narrows both
     * controls to the one seat: seat_ids carries only that seat (so the
     * mandatory minimum is its first item alone) and every other seat's
     * budget is zero (so no other seat's item can enter as discretionary
     * fill). The assembled payload can therefore contain only this
     * seat's items, which is what makes the independence invariant
     * structural rather than promissory. As a fail-closed guard, the
     * result is verified before use: a context containing any other
     * seat's item is refused, never dispatched.
     */
    private prepareSeat;
}
