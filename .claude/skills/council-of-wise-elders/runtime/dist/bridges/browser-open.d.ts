/**
 * Browser-open helper (WER-005).
 *
 * Opening a URL is best effort: a missing browser, a locked session, or a
 * nonzero opener exit must NOT discard the URL the caller needs. Every
 * result carries `url` unchanged, and every failure's recovery text repeats
 * it so the client can open it manually. Nothing here throws.
 */
export interface BrowserOpenResult {
    /** Always the caller's URL, unchanged, including on failure. */
    url: string;
    opened: boolean;
    /** Exact opener command attempted, or null when none could be chosen. */
    command: string | null;
    error: string | null;
    /** Present only on failure; always names the usable URL. */
    recovery: string | null;
}
export interface BrowserOpenSpawnResult {
    status: number | null;
    error?: Error;
}
export type BrowserOpenSpawn = (command: string, args: string[]) => BrowserOpenSpawnResult;
export interface BrowserOpenOptions {
    platform?: NodeJS.Platform;
    /** Injected in tests; never launches a real browser there. */
    spawn?: BrowserOpenSpawn;
}
export declare function browserOpenCommand(url: string, platform?: NodeJS.Platform): {
    command: string;
    args: string[];
};
/**
 * Attempt to open `url`. Returns a result in every case; the URL is never
 * lost, and a failure always includes a manual-open recovery line.
 */
export declare function openCouncilUrl(url: string, options?: BrowserOpenOptions): BrowserOpenResult;
