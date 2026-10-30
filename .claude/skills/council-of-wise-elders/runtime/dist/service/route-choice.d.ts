/**
 * Per-session model route choice (W28, Decision 1).
 *
 * The route is resolved for each session, never once for the service.
 * The client's explicit route_id / model always wins. Otherwise the
 * convening harness picks the default:
 *
 *   claude-nine -> claude-nine-configured, no --model (the launcher's own
 *                  configured default applies)
 *   claude-code -> claude-configured, model 'sonnet'
 *   deepseek    -> deepseek-configured, the newest DeepSeek Flash id read
 *                  from the provider's live GET {baseUrl}/models at run
 *                  time. The configuration's pinned id is never used.
 *
 * Never guess: no route_id and no known harness is a typed refusal, and a
 * failed or Flash-less model list never falls back to the configured id.
 * Several composable routes existing at once is the normal case here.
 *
 * Transport construction lives here too, resolved from snapshot.routeId on
 * every call (moved from service/composition.ts, same behaviour), so each
 * session's pinned snapshot gets the transport for its own route.
 *
 * Secrets: the model-list request carries the credential in the
 * Authorization header only. No error text built here includes it.
 */
import type { spawn } from 'node:child_process';
import type { ModelTransport } from '../cli/host-ports.js';
import { type DiscoveredRoute } from '../cli/route-discovery.js';
import type { ModelPolicy } from '../contracts/index.js';
import type { PinnedRouteSnapshot, RouteTrustedScope } from '../budgets/index.js';
export type ConveningHarness = 'claude-nine' | 'claude-code' | 'deepseek' | 'unknown';
export declare const HARNESS_DEFAULTS: Readonly<Record<'claude-nine' | 'claude-code' | 'deepseek', {
    route_id: string;
    model: 'harness_default' | 'sonnet' | 'latest_deepseek_flash';
}>>;
export interface RouteChoiceRequest {
    route_id?: string | null;
    model?: string | null;
    harness?: ConveningHarness | null;
}
export interface RouteChoiceOptions {
    homeDir?: string;
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
    scope: RouteTrustedScope;
    nowUtc: () => string;
}
export interface ResolvedSessionRoute {
    route: DiscoveredRoute;
    /** requestedModelOrAlias is the wire model, or null for the harness default. */
    snapshot: PinnedRouteSnapshot;
    model_policy: ModelPolicy;
    model_label: string;
    selection_source: 'explicit' | 'client_default';
    harness: ConveningHarness | null;
}
export type RouteChoiceErrorCode = 'ROUTE_CHOICE_REQUIRED' | 'ROUTE_NOT_CONFIGURED' | 'ROUTE_NOT_COMPOSABLE' | 'ROUTE_MODEL_LIST_UNAVAILABLE' | 'ROUTE_LATEST_FLASH_NOT_FOUND' | 'ROUTE_MODEL_NOT_OFFERED';
export declare class RouteChoiceError extends Error {
    readonly code: RouteChoiceErrorCode;
    readonly recovery: string;
    constructor(code: RouteChoiceErrorCode, message: string, recovery: string);
}
/**
 * The newest Flash id in a provider model list: highest parsed version
 * (v4.1 > v4 > v3.2), then the latest date/build suffix. Null when the
 * list holds no Flash id.
 */
export declare function pickLatestFlash(modelIds: readonly string[]): string | null;
export interface RouteOption {
    route_id: string;
    provider_slug: string;
    kind: string;
    composable: boolean;
    failure_code: string | null;
    default_for: ConveningHarness[];
    /**
     * True when the route's only blocker is the choice of model: pass one
     * of `model_candidates` and it is usable. The council never picks it.
     */
    usable_with_model: boolean;
    /** Every configured candidate model id on this route. */
    model_candidates: string[];
}
export declare function listRouteOptions(opts: Omit<RouteChoiceOptions, 'scope' | 'nowUtc'>): RouteOption[];
export declare function resolveSessionRoute(req: RouteChoiceRequest, opts: RouteChoiceOptions): Promise<ResolvedSessionRoute>;
/**
 * Compose the real transport for the route a snapshot pins, at flight
 * time. A harness route runs its own executable and passes --model when
 * the snapshot pins one; a compatible route uses the configured endpoint
 * and resolves the credential value only when a call is made. A route that
 * no longer resolves gives null (an honest pre-dispatch refusal upstream).
 */
export declare function transportForSnapshot(snapshot: PinnedRouteSnapshot, opts: {
    homeDir?: string;
    env?: NodeJS.ProcessEnv;
    spawnImpl?: typeof spawn;
    /**
     * CTR-134: one-shot preparation. The same configured adapter, but it may
     * make exactly one attempt and never retries, so the preparatory request
     * can never spend a second provider request or fall through to a retry.
     */
    singleAttempt?: boolean;
}): ModelTransport | null;
