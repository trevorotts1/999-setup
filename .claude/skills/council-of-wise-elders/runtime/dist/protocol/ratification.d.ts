/**
 * Draft resolution, ratification, consult completion, and the
 * completed-deliberation assembly (CWE-025; directive Sections 10,
 * 11.5 to 11.7, 12.8, 14.4, 14.5, and the Section 34 CWE-025 build
 * steps 3 and 4).
 *
 * What lives here:
 * - composeDraftResolution: the chair's draft as DETERMINISTIC CODE
 *   (Section 14.4: provisional scores are calculated in code; the
 *   chair's prose cannot change arithmetic). The recommended option
 *   comes from CWE-026's analyzeDecision over the committed Round 2
 *   cards, never from a second scorer. Actions are the Round 2
 *   conditions of seats that prefer the recommended option, duplicates
 *   merged without losing their source condition IDs; prerequisites
 *   are the frozen brief's unresolved critical-domain questions plus
 *   the analysis's named prerequisites; limits are the brief's hard
 *   constraints. The draft's semantic hash is CWE-026's
 *   draftResolutionSemanticHash, the exact digest ratification cards
 *   bind to (T046).
 * - evaluateQuickModeSkip: CWE-023 records the five quick-mode
 *   prerequisites verbatim at freeze with evaluated_by 'CWE-025';
 *   this is that evaluation, run against the run's actual cards and
 *   the composed draft (Section 10's gate, T022). Every prerequisite
 *   gets its own satisfied flag and detail; a tie, an invalid or
 *   missing card, a critical abstention, or a newly proposed material
 *   condition fails the gate, and no resolution-support votes are
 *   ever invented for a skipped round.
 * - RatificationRoundExecutor: the OperationExecutorPort for Round 3,
 *   composed with CWE-027's runner exactly as the opening and
 *   challenge executors compose. It composes the draft itself from
 *   the committed Round 2 record (deterministically, through
 *   composeDraftResolution), so planning, dispatch, and validation
 *   always bind the same draft the composition's resolution_drafted
 *   event names. Validation binds each card to the exact draft
 *   semantic hash (T046).
 * - ConsultExecutor: the one-seat consult operation (Sections 10,
 *   11.6, T023, T146). Its descriptor round is 0, the round key the
 *   CWE-006 store's findCard assigns consult cards (they carry no
 *   round field). A consult is not a vote: the executor produces one
 *   ConsultCard and the completion service below produces the
 *   discriminated ConsultResult, with no options, scores, or
 *   consensus anywhere in either.
 * - assembleDeliberationOutcome / assembleConsultOutcome: the
 *   completion services that hand a finished deliberation to CWE-026.
 *   Scoring flows ONLY through analyzeDecision + buildScoredVerdict;
 *   publication is checked through validateVerdictForPublication
 *   against the exact revision hash with the final cards required.
 *   Completeness follows Section 11.7 exactly: full mode needs nine
 *   valid cards or explicit abstentions in every required round and a
 *   missing seat is never disguised as an abstention (T021, T045);
 *   selected mode accounts for every selected seat by name (T023);
 *   quick mode completes without Round 3 only when the skip gate
 *   passes on the final proposed plan; three rounds is the ceiling,
 *   and a materially amended plan carries
 *   material_change_unratified with its old support counted only
 *   against the original hash (T046, T047 family, T048, T147).
 *
 * Amendment materiality is assessed with CWE-026's assessAmendment at
 * completion: a proposer labeling a material-root change
 * 'nonmaterial' does not make it so. Card VALIDATION deliberately
 * does not reject on claimed materiality; the assessment governs the
 * verdict's status instead (disclosed in the build report).
 */
