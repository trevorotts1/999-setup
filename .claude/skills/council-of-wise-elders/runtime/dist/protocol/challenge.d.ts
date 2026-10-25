/**
 * Focused challenge round: crux extraction, challenge assignment, and
 * the Round 2 executor (CWE-025; directive Sections 10, 11.7, 14.3,
 * 14.5, and the Section 34 CWE-025 build steps 1 and 2).
 *
 * What lives here:
 * - extractCruxes: the chair's crux identification as DETERMINISTIC
 *   CODE over valid committed opening cards (the same architectural
 *   choice CWE-004's in-process engine made: "deterministic crux
 *   extraction"; the chair is a model ROLE for prose, but crux
 *   identification from recorded scores, preferences, and blocking
 *   conditions is arithmetic and record-keeping, and code cannot
 *   fabricate a dispute). Up to three decision-changing cruxes, each
 *   typed fact | numbers | values | execution, with competing claims
 *   quoted from the cards' own recorded values, responsible seats,
 *   needed evidence, and a resolution test (Section 14.3). Structural
 *   generators: a score spread of at least 4 on one option (numbers);
 *   a blocking condition attached to a contended leading option
 *   (execution); a split in preferred options (values); and, when
 *   every seat prefers the same option, the labeled adversarial test
 *   of the strongest neglected alternative (origin
 *   unanimity_stress_test, adversarial_test true; it is never recorded
 *   as genuine dissent, T039). No deterministic signal in the frozen
 *   card contract separates a factual dispute from a numeric one (the
 *   same recorded spread is a numbers crux), so this build types no
 *   crux 'fact' rather than inventing one; see the CWE-025 build
 *   report's discrepancy register.
 * - ChallengeRoundExecutor: the OperationExecutorPort CWE-027's
 *   durable runner dispatches through for Round 2 seat operations,
 *   composed exactly as CWE-024's opening executor composes (the
 *   runner owns admission through CWE-049, the one CWE-028 budget
 *   ledger, leases, fencing, and the bounded follow-on policy; this
 *   executor owns per-dispatch context assembly, input identity, the
 *   provider call on the pinned route, and deep card validation; it
 *   commits nothing itself).
 * - The planner surface (planSeat / planChallengeRound) deriving the
 *   exact input identity an enqueueing composition (CWE-050) uses as
 *   each job's input_sha256. EVERY panel seat is planned, including
 *   seats with no targeted challenge: a required seat returns a fresh
 *   Round 2 card even without one (T149), and a Round 1 card can never
 *   satisfy a Round 2 job because the Round 2 input identity binds
 *   the committed Round 1 card set and the crux set.
 *
 * Round 2's context posture is DELIBERATELY DIFFERENT from Round 1
 * (Section 14.3): independence is over. Each seat's provider payload
 * carries its own assembled evidence context (still narrowed to its
 * own source material through CWE-022's assembler), its own committed
 * Round 1 card, and ONLY the peer arguments necessary to answer its
 * assigned challenges: for each assigned crux, the competing claims
 * and the other responsible seats' recorded arguments about that
 * crux. The entire transcript is never expanded into every seat's
 * context by default, and a decisive opposing fact is never hidden
 * from an affected seat: the crux payload carries the opposing seat's
 * own decisive arguments and strongest objection verbatim. Two things
 * stay hidden in every round: the client preference (the brief view
 * in the payload omits private_preference_ref entirely, in Round 2
 * and Round 3 as in Round 1; CWE-022's assembler strips it only for
 * round_1_opening, so these executors strip it at the payload
 * boundary and bind the assembler's unstripped content hash in the
 * input identity, disclosed for CWE-050) and any seat's private
 * material (source items are per-seat; no seat's payload contains
 * another seat's source items).
 *
 * Failure honesty is inherited unchanged: transport failures keep
 * CWE-009's honesty flags through translation into the runner's
 * TransportDispatchError; an invalid card returns as an author payload
 * so the runner's validation drives the one bounded repair;
 * pre-dispatch refusals throw a definite TransportDispatchError with
 * actual_minor 0 before any provider call; nothing here fabricates a
 * card, an abstention, or a changed position.
 */
