/**
 * Source integrity schemas for the Council of Wise Elders (CWE-012).
 *
 * Implements the Section 8.3 source record contract and the evidence-unit
 * shape the quotation validator and coverage gate consume. These schemas
 * extend the CWE-003 canonical contracts; they do not redefine them. The
 * AdvisorCard quote surface stays the CWE-003 VerifiedQuoteCandidate; this
 * module verifies such candidates against source records and evidence.
 *
 * Boundary rules, mirroring the contracts package:
 * - strict objects: unknown fields are rejected, never silently dropped;
 * - unknown enum values and invalid IDs fail validation;
 * - unknown values are null, never empty strings masquerading as facts;
 * - a filename or a bibliographic entry is not ingestion (Section 8.2):
 *   only a full source record in this shape can ground a claim.
 */
import { z } from 'zod';
/** Claim-level locator (Section 8.3): page, timestamp, or section. */
export declare const sourceLocatorSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        page: "page";
        timestamp: "timestamp";
        section: "section";
    }>;
    value: z.ZodString;
}, z.core.$strict>;
export type SourceLocator = z.infer<typeof sourceLocatorSchema>;
export declare const SOURCE_TYPES: readonly ["book", "article", "talk", "interview", "transcript"];
export type SourceType = (typeof SOURCE_TYPES)[number];
export declare const RIGHTS_STATUSES: readonly ["reference_only", "private_use", "licensed_distribution", "public_domain"];
export type RightsStatus = (typeof RIGHTS_STATUSES)[number];
export declare const SOURCE_SCOPES: readonly ["shared_pack", "tenant", "user_private"];
export type SourceScope = (typeof SOURCE_SCOPES)[number];
export declare const SOURCE_QUALITIES: readonly ["primary_substantive", "secondary", "bibliographic_only", "unverified"];
export type SourceQuality = (typeof SOURCE_QUALITIES)[number];
/**
 * Section 8.3 source record, field for field. One deliberate addition:
 * the optional `version` string. Section 8.3 speaks of a source version
 * ("immutable within source version"; each evidence unit carries "a source
 * version/hash") without naming a version field, so when `version` is
 * absent the record's content_sha256 IS the source version. See
 * sourceVersionOf and format assumption A3 in this package's README.
 */
export declare const sourceRecordSchema: z.ZodObject<{
    source_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    work_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    work_title: z.ZodString;
    credited_authors: z.ZodArray<z.ZodString>;
    original_speaker: z.ZodNullable<z.ZodString>;
    source_type: z.ZodEnum<{
        book: "book";
        article: "article";
        transcript: "transcript";
        talk: "talk";
        interview: "interview";
    }>;
    publisher_or_host: z.ZodNullable<z.ZodString>;
    edition_or_publication_date: z.ZodNullable<z.ZodString>;
    retrieved_at: z.ZodString;
    canonical_url: z.ZodNullable<z.ZodString>;
    private_asset_id: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    content_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    rights_status: z.ZodEnum<{
        reference_only: "reference_only";
        private_use: "private_use";
        licensed_distribution: "licensed_distribution";
        public_domain: "public_domain";
    }>;
    allowed_scope: z.ZodEnum<{
        shared_pack: "shared_pack";
        tenant: "tenant";
        user_private: "user_private";
    }>;
    locators: z.ZodArray<z.ZodObject<{
        kind: z.ZodEnum<{
            page: "page";
            timestamp: "timestamp";
            section: "section";
        }>;
        value: z.ZodString;
    }, z.core.$strict>>;
    quality: z.ZodEnum<{
        unverified: "unverified";
        primary_substantive: "primary_substantive";
        secondary: "secondary";
        bibliographic_only: "bibliographic_only";
    }>;
    version: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export type SourceRecord = z.infer<typeof sourceRecordSchema>;
/** The version a quote tuple or evidence unit must name for this record. */
export declare function sourceVersionOf(record: SourceRecord): string;
/**
 * Concept marks from Section 8.1 step 5. Bibliographic references,
 * extracted text, author statements, third-party commentary, and BlackCEO
 * adaptations are separate evidence types and are never merged.
 */
export declare const CONCEPT_MARKS: readonly ["direct_teaching", "paraphrase", "reported_example", "third_party_commentary", "blackceo_adaptation"];
export type ConceptMark = (typeof CONCEPT_MARKS)[number];
export declare const EVIDENCE_KINDS: readonly ["concept", "application_case", "quotation"];
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
/**
 * One evidence unit (Section 8.3): source version/hash, exact locator,
 * original speaker, a concise paraphrase or permitted excerpt, and the
 * seat/claim IDs it supports. An evidence unit establishes provenance; it
 * does not assert that the teaching is objectively correct.
 */
export declare const evidenceUnitSchema: z.ZodObject<{
    evidence_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    source_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    source_version: z.ZodString;
    locator: z.ZodObject<{
        kind: z.ZodEnum<{
            page: "page";
            timestamp: "timestamp";
            section: "section";
        }>;
        value: z.ZodString;
    }, z.core.$strict>;
    kind: z.ZodEnum<{
        concept: "concept";
        application_case: "application_case";
        quotation: "quotation";
    }>;
    mark: z.ZodEnum<{
        blackceo_adaptation: "blackceo_adaptation";
        direct_teaching: "direct_teaching";
        paraphrase: "paraphrase";
        reported_example: "reported_example";
        third_party_commentary: "third_party_commentary";
    }>;
    original_speaker: z.ZodNullable<z.ZodString>;
    excerpt: z.ZodNullable<z.ZodString>;
    paraphrase: z.ZodNullable<z.ZodString>;
    claim_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    seat_id: z.ZodEnum<{
        "simon-sinek": "simon-sinek";
        "td-jakes": "td-jakes";
        "oprah-winfrey": "oprah-winfrey";
        "tiffany-aliche": "tiffany-aliche";
        "russell-brunson": "russell-brunson";
        "michelle-obama": "michelle-obama";
        "brene-brown": "brene-brown";
        "dennis-kimbro": "dennis-kimbro";
        "les-brown": "les-brown";
    }>;
}, z.core.$strict>;
export type EvidenceUnit = z.infer<typeof evidenceUnitSchema>;
/** A source whose use has been withdrawn (Section 8.6), supplied by audit. */
export declare const revocationSchema: z.ZodObject<{
    source_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    revoked_at: z.ZodString;
    reason: z.ZodString;
}, z.core.$strict>;
export type SourceRevocation = z.infer<typeof revocationSchema>;
/** One validator finding. Errors fail validation; warnings do not. */
export interface Diagnostic {
    code: string;
    severity: 'error' | 'warning';
    message: string;
    /** Dotted path into the validated input, when one applies. */
    path?: string;
}
export declare function errorDiagnostic(code: string, message: string, path?: string): Diagnostic;
export declare function warningDiagnostic(code: string, message: string, path?: string): Diagnostic;
export declare function hasErrors(diagnostics: readonly Diagnostic[]): boolean;
