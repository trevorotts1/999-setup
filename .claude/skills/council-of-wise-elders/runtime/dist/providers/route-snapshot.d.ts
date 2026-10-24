/**
 * Frozen normalized route snapshot (WER-006 contract slice).
 *
 * This module publishes the route/model/effort contract that WER-007,
 * WER-008 and WER-009 consume. It does NOT dispatch, probe, authenticate,
 * or capture a transport: the bounded probe dispatch is the rest of
 * WER-006 and stays deferred.
 *
 * Laws:
 * - One snapshot is self-contained. It holds values, never a reference to
 *   a live default profile, so changing a global default cannot reroute an
 *   already-frozen snapshot. There is no re-resolution step to forget.
 * - CONFIGURED identity (`identity.configured`) is what configuration says
 *   will be used. TRANSPORT-REPORTED identity (`identity.transportReported`)
 *   is runtime evidence and is a separate field. When nothing has reported,
 *   it is explicitly `UNKNOWN` with a reason; it is never inferred from the
 *   requested model, the alias, or model prose.
 * - The snapshot hash covers the PIN (configured contract state) only.
 *   Transport-reported identity is excluded on purpose: recording evidence
 *   later must not change the pin, and changing the pin must not be
 *   disguised as a new observation. "Transport-reported identity" means
 *   BOTH evidence fields: `identity.transportReported` and the per-member
 *   `combinationMembers[].reported`. The PIN carries the permitted member
 *   SET (`selection.combinationMembers` plus each
 *   `combinationMembers[].memberModelId`) — which is configured state —
 *   but not the evidence recorded about those members. `pinBody()`
 *   normalizes every member to `{ memberModelId }`, so evidence attached
 *   later recomputes to the identical hash on ANY route kind.
 * - An unsupported reasoning level or a member outside the approved
 *   combination raises a concrete TransportError. Nothing is downgraded,
 *   renamed, or silently substituted.
 */
import type { ReasoningParamStyle } from './reasoning.js';
import { type CouncilRouteSelection, type RouteCapabilitySnapshot, type RouteKind } from './selection.js';
/** Explicit schema identifier for this contract. */
export declare const ROUTE_SNAPSHOT_SCHEMA = "wise-elders.route-snapshot/v1";
export declare const ROUTE_API_FAMILIES: readonly ["openai_compatible", "anthropic_messages", "ollama_chat", "other"];
export type RouteApiFamily = (typeof ROUTE_API_FAMILIES)[number];
/** The literal used wherever identity is not established. */
export declare const UNKNOWN_ROUTE_IDENTITY: "UNKNOWN";
export type TransportIdentityUnknownReason = 'probe_deferred' | 'not_probed' | 'provider_hid_identity';
/**
 * Transport evidence about one model. An unreported member is UNKNOWN
 * with a reason; it is never filled with the requested model.
 */
export type TransportReportedRouteIdentity = {
    state: 'unknown';
    modelId: typeof UNKNOWN_ROUTE_IDENTITY;
    reason: TransportIdentityUnknownReason;
} | {
    state: 'reported';
    modelId: string;
    providerRequestId: string | null;
};
/** What configuration says the route will use. Never transport evidence. */
export interface ConfiguredRouteIdentity {
    providerSlug: string;
    /** Configured model id for a fixed route; null for a combination alias. */
    modelId: string | null;
    /** Combination alias, or the fixed route's requested model string. */
    alias: string | null;
    accountRef: string | null;
    configProfile: string;
}
export interface RouteCombinationMemberIdentity {
    memberModelId: string;
    reported: TransportReportedRouteIdentity;
}
export interface RouteSnapshotIdentity {
    configured: ConfiguredRouteIdentity;
    transportReported: TransportReportedRouteIdentity;
    /** One entry per PERMITTED member for a combination route; null otherwise. */
    combinationMembers: RouteCombinationMemberIdentity[] | null;
}
/** Host and configuration selection for this snapshot. */
export interface RouteHostSelection {
    baseUrl: string;
    /** Named config profile that produced this snapshot (frozen, not live). */
    configProfile: string;
    apiFamily: RouteApiFamily;
}
/** Rate and concurrency limits relevant to the pinned route. */
export interface RouteSnapshotLimits {
    requestsPerMinute: number | null;
    tokensPerMinute: number | null;
    maxConcurrency: number | null;
}
/**
 * Reasoning, split into the three questions the contract must never
 * conflate: what was requested, what the route SUPPORTS, and what was
 * actually APPLIED.
 */
