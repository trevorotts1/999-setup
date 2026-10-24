/**
 * Token-to-byte conversion per route (W28 decision 3).
 *
 * The context assembler works in canonical bytes; providers publish
 * limits in tokens. This module converts one into the other from a
 * conservative bytes-per-token ratio so a request never overflows the
 * model's window. There is no approval step: a convene on any route
 * just works.
 *
 * - The shipped config (config/route-budgets.json) holds the numbers
 *   measured so far (DeepSeek Flash). A route without measured numbers
 *   uses the built-in conservative defaults below, so it still convenes.
 * - The window and answer limits come from the shipped entry, else from
 *   the limits the route itself reports, else from a safe fallback.
 * - The measurement script is an optional engineering tool that refines
 *   the numbers; nothing requires running it.
 */
import type { PinnedRouteSnapshot } from './route-snapshot.js';
export declare const ROUTE_BUDGET_SCHEMA = "wise-elders.route-budgets/v1";
export declare const MAX_SAFETY_FACTOR = 0.9;
export interface RouteBudgetEntry {
    route_id: string;
    /** null = any model on this route. */
    model: string | null;
    context_window_tokens: number | null;
    max_output_tokens: number | null;
    measured_min_bytes_per_token: number | null;
    /** In (0, 0.9]. */
    safety_factor: number;
    response_schema_bytes: number;
    measured_at: string | null;
    /** Sample set + count + provider usage field used. */
    measurement_basis: string;
}
export interface RouteBudgetConfig {
    schema: typeof ROUTE_BUDGET_SCHEMA;
    entries: RouteBudgetEntry[];
}
export interface ComputedRouteBudget {
    context_limit_bytes: number;
    response_schema_bytes: number;
    output_reserve_bytes: number;
}
export declare class RouteBudgetConfigError extends Error {
    readonly code = "ROUTE_BUDGET_CONFIG_INVALID";
    constructor(message: string);
}
export declare function routeBudgetConfigPath(skillRoot: string, env?: NodeJS.ProcessEnv): string;
export declare function parseRouteBudgetEntry(raw: unknown, where?: string): RouteBudgetEntry;
/** Throws RouteBudgetConfigError on any malformed content, incl. a missing file. */
export declare function loadRouteBudgetConfig(path: string): RouteBudgetConfig;
/** Built-in conservative defaults for a route with no measured numbers. */
export declare const DEFAULT_BYTES_PER_TOKEN = 1;
export declare const DEFAULT_SAFETY_FACTOR = 0.8;
export declare const DEFAULT_CONTEXT_WINDOW_TOKENS = 128000;
export declare const DEFAULT_MAX_OUTPUT_TOKENS = 16384;
export declare const DEFAULT_RESPONSE_SCHEMA_BYTES = 10159;
/**
 * b = bytes-per-token * safety_factor; the context limit rounds down and
 * the output reserve rounds up, so both errors favour a smaller prompt.
 * Window: entry, else what the route reports, else the fallback. An
 * answer limit that is not smaller than the window becomes a quarter of it.
 */
export declare function computeRouteBudget(entry: RouteBudgetEntry | null, reported?: {
    contextWindowTokens: number | null;
    maxOutputTokens: number | null;
}): ComputedRouteBudget;
/**
 * Exact model entry first, then the model:null entry for the route; null
 * when the shipped config has neither (the defaults then apply).
 */
export declare function findRouteBudgetEntry(config: RouteBudgetConfig | null, routeId: string, model: string | null): RouteBudgetEntry | null;
/**
 * Always returns limits. Re-reads the shipped config on every call
 * (cheap); a missing or malformed file falls back to the defaults.
 */
export declare function routeBudgetResolver(input: {
    configPath: string | null;
}): (snapshot: PinnedRouteSnapshot) => ComputedRouteBudget;
export interface BytesTokensPair {
    bytes: number;
    input_tokens: number | null;
}
export declare const SAMPLE_SET_ID = "wise-elders.route-bytes-samples/v1";
export declare const USAGE_FIELD = "usage.input_tokens";
/** Bytes a request puts on the wire as text: system, blank line, canonical input. */
export declare function requestBytes(system: string, input: unknown): number;
/**
 * The SMALLEST observed bytes-per-token ratio (never the mean): the
 * densest text is the one that overflows a window first. Null when no
 * pair has a usable token count.
 */
export declare function minBytesPerToken(pairs: readonly BytesTokensPair[]): number | null;
/**
 * Deterministic proposed entry from recorded pairs. Keeps the base
 * entry's window, output limit, safety factor and schema bytes; only
 * the measured fields change.
 */
export declare function proposeRouteBudgetEntry(input: {
    base: RouteBudgetEntry | null;
    route_id: string;
    model: string | null;
    pairs: readonly BytesTokensPair[];
    measured_at: string | null;
    usage_field?: string;
}): RouteBudgetEntry;
