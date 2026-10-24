/**
 * Claude-Nine host bridge (CWE-010; directive Sections 13, 14, 25).
 *
 * Composes the portable council core under the Claude-Nine host (the
 * 999 / Claude Code harness): the same CWE-004 host ports, the same
 * shared local store and data profile, and a guarded transport per
 * selected route (host-bridge.ts).
 *
 * Harness isolation is structural here. The 999 side resolves routes
 * inside the Claude Code harness through its own native mechanisms (its
 * own skills and vendored modules under parity), never by borrowing the
 * other host's tree at runtime: the same operator commonly has both
 * installs, and a cross-repo dependency is a cross-HARNESS problem. This
 * module therefore imports nothing from the other bridge and nothing
 * from any other host's tree; the isolation test walks the import graph
 * and fails if that ever changes. The only shared code is the
 * harness-neutral bridge machinery in host-bridge.ts, which contains no
 * host-specific resolution logic at all.
 *
 * Config roots (Section 25.2): both Mac Claude config roots
 * (~/.claude and ~/.claude-nine) use the SAME council data profile. The
 * bridge records which root it was composed for, and the data directory
 * still resolves through the one shared profile in paths.ts; no
 * duplicate history is created per skill root.
 *
 * Expired host OAuth (T035): the bridge never scrapes OAuth tokens or
 * cookies and never manufactures unsupported API access from a
 * subscription (Section 13.4 adapter 3). An expired host credential
 * surfaces through the host's supported renewal flow; until it renews,
 * requests fail through the normal transport error path.
 */
import type { TransportRequest } from '../cli/host-ports.js';
import type { LocalHost } from '../cli/local-host.js';
import { type BridgeHostOptions, type BridgeInstance, type CouncilRouteSelection, type HostResolutionAttempt, type RouteCatalogEntry } from './host-bridge.js';
export interface ClaudeNineResolutionReport {
    /** Model the harness used or tried to use, when exposed. */
    attemptedModelId: string | null;
    /** Structured transport/provider-reported identity, when exposed. */
    reportedModelId?: string | null;
    /** Identity claimed in model prose. Recorded as ignored, never used. */
    proseClaimedModelId?: string | null;
    /** Client approval for a fallback change, when one exists. */
    approval?: HostResolutionAttempt['approval'];
    /** True when attemptedModelId is a resolved combination member. */
    viaCombinationMember?: boolean;
}
export interface ClaudeNineNativeResolver {
    reportResolution(selection: CouncilRouteSelection, request: TransportRequest): ClaudeNineResolutionReport | Promise<ClaudeNineResolutionReport>;
}
export declare function claudeNineAttemptFromReport(report: ClaudeNineResolutionReport): HostResolutionAttempt;
/**
 * The pinned-route native resolver: the harness runs the selected route
 * exactly as selected. For a combination, the harness hides the member
 * by default (attemptedModelId null), which the guard accepts with the
 * hidden-identity statement rather than inventing a member. Wiring the
 * live 999-native probe belongs to the bundle packaging (CWE-040)
 * behind this same port.
 */
export declare class PinnedClaudeNineResolver implements ClaudeNineNativeResolver {
    reportResolution(selection: CouncilRouteSelection): ClaudeNineResolutionReport;
}
export type ClaudeNineConfigRoot = '.claude' | '.claude-nine';
export interface ClaudeNineBridgeOptions extends BridgeHostOptions {
    resolver?: ClaudeNineNativeResolver;
    /** Which harness config root this bridge instance serves. */
    configRoot?: ClaudeNineConfigRoot;
}
export interface ClaudeNineBridgeInstance extends BridgeInstance {
    configRoot: ClaudeNineConfigRoot;
}
export declare function createClaudeNineBridge(options?: ClaudeNineBridgeOptions): ClaudeNineBridgeInstance;
/**
 * The Claude-Nine host view handed to the CLI dispatcher (WER-005).
 *
 * `runCli`'s `createHost` port is the CWE-004 `LocalHost` shape. Returning
 * only `{ host, dataDir, store }` silently dropped `routeDiscovery`, so
 * `models` and `doctor` lost every discovered-route diagnostic once the
 * bridge wrapper sat in front of the canonical CLI. This view is the same
 * local host the bridge composed, plus the bridge's own route catalog: no
 * field is re-derived here, so the wrapper reports exactly what the
 * canonical CLI reports for the same input.
 */
export interface ClaudeNineLocalHostView extends LocalHost {
    catalog: RouteCatalogEntry[];
    bridge: ClaudeNineBridgeInstance;
}
export declare function composeClaudeNineLocalHost(options?: ClaudeNineBridgeOptions): ClaudeNineLocalHostView;
export declare const CLAUDE_NINE_WRAPPER_FILE_NAME = "claude-nine-host-wrapper.mjs";
export declare function renderClaudeNineWrapper(): string;
