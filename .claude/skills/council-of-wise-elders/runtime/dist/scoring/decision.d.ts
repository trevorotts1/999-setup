/**
 * Deterministic decision analysis (directive Sections 12.2 to 12.7,
 * CWE-026 build step 1).
 *
 * Pure services over locked schemas and synthetic or real cards:
 * weighted scores, coverage, spread, option eligibility, verdict
 * labels, near ties, and the frozen critical-domain gates. Nothing here
 * waits for a live discussion engine, and nothing here invents an
 * argument a seat did not make.
 *
 * Arithmetic is delegated to the CWE-003 contracts scoring module
 * (computeOptionScore), the same module the CWE-004 core engine uses,
 * so these services and the core agree byte-for-byte on the golden
 * fixtures. This module adds what the contracts module deliberately
 * leaves to the verdict layer: eligibility, gates, and labels.
 *
 * Semantics enforced (Sections 12.2, 12.3, 12.4, 12.7):
 * - A null score is an explicit abstention. It is never a zero, never
 *   inferred support, and it reduces the denominator and coverage.
 * - A seat with no returned card is MISSING, reported separately. A
 *   timeout is one kind of missing; it is never relabeled an
 *   abstention (T045's boundary, enforced by input separation here).
 * - Eligibility is decided BEFORE labels: a confirmed hard-constraint
 *   FAIL disqualifies the option no matter how high it scores; a hard
 *   UNKNOWN blocks unconditional approval for that option.
 * - A GO-style label needs at least 80 percent weighted coverage on the
 *   recommended option AND no unresolved critical-domain gate on it.
 *   Mathematical coverage and decision safety stay separate: the
 *   golden abstention variant keeps 86.36 percent coverage and still
 *   cannot be an unconditional GO (Section 32.2).
 * - A missing critical assessment stays not_assessed and can never be
 *   laundered into PASS by a high mean, an abstention relabel, or a
 *   user checkbox (T144). An option-specific classification permits a
 *   justified safe alternative without endorsing an exposed unknown
 *   (T145).
 * - A difference within 0.25 is a near tie: the tradeoff is preserved.
 *   The less irreversible, lower-exposure option is preferred only
 *   when recorded exposure evidence supports that distinction;
 *   otherwise the unresolved crux and the next fact needed are
 *   returned instead of a rounding decision (T044).
 */
import { type ConstraintResult, type CriticalDomain, type CriticalDomainRequirement, type DecisionBrief, type DecisionOption, type HardConstraintFinding, type SeatId, type VerdictLabel } from '../contracts/index.js';
import type { CriticalDomainApplicability } from './critical-domains.js';
/** One seat's final-round judgment on one option, from a returned card. */
export interface OptionScoreInput {
    option_id: string;
    seat_id: SeatId;
    /** 0..10, or null for an explicit abstention. */
    score: number | null;
}
export type ExposureLevel = 'low' | 'medium' | 'high';
export interface OptionExposure {
    option_id: string;
    irreversibility: ExposureLevel;
    exposure: ExposureLevel;
}
/** A qualified professional review outcome for one option, or global. */
export interface ProfessionalReviewOutcome {
    /** Null means the outcome applies to every option. */
    option_id: string | null;
    result: ConstraintResult;
}
export interface DecisionInput {
    options: readonly DecisionOption[];
    /** The active panel for this session. */
    active_seat_ids: readonly SeatId[];
    /** Frozen relevance weights (Section 12.1); required for every seat. */
    weights: Partial<Record<SeatId, number>>;
    /** Scores from returned final-round cards only. */
    scores: readonly OptionScoreInput[];
    /** Active seats that returned no card. Never scored, never abstentions. */
    missing_seat_ids?: readonly SeatId[];
    /** Subset of missing seats whose absence was a timeout. */
    timed_out_seat_ids?: readonly SeatId[];
    /** Hard-constraint findings per option (Section 12.3). */
    hard_constraints?: readonly HardConstraintFinding[];
    /** Frozen critical-domain classification from the reviewed brief. */
    critical_domains?: readonly CriticalDomainRequirement[];
    /** Per-option domain applicability; a domain with no pairs is global. */
    critical_domain_applicability?: readonly CriticalDomainApplicability[];
    /** Outcomes for the qualified_professional_review domain. */
    professional_reviews?: readonly ProfessionalReviewOutcome[];
    /** Recorded exposure evidence used only for near-tie resolution. */
    option_exposure?: readonly OptionExposure[];
}
export interface OptionAnalysis {
    option_id: string;
    eligible: boolean;
    eligibility_reasons: string[];
    weighted_sum: number;
    denominator: number;
    /** Null when no seat scored the option; never reported as 0. */
    score: number | null;
    display_score: number | null;
    coverage: number;
    spread: number | null;
    scored_seat_ids: SeatId[];
    abstained_seat_ids: SeatId[];
    hard_failure_constraint_ids: string[];
    hard_unknown_constraint_ids: string[];
    /** Critical domains still gating this option (decision safety). */
    critical_blockers: CriticalDomain[];
    /** Required reviewers who abstained on this option. */
    critical_abstentions: SeatId[];
    /** The label this option would carry if recommended, else null. */
    band_label: VerdictLabel | null;
}
export interface NearTieAnalysis {
    present: boolean;
    option_ids: string[];
    score_gap: number | null;
    resolution: 'less_irreversible_preferred' | 'unresolved_crux' | null;
    preferred_option_id: string | null;
    /** Named when the tie cannot be resolved on recorded evidence. */
    next_fact_needed: string | null;
}
export interface DecisionAnalysis {
    verification_level: 'contract_tested';
    total_active_weight: number;
    options: OptionAnalysis[];
    /** Highest-ranked eligible scored option before gate labels. */
    leading_option_id: string | null;
    /** The option the verdict may recommend; null when none is justified. */
    recommended_option_id: string | null;
    label: VerdictLabel;
    label_reasons: string[];
    /** Named prerequisites behind a WAIT, in deterministic order. */
    prerequisites_needed: string[];
    near_tie: NearTieAnalysis;
    missing_seat_ids: SeatId[];
    timed_out_seat_ids: SeatId[];
}
/**
 * Derive the hard-constraint findings a verdict is evaluated against
 * (Section 12.3; CWE-050 reconciliation of CWE-026 divergence (a)).
 *
 * The canonical rule, owned by CWE-026's analysis: findings are
 * APPLIED, never assumed away. A recorded checker result (supplied by
 * the composition from a deterministic check, a seat, or a qualified
 * professional) wins for its constraint and option. Where no checker
 * has recorded a result, the honest deterministic state is `unknown`
 * from `deterministic_code` with no evidence: an unchecked hard
 * constraint is not a passed one, and under the analysis an unknown
 * blocks an unconditional recommendation until it is checked. The
 * pre-reconciliation CWE-004 engine emitted an empty findings list,
 * which silently treated every hard constraint as satisfied; that
 * behavior is retired everywhere by this shared derivation.
 */
export declare function deriveHardConstraintFindings(brief: DecisionBrief, recorded?: readonly HardConstraintFinding[]): HardConstraintFinding[];
/**
 * Analyze a scored decision. Pure and deterministic: no clock, no
 * randomness, no host access. Throws ContractError on malformed input
 * (duplicate seats or options, unknown references, missing weights);
 * decision-shaped problems (abstentions, disqualifications, gates) are
 * reported in the result, never thrown.
 */
export declare function analyzeDecision(input: DecisionInput): DecisionAnalysis;
