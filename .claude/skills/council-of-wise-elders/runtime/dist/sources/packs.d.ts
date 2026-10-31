/**
 * Advisor pack validation (CWE-012): the structural and substantive
 * audit of one seat's pack, plus the seat registry checks (T001) and
 * the T. D. Jakes one-seat-three-lenses structure (T003 groundwork).
 *
 * Packs are validated from parsed file contents, never from filenames:
 * a file named like a book is not the book (Sections 8.2, 39.5). The
 * validator distinguishes all four source classes the directive names:
 * bibliographic-only, primary teaching, complete-book extraction, and
 * BlackCEO adaptation (a concept mark, never foundation evidence), and
 * it reports coverage honestly: a pack whose foundation is not
 * substantiated is labeled, not silently passed and not fabricated.
 */
import { type SeatId } from '../contracts/enums.js';
/** Type guard the contracts package does not export; defined locally. */
export declare function isSeatId(value: string): value is SeatId;
import { type PackQualification, type WorkCoverage } from './coverage.js';
import { type Diagnostic, type EvidenceUnit, type SourceRecord } from './schemas.js';
/** Pack-level claim surface the validator audits (parsed JSON files). */
export interface PackInput {
    /** Seat folder name the pack was loaded from. */
    folder: string;
    profile: Record<string, unknown>;
    sources: Record<string, unknown>;
    coverage: Record<string, unknown>;
    frameworks?: Record<string, unknown>;
    decisionRules?: Record<string, unknown>;
    failurePatterns?: Record<string, unknown>;
    questions?: Record<string, unknown>;
    evals?: Record<string, unknown>;
    /** Free text of briefing.md and communication.md, when present. */
    markdownTexts?: readonly string[];
}
export interface PackValidationOptions {
    /**
     * Audit context: a pack compiled for a shared pack may not draw on
     * tenant or user_private sources at all (T012 leakage boundary).
     */
    contextScope?: 'shared_pack' | 'tenant' | 'user_private';
    /** Source IDs withdrawn under Section 8.6. */
    revokedSourceIds?: ReadonlySet<string>;
    /** Fail the pack when its foundation is below the substantive gate. */
    expectProductionReady?: boolean;
}
export interface PackValidation {
    valid: boolean;
    seat_id: SeatId | null;
    pack_version: string | null;
    qualification: PackQualification | null;
    works: WorkCoverage[];
    records: SourceRecord[];
    evidence: EvidenceUnit[];
    diagnostics: Diagnostic[];
}
/** T001: the registry holds exactly the nine approved seat IDs. */
export declare function validateSeatRegistry(seatIds: readonly string[]): Diagnostic[];
/**
 * Validate one advisor pack. Structural failures, coverage dishonesty,
 * revoked or leaking sources, and foundation shortfalls are all named
 * diagnostics; `valid` is true exactly when no error diagnostic exists.
 */
export declare function validateAdvisorPack(pack: PackInput, options?: PackValidationOptions): PackValidation;
/**
 * Card-level source use (Sections 7.3, 16.6): lenses are recorded per
 * card for the Jakes seat only, from the seat's declared lens set, and
 * no card structure may turn one seat into multiple votes.
 */
export declare function validateCardSourceUse(card: {
    seat_id: string;
    lenses_used?: readonly string[];
    votes?: number;
}): Diagnostic[];
