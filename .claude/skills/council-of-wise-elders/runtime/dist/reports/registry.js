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
export const REPORT_FORMATS = [
    'record_json',
    'markdown',
    'print_html',
    'pdf',
];
export const PDF_MISSING_PIECE = 'no headless Chrome/Chromium or CUPS PDF filter (cupsfilter) is installed or discoverable on this host; install one, or set CHROME_PATH to a Chrome/Chromium binary, then retry the export';
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
/**
 * The registry as the host sees it: PDF flips to ready only when the
 * host renderer capability is actually present. Every other descriptor
 * is static.
 */
export function reportFormatRegistry(args = { pdf_available: false }) {
    if (!args.pdf_available) {
        return {
            ...REPORT_FORMAT_REGISTRY,
            pdf: {
                ...REPORT_FORMAT_REGISTRY.pdf,
                status: 'not_ready',
                missing_piece: args.pdf_detail ?? PDF_MISSING_PIECE,
            },
        };
    }
    return {
        ...REPORT_FORMAT_REGISTRY,
        pdf: { ...REPORT_FORMAT_REGISTRY.pdf, status: 'ready', missing_piece: null },
    };
}
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