import { type AdvisorCard, type CouncilCard, type DecisionBrief, type DraftResolution, type HardConstraintFinding, type RatificationCard, type RatificationStatus, type ResolutionSupport, type ScoredVerdict, type SeatId, type SessionMode, type SessionSpec, type Verdict } from '../contracts/index.js';
import { type TrustedPrincipal } from '../authorization/index.js';
import { type PinnedRouteSnapshot } from '../budgets/index.js';
import { type MaterialCatalog, type RouteContextBudget } from '../context/index.js';
import type { ModelTransport, StoredSession } from '../cli/host-ports.js';
import { type OperationDispatchContext, type OperationDispatchResult, type OperationExecutorPort } from '../queue/runner.js';
import type { QuickModePolicyRecord } from '../intake/panel.js';
import { type DecisionAnalysis, type DecisionInput, type ProfessionalReviewOutcome } from '../scoring/index.js';
import { deriveCriticalDomainApplicability } from '../scoring/critical-domains.js';
export { deriveCriticalDomainApplicability };
import { draftResolutionSemanticHash, verdictContentHash, type PublicationValidation } from './verdict.js';
import { type LaterRoundDeps } from './challenge.js';
/** A composed draft plus the condition sources behind each action. */
export interface DraftComposition {
    readonly draft: DraftResolution;
    /**
     * Source condition IDs behind each draft action, parallel to
     * draft.actions: the conditions (from Round 2 cards of seats
     * preferring the recommended option) whose descriptions merged
     * into that action. No source is lost when duplicates merge
     * (Section 14.4).
     */
    readonly action_source_condition_ids: readonly (readonly string[])[];
    /** The CWE-026 analysis the recommendation came from. */
    readonly analysis: DecisionAnalysis;
}
export interface ComposeDraftInput {
    readonly brief: DecisionBrief;
    /** The session's panel, in spec order (Section 11.7 accounting). */
    readonly active_seat_ids: readonly SeatId[];
    readonly round2Cards: readonly AdvisorCard[];
    readonly hard_constraint_findings?: readonly HardConstraintFinding[];
    readonly professional_reviews?: readonly ProfessionalReviewOutcome[];
    /** Draft revision within the session attempt; 1 for the first draft. */
    readonly revision?: number;
}
/** DecisionInput over a card set, mirroring CWE-026's own derivation. */
export declare function decisionInputForCards(args: {
    brief: DecisionBrief;
    active_seat_ids: readonly SeatId[];
    cards: readonly (AdvisorCard | RatificationCard)[];
    hard_constraint_findings?: readonly HardConstraintFinding[];
    professional_reviews?: readonly ProfessionalReviewOutcome[];
}): DecisionInput;
/**
 * Compose the chair's draft resolution from the committed Round 2
 * record (Section 14.4). Pure and deterministic: the same committed
 * cards, brief, and findings always compose the same draft and the
 * same semantic hash, at planning time, dispatch time, validation
 * time, and completion time.
 */
export declare function composeDraftResolution(input: ComposeDraftInput): DraftComposition;
export interface QuickSkipPrerequisiteResult {
    readonly id: string;
    readonly text: string;
    readonly satisfied: boolean;
    readonly detail: string;
}
export interface QuickSkipEvaluation {
    readonly skip: boolean;
    /** The exact status a skipped Round 3 records (Section 10). */
    readonly ratification_status_when_skipped: 'not_run_by_quick_mode_policy';
    readonly prerequisites: readonly QuickSkipPrerequisiteResult[];
}
export interface QuickSkipInput {
    readonly policy: QuickModePolicyRecord;
    readonly brief: DecisionBrief;
    readonly round1Cards: readonly AdvisorCard[];
    readonly round2Cards: readonly AdvisorCard[];
    readonly draft: DraftResolution;
    /** Source condition IDs per draft action, when the composer supplied them. */
    readonly draft_action_source_condition_ids?: readonly (readonly string[])[];
    readonly hard_constraint_findings?: readonly HardConstraintFinding[];
}
/**
 * Evaluate CWE-023's frozen quick-mode policy record against the
 * run's actual cards and the final proposed plan (Section 10, T022).
 * The gate is evaluated per prerequisite and fails closed: anything
 * unproven is unsatisfied.
 */
export declare function evaluateQuickModeSkip(input: QuickSkipInput): QuickSkipEvaluation;
/**
 * The Section 14.5 logical prompt contract for ratification. CWE-050
 * consolidation: the single source is RATIFICATION_SYSTEM in
 * cli/engine.ts; this name is kept as the protocol surface.
 */
