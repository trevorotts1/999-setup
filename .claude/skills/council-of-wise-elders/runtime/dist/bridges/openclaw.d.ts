/**
 * OpenClaw host bridge (CWE-010; directive Sections 13, 14, 25).
 *
 * Composes the portable council core under the OpenClaw host: the same
 * CWE-004 host ports, the same shared local store and data profile, and
 * a guarded transport per selected route (host-bridge.ts). The bridge
 * resolves the client's selected route inside the OpenClaw harness only.
 *
 * select_model.py is the OpenClaw host's own model machinery. It is
 * READ-ONLY for this build: the bridge never modifies it and never
 * silently rides it. CWE-001 recon read it in full (1,120 lines) and
 * mapped its silent-replacement points; the binding lock (CWE-002,
 * Part 4) carries that map. Every one of those points, if the host
 * engages it for a council request, produces a resolution attempt that
 * this bridge runs through the explicit-selection guard: under
 * fallback_policy none the substitution is REFUSED and recorded as a
 * substitution_refused event; under client_approved_only it proceeds
 * only with a client approval record and is recorded as a route-change
 * event with a new route revision. There is no path around the guard.
 *
 * Expired host OAuth (T035): this bridge never scrapes cookies or
 * tokens and never fabricates API entitlement from a subscription.
 * When the host reports an expired credential, the supported path is
 * the host's own renewal flow; the bridge surfaces the failure through
 * the normal transport error path and the council refuses to spend.
 */
import type { TransportRequest } from '../cli/host-ports.js';
import { type BridgeHostOptions, type BridgeInstance, type CouncilRouteSelection, type HostResolutionAttempt, type HostResolutionSource } from './host-bridge.js';
export interface OpenClawReplacementPoint {
    id: string;
    hostSurface: string;
    source: HostResolutionSource;
    description: string;
}
export declare const OPENCLAW_REPLACEMENT_POINTS: readonly OpenClawReplacementPoint[];
export declare function replacementPointById(id: string): OpenClawReplacementPoint | null;
export interface OpenClawResolutionReport {
    /** Model the host used or tried to use, when exposed. */
    attemptedModelId: string | null;
    /** Structured transport/provider-reported identity, when exposed. */
    reportedModelId?: string | null;
    /** Identity claimed in model prose. Recorded as ignored, never used. */
    proseClaimedModelId?: string | null;
    /** Client approval for a fallback change, when one exists. */
    approval?: HostResolutionAttempt['approval'];
    /** Replacement point the host engaged, by map id, when it engaged one. */
    viaReplacementPoint?: string | null;
}
export interface OpenClawHostResolver {
    reportResolution(selection: CouncilRouteSelection, request: TransportRequest): OpenClawResolutionReport | Promise<OpenClawResolutionReport>;
}
export declare function openClawAttemptFromReport(report: OpenClawResolutionReport): HostResolutionAttempt;
/**
 * The pinned-route resolver for an installation whose OpenClaw config
 * pins the council route as the executing model: the host reports the
 * selected model unchanged and no replacement point is engaged. This is
 * the only resolver this unit ships; wiring a live host probe belongs
 * to the installation packaging (CWE-039/CWE-040) behind this same port.
 */
export declare class PinnedOpenClawResolver implements OpenClawHostResolver {
    reportResolution(selection: CouncilRouteSelection): OpenClawResolutionReport;
}
export interface OpenClawBridgeOptions extends BridgeHostOptions {
    resolver?: OpenClawHostResolver;
}
export declare function createOpenClawBridge(options?: OpenClawBridgeOptions): BridgeInstance;
