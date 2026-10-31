/**
 * `blackceo-council routes` and `blackceo-council convene` (W28).
 *
 * A thin client over the council service HTTP API. Convening is the
 * approval: there is no grant or approval step on this path. The CLI
 * only detects which harness it runs in, forwards the client's model
 * choice verbatim, and reports what the service accepted or refused.
 * It never picks a model itself: the service resolves the route.
 */
import type { CliIo } from './dispatcher.js';
export type Harness = 'claude-nine' | 'claude-code' | 'deepseek' | 'unknown';
export declare const DEFAULT_SERVICE_ORIGIN = "http://127.0.0.1:8787";
/**
 * claude-nine exports CLAUDE_CONFIG_DIR (default ~/.claude-nine) before
 * it launches Claude Code, and Claude Code itself sets CLAUDECODE=1.
 * So the config dir decides claude-nine first. A DeepSeek-direct
 * harness leaves no reliable marker, so it is only ever chosen with
 * --harness (or by the client); anything else is 'unknown'.
 */
export declare function detectHarness(env: NodeJS.ProcessEnv): Harness;
export interface ConveneOpts {
    fetchImpl?: typeof fetch;
    /** Hard cap on the convene-time public-link probe (default 5000 ms). */
    probeTimeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    io: CliIo;
    /**
     * Test seam: the desktop opener. Tests inject a recorder so no browser
     * is ever launched. The default is fire-and-forget and never blocks.
     */
    openUrl?: (url: string) => void;
    /** Test seam: whether a desktop (GUI) session exists. */
    guiPresent?: () => boolean;
}
/**
 * A public origin is one plain https origin: no path, query, fragment,
 * credentials or loopback spelling. Null when the input does not qualify.
 */
export declare function validPublicOrigin(raw: string | undefined | null): string | null;
/**
 * The box's own service record. WISE_ELDERS_SERVICE_JSON is what the
 * supported `blackceo-council` shim exports; the fallback is the same
 * file chamber-visual.sh reads. Null unless the environment actually
 * names a box layout: a bare test environment must never read (or write)
 * the real operator box's record.
 */
export declare function serviceJsonPath(env: NodeJS.ProcessEnv): string | null;
/**
 * The durable chamber origin: the env value the box already carries, then
 * the service's own persisted public_origin (written only after a verified
 * probe). Reads use this WITHOUT any network call, so an existing-session
 * read stays an honest read: no probe, no new request, no question.
 */
export declare function durablePublicOrigin(env: NodeJS.ProcessEnv): string | null;
/** The per-session Roast Room address, identical to chamber-visual.sh's. */
export declare function chamberUrlFor(origin: string, sessionId: string): string;
export declare function conveneCandidates(env: NodeJS.ProcessEnv): string[];
export declare function probePublicCandidate(raw: string | undefined, fetchImpl: typeof fetch, timeoutMs?: number): Promise<string | null>;
export declare function runRoutes(args: string[], opts: ConveneOpts): Promise<number>;
export declare function runConvene(args: string[], opts: ConveneOpts): Promise<number>;
