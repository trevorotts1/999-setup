/**
 * CTR-147/CTR-150/CTR-154: packaged report display assets.
 *
 * The print document is rendered offline by the host PDF capability, so
 * every image it uses must already be inside the document as a base64
 * data URI. These helpers read packaged display files and return that
 * data URI; the HTML never carries a local file path and no renderer
 * ever fetches a network asset.
 *
 * Resolution mirrors the chamber asset roots in the front door so the
 * same files are found from the TypeScript source, the tsc output and
 * the esbuild single-file bundle. A missing packaged asset returns null:
 * the document then omits the image instead of inventing one or printing
 * a broken image.
 *
 * CTR-150: the report cover uses the nine portraits the chamber already
 * serves, in the shared seat order, rather than the empty-table
 * `assets/seats/cover.png`. Only the fixed seat ids below are readable;
 * a caller can never use this module to read an arbitrary local file.
 * The portrait files stay in `public/chamber/portraits` and are already
 * packaged by `package.json#files`; no duplicate copies are created.
 *
 * The originals live under `assets/report` and `assets/seats` and are
 * never rewritten here. `public/report/ASSET-MANIFEST.json` records the
 * KIE source and derivative hashes.
 */
export declare const REPORT_COVER_ASSET = "cover-report.webp";
export declare const REPORT_FRAME_ASSET = "council-page-frame-a4.webp";
export declare const REPORT_DIVIDER_ASSET = "council-section-divider-wide.webp";
/**
 * One packaged report asset as a data URI, or null when it is absent or
 * not one of the fixed packaged names. The allowlist means a caller
 * cannot turn this helper into an arbitrary local-file read.
 */
export declare function loadReportAssetDataUri(name: string, mime?: string): string | null;
/** The compressed derivative of the exact Council hero (`assets/seats/cover.png`). */
export declare function loadReportCoverDataUri(): string | null;
/** The KIE page-frame plate, as a compressed display derivative. */
export declare function loadReportFrameDataUri(): string | null;
/** The KIE section divider, as a compressed display derivative. */
export declare function loadReportDividerDataUri(): string | null;
export interface ReportSeatPortrait {
    seat_id: string;
    display_name: string;
    /** File name inside `public/chamber/portraits`; never a path. */
    file_name: string;
}
/**
 * The shared nine-seat order, copied from `config/advisors.json` (order
 * 1-9) and `public/chamber/chamber-seats.js` (`SEATS`). The unexecuted
 * CTR-150 regression pins this array against `config/advisors.json`.
 */
export declare const REPORT_SEAT_PORTRAITS: readonly ReportSeatPortrait[];
/**
 * One served chamber portrait as a data URI. Unknown ids return null so
 * the caller cannot turn this into an arbitrary file read.
 *
 * CTR-154: never call this for a redacted export. `service.ts` states
 * that a redacted report embeds no image bytes because a redaction target
 * cannot be proven absent from compressed pixels. The cover renderer
 * skips portraits and static seat names entirely when `model.redacted`
 * is true; this helper stays a pure asset read so the policy lives in one
 * place rather than being re-derived from the model here.
 */
export declare function loadReportPortraitDataUri(seatId: string): string | null;
