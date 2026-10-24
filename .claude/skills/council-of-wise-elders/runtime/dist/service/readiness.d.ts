/**
 * Layered service readiness (WER-021).
 *
 * Each layer is observed INDEPENDENTLY: one failing probe never rewrites
 * another layer's result, and nothing combines handlers, a model listing,
 * a zero exit code, a scheduler or a queue admission into `usable`.
 *
 * Offline readiness makes ZERO provider calls. Probes receive a guarded
 * dispatch context: calling it while offline is refused, counted, and
 * turns that layer blocked. The evaluator itself never calls the provider
 * dispatch port.
 *
 * Deferred and never claimed here: an installed service, a real browser
 * launch, a live session, host registration, and a completed live run.
 */
import type { RouteDiscoveryInfo } from '../cli/route-discovery.js';
import type { CouncilWorkerHandle } from '../queue/index.js';
import { type ReadinessState, type ServiceBlocker, type ServiceReadiness } from './types.js';
export interface ReadinessObservation {
    state: ReadinessState;
    artifact?: string | null;
    blocker?: ServiceBlocker | null;
    recovery?: string | null;
}
export interface ReadinessProbeContext {
    /** True when this evaluation is offline (the default). */
    offline: boolean;
    /**
     * Guarded provider dispatch. Offline calls are refused and counted;
     * there is no other provider route inside readiness.
     */
    dispatchProvider: () => Promise<unknown>;
}
export type ReadinessProbe = (context: ReadinessProbeContext) => ReadinessObservation | Promise<ReadinessObservation>;
export interface ServiceReadinessDeps {
    nowUtc?: () => string;
    origin?: string | null;
    discovery?: ReadinessProbe;
    executable?: ReadinessProbe;
    store?: ReadinessProbe;
    /** Route configured (host/config/credential presence), no provider call. */
    route?: ReadinessProbe;
    /**
     * Route callable. Invoked ONLY when the evaluation is not offline; it
     * is the sole place a route probe may reach the guarded dispatch.
     */
    routeCallable?: ReadinessProbe;
    packs?: ReadinessProbe;
    worker?: ReadinessProbe;
    ui?: ReadinessProbe;
    /** The provider dispatch port itself, guarded by the evaluator. */
    providerDispatch?: () => unknown | Promise<unknown>;
}
export interface ReadinessOptions {
    /** Default true. Offline readiness makes zero provider calls. */
    offline?: boolean;
}
/** Route readiness derived from the existing route-discovery output. */
export declare function routeObservationFromDiscovery(routes: readonly RouteDiscoveryInfo[] | null | undefined): ReadinessObservation;
/** Worker readiness derived from the existing supervised-worker handle. */
export declare function workerObservationFromHandle(handle: Pick<CouncilWorkerHandle, 'running'> | null | undefined): ReadinessObservation;
/**
 * Evaluate every layer independently. A probe that throws marks only its
 * own layer blocked with the observed error; no layer is retried through
 * another layer's path.
 */
export declare function evaluateServiceReadiness(deps?: ServiceReadinessDeps, options?: ReadinessOptions): Promise<ServiceReadiness>;
