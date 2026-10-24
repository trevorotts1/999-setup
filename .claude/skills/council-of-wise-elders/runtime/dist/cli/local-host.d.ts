/**
 * Standalone host composition (CWE-004; authorization composed by
 * CWE-050 from CWE-049's service; live route composition repaired by
 * RP-046-1 for DEFECT-046-A).
 *
 * Assembles the real local host for the portable core: SQLite store in
 * the per-user data directory (never inside the skill tree), in-process
 * budget ledger and lease provider, a transport registry, an evidence
 * provider that serves the frozen brief manifest and resolves the
 * installed advisor assets by manifest hashes, a secrets probe that never accepts or returns
 * values, and the run authorization provider composed from CWE-049's
 * standalone service (withRunAuthorization over
 * createStandaloneRunAuthorization): grants approved through the
 * `authorization` CLI commands resolve here, in the SAME provisioned
 * installation namespace the sessions are created under (localScope
 * with a data directory). Unapproved or unknown grant references still
 * resolve to null, so runs refuse with RUN_AUTHORIZATION_REQUIRED
 * rather than spending on a flag or a file.
 *
 * Live routes (RP-046-1): the registry additionally composes a real
 * transport for every route the client's EXISTING configuration
 * describes on this machine, discovered read-only by
 * route-discovery.ts (Section 25.2 step 7: discover the client's
 * existing route configuration, store references not credentials).
 * Harness config roots compose the CWE-010 bridge guard over a real
 * subprocess host-call delegate (Section 13.4 adapter 3);
 * OpenAI-compatible endpoints in the client's OpenClaw provider
 * configuration compose the CWE-009 compatible transport (adapter 1).
 * Nothing is invented: a route that is not configured, or whose
 * configuration cannot be bound unambiguously (no harness executable,
 * no unambiguous configured model, no credential present), is
 * discovered but NOT composed, is reported honestly by `models` and
 * the doctor, and dispatch on it keeps refusing with
 * COUNCIL_ROUTE_UNAVAILABLE. Explicit transports supplied by the
 * caller always win over discovered ones for the same route id. The
 * result is a core that runs fully offline and fails closed with
 * typed errors wherever a production dependency is not yet present.
 */
import type { ScopeFields } from '../contracts/index.js';
import type { CouncilHost, CouncilStore, ModelTransport, TransportRegistry } from './host-ports.js';
import { type RouteDiscoveryInfo } from './route-discovery.js';
export declare class MapTransportRegistry implements TransportRegistry {
    private readonly routes;
    register(routeId: string, transport: ModelTransport): void;
    resolve(routeId: string): ModelTransport | null;
    listRoutes(): string[];
}
export interface LocalHostOptions {
    dataDir?: string;
    skillRoot?: string;
    transports?: Array<{
        routeId: string;
        transport: ModelTransport;
    }>;
    /**
     * RP-046-1: compose real transports for the client's configured
     * routes discovered read-only on this machine. Default true. Set
     * false to compose the bare foundation host (no discovered routes).
     */
    discoverRoutes?: boolean;
    /** Home directory route discovery reads under. Default: the OS home. */
    homeDir?: string;
    /** Environment route discovery and credential presence read. Default: process.env. */
    env?: NodeJS.ProcessEnv;
    /** Verified deadline for harness host calls, when one is configured. */
    hostCallTimeoutMs?: number;
}
export interface LocalHost {
    host: CouncilHost;
    dataDir: string;
    store: CouncilStore;
    /** Secret-free discovery report for this composition (RP-046-1). */
    routeDiscovery?: RouteDiscoveryInfo[];
}
/**
 * The engine's operation keys are scope-qualified:
 * `op:<installation>:<tenant>:<session>:...` (with `:retry:` / `:repair:`
 * suffixes for follow-up operations). The session is the fourth
 * segment, which is the key the durable lease generation is raised on.
 * A key that does not carry a session keeps the foundation lease path
 * rather than guessing.
 */
export declare function sessionIdFromOperationKey(operationKey: string): string | null;
export declare function createLocalHost(options?: LocalHostOptions): LocalHost;
/**
 * Scope for standalone single-user runs (Section 5.4). CWE-050
 * alignment: with a data directory, the scope IS the provisioned
 * standalone installation (resolveStandaloneInstallation +
 * standaloneScope), so sessions, envelopes, and grants share ONE
 * namespace: the authorization profile's UUID installation. The
 * no-argument form keeps the fixed foundation strings for callers
 * that compose no data directory (for example bridge defaults in
 * tests); production CLI paths always pass the data directory.
 */
export declare function localScope(dataDir?: string): ScopeFields;