export declare const RATIFICATION_ROUND_SYSTEM: string;
/** Identity kind tag for a Round 3 ratification input manifest. */
export declare const RATIFICATION_INPUT_KIND = "wise-elders.ratification-input/v1";
export interface RatificationInputIdentity {
    readonly session_id: string;
    readonly brief_revision: number;
    readonly brief_sha256: string;
    readonly seat_id: SeatId;
    readonly pack_version: string;
    readonly context_sha256: string;
    readonly route_fingerprint: string;
    /** The exact draft this seat is asked to judge (Section 12.8). */
    readonly draft_resolution_sha256: string;
}
export declare function ratificationInputManifestSha256(identity: RatificationInputIdentity): string;
export interface RatificationSeatPlan {
    readonly seat_id: SeatId;
    readonly pack_version: string;
    readonly context_sha256: string;
    readonly route_fingerprint: string;
    readonly input_manifest_sha256: string;
    readonly draft_resolution_sha256: string;
    readonly item_evidence_ids: readonly string[];
}
export type RatificationPlanResult = {
    readonly status: 'planned';
    readonly plan: RatificationSeatPlan;
} | {
    readonly status: 'context_too_small';
    readonly readiness: 'CONTEXT_TOO_SMALL';
    readonly minimum_required_bytes: number;
    readonly available_bytes: number;
    readonly supported_lower_context_modes: readonly SessionMode[];
};
export interface RatificationRoundPlan {
    readonly draft: DraftResolution;
    readonly composition: DraftComposition;
    readonly plans: ReadonlyMap<SeatId, RatificationPlanResult>;
}
/** Extra composition inputs ratification needs beyond the shared deps. */
export interface RatificationRoundDeps extends LaterRoundDeps {
    /**
     * Hard-constraint findings recorded for the session (deterministic
     * checkers, seats, or qualified professionals, Section 12.3). Absent:
     * no findings, which the analysis treats as no confirmed failures.
     */
    readonly loadHardConstraintFindings?: (session: StoredSession) => readonly HardConstraintFinding[];
    /** Qualified professional review outcomes, when any exist. */
    readonly loadProfessionalReviews?: (session: StoredSession) => readonly ProfessionalReviewOutcome[];
}
export declare class RatificationRoundExecutor implements OperationExecutorPort {
    private readonly deps;
    constructor(deps: RatificationRoundDeps);
    /** Compose the draft from the committed Round 2 record. */
    composeDraft(session: StoredSession): DraftComposition;
    planSeat(session: StoredSession, snapshot: PinnedRouteSnapshot, seatId: SeatId): RatificationPlanResult;
    /** Plan the whole ratification round: one draft, one plan per seat. */
    planRatificationRound(session: StoredSession, snapshot: PinnedRouteSnapshot): RatificationRoundPlan;
    dispatch(ctx: OperationDispatchContext): Promise<OperationDispatchResult>;
    /**
     * Deep validation of a stamped Round 3 card: identity, the input
     * manifest echo, the frozen brief, and above all the exact
     * draft-resolution hash binding (T046). Amendment authorship is
     * checked (a seat proposes only its own amendments); amendment
     * materiality is NOT judged here (completion assesses it through
     * CWE-026's assessAmendment, Section 12.8). Accepted condition IDs
     * must name conditions the committed Round 2 record actually
     * carries.
     */
    validateCard(ctx: OperationDispatchContext, card: CouncilCard): string[];
    private round2Cards;
    private prepareSeat;
}
/**
 * The Section 14 consult prompt contract. CWE-050 consolidation: the
 * single source is CONSULT_SYSTEM in cli/engine.ts; re-exported under
 * the same name for this module's existing surface.
 */
export declare const CONSULT_SYSTEM: string;
/** Identity kind tag for a consult input manifest. */
export declare const CONSULT_INPUT_KIND = "wise-elders.consult-input/v1";
/**
 * The descriptor and store round key for consult operations: consult
 * cards carry no round field, and the CWE-006 store's findCard maps
 * them to round 0 (the same key CWE-004's engine used).
 */
