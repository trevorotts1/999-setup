/**
 * Verdict services (directive Sections 11.5, 11.6, 12.8, 14.6, CWE-026
 * build steps 2 to 4).
 *
 * What lives here:
 * - Verdict assembly from a DecisionAnalysis plus card-derived content
 *   (reasons and dissent are drawn from the original cards, never
 *   invented and never written back over them).
 * - Publication validation against the EXACT revision hash: a report is
 *   publishable only when this validator has checked the exact content
 *   hash of that revision (Section 11.5). Validation of earlier rounds
 *   never substitutes: a verdict whose final attribution fails is
 *   blocked even when every earlier round passed (Section 14.6, T047).
 * - Resolution support counted from ratification cards bound to the
 *   exact draft-resolution semantic hash (Sections 11.6, 12.8).
 * - Client accept / reject / defer as a SEPARATE record. It never
 *   alters the historical recommendation (Section 11.5).
 * - Material-amendment assessment under Section 12.8: previous support
 *   never transfers to a materially amended plan, no fourth round is
 *   created, and nothing dispatches from an unratified altered plan.
 *
 * Pure services: no host, network, filesystem, clock, or random
 * dependency. Hashes use the one canonical serializer from CWE-003.
 */
import { type ActionProposal, type AdvisorCard, type Amendment, type AmendmentMateriality, type CouncilCard, type DecisionBrief, type DraftResolution, type EvidenceStrength, type HardConstraintFinding, type RatificationCard, type RatificationStatus, type ResolutionSupport, type ScoredVerdict, type SeatId, type Verdict } from '../contracts/index.js';
import { type DecisionAnalysis } from '../scoring/decision.js';
/**
 * The content hash of a verdict: canonical hash of the verdict with
 * only its own content_sha256 field removed. This reproduces exactly
 * the digest the CWE-004 core computes at assembly time (it hashes the
 * base object before attaching the field), so a stored verdict can be
 * re-verified byte-for-byte at publication time.
 */
export declare function verdictContentHash(verdict: Verdict): string;
/**
 * The semantic hash of a draft resolution: canonical hash with only
 * its own semantic_sha256 field removed. Ratification cards bind to
 * exactly this digest (Section 12.8).
 */
export declare function draftResolutionSemanticHash(draft: DraftResolution): string;
/**
 * Up to three main reasons, drawn in card order from the decisive
 * arguments of final-round advisor cards that preferred the
 * recommended option. Nothing is paraphrased into existence: the
 * strings are the seats' own recorded arguments.
 */
export declare function summarizeMainReasons(finalCards: readonly AdvisorCard[], recommendedOptionId: string | null): string[];
/**
 * The strongest dissent: the strongest objection of the card least
 * favorable to the recommended option (lowest recorded score for it).
 * An abstaining card is not treated as the strongest dissent.
 */
export declare function summarizeStrongestDissent(finalCards: readonly AdvisorCard[], recommendedOptionId: string | null): string | null;
/** Evidence strength aggregated from the final-round cards. */
export declare function aggregateEvidenceStrength(finalCards: readonly AdvisorCard[]): EvidenceStrength;
/**
 * Weighted support counts for ONE exact resolution hash, counted from
 * ratification cards bound to that hash. Counts are never a probability
 * and are never inferred from option scores (Section 11.6).
 */
export declare function computeResolutionSupport(ratificationCards: readonly RatificationCard[], weights: Partial<Record<SeatId, number>>, resolutionSha256: string): ResolutionSupport;
/** Seats whose ratification cards are bound to a DIFFERENT hash. */
export declare function findMisboundRatificationCards(ratificationCards: readonly RatificationCard[], resolutionSha256: string): SeatId[];
export interface ScoredVerdictBuildInput {
    analysis: DecisionAnalysis;
    session_id: string;
    verdict_revision: number;
    brief_sha256: string;
    /** The frozen weights, echoed into the verdict as active_weights. */
    weights: Partial<Record<SeatId, number>>;
    evidence_strength: EvidenceStrength;
    hard_constraint_findings: HardConstraintFinding[];
    main_reasons: string[];
    strongest_dissent: string | null;
    accepted_amendments: Amendment[];
    rejected_amendments: Amendment[];
    critical_unknowns: string[];
    prerequisites: string[];
    action_proposals: ActionProposal[];
    cheapest_informative_test: string | null;
    stop_criteria: string[];
    review_criteria: string[];
    resolution_support: ResolutionSupport | null;
    ratification_status: RatificationStatus;
}
/**
 * Assemble a scored verdict from a decision analysis. The content hash
 * is computed over the exact stored bytes (minus the hash field), and
 * the assembled verdict must pass the canonical schema before it is
 * returned carrying validation_status 'valid'.
 */
