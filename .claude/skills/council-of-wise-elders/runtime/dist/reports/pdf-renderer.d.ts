/**
 * Host PDF renderer capability (CWE-038 PDF deliverable, directive
 * Section 24.3; CTR-136).
 *
 * The print HTML produced by `renderPrintHtml` is the document; this
 * module turns it into real PDF bytes with a renderer the host already
 * has. Nothing new is added to the dependency bill: the same headless
 * Chrome / CUPS filter probe the shipped artifact renderer
 * (`scripts/render-counsel-artifact.mjs`) uses is reused here, extended
 * with the Playwright browser cache paths a box may already carry.
 *
 * Honesty rules carried from CWE-038:
 * - no renderer on the host means the export refuses with
 *   EXPORT_FORMAT_NOT_READY naming the missing piece; bytes are never
 *   faked, and HTML is never renamed `.pdf`;
 * - a renderer that exits non-zero, times out, writes nothing, or
 *   writes something that is not a PDF is EXPORT_RENDER_FAILED;
 * - volatile PDF metadata (`/CreationDate`, `/ModDate`, `/ID`) is
 *   zeroed in place so the same report model renders to the same bytes
 *   and a replay re-checks the same SHA-256. The rewrite is
 *   length-preserving, so the PDF cross-reference table stays valid.
 *
 * Module-load discipline: no process is spawned and no environment is
 * read at import time. `probe()` is pure inspection (file existence),
 * never a browser launch.
 */
export type PdfRenderMethod = 'chrome-headless' | 'cupsfilter';
export interface PdfCapability {
    available: boolean;
    method: PdfRenderMethod | null;
    executable: string | null;
    /** Human detail for the honest not-ready refusal. */
    detail: string;
}
export interface PdfRenderPort {
    probe(): PdfCapability;
    /** Render one print document to PDF bytes; throws a typed error, never returns HTML. */
    render(html: string, options?: {
        timeout_ms?: number;
    }): Promise<Buffer>;
}
export declare const PDF_RENDERER_MISSING_PIECE = "no headless Chrome/Chromium or CUPS PDF filter (cupsfilter) is installed or discoverable on this host; install one, or set CHROME_PATH to a Chrome/Chromium binary, then retry the export";
/**
 * Pure inspection: which PDF renderer this host has, if any. No spawn,
 * no network, never throws.
 */
export declare function probePdfCapability(env?: NodeJS.ProcessEnv): PdfCapability;
/** Real-PDF assertion: magic header, trailer, and a non-trivial size. */
export declare function validatePdfBytes(bytes: Uint8Array): void;
/**
 * Zero the volatile PDF metadata a renderer stamps from the clock so
 * the same report model always produces the same bytes. Length-
 * preserving, so the cross-reference table offsets stay correct.
 */
export declare function pinVolatilePdfMetadata(bytes: Uint8Array): Buffer;
export declare function sha256OfBytes(bytes: Uint8Array): string;
/**
 * The host renderer port. `render` writes the print document to a
 * private temporary directory, runs the probed renderer, validates and
 * pins the bytes, and removes every temporary file before returning.
 */
export declare function createHostPdfRenderer(env?: NodeJS.ProcessEnv): PdfRenderPort;
