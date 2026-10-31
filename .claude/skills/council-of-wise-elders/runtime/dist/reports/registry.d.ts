/**
 * Registered deliverables for council reports (CWE-038, directive
 * Sections 24.1, 24.3, 24.4; binding B15).
 *
 * The format registry is the single list of deliverables an export may
 * produce. Markdown, the canonical record JSON, and print HTML are
 * rendered deterministically by this unit from the validated verdict
 * revision. PDF is a REGISTERED deliverable rendered from the same
 * print HTML by the host renderer capability named in Section 24.3
 * (`pdf-renderer.ts`: headless Chrome/Chromium, the Playwright browser
 * cache, or the CUPS filter — whatever the host already has; no new
 * package dependency). The registry reports PDF ready only when the
 * host renderer is actually present; on a host without one it stays
 * not ready and names the missing piece. A PDF is never faked with
 * renamed bytes and HTML is never served as a PDF.
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
export declare const PDF_MISSING_PIECE = "no headless Chrome/Chromium or CUPS PDF filter (cupsfilter) is installed or discoverable on this host; install one, or set CHROME_PATH to a Chrome/Chromium binary, then retry the export";
export declare const REPORT_FORMAT_REGISTRY: Readonly<Record<ReportFormat, ReportFormatDescriptor>>;
/**
 * The registry as the host sees it: PDF flips to ready only when the
 * host renderer capability is actually present. Every other descriptor
 * is static.
 */
export declare function reportFormatRegistry(args?: {
    pdf_available: boolean;
    pdf_detail?: string;
}): Readonly<Record<ReportFormat, ReportFormatDescriptor>>;
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
    /** Exact bytes in the encoding below; base64 for binary formats (PDF). */
    bytes: string;
    /** How `bytes` is carried: utf8 text (default) or base64 binary. */
    encoding?: 'utf8' | 'base64';
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
