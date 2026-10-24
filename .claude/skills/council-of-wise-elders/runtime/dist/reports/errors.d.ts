/**
 * Typed failures for the validated report export service (CWE-038,
 * directive Section 24).
 *
 * Every refusal is a typed error with a stable code. The service never
 * returns a partial document, never exports a draft as a final, and
 * never fakes a deliverable it cannot produce: a format whose renderer
 * is not present in the runtime dependency bill fails with
 * EXPORT_FORMAT_NOT_READY naming the missing piece, so the absence is
 * an actionable export-readiness issue (Section 24.3), never a silent
 * omission and never renamed bytes.
 */
export type ReportExportErrorCode = 'EXPORT_REQUEST_INVALID' | 'EXPORT_FORMAT_UNKNOWN' | 'EXPORT_FORMAT_NOT_READY' | 'EXPORT_VERDICT_INCOMPLETE' | 'EXPORT_VERDICT_INVALID' | 'EXPORT_VERDICT_SUPERSEDED' | 'EXPORT_SESSION_DELETED' | 'EXPORT_REDACTION_INCOMPLETE' | 'EXPORT_JOURNAL_MISMATCH' | 'EXPORT_DELIVERABLE_NOT_FOUND';
export declare class ReportExportError extends Error {
    readonly code: ReportExportErrorCode;
    /** For EXPORT_VERDICT_INVALID: the CWE-026 publication checks that failed. */
    readonly failed_checks: readonly string[];
    /** For EXPORT_FORMAT_NOT_READY: the missing piece, named exactly. */
    readonly missing_piece: string | null;
    constructor(code: ReportExportErrorCode, message: string, options?: {
        failed_checks?: readonly string[];
        missing_piece?: string;
    });
}
export declare function exportRequestInvalid(message: string): ReportExportError;
export declare function verdictIncomplete(message: string): ReportExportError;
export declare function verdictInvalid(message: string, failedChecks: readonly string[]): ReportExportError;
export declare function verdictSuperseded(message: string): ReportExportError;
export declare function sessionDeleted(message: string): ReportExportError;
