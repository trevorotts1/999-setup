/**
 * Deterministic renderers for the registered report formats
 * (CWE-038, directive Sections 24.1 to 24.3; CTR-146 reader pass).
 *
 * All renderers consume the one report model and nothing else: no
 * second model rewrite per format, no clock, no randomness, no locale
 * dependence. The same model always renders to the same bytes, which
 * is what makes the formats agree on scores, decisions, conditions,
 * citations, and report revision (test contract T105).
 *
 * CTR-146 changes the READER surface, not the data. CTR-154 corrects this
 * comment to match the order CTR-150 actually renders (the old text still
 * described the CTR-146 order):
 * - the print document (the PDF's source) opens with a plain-language
 *   summary, then the question, the ordered plan, how you will know it
 *   worked, how to use the report, and the installed helpers that fit the
 *   plan; Part 2 then holds the options, each advisor, the debate, the
 *   conditions and amendments, the sources, and the records;
 * - a consult report has no plan, debate, or nine-seat record: it prints
 *   the one recorded seat, its answer, assumptions, limits, and next step,
 *   then how to use it, the installed helpers, the sources, and the
 *   records;
 * - every printable character is at least 14pt, including tables,
 *   footnotes, and the page number. There is no hidden small print and
 *   no shrink-to-fit trick: wide tables are replaced by stacked blocks;
 * - section headings are common-sense language, and technical
 *   identifiers (session id, revisions, hashes) live only in the final
 *   "For your records" block;
 * - the cover band exposes the nine served chamber portraits in the
 *   shared seat order (CTR-150); the empty-table hero is not printed.
 *
 * CTR-150 changes the print LAYOUT, not the saved record:
 * - the cover is the exact nine served chamber portraits in the shared
 *   seat order (3 x 3), composed from `public/chamber/portraits`; the
 *   empty-table `assets/seats/cover.png` is never printed;
 * - the repeating KIE page-frame plate and the 24 mm section divider are
 *   removed from running pages. They were painted from the continuous
 *   body box, so their 297 mm tile drifted against the physical page and
 *   landed on top of live text. Restrained gold rules and cream callouts
 *   carry the brand instead;
 * - the main report is summary -> question -> plan -> review -> how to
 *   use -> installed help, and the long advisor/option/debate record is
 *   Part 2 behind one explicit page break. Nothing is truncated and no
 *   saved value is rewritten; the same sections are only reordered and
 *   de-duplicated by exact text;
 * - long cards may split across pages. `break-inside: avoid` is kept
 *   only on small units (labels, glance tiles, the read map), so a tall
 *   advisor card no longer leaves a half-empty page;
 * - section headings, their one-line reader cue and the first block stay
 *   together; a heading is never printed alone at the foot of a page;
 * - white reading pages, cream callouts, ink text, 20-22 mm side margins,
 *   15pt body and a 14pt floor everywhere, including page numbers.
 *
 * The print document stays offline and deterministic: one embedded
 * style block, no scripts, no network references, every generated string
 * HTML-escaped.
 */
export declare function sha256OfText(text: string): string;
export declare function escapeHtml(value: string): string;
/** Full-precision score, trimmed deterministically for display. */
export declare function formatScore(score: number | null): string;
export declare function formatDisplayScore(display: number | null): string;
export declare function formatCoverage(coverage: number | null): string;
export declare function renderMarkdown(model: Record<string, unknown>): string;
export interface PrintRenderOptions {
    /**
     * Retained for callers built against CTR-146/147. CTR-150/CTR-154
     * ignore all three: the cover is composed from the packaged portraits
     * that match the report kind (nine for a council, one for a consult,
     * none for a redacted export), and the tiled frame/divider were removed
     * because they printed over live text. Keeping the fields avoids a
     * breaking service change; they never reach the report model or the
     * record JSON.
     */
    cover_image_data_uri?: string | null;
    frame_image_data_uri?: string | null;
    divider_image_data_uri?: string | null;
}
export declare function renderPrintHtml(model: Record<string, unknown>, _options?: PrintRenderOptions): string;
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
 * the exact bytes of the Markdown, print HTML, and rendered PDF
 * produced from the same validated revision. When no PDF was rendered
 * the record names the deliverable as not ready with its missing piece
 * instead of omitting it silently.
 */
export declare function renderRecordJson(model: Record<string, unknown>, siblings: SiblingArtifact[]): string;