export declare const CONSULT_DESCRIPTOR_ROUND = 0;
export interface ConsultInputIdentity {
    readonly session_id: string;
    readonly brief_revision: number;
    readonly brief_sha256: string;
    readonly seat_id: SeatId;
    readonly pack_version: string;
    readonly context_sha256: string;
    readonly route_fingerprint: string;
}
export declare function consultInputManifestSha256(identity: ConsultInputIdentity): string;
export interface ConsultPlan {
    readonly seat_id: SeatId;
    readonly pack_version: string;
    readonly context_sha256: string;
    readonly route_fingerprint: string;
    readonly input_manifest_sha256: string;
    readonly item_evidence_ids: readonly string[];
}
export type ConsultPlanResult = {
    readonly status: 'planned';
    readonly plan: ConsultPlan;
} | {
    readonly status: 'context_too_small';
    readonly readiness: 'CONTEXT_TOO_SMALL';
    readonly minimum_required_bytes: number;
    readonly available_bytes: number;
    readonly supported_lower_context_modes: readonly SessionMode[];
};
export declare class ConsultExecutor implements OperationExecutorPort {
    private readonly deps;
    constructor(deps: LaterRoundDeps);
    planConsult(session: StoredSession, snapshot: PinnedRouteSnapshot): ConsultPlanResult;
    dispatch(ctx: OperationDispatchContext): Promise<OperationDispatchResult>;
    validateCard(ctx: OperationDispatchContext, card: CouncilCard): string[];
    private prepare;
}
/** Per-seat accounting for one round (Section 11.7 completeness). */
export type SeatRoundAccounting = 'card' | 'explicit_abstention' | 'missing';
export interface DeliberationAccounting {
    readonly round1: Readonly<Partial<Record<SeatId, SeatRoundAccounting>>>;
    readonly round2: Readonly<Partial<Record<SeatId, SeatRoundAccounting>>>;
    readonly round3: Readonly<Partial<Record<SeatId, SeatRoundAccounting>>>;
}
export interface DeliberationOutcomeComplete {
    readonly status: 'complete';
    readonly mode: SessionMode;
    /** The panel exactly as frozen in the spec; a subset names itself (T023). */
    readonly panel_seat_ids: readonly SeatId[];
    readonly verdict: ScoredVerdict;
    readonly publication: PublicationValidation;
    readonly analysis: DecisionAnalysis;
    readonly draft: DraftResolution;
    readonly resolution_support: ResolutionSupport | null;
    readonly ratification_status: RatificationStatus;
    /** Present when quick mode completed by the Section 10 gate. */
    readonly quick_skip: QuickSkipEvaluation | null;
    readonly accounting: DeliberationAccounting;
}
export interface DeliberationOutcomeIncomplete {
    readonly status: 'incomplete';
    readonly mode: SessionMode;
    readonly panel_seat_ids: readonly SeatId[];
    /** Every unaccounted seat, by round: the visible partial record. */
    readonly missing: readonly {
        readonly round: 1 | 2 | 3;
        readonly seat_id: SeatId;
    }[];
    readonly detail: string;
    readonly accounting: DeliberationAccounting;
}
export type DeliberationOutcome = DeliberationOutcomeComplete | DeliberationOutcomeIncomplete;
export interface AssembleDeliberationInput {
    readonly spec: SessionSpec;
    readonly brief: DecisionBrief;
    readonly cards: readonly CouncilCard[];
    /** The composed draft, when the caller already holds it. */
    readonly draft_composition?: DraftComposition;
    /** CWE-023's frozen quick-mode policy record (quick sessions). */
    readonly quick_policy?: QuickModePolicyRecord | null;
    readonly hard_constraint_findings?: readonly HardConstraintFinding[];
    readonly professional_reviews?: readonly ProfessionalReviewOutcome[];
    readonly verdict_revision?: number;
}
/**
 * Assemble the completed deliberation for a scored mode and validate
 * it for publication through CWE-026 (Sections 11.7, 14.6). Returns a
 * discriminated outcome: 'complete' carries the validated verdict;
 * 'incomplete' carries the exact missing record and never a verdict.
 * No fourth round exists anywhere in this surface (T048): unresolved
 * disagreement is published honestly through the analysis label, or
 * the outcome is incomplete.
 */
export declare function assembleDeliberationOutcome(input: AssembleDeliberationInput): DeliberationOutcome;
export interface ConsultOutcomeComplete {
    readonly status: 'complete';
    readonly mode: 'consult';
    readonly panel_seat_ids: readonly SeatId[];
    /** The discriminated consult result: no scores, no vote (T023). */
    readonly result: Extract<Verdict, {
        result_kind: 'consult';
    }>;
    readonly publication: PublicationValidation;
}
export interface ConsultOutcomeIncomplete {
    readonly status: 'incomplete';
    readonly mode: 'consult';
    readonly panel_seat_ids: readonly SeatId[];
    readonly detail: string;
}
export type ConsultOutcome = ConsultOutcomeComplete | ConsultOutcomeIncomplete;
/**
 * Assemble a consult result from the one committed ConsultCard
 * (Sections 11.5, 11.7, T146): PREPARING -> CONSULTING -> VERIFYING ->
 * COMPLETED with a single valid card and no council scoring anywhere.
 */
export declare function assembleConsultOutcome(input: {
    spec: SessionSpec;
    brief: DecisionBrief;
    cards: readonly CouncilCard[];
    verdict_revision?: number;
}): ConsultOutcome;
export { draftResolutionSemanticHash, verdictContentHash };
export type { PublicationValidation };
export type { TrustedPrincipal, MaterialCatalog, RouteContextBudget, ModelTransport, PinnedRouteSnapshot };