export interface RouteSnapshotReasoning {
    requested: string | null;
    /** null means support is not established (UNKNOWN), never "none". */
    supported: string[] | null;
    /** null means nothing was applied; never a substituted level. */
    applied: string | null;
    limitation: string | null;
    paramStyle: ReasoningParamStyle;
}
export interface RouteSnapshotDraft {
    selection: CouncilRouteSelection;
    sessionId: string;
    /** Session owner identity that requested this route. */
    sessionOwner: string;
    host: RouteHostSelection;
    reasoning: RouteSnapshotReasoning;
    capabilityVersion: string;
    policySha256: string;
    limits: RouteSnapshotLimits;
    /** Optional initial transport evidence. Absent means UNKNOWN/deferred. */
    transportReported?: TransportReportedRouteIdentity;
    /** Caller-supplied so the snapshot hash is deterministic. */
    createdAt: string;
}
export interface CouncilRouteSnapshot {
    schema: typeof ROUTE_SNAPSHOT_SCHEMA;
    sessionId: string;
    sessionOwner: string;
    /** The pinned route selection (route id, account, alias, fallback...). */
    selection: CouncilRouteSelection;
    host: RouteHostSelection;
    identity: RouteSnapshotIdentity;
    reasoning: RouteSnapshotReasoning;
    capabilityVersion: string;
    policySha256: string;
    limits: RouteSnapshotLimits;
    createdAt: string;
    /** Canonical hash of the pin body. Stable across serialization. */
    snapshotSha256: string;
}
/** Canonical SHA-256 over the pin body of a snapshot (or snapshot-shaped draft). */
export declare function computeRouteSnapshotSha256(snapshot: Omit<CouncilRouteSnapshot, 'snapshotSha256'>): string;
/** Recompute and compare the published hash. */
export declare function verifyRouteSnapshotHash(snapshot: CouncilRouteSnapshot): boolean;
/**
 * Freeze a draft into an immutable snapshot with its published hash.
 * The input is deep-copied: later mutation of the caller's objects (or of
 * any live default it came from) cannot alter the frozen snapshot.
 */
export declare function freezeRouteSnapshot(draft: RouteSnapshotDraft): CouncilRouteSnapshot;
/**
 * Record transport-reported identity as a NEW snapshot with the SAME hash.
 * The pin is unchanged; only the evidence field moves. A report that
 * contradicts the configured fixed model is refused, and a combination
 * member outside the permitted list is refused by name.
 */
export declare function withTransportReportedIdentity(snapshot: CouncilRouteSnapshot, reported: TransportReportedRouteIdentity): CouncilRouteSnapshot;
/**
 * Refuse a model that is not a permitted member of this snapshot's
 * combination. A combination is never permission to add models.
 */
export declare function requirePermittedCombinationMember(snapshot: CouncilRouteSnapshot, modelId: string): void;
/**
 * The declared support the route carries. `null` means UNKNOWN (not
 * established), not "no support".
 */
export declare function supportedReasoningLevels(snapshot: CouncilRouteSnapshot): string[] | null;
/** Capability snapshot carried by the pinned selection, for consumers. */
export declare function routeSnapshotCapabilities(snapshot: CouncilRouteSnapshot): RouteCapabilitySnapshot;
/** The route kind, re-exported for consumers that branch on it. */
export type RouteSnapshotKind = RouteKind;
