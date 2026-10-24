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
export class ReportExportError extends Error {
    code;
    /** For EXPORT_VERDICT_INVALID: the CWE-026 publication checks that failed. */
    failed_checks;
    /** For EXPORT_FORMAT_NOT_READY: the missing piece, named exactly. */
    missing_piece;
    constructor(code, message, options = {}) {
        super(message);
        this.name = 'ReportExportError';
        this.code = code;
        this.failed_checks = options.failed_checks ?? [];
        this.missing_piece = options.missing_piece ?? null;
    }
}
export function exportRequestInvalid(message) {
    return new ReportExportError('EXPORT_REQUEST_INVALID', message);
}
export function verdictIncomplete(message) {
    return new ReportExportError('EXPORT_VERDICT_INCOMPLETE', message);
}
export function verdictInvalid(message, failedChecks) {
    return new ReportExportError('EXPORT_VERDICT_INVALID', message, {
        failed_checks: failedChecks,
    });
}
export function verdictSuperseded(message) {
    return new ReportExportError('EXPORT_VERDICT_SUPERSEDED', message);
}
export function sessionDeleted(message) {
    return new ReportExportError('EXPORT_SESSION_DELETED', message);
}
