/**
 * The one report data source (CWE-038, directive Section 24.1).
 *
 * Every format (record JSON, Markdown, print HTML, and the future
 * rendered PDF) is produced from this single model, which is built
 * once from the validated verdict revision, the frozen brief, and the
 * final cards. No format re-derives, rewrites, or re-scores anything:
 * scores, coverage, and the label are copied from the validated
 * verdict exactly as recorded; abstentions are read from the final
 * scoring cards exactly as recorded (a null score entry is an
 * abstention for that option); seat qualifications are printed exactly
 * as the caller recorded them and are never upgraded here.
 *
 * Honesty content carried by construction:
 * - the Section 7 label for every seat whose content appears, built by
 *   the canonical advisorProfileLabel from CWE-003;
 * - the four-authorizations separation notice (Section 1.2): a verdict
 *   export is an advisory record, never an action-plan approval and
 *   never an execution authorization;
 * - the provenance appendix lists evidence identifiers, kinds, and
 *   locators only. No evidence body or source text field exists in
 *   this model, so no export path can carry raw source material
 *   (including the private-scope Brunson source text barred by the
 *   CWE-012 condition 3): exports contain advisor perspective content
 *   and verdict data, never source text.
 *
 * Redaction (Section 24.4) is a transform of this model before any
 * rendering, so a redacted report is a separate identified artifact
 * whose body, metadata, appendix, and filename all derive from the
 * redacted model. Identity and hash fields are never rewritten by
 * redaction: a redacted export still binds to the exact verdict
 * revision it came from.
 *
 * CTR-146 adds reader-facing projections to the same model: a plain
 * summary, the question and its context, each advisor's contribution,
 * the recorded rounds (and what actually changed between them), the
 * verdict with its recorded uncertainty, an ordered plan built from the
 * stored action proposals, a reading guide, and the installed skills and
 * departments that match the plan. Every new field is a projection of
 * already-validated data plus static connective wording; nothing is
 * re-scored, re-ranked, inferred, or invented. A capability snapshot is
 * bound to this session's installation and refused when it is not.
 *
 * CTR-155 corrects the reader projection against the saved record: the
 * brief's unknowns are the canonical Information needed list, readiness is
 * never "ready" for any verdict except GO / GO_WITH_CONDITIONS, unresolved
 * hard constraints and blocking ratification states are stated as
 * readiness reasons, and no list is silently cut to eight rows.
 */
import { type AdvisorCard, type CouncilCard, type DecisionBrief, type RatificationCard, type SeatId, type Verdict } from '../contracts/index.js';
import { type InstallationCapabilitySnapshot } from './capability-snapshot.js';
export interface RedactionReplacement {
    /** Literal string to remove wherever it appears in report content. */
    match: string;
    /** Replacement text; defaults to '[redacted]'. */
    replace_with?: string;
}
export interface RedactionProfile {
    profile_id: string;
    replacements: RedactionReplacement[];
}
export interface ReportContext {
    /** Host-supplied display date for the report header (Section 24.2 item 1). */
    report_date: string;
    /** Session mode as recorded by the host; null when not recorded. */
    session_mode: string | null;
    /**
     * True when the exported session is one of the shipped sample
     * sessions (the stored session's sample flag, carried into the export
     * by the host; CWE-048 F-047-1). Sample exports carry the SAMPLE
     * badge on every rendered surface.
     */
    sample?: boolean;
    /**
     * Selected/observed route as the host records it. When the host does
     * not independently expose the underlying model identity, the
     * CWE-028 hidden-identity statement is the honest default.
     */
    route_display: string;
    /**
     * Per-seat source qualification exactly as recorded by the seat-pack
     * registry (for example 'bibliographic_only'). A seat with no entry
     * is reported as not recorded, never upgraded.
     */
    seat_qualifications: Partial<Record<SeatId, string>>;
    /**
     * CTR-146: the trusted installation this report belongs to. A
     * capability snapshot is attached only when this matches the
     * snapshot's own installation; otherwise the snapshot is refused
     * rather than risking another installation's catalog in a client
     * export. Optional so existing callers keep their exact behaviour
     * (the tools section is then reported as not recorded).
     */
    installation_id?: string | null;
    /**
     * CTR-146: the sitting's own mode-selection provenance, when the host
     * recorded it (`selectMode` returns mode, source, reason). Null means
     * the saved record does not state why this sitting size was chosen —
     * the report says exactly that and never invents a chair rationale.
     */
    mode_selection?: {
        mode: string;
        source: 'client' | 'auto';
        reason: string;
    } | null;
    /**
     * CTR-146: plain-language seat descriptors read from the shipped
     * advisor profile (`role`, `owned_question`). Absent entries simply
     * omit the focus line; nothing is guessed.
     */
    seat_descriptors?: Partial<Record<SeatId, {
        lane: string | null;
        owned_question: string | null;
    }>>;
    /**
     * CTR-146: the installation capability snapshot (skills and
     * departments) used for the reader-facing "Your installed tools"
     * section. Validated here; never executed, never a catalog dump.
     */
    capability_snapshot?: InstallationCapabilitySnapshot | null;
}
/** CTR-146: the exact Council image the report cover may use. */
export declare const COUNCIL_COVER_IMAGE_REFERENCE = "assets/seats/cover.png";
/** CTR-146: every printable character is at least this size. */
export declare const REPORT_MIN_FONT_PT = 14;
/**
 * Cover images are embedded in the print document, so the data URI is
 * capped well under the 6.3 MB shipped original. Asset wiring supplies a
 * compressed derivative; the original is not embedded here.
 */
