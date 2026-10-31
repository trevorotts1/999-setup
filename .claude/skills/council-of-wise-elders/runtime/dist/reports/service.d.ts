/**
 * The validated report export service (CWE-038, directive Section
 * 24; graph: consumes CWE-007 trusted-authorization-ports and the
 * CWE-026 deterministic-decision-validator).
 *
 * Pipeline, in order, for every export:
 * 1. Request shape: the idempotency request ID and the host-supplied
 *    export timestamp must be well formed.
 * 2. Authorization through the CWE-007 ports: the scope barrier and
 *    session visibility decision run first, exports of a private
 *    session are owner-only (a support read never includes export),
 *    and a machine principal must satisfy its approved binding for the
 *    'export' operation. Nothing renders for an unauthorized caller.
 * 3. Format readiness: a requested format that is registered not ready
 *    (PDF, pending the approved renderer) refuses with a typed error
 *    naming the missing piece.
 * 4. Currency: the verdict must be the session's current validated
 *    revision. An older revision is superseded and refuses; a revision
 *    ahead of the session record is invalid.
 * 5. Liveness: a session under a deletion tombstone refuses before any
 *    rendering, and again after rendering before anything is journaled
 *    or registered, so a deletion racing an active export cannot
 *    expose a deleted private artifact (T059).
 * 6. Validation: CWE-026 validateVerdictForPublication must return
 *    publishable for the exact revision, with final cards required for
 *    scored verdicts. Invalid or incomplete verdicts refuse with a
 *    typed error carrying the failed checks. No partial documents.
 * 7. Render: one model, all formats, byte-deterministic.
 * 8. Journal: one CWE-006 journal record per format (who, revision,
 *    format, hashes). A retry with the same request ID replays: the
 *    recorded artifact hash must match the re-rendered bytes, and no
 *    second journal record is written (export retry states, build
 *    step 4).
 * 9. Register: each artifact is registered as a deliverable bound to
 *    the session scope and the exact verdict revision (B15).
 *
 * Reads and deletes of registered deliverables recheck authorization
 * and liveness on every call (Section 24.4).
 */
import { type CouncilCard, type DecisionBrief, type DraftResolution, type ScopeFields, type SeatId, type SessionVisibility, type Verdict } from '../contracts/index.js';
import { type MachineBinding, type TrustedPrincipal } from '../authorization/index.js';
import { type RedactionProfile } from './model.js';
import type { InstallationCapabilitySnapshot } from './capability-snapshot.js';
import { type DeliverableRegistry, type ReportFormat } from './registry.js';
import { type PdfRenderPort } from './pdf-renderer.js';
import { type ExportJournalPort, type SessionLivenessPort } from './journal.js';
export interface ReportExportContextInput {
    /** Host-supplied display date for the report header. */
    report_date: string;
    /** True when the session is a shipped sample session (F-047-1 badge). */
    sample?: boolean;
    session_mode?: string | null;
    route_display?: string;
    seat_qualifications?: Partial<Record<SeatId, string>>;
    /** CTR-146: the trusted installation binding for a capability snapshot. */
    installation_id?: string | null;
    /** CTR-146: recorded sitting-size provenance, when the host has it. */
    mode_selection?: {
        mode: string;
        source: 'client' | 'auto';
        reason: string;
    } | null;
    /** CTR-146: shipped seat descriptors (lane, owned question). */
    seat_descriptors?: Partial<Record<SeatId, {
        lane: string | null;
        owned_question: string | null;
    }>>;
    /** CTR-146: this installation's own skills/departments, validated in the model. */
    capability_snapshot?: InstallationCapabilitySnapshot | null;
    /** CTR-146: compressed cover image derivative; asset wiring owns it. */
    cover_image_data_uri?: string | null;
}
export interface ReportExportRequest {
    /** Idempotency key from the caller; retries reuse it (retry states). */
    request_id: string;
    principal: TrustedPrincipal;
    session_id: string;
    session_scope: ScopeFields;
    session_visibility: SessionVisibility;
    verdict: Verdict;
    brief: DecisionBrief;
    final_cards?: readonly CouncilCard[];
    draft_resolution?: DraftResolution;
    /** The session's current validated verdict revision, from the host's store. */
    current_verdict_revision: number;
    formats: readonly ReportFormat[] | 'all';
    redaction?: RedactionProfile | null;
    context: ReportExportContextInput;
    /** Host clock timestamp recorded in the journal and registry. */
    exported_at: string;
    machine_binding?: MachineBinding | null;
}
export interface ExportedArtifact {
    deliverable_id: string;
    format: ReportFormat;
    filename: string;
    media_type: string;
    sha256: string;
    /** Exact bytes; base64 when `encoding` is base64 (PDF), else UTF-8 text. */
    bytes: string;
    encoding: 'utf8' | 'base64';
    redacted: boolean;
    /** True when this artifact was already journaled under the same request ID. */
    replayed: boolean;
}
export interface ReportExportResult {
    request_id: string;
    report_revision_id: string;
    session_id: string;
    verdict_revision: number;
    verdict_content_sha256: string;
    artifacts: ExportedArtifact[];
    /** Pipeline states reached, in order. */
    states: string[];
}
export interface ReportExportServiceDeps {
    journal: ExportJournalPort;
    registry: DeliverableRegistry;
    liveness?: SessionLivenessPort;
    /**
     * Host PDF renderer capability (directive Section 24.3). Bound only
     * when the host actually has a renderer; the pdf deliverable is
     * ready only when this port is present and its probe passes.
     */
    pdf?: PdfRenderPort;
}
interface SessionTarget {
    scope: ScopeFields;
    visibility: SessionVisibility;
}
/**
 * The export access decision, composed from the CWE-007 ports. The
 * read decision supplies the scope barrier and visibility rule; export
 * then tightens private sessions to the owner alone, because export is
 * a disclosure beyond reading and the brief fixes private exports as
 * owner-only.
 */
export declare function checkExportAccess(principal: TrustedPrincipal, target: SessionTarget): 'owner' | 'company';
export declare class ReportExportService {
    private readonly journal;
    private readonly registry;
    private readonly liveness;
    private readonly pdf;
    constructor(deps: ReportExportServiceDeps);
    exportReport(request: ReportExportRequest): Promise<ReportExportResult>;
    /**
     * Read one registered deliverable (B15). Authorization and session
     * liveness are rechecked on every read (Section 24.4, T059); a
     * missing deliverable and a deleted session never return bytes.
     */
    readDeliverable(args: {
        principal: TrustedPrincipal;
        deliverable_id: string;
        machine_binding?: MachineBinding | null;
    }): Promise<{
        deliverable_id: string;
        format: ReportFormat;
        filename: string;
        media_type: string;
        sha256: string;
        bytes: string;
        encoding: 'utf8' | 'base64';
        verdict_revision: number;
        verdict_content_sha256: string;
    }>;
    /** Delete one registered deliverable (B15). Mutation rules apply. */
    deleteDeliverable(args: {
        principal: TrustedPrincipal;
        deliverable_id: string;
    }): Promise<boolean>;
    /** Render the print document to real PDF bytes through the host. */
    private renderPdf;
    /** Host renderer readiness; a missing port is a missing renderer. */
    private pdfReadiness;
    private resolveFormats;
    private assertSessionAlive;
}
export declare function createReportExportService(deps: ReportExportServiceDeps): ReportExportService;
export {};