export declare function buildScoredVerdict(input: ScoredVerdictBuildInput): ScoredVerdict;
export interface PublicationCheck {
    name: string;
    status: 'pass' | 'fail' | 'not_run';
    detail: string;
}
export interface PublicationValidation {
    /** True only when every required check passed for THIS revision. */
    publishable: boolean;
    verdict_revision: number;
    /** The content hash claimed by the verdict. */
    content_sha256: string;
    /** The content hash recomputed by this validator. */
    computed_content_sha256: string;
    checks: PublicationCheck[];
}
export interface PublicationValidationInput {
    verdict: Verdict;
    /** The frozen brief the verdict claims to answer. */
    brief: DecisionBrief;
    /** Final-round cards (advisor round 2 and ratification), when available. */
    final_cards?: readonly CouncilCard[];
    /** The frozen draft resolution, when ratification is in scope. */
    draft_resolution?: DraftResolution;
    /** When true, missing final cards fail publication instead of not_run. */
    require_final_cards?: boolean;
}
/**
 * Validate a verdict for publication against its exact revision hash.
 * This is the Section 14.6 final validation: schema, arithmetic,
 * constraint, citation, attribution, and action-policy checks run
 * against the FINAL verdict revision, so an invalid final attribution
 * blocks release even when earlier rounds passed.
 */
export declare function validateVerdictForPublication(input: PublicationValidationInput): PublicationValidation;
export type ClientVerdictResponse = 'accepted' | 'rejected' | 'deferred';
export interface ClientVerdictResponseRecord {
    schema_version: 'wise-elders.client-verdict-response/v1';
    session_id: string;
    verdict_revision: number;
    verdict_content_sha256: string;
    response: ClientVerdictResponse;
    responded_by_principal: string;
    responded_at: string;
    /** A client response never alters the historical recommendation. */
    alters_verdict: false;
}
/**
 * Record the client's accept / reject / defer decision about a verdict.
 * Returns a standalone record; the verdict object is neither mutated
 * nor re-hashed, and no part of the recommendation changes.
 */
export declare function recordClientVerdictResponse(verdict: ScoredVerdict, response: ClientVerdictResponse, respondedByPrincipal: string, respondedAtUtc: string): ClientVerdictResponseRecord;
/**
 * Target-path roots whose change is ALWAYS material under Section
 * 12.8: recommended option, required prerequisite, spending or
 * exposure limit, actor or owner authority, action scope, execution
 * permission, due-date commitment, or stop criterion.
 */
export declare const MATERIAL_AMENDMENT_TARGET_ROOTS: ReadonlySet<string>;
export interface AmendmentAssessment {
    materiality: AmendmentMateriality;
    /** Previous ratification support carries to the amended plan. */
    support_transfers: boolean;
    /** The chair may apply it as an editorial correction on the same hash. */
    may_apply_editorially: boolean;
    required_outcome: 'editorial_same_hash' | 'publish_original_or_wait_unratified';
    /** Status the amended plan would carry if published unratified. */
    ratification_status_if_published: RatificationStatus | null;
    creates_fourth_round: false;
    dispatch_allowed: false;
    reasons: string[];
}
/**
 * Assess a proposed amendment to a frozen draft resolution. Pure
 * spelling, formatting, or citation-presentation changes are
 * nonmaterial only when they change no meaning; any change touching a
 * material root is material regardless of how it is labeled, and a
 * proposer-claimed material change is always honored as material.
 */
export declare function assessAmendment(input: {
    target_path: string;
    claimed_materiality: AmendmentMateriality;
}): AmendmentAssessment;
