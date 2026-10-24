/**
 * Registered deliverables for council reports (CWE-038, directive
 * Sections 24.1, 24.3, 24.4; binding B15).
 *
 * The format registry is the single list of deliverables an export may
 * produce. Markdown, the canonical record JSON, and print HTML are
 * rendered deterministically by this unit from the validated verdict
 * revision. PDF is a REGISTERED deliverable whose renderer is the
 * approved Playwright/Chromium capability named in Section 24.3; that
 * renderer is not present in this runtime's dependency bill (the
 * package depends on zod only), so the PDF deliverable is registered
 * as not ready and names the missing piece. Rendered-PDF production
 * and visual QA belong to CWE-044. A PDF is never faked with renamed
 * bytes.
 *
 * The deliverable registry records real register, read, delete, and
 * redaction-produced artifacts (B15): every successful export registers
 * its artifacts under a deliverable ID bound to the session scope, the
 * exact verdict revision, and the artifact content hash. Reads recheck
 * authorization and session liveness in the service layer before any
 * bytes are returned (Section 24.4; test contract T059).
 */
import type { ScopeFields } from '../contracts/index.js';
export declare const REPORT_FORMATS: readonly ["record_json", "markdown", "print_html", "pdf"];
export type ReportFormat = (typeof REPORT_FORMATS)[number];
export interface ReportFormatDescriptor {
    format: ReportFormat;
    status: 'ready' | 'not_ready';
    media_type: string;
    file_extension: string;
    /** Set only when status is 'not_ready': the missing piece, named. */
    missing_piece: string | null;
}
export declare const PDF_MISSING_PIECE = "the approved Playwright/Chromium PDF renderer (directive Section 24.3) is not present in the runtime dependency bill (package dependencies: zod only); rendered PDF production and visual QA are owned by CWE-044";
export declare const REPORT_FORMAT_REGISTRY: Readonly<Record<ReportFormat, ReportFormatDescriptor>>;
export declare function isReportFormat(value: string): value is ReportFormat;
/** Safe download filename (Section 24.4): built from IDs only, never caller paths. */
export declare function reportFilename(args: {
    session_id: string;
    verdict_revision: number;
    format: ReportFormat;
    redacted: boolean;
}): string;
/**
 * One registered deliverable artifact. Bytes are the exact rendered
 * bytes; sha256 is the SHA-256 of those bytes; the verdict identity
 * fields bind the artifact to one exact validated revision.
 */
export interface ReportDeliverable {
    deliverable_id: string;
    request_id: string;
    session_id: string;
    scope: ScopeFields;
    visibility: 'private' | 'company';
    format: ReportFormat;
    filename: string;
    media_type: string;
    bytes: string;
    sha256: string;
    verdict_revision: number;
    verdict_content_sha256: string;
    report_revision_id: string;
    redacted: boolean;
    redaction_profile_id: string | null;
    registered_at: string;
}
/**
 * The deliverable registry port. Hosts back this with durable storage
 * at composition (CWE-050); this unit ships the contract plus an
 * in-memory implementation used by the service's own tests.
 */
export interface DeliverableRegistry {
    register(deliverable: ReportDeliverable): void;
    /** Returns the deliverable or null; absence and foreign scope are indistinguishable to callers above the service layer. */
    get(deliverable_id: string): ReportDeliverable | null;
    delete(deliverable_id: string): boolean;
    listForSession(session_id: string): ReportDeliverable[];
}
export declare class InMemoryDeliverableRegistry implements DeliverableRegistry {
    private readonly byId;
    register(deliverable: ReportDeliverable): void;
    get(deliverable_id: string): ReportDeliverable | null;
    delete(deliverable_id: string): boolean;
    listForSession(session_id: string): ReportDeliverable[];
}