export declare const COVER_IMAGE_DATA_URI_MAX_CHARS = 900000;
/** The reading guide printed in every report. Static, true, no claims. */
export declare const HOW_TO_USE_REPORT: readonly string[];
export declare const DEFAULT_ROUTE_DISPLAY = "Selected route used; underlying model identity not independently exposed.";
export declare const SIMULATION_LABEL = "Simulated advisory perspectives. Every advisor voice in this report is an AI perspective inspired by the published work of the named person. It is not the individual and not an endorsement.";
export declare const AUTHORIZATION_NOTICE = "Authorization boundary: this report records an advisory council verdict only. It is not an action-plan approval and not an execution authorization. Any action proposal listed here requires its own separate approvals before anything is executed; a council verdict is never an execution credential.";
export declare const SAMPLE_NOTICE = "SAMPLE: this report was exported from one of the shipped sample sessions. Its content is sample material shipped with the package, not a verdict on a real decision.";
export declare function seatDisplayName(seatId: SeatId): string;
export declare function seatLabel(seatId: SeatId): string;
/**
 * The cards whose scores the verdict was computed from, using the same
 * rule as CWE-026 publication validation: ratification cards when they
 * exist, otherwise the round-2 advisor cards.
 */
export declare function scoringCardsOf(cards: readonly CouncilCard[]): Array<AdvisorCard | RatificationCard>;
/** Per-option abstaining seats, read from the scoring cards as recorded. */
export declare function abstentionsByOption(cards: readonly CouncilCard[]): Map<string, SeatId[]>;
export interface ReportModelInput {
    verdict: Verdict;
    brief: DecisionBrief;
    final_cards: readonly CouncilCard[];
    context: ReportContext;
    redaction: RedactionProfile | null;
}
/**
 * The deterministic report revision identity: the same validated
 * verdict revision under the same redaction profile always yields the
 * same report revision, and a redacted report is a distinct revision
 * from the unredacted one.
 */
export declare function reportRevisionId(args: {
    session_id: string;
    verdict_content_sha256: string;
    redaction_profile_id: string | null;
}): string;
/**
 * CTR-146: the optional cover image is a transport concern, not report
 * content. Asset wiring produces a compressed derivative; the service
 * validates it here and hands it to the print renderer, so the record
 * JSON never carries image bytes.
 */
export declare function assertCoverImageDataUri(value: string | null | undefined): string | null;
export interface ReaderProjectionInput {
    verdict: Verdict;
    brief: DecisionBrief;
    final_cards: readonly CouncilCard[];
    /**
     * Only a live export has installation context. A session read passes
     * nothing: the tools section then reports "not recorded" rather than
     * borrowing a catalog from another installation.
     */
    context?: ReportContext | null;
}
/**
 * CTR-156: ONE reader projection, built from the corrected model, consumed by
 * both the report renderer and the chamber. Every field is a projection of
 * already-validated saved data plus static connective wording: nothing is
 * re-scored, re-ranked, inferred, or invented. The same function is called by
 * buildReportModel (export path) and by the session read (chamber path), so
 * the two surfaces cannot tell the reader two different stories.
 */
export declare function buildReaderProjection(input: ReaderProjectionInput): Record<string, unknown>;
export declare function buildReportModel(input: ReportModelInput): Record<string, unknown>;
/**
 * Post-render redaction assertion (Section 24.4): no redaction target
 * may survive anywhere in the final bytes of an artifact, including
 * metadata and filenames. The service checks every artifact (and its
 * filename) and fails the export rather than shipping a leak.
 */
export declare function assertRedactionComplete(artifacts: Array<{
    filename: string;
    bytes: string;
}>, redaction: RedactionProfile): void;
