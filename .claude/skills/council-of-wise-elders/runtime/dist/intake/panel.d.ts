/**
 * CWE-023 panel rules for the four intake modes (directive Sections
 * 10 and 12.7).
 *
 * For selected and quick panels the required critical responsibilities
 * are computed and displayed BEFORE start. A panel missing a critical
 * responsibility keeps that assessment `not_assessed`, which blocks a
 * GO-style endorsement downstream where that assessment is necessary.
 * The system may RECOMMEND including the responsible seat; it never
 * silently changes the client's chosen panel. The client may retain
 * the subset; the missing assessment stays visible.
 *
 * Quick mode records its Round 3 skip prerequisites verbatim at
 * freeze (Section 10 gate). The skip DECISION is evaluated on the
 * run's cards by CWE-025 (T022); this module records the prerequisites
 * and the exact status string a skip must carry, it does not evaluate
 * them.
 */
import { type CriticalDomain, type CriticalDomainRequirement, type SeatId, type SessionMode } from '../contracts/index.js';
import { type IntakeDraft } from './types.js';
/** Validate a chosen panel against the mode's seat-count rules. */
export declare function validatePanel(mode: SessionMode, seatIds: readonly SeatId[]): void;
export interface RequiredResponsibility {
    readonly domain: CriticalDomain;
    readonly required_seat_id: SeatId | null;
    readonly required_checker: 'seat' | 'qualified_professional';
    readonly reviewer_note: string;
    /** Whether the chosen panel covers this responsibility. */
    readonly on_panel: boolean;
    /**
     * Effective pre-start status. A missing responsibility stays
     * `not_assessed`; a covered one is `unresolved` until the run's
     * assessment exists.
     */
    readonly status: 'not_assessed' | 'unresolved';
}
export interface PanelRecommendation {
    readonly domain: CriticalDomain;
    readonly seat_id: SeatId;
    readonly message: string;
}
/**
 * The quick-mode ratification gate, recorded verbatim at freeze
 * (Section 10). Prerequisites are pending until CWE-025 evaluates
 * them against the run's actual cards.
 */
export interface QuickModePolicyRecord {
    readonly seat_ids: readonly SeatId[];
    /** The exact status recorded when Round 3 is skipped. */
    readonly ratification_status_when_skipped: 'not_run_by_quick_mode_policy';
    readonly prerequisites: readonly {
        readonly id: string;
        readonly text: string;
        readonly status: 'pending_run';
    }[];
    readonly evaluated_by: 'CWE-025';
}
export declare function quickModePolicyRecord(seatIds: readonly SeatId[]): QuickModePolicyRecord;
export interface PanelAssessment {
    readonly mode: SessionMode;
    readonly seat_ids: readonly SeatId[];
    readonly required_responsibilities: readonly RequiredResponsibility[];
    readonly missing_critical_domains: readonly CriticalDomain[];
    readonly recommendations: readonly PanelRecommendation[];
    /**
     * True when a triggered critical domain stays not_assessed in a
     * scored mode, so a GO-style endorsement is blocked downstream
     * where that assessment is necessary (Section 12.7). Consults
     * explain limitations rather than manufacturing a panel score, so
     * this is always false for consult.
     */
    readonly blocks_go_style_endorsement: boolean;
    readonly quick_mode_policy: QuickModePolicyRecord | null;
}
/**
 * Compute the pre-start panel assessment. Pure: reads the draft's
 * mode, panel, triggered domains, and professional-review flag, and
 * changes nothing. Recommendations are offered; the panel is the
 * client's and stays exactly as chosen.
 */
export declare function assessPanel(args: {
    mode: SessionMode;
    seatIds: readonly SeatId[];
    requirements: readonly CriticalDomainRequirement[];
    professionalReviewArranged: boolean | null;
}): PanelAssessment;
/**
 * Recommend a quick panel by decision relevance (Section 10): seats
 * responsible for triggered critical domains first (financial exposure
 * always offers Tiffany Aliche; an offer or acquisition decision
 * always offers Russell Brunson), then the remaining roster in order.
 * A recommendation only: the client selects or accepts the panel.
 */
export declare function recommendQuickPanel(draft: IntakeDraft): SeatId[];
