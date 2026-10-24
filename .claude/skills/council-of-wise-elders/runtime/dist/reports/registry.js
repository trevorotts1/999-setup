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
export const REPORT_FORMATS = [
    'record_json',
    'markdown',
    'print_html',
    'pdf',
];
export const PDF_MISSING_PIECE = 'the approved Playwright/Chromium PDF renderer (directive Section 24.3) is not present in the runtime dependency bill (package dependencies: zod only); rendered PDF production and visual QA are owned by CWE-044';
export const REPORT_FORMAT_REGISTRY = {
    record_json: {
        format: 'record_json',
        status: 'ready',
        media_type: 'application/json',
        file_extension: 'json',
        missing_piece: null,
    },
    markdown: {
        format: 'markdown',
        status: 'ready',
        media_type: 'text/markdown; charset=utf-8',
        file_extension: 'md',
        missing_piece: null,
    },
    print_html: {
        format: 'print_html',
        status: 'ready',
        media_type: 'text/html; charset=utf-8',
        file_extension: 'html',
        missing_piece: null,
    },
    pdf: {
        format: 'pdf',
        status: 'not_ready',
        media_type: 'application/pdf',
        file_extension: 'pdf',
        missing_piece: PDF_MISSING_PIECE,
    },
};
export function isReportFormat(value) {
    return REPORT_FORMATS.includes(value);
}
/** Safe download filename (Section 24.4): built from IDs only, never caller paths. */
export function reportFilename(args) {
    const descriptor = REPORT_FORMAT_REGISTRY[args.format];
    const redactionSuffix = args.redacted ? '-redacted' : '';
    return `council-report-${args.session_id}-r${args.verdict_revision}${redactionSuffix}.${descriptor.file_extension}`;
}
export class InMemoryDeliverableRegistry {
    byId = new Map();
    register(deliverable) {
        this.byId.set(deliverable.deliverable_id, deliverable);
    }
    get(deliverable_id) {
        return this.byId.get(deliverable_id) ?? null;
    }
    delete(deliverable_id) {
        return this.byId.delete(deliverable_id);
    }
    listForSession(session_id) {
        return [...this.byId.values()].filter((d) => d.session_id === session_id);
    }
}
