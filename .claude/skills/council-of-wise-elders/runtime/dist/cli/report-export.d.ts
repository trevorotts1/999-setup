/**
 * CLI report export composition (CWE-050; B15's portable half):
 * rewires the standalone `export` command to CWE-038's validated
 * ReportExportService. Exports are produced ONLY from a verdict
 * revision that passes CWE-026 publication validation, journaled into
 * the host store's event journal (operation_completed with payload
 * kind 'report_export', the frozen-vocabulary convention CWE-038
 * established), and registered as deliverables bound to the exact
 * verdict revision and content hash. PDF stays registered not ready:
 * the service refuses it with EXPORT_FORMAT_NOT_READY naming the
 * missing Playwright/Chromium renderer (CWE-044); no PDF is faked.
 *
 * The deliverable registry here is process-scoped (the standalone CLI
 * is one export per process); the journal record in the store is the
 * durable deliverable record, and its event ID is the deliverable ID,
 * readable back through findExportRecord. The authenticated durable
 * download path for managed hosts is the Command Center stream's
 * composition (CWE-050 CC), over the same service.
 */
import { ReportExportService, type ExportJournalPort, type ReportFormat } from '../reports/index.js';
import type { CouncilStore, StoredSession } from './host-ports.js';
import type { Verdict } from '../contracts/index.js';
/**
 * ExportJournalPort over the CWE-004 CouncilStore port (satisfied by
 * both the standalone LocalSqliteStore and CWE-006's
 * CouncilStoreService), with the same payload convention as CWE-038's
 * createCwe006ExportJournal.
 */
export declare function createStoreExportJournal(store: CouncilStore, scope: {
    tenant_id: string;
    company_id: string;
}): ExportJournalPort;
/** Compose CWE-038's service over a standalone host store. */
export declare function composeLocalReportExportService(store: CouncilStore, scope: {
    tenant_id: string;
    company_id: string;
}): ReportExportService;
export type CliExportFormat = 'md' | 'json' | 'pdf';
/**
 * Export one session's validated verdict through the composed
 * service. ReportExportError surfaces as a CouncilError mapped onto
 * the CLI's stable vocabulary (the service code stays in the
 * message): EXPORT_FORMAT_NOT_READY becomes COUNCIL_FEATURE_NOT_READY
 * naming CWE-044's missing renderer, so the dispatcher's error
 * envelope stays truthful.
 */
export declare function exportVerdictReport(args: {
    store: CouncilStore;
    session: StoredSession;
    verdict: Verdict;
    format: CliExportFormat;
    requestId: string;
    exportedAt: string;
}): Promise<{
    deliverable_id: string;
    format: ReportFormat;
    filename: string;
    sha256: string;
    bytes: string;
    verdict_content_sha256: string;
}>;