import { type AdvisorCard, type CouncilCard, type DecisionBrief, type SeatId, type SessionMode } from '../contracts/index.js';
import { type TrustedPrincipal } from '../authorization/index.js';
import { type PinnedRouteSnapshot } from '../budgets/index.js';
import { type AssembledContext, type ContextAssemblyResult, type MaterialCatalog, type RouteContextBudget } from '../context/index.js';
import type { ModelTransport, StoredSession, TransportResponse } from '../cli/host-ports.js';
import { TransportDispatchError, type OperationDispatchContext, type OperationDispatchResult, type OperationExecutorPort } from '../queue/runner.js';
/**
 * A pre-dispatch refusal: no provider call was made, so the runner
 * records a definite failure settled at actual_minor 0. Shared by the
 * CWE-025 executors (challenge, ratification, consult); CWE-024's
 * opening executor carries its own copy from its own build, and
 * consolidating the three is CWE-050 integration work.
 */
export declare function definiteDispatchRefusal(message: string): TransportDispatchError;
/** Translate a CWE-009 transport failure, preserving its honesty flags. */
export declare function translateTransportFailure(error: unknown): TransportDispatchError;
/** The author payload of a committed card (host stamp removed). */
export declare function authorOfCard(card: CouncilCard): Record<string, unknown>;
/**
 * The brief view a CWE-025 provider payload carries: the assembled
 * context's view with private_preference_ref REMOVED in every round.
 * The preference content is never an assembly input at all; this
 * strips even the reference from the wire payload (see header).
 */
export declare function payloadBriefView(context: AssembledContext): Record<string, unknown>;
/** Composition dependencies shared by the CWE-025 round executors. */
export interface LaterRoundDeps {
    /** CWE-022 material catalog: pack and session material, host-composed. */
    readonly catalog: MaterialCatalog;
    /** The trusted principal per-seat assemblies run as (CWE-022/CWE-007). */
    readonly resolvePrincipal: (session: StoredSession) => TrustedPrincipal;
    /**
     * The CWE-009 transport serving the pinned route snapshot, or null
     * when no transport is composed for it. Null is an honest
     * pre-dispatch refusal, never a silent substitution.
     */
    readonly resolveTransport: (snapshot: PinnedRouteSnapshot, session: StoredSession) => ModelTransport | null | Promise<ModelTransport | null>;
    /**
     * The pinned route's real limits (Section 9.5), from verified route
     * data, never a guessed family default. Null when the route's limit
     * is not verified: planning reports the seat unplannable and
     * dispatch refuses before any provider call.
     */
    readonly routeBudget: (snapshot: PinnedRouteSnapshot) => Omit<RouteContextBudget, 'system_rules_bytes'> | null;
    /**
     * The session's committed cards, read through the CWE-006 store the
     * composition owns. Later rounds are functions of the committed
     * record: cruxes derive from committed Round 1 cards, the draft
     * from committed Round 2 cards. Synchronous because the CWE-006
     * repository read is synchronous.
     */
    readonly loadCommittedCards: (session: StoredSession) => readonly CouncilCard[];
    /**
     * Optional seat pack briefing text through the accepted pack
     * surface (the CWE-004 EvidenceProvider loadSeatPack shape). Absent
     * or null for a seat: the seat deliberates from its assembled
     * context, its Section 7 focus, and the committed record only.
     */
    readonly loadSeatBriefing?: (seatId: SeatId, session?: StoredSession) => Promise<{
        briefing_text: string;
    } | null>;
    /**
     * Optional actual-charge pricer for transports that meter money.
     * Absent (or returning null): the dispatch settles at the
     * operation's reserved estimate; unknown billed usage is never
     * reported as zero (Section 15.6).
     */
    readonly priceActual?: (info: {
        readonly response: TransportResponse;
        readonly snapshot: PinnedRouteSnapshot;
    }) => number | null;
    /** Assemblies are for internal deliberation unless composed otherwise. */
    readonly distributable?: boolean;
}
/** Narrow one seat's assembled context through CWE-022's own controls. */
export declare function assembleSeatContext(args: {
    deps: LaterRoundDeps;
    session: StoredSession;
    snapshot: PinnedRouteSnapshot;
    seatId: SeatId;
    operation: 'round_2_response' | 'round_3_ratification' | 'consult';
    systemText: string;
}): ContextAssemblyResult;
export type SeatContextResult = {
    readonly status: 'assembled';
    readonly context: AssembledContext;
} | {
    readonly status: 'context_too_small';
    readonly readiness: 'CONTEXT_TOO_SMALL';
    readonly minimum_required_bytes: number;
    readonly available_bytes: number;
    readonly supported_lower_context_modes: readonly SessionMode[];
};
export declare function toSeatContextResult(result: ContextAssemblyResult): SeatContextResult;
/** Source status for a dispatch result, from the assembled context. */
export declare function sourceStatusOf(context: AssembledContext): 'verified' | 'unverified' | 'not_applicable';
/**
 * Evidence-citation checks shared by the later-round validators: a
 * card may cite, as framework source evidence, only material its own
 * assembled context actually contained; case evidence must belong to
 * the frozen brief manifest; a quotation validates only when backed
 * by host-verified material in the seat's own context (in this build
 * no pack record is verified, so no quotation validates, matching
 * CWE-012's acceptance conditions).
 */
