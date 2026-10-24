/**
 * Deterministic renderers for the registered report formats
 * (CWE-038, directive Sections 24.1 to 24.3).
 *
 * All renderers consume the one report model and nothing else: no
 * second model rewrite per format, no clock, no randomness, no locale
 * dependence. The same model always renders to the same bytes, which
 * is what makes the formats agree on scores, decisions, conditions,
 * citations, and report revision (test contract T105).
 *
 * The print HTML is the deterministic document the approved
 * Playwright/Chromium renderer (Section 24.3) will print to PDF under
 * CWE-044: local assets only (one embedded style block), no scripts,
 * no network references, every generated string HTML-escaped, body
 * type at 12.5pt, repeating table headers, controlled page breaks,
 * and page numbers from the print stylesheet.
 */
export declare function sha256OfText(text: string): string;
export declare function escapeHtml(value: string): string;
/** Full-precision score, trimmed deterministically for display. */
export declare function formatScore(score: number | null): string;
export declare function formatDisplayScore(display: number | null): string;
export declare function formatCoverage(coverage: number | null): string;
export declare function renderMarkdown(model: Record<string, unknown>): string;
export declare function renderPrintHtml(model: Record<string, unknown>): string;
export interface SiblingArtifact {
    format: string;
    filename: string;
    sha256: string;
    status: 'ready' | 'not_ready';
    missing_piece: string | null;
}
/**
 * The canonical record JSON: the full report model in canonical
 * serialized form, plus the sibling artifact index so the record binds
 * the exact bytes of the Markdown and print HTML produced from the
 * same validated revision, and names the PDF deliverable as not ready
 * with its missing piece instead of omitting it silently.
 */
export declare function renderRecordJson(model: Record<string, unknown>, siblings: SiblingArtifact[]): string;
