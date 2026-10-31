/**
 * Deterministic scoring arithmetic (directive Sections 12.2 and 12.4).
 *
 * Arithmetic is code, never model output. Rules:
 * - weighted score = sum(weight * score) / sum(weight) over seats that
 *   actually scored the option; a null (abstention) is never a zero;
 * - coverage = scored weight / total active weight;
 * - spread = max scored value - min scored value, null when nothing scored;
 * - full precision is kept internally; display rounds to one decimal and
 *   display rounding changes no decision (test contract T148);
 * - a GO-style label requires at least 80 percent coverage AND no unresolved
 *   critical-domain abstention (the gate itself lives with the verdict
 *   builder in later units; the constants and label bands live here);
 * - a tie within 0.25 points is a near tie, not false precision.
 */
import type { VerdictLabel } from './enums.js';
export interface SeatScoreEntry {
    seat_id: string;
    /** Frozen relevance weight, 1..3 (Section 12.1). */
    weight: number;
    /** 0..10, or null for an explicit abstention. Never NaN. */
    score: number | null;
}
export interface OptionScoreResult {
    weighted_sum: number;
    denominator: number;
    /** Null when no seat scored the option; never reported as 0. */
    score: number | null;
    display_score: number | null;
    coverage: number;
    spread: number | null;
}
export declare function computeOptionScore(entries: readonly SeatScoreEntry[], totalActiveWeight: number): OptionScoreResult;
/** Minimum weighted coverage for a GO-style label (Section 12.2 policy). */
export declare const GO_COVERAGE_THRESHOLD = 0.8;
/** Score difference at or below which two options are a near tie. */
export declare const NEAR_TIE_BAND = 0.25;
export declare function isNearTie(a: number, b: number): boolean;
/** Default label bands (Section 12.4), applied AFTER eligibility checks. */
export declare function labelForScore(score: number): VerdictLabel;