export declare function citationIssues(args: {
    context: AssembledContext;
    brief: DecisionBrief;
    framework_applications: readonly {
        source_evidence_ids: readonly string[];
        case_evidence_ids: readonly string[];
    }[];
    quotes: readonly {
        quote_id: string;
        evidence_id: string;
        verification_status: string;
    }[];
}): string[];
export type CruxType = 'fact' | 'numbers' | 'values' | 'execution';
/**
 * How a crux arose. Genuine disagreement origins (score_spread,
 * preference_split, blocking_condition) are distinguished from the
 * labeled adversarial test so no surface can present the stress test
 * as spontaneous dissent (T039).
 */
export type CruxOrigin = 'score_spread' | 'preference_split' | 'blocking_condition' | 'unanimity_stress_test';
/** One decision-changing crux (Section 14.3). */
export interface Crux {
    readonly crux_id: string;
    readonly type: CruxType;
    readonly origin: CruxOrigin;
    /** True only for the Section 14.3 adversarial alternative test. */
    readonly adversarial_test: boolean;
    readonly option_id: string;
    readonly competing_claims: readonly string[];
    readonly responsible_seats: readonly SeatId[];
    readonly needed_evidence: string;
    readonly resolution_test: string;
}
/** The minimum score spread that makes an option's disagreement a crux. */
export declare const CRUX_SCORE_SPREAD = 4;
/** The Section 14.3 ceiling: at most three cruxes. */
export declare const MAX_CRUXES = 3;
/**
 * The Section 14.3 adversarial alternative test, built when every
 * valid opening card prefers the same option: the strongest neglected
 * alternative (the highest weighted-mean non-preferred option) is
 * tested by the seat least convinced of the consensus and the seat
 * that scored the alternative highest. Labeled, never disguised as
 * genuine dissent (T039). Returns null when there is no unanimity or
 * no scored alternative to test.
 */
export declare function unanimityStressCrux(previousCards: readonly AdvisorCard[], brief: DecisionBrief, seatOrder: readonly SeatId[]): Crux | null;
/**
 * Identify up to three decision-changing cruxes from valid committed
 * opening cards (Section 14.3). Deterministic: the same committed
 * record always yields the same cruxes, IDs assigned in final order
 * (genuine disagreements first: numbers, then execution, then values;
 * the labeled adversarial test last). Fabricates nothing: every
 * competing claim is composed from values the cards actually recorded.
 */
export declare function extractCruxes(previousCards: readonly AdvisorCard[], brief: DecisionBrief, seatOrder: readonly SeatId[]): Crux[];
/** The cruxes one seat is responsible for, in crux order. */
export declare function assignedCruxesFor(cruxes: readonly Crux[], seatId: SeatId): Crux[];
/**
 * A peer's recorded argument about one crux, excerpted from its
 * committed opening card: exactly the peer material a challenged seat
 * needs (Section 14.3), never the whole transcript.
 */
export interface PeerArgumentExcerpt {
    readonly seat_id: SeatId;
    readonly stance: AdvisorCard['stance'];
    readonly preferred_option_id: string | null;
    readonly score_for_crux_option: number | null;
    readonly decisive_arguments: readonly string[];
    readonly strongest_objection: string;
}
export declare function peerArgumentsFor(crux: Crux, previousCards: readonly AdvisorCard[], forSeatId: SeatId): PeerArgumentExcerpt[];
/** Canonical digest of a set of committed cards' author payloads. */
export declare function cardSetSha256(cards: readonly CouncilCard[]): string;
/** Canonical digest of a crux set. */
export declare function cruxSetSha256(cruxes: readonly Crux[]): string;
/**
 * The Section 14.3 logical prompt contract for the challenge round.
 * CWE-050 consolidation: the single source is CHALLENGE_SYSTEM in
 * cli/engine.ts; this name is kept as the protocol surface.
 */
