/**
 * Coverage classification and the Section 8.2 substantive gate (CWE-012).
 *
 * Coverage vocabulary is the directive's own: a publisher description
 * alone is bibliographic_only, not production-ready knowledge; substantial
 * primary teaching without full-book access makes a pack
 * primary_teaching_based; a required basis that cannot be substantiated
 * leaves the pack incomplete, and nobody fabricates a replacement.
 *
 * For Simon Sinek's required book and for each of T. D. Jakes' three
 * required books the directive sets the operational gate explicitly: at
 * least three independently traceable concepts supported by actual
 * accessed teaching, and at least one case demonstrating application
 * beyond a book blurb. This module applies the same gate to every
 * required work so no seat is held to a weaker standard.
 */
import { type SeatId } from '../contracts/enums.js';
import { type EvidenceUnit, type SourceRecord } from './schemas.js';
export declare const MIN_TRACEABLE_CONCEPTS = 3;
export declare const MIN_APPLICATION_CASES = 1;
export type RequiredWorkKind = 'book' | 'first_person_teaching' | 'documented_material';
export interface RequiredWork {
    work_key: string;
    title: string;
    kind: RequiredWorkKind;
    /** Jakes lens this work grounds, where the seat has lenses. */
    lens?: string;
}
/**
 * Required foundations per seat, from Section 7.2 to 7.10. Titles are
 * matched against source records by normalized title; a related work or
 * another book by the same author is not a substitute (Section 39.5).
 */
export declare const REQUIRED_FOUNDATIONS: Record<SeatId, readonly RequiredWork[]>;
export type WorkClass = 'complete_book' | 'primary_teaching' | 'partial' | 'bibliographic_only' | 'missing';
export interface WorkCoverage {
    work_key: string;
    title: string;
    work_class: WorkClass;
    matched_source_ids: string[];
    traceable_concepts: number;
    application_cases: number;
    gate_met: boolean;
}
export type PackQualification = 'substantive' | 'primary_teaching_based' | 'partial' | 'bibliographic_only' | 'incomplete';
export declare function computeWorkCoverage(seatId: SeatId, work: RequiredWork, records: readonly SourceRecord[], evidence: readonly EvidenceUnit[], 
/** Titles present only as bibliographic stubs (acknowledged, not ingested). */
stubTitles?: readonly string[]): WorkCoverage;
export declare function computePackQualification(seatId: SeatId, records: readonly SourceRecord[], evidence: readonly EvidenceUnit[], stubTitles?: readonly string[]): {
    qualification: PackQualification;
    works: WorkCoverage[];
};
