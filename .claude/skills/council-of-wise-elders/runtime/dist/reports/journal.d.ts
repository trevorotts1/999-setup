/**
 * Export journaling (CWE-038, brief scope point 4; directive Sections
 * 16.2, 18).
 *
 * Every export writes one journal record per format through the
 * CWE-006 event journal on the stack: who exported (exporter subject
 * and access path), what verdict revision and content hash, what
 * format, and the artifact's own content hash.
 *
 * Vocabulary note: the frozen CWE-003 event vocabulary has no
 * export-specific event type, and the council_events table enforces
 * that vocabulary with a CHECK constraint. An export is therefore
 * journaled as an 'operation_completed' event whose payload carries
 * kind 'report_export' and the full export record. Adding a dedicated
 * event type is a CWE-003 contract amendment for integration to
 * consider; this unit does not modify the frozen contracts.
 */
import { type ScopeFields } from '../contracts/index.js';
import type { CouncilStoreService } from '../persistence/store.js';
import type { ReportFormat } from './registry.js';
export interface ExportJournalRecord {
    /** Journal event ID; also the deliverable ID. Deterministic per request and format. */
    export_id: string;
    request_id: string;
    session_id: string;
    format: ReportFormat;
    verdict_revision: number;
    verdict_content_sha256: string;
    artifact_sha256: string;
    exporter_subject: string;
    /** How CWE-007 granted access: 'owner' or 'company'. */
    via: 'owner' | 'company';
    actor: 'owner' | 'system' | 'worker' | 'chair';
    redacted: boolean;
    redaction_profile_id: string | null;
    created_at: string;
}
export interface ExportJournalPort {
    appendExportRecord(record: ExportJournalRecord): Promise<void>;
    findExportRecord(session_id: string, export_id: string): Promise<ExportJournalRecord | null>;
}
/** The journal event ID for one export of one format under one request. */
export declare function exportEventId(request_id: string, format: ReportFormat): string;
/**
 * The CWE-006 adapter: appends through CouncilStoreService.appendEvent
 * (the composed store's journal port) and reads back through
 * listEvents, which is per-session by construction. The journal row's
 * actor_subject is the composing host's service identity per the
 * CWE-006 port semantics; the export record itself, including the
 * exporter subject, is the event payload.
 */
export declare function createCwe006ExportJournal(store: CouncilStoreService, scope: {
    tenant_id: string;
    company_id: string;
}): ExportJournalPort;
/** In-memory journal for tests and standalone composition. */
export declare class InMemoryExportJournal implements ExportJournalPort {
    private readonly byId;
    appendExportRecord(record: ExportJournalRecord): Promise<void>;
    findExportRecord(session_id: string, export_id: string): Promise<ExportJournalRecord | null>;
    /** Test and diagnostic view of everything journaled, in append order. */
    records(): ExportJournalRecord[];
}
/**
 * Session liveness for the deletion race (test contract T059): a
 * retention or deletion tombstone recorded by CWE-006 must be visible
 * to the export path before rendering and again before the artifact is
 * journaled and registered, so a deleted private artifact can never be
 * exposed by an export that started earlier.
 */
export interface SessionLivenessPort {
    isSessionDeleted(scope: ScopeFields, session_id: string): boolean | Promise<boolean>;
}
export declare function createCwe006SessionLiveness(store: CouncilStoreService): SessionLivenessPort;