export declare const CHALLENGE_ROUND_SYSTEM: string;
/** Identity kind tag for a Round 2 challenge input manifest. */
export declare const CHALLENGE_INPUT_KIND = "wise-elders.challenge-input/v1";
/** The exact inputs one challenge operation is bound to. */
export interface ChallengeInputIdentity {
    readonly session_id: string;
    readonly brief_revision: number;
    readonly brief_sha256: string;
    readonly seat_id: SeatId;
    readonly pack_version: string;
    /** CWE-022 content hash of this seat's assembled challenge context. */
    readonly context_sha256: string;
    /** CWE-028 fingerprint of the pinned route snapshot. */
    readonly route_fingerprint: string;
    /**
     * Digest of the committed PREVIOUS round's card set the cruxes derive
     * from: round 1 cards for pass 2, round k-1 cards for pass k. The
     * field name is kept for the round-2 identity the earlier tests pin.
     */
    readonly round1_cards_sha256: string;
    /** Digest of the crux set extracted from those cards. */
    readonly cruxes_sha256: string;
    /**
     * The challenge pass this operation is. Round 2 is the first pass;
     * medium and heavy re-enter the challenge with rounds 3..10, and the
     * round is part of the input identity so every pass hashes differently
     * even when the committed card set repeats.
     */
    readonly round?: number;
}
export declare function challengeInputManifestSha256(identity: ChallengeInputIdentity): string;
/** A fully planned challenge seat operation, ready to enqueue. */
export interface ChallengeSeatPlan {
    readonly seat_id: SeatId;
    readonly pack_version: string;
    readonly context_sha256: string;
    readonly route_fingerprint: string;
    readonly input_manifest_sha256: string;
    /** Cruxes this seat must answer; empty is a valid, planned state (T149). */
    readonly assigned_crux_ids: readonly string[];
    readonly item_evidence_ids: readonly string[];
}
export type ChallengePlanResult = {
    readonly status: 'planned';
    readonly plan: ChallengeSeatPlan;
} | {
    readonly status: 'context_too_small';
    readonly readiness: 'CONTEXT_TOO_SMALL';
    readonly minimum_required_bytes: number;
    readonly available_bytes: number;
    readonly supported_lower_context_modes: readonly SessionMode[];
};
/** The full challenge round plan: the cruxes plus one plan per seat. */
export interface ChallengeRoundPlan {
    readonly cruxes: readonly Crux[];
    readonly plans: ReadonlyMap<SeatId, ChallengePlanResult>;
}
export declare class ChallengeRoundExecutor implements OperationExecutorPort {
    private readonly deps;
    constructor(deps: LaterRoundDeps);
    planSeat(session: StoredSession, snapshot: PinnedRouteSnapshot, seatId: SeatId, round?: number): ChallengePlanResult;
    /**
     * Plan one challenge pass: extract the cruxes from the PREVIOUS
     * round's committed record once, then plan EVERY panel seat in spec
     * order, challenged or not (T149). Round 2 is the first pass; medium
     * and heavy re-enter with rounds 3..MAX_ADVISOR_ROUND, each pass
     * deriving its cruxes from the round before it.
     */
    planChallengeRound(session: StoredSession, snapshot: PinnedRouteSnapshot, round?: number): ChallengeRoundPlan;
    /** The cruxes the committed record before `round` currently yields. */
    cruxesFor(session: StoredSession, round?: number): Crux[];
    dispatch(ctx: OperationDispatchContext): Promise<OperationDispatchResult>;
    /**
     * Deep validation of a stamped Round 2 card: identity, the input
     * manifest echo, the frozen brief, challenge integrity (T038: every
     * answered challenge is a real crux assigned to this seat; a
     * fabricated dispute or a crux belonging to another seat is
     * rejected; every assigned crux is answered unless the card is an
     * explicit abstention), the changed-score explanation rule
     * (Section 14.3), evidence citation bounds, quote gating, and
     * CWE-012's card source-use rules.
     */
    validateCard(ctx: OperationDispatchContext, card: CouncilCard): string[];
    /** The committed advisor cards of the round BEFORE `round`. */
    private previousCards;
    private prepareSeat;
}
