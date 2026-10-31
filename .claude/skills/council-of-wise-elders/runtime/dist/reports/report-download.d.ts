/**
 * Saved-session PDF download composition (CWE-038 PDF deliverable,
 * CTR-136).
 *
 * One composition serves `GET /council/<id>/report.pdf`:
 *
 *   saved session record  ->  the caller's own access boundary
 *   committed verdict     ->  CWE-026 publication validation
 *   frozen brief + cards  ->  the one report model
 *   print HTML            ->  host PDF renderer  ->  real PDF bytes
 *
 * Rules carried from CWE-038/CWE-050 and the CTR-136 requirement:
 * - the report is built ONLY from the saved record: no provider call,
 *   no model inference, no new spend, no re-scoring;
 * - a session that is not COMPLETED or has no validated verdict is
 *   refused with a typed, human-readable code instead of a document;
 * - every download rechecks authorization and the deletion tombstone
 *   through the composed export service before bytes are returned;
 * - missing historical fields stay exactly as the model renders them
 *   ("not recorded"/"none") — nothing is invented to fill a gap;
 * - no renderer on the host is EXPORT_FORMAT_NOT_READY, never an HTML
 *   or placeholder file served as `application/pdf`.
 *
 * This module never opens a database or resolves identity itself: the
 * caller binds the read functions, the trusted principal, the journal
 * port and the renderer.
 */
import type { TrustedPrincipal } from '../authorization/index.js';
import type { CouncilCard, ScopeFields, SeatId, Verdict } from '../contracts/index.js';
import type { StoredSession } from '../cli/host-ports.js';
import type { AuthorizationEnvelope } from '../persistence/envelope.js';
import type { InstallationCapabilitySnapshot } from './capability-snapshot.js';
import { type ExportJournalPort, type PdfRenderPort } from './index.js';
/** One served PDF download. */
export interface CouncilReportDownload {
    session_id: string;
    bytes: Buffer;
    filename: string;
    media_type: 'application/pdf';
    sha256: string;
    verdict_content_sha256: string;
    verdict_revision: number;
    report_revision_id: string;
}
/** A typed refusal the front door turns into a JSON status response. */
export interface CouncilReportDownloadRefusal {
    ok: false;
    status: number;
    code: string;
    detail: string;
    recovery: string;
}
export type CouncilReportDownloadResult = ({
    ok: true;
} & CouncilReportDownload) | CouncilReportDownloadRefusal;
export interface CouncilReportDownloadPort {
    readPdf(args: {
        session_id: string;
    }): Promise<CouncilReportDownloadResult>;
}
export interface CouncilReportDownloadDeps {
    readSession(sessionId: string): StoredSession | null;
    listCards(sessionId: string): CouncilCard[];
    readVerdict(sessionId: string): Verdict | null;
    isSessionDeleted(scope: ScopeFields, sessionId: string): boolean;
    journal: ExportJournalPort;
    principal: TrustedPrincipal;
    pdf: PdfRenderPort;
    nowUtc(): string;
    /** Override the per-download export request ID (tests, callers). */
    requestIdFor?(sessionId: string, verdictRevision: number): string;
    /**
     * CTR-146: this installation's own skills/departments for the reader
     * section. Supplied by the caller that owns the sitting (see
     * `discoverInstallationCapabilities`), because only that caller knows
     * the snapshot belongs to this session's installation. Omitted or
     * `false` means the report says the inventory was not recorded — it
     * never guesses one from whatever box happens to run the download.
     */
    capabilitySnapshot?: ((args: {
        installationId: string | null;
        capturedAt: string;
    }) => InstallationCapabilitySnapshot | null) | false;
    /** CTR-146: recorded sitting-size provenance, when the host stores it. */
    modeSelection?(sessionId: string): {
        mode: string;
        source: 'client' | 'auto';
        reason: string;
    } | null;
    /** CTR-146: shipped seat descriptors; defaults to the advisor profiles. */
    seatDescriptors?(): Partial<Record<SeatId, {
        lane: string | null;
        owned_question: string | null;
    }>>;
    /** CTR-146: compressed cover image derivative, supplied by asset wiring. */
    coverImageDataUri?(): string | null;
}
/** True when a session record has reached its completed sitting. */
export declare function isCompletedSession(session: StoredSession): boolean;
/**
 * Compose the PDF download port over the saved session record and the
 * unchanged CWE-038 export pipeline.
 */
export declare function composeCouncilReportDownload(deps: CouncilReportDownloadDeps): CouncilReportDownloadPort;
/** One committed event the download journal appends. */
export interface RepositoryEventAppendInput {
    event_id: string;
    type: 'operation_completed';
    payload: Record<string, unknown>;
    created_at: string;
}
/** One committed event row the download journal reads back. */
export interface RepositoryEventRow {
    event_id: string;
    payload: Record<string, unknown>;
    created_at: string;
}
/**
 * ExportJournalPort over the canonical repository journal. The payload
 * convention is the one CWE-038 established (operation_completed with
 * payload kind 'report_export'), so a report download is journaled in
 * the same vocabulary as every other export, with the same hash chain.
 */
export declare function createRepositoryExportJournal(args: {
    envelope: AuthorizationEnvelope;
    appendEvent(envelope: AuthorizationEnvelope, sessionId: string, input: RepositoryEventAppendInput): unknown;
    listEvents(envelope: AuthorizationEnvelope, sessionId: string, afterSequence?: number): readonly RepositoryEventRow[];
}): ExportJournalPort;
