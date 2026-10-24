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
}
export declare function conveneCandidates(env: NodeJS.ProcessEnv): string[];
export declare function probePublicCandidate(raw: string | undefined, fetchImpl: typeof fetch, timeoutMs?: number): Promise<string | null>;
export declare function runRoutes(args: string[], opts: ConveneOpts): Promise<number>;
export declare function runConvene(args: string[], opts: ConveneOpts): Promise<number>;
