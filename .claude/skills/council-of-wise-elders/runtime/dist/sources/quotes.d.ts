/**
 * Quotation verification (Section 8.4) and the CWE-012 acceptance tests
 * T004, T011, and the quotation half of T012.
 *
 * The validator verifies the tuple (quoted_text, original_speaker,
 * source_id, source_version, locator) against the ORIGINAL source
 * record, never against a concatenation of all advisor files. A match in
 * a different advisor's corpus does not pass; it is reported as its own
 * diagnostic so the failure is attributable. A quote that appears only
 * in earlier generated rounds is rejected: repetition is not external
 * verification.
 *
 * A string match alone cannot prove entailment of an argument, and this
 * module never claims it does. Paraphrase relevance remains an
 * independent semantic review (Section 8.4), outside this deterministic
 * check.
 */
import type { SeatId } from '../contracts/enums';
import type { VerifiedQuoteCandidate } from '../contracts/schemas';
import { type Diagnostic, type EvidenceUnit, type SourceRecord } from './schemas';
/** The five-tuple a quotation claim must prove (Section 8.4). */
export interface QuoteTuple {
    quoted_text: string;
    original_speaker: string;
    source_id: string;
    source_version: string;
    locator: string;
}
export interface QuoteCorpus {
    records: readonly SourceRecord[];
    evidence: readonly EvidenceUnit[];
}
export type QuoteAudience = 'shared_pack' | 'tenant' | 'user_private';
export interface QuoteContext {
    /** Where the verified quote would be released. */
    audience: QuoteAudience;
    /** Source IDs withdrawn under Section 8.6. */
    revokedSourceIds?: ReadonlySet<string>;
    /**
     * Other seats' corpora, consulted ONLY to attribute a failure: text
     * found there is named as found in another seat and still rejected.
     */
    otherSeatCorpora?: Partial<Record<SeatId, QuoteCorpus>>;
    /**
     * Text of earlier generated rounds for this session. A quote whose
     * only occurrence is here is rejected (Section 8.4).
     */
    generatedRoundsText?: readonly string[];
}
export interface QuoteVerification {
    status: 'verified' | 'rejected';
    diagnostics: Diagnostic[];
}
/**
 * Verify one quotation tuple against one seat's corpus. Every rejection
 * names the exact boundary that caused it; an expected rejection is only
 * meaningful when the intended boundary is the cause (Section 35.1).
 */
export declare function verifyQuotation(tuple: QuoteTuple, corpus: QuoteCorpus, context: QuoteContext): QuoteVerification;
/**
 * Verify a CWE-003 VerifiedQuoteCandidate from an advisor card. The
 * candidate names an evidence_id; the evidence unit supplies the source,
 * version, and locator the tuple is built from, and the card's seat
 * supplies the speaker the quote is attributed to. The caller resolves
 * the attributed speaker (the seat's display name or the speaker the
 * card asserts) and passes it explicitly.
 */
export declare function verifyQuoteCandidate(candidate: VerifiedQuoteCandidate, attributedSpeaker: string, corpus: QuoteCorpus, context: QuoteContext): QuoteVerification;
