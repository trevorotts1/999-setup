/**
 * CWE-023 route snapshot pinning (directive Sections 10, 13.1, 13.2).
 *
 * The brief revision records the client's selected route snapshot in
 * CWE-008 catalog semantics: a route reference from the client's own
 * configured catalog, with its identity level stated honestly
 * (configured / transport_probed / reported_identity /
 * resolved_identity_verified / quality_qualified). The snapshot is
 * pinned at choice time with the canonical hash of the catalog entry
 * it came from. A later catalog change never moves a pinned snapshot:
 * drift is detected and reported, and changing the route means a new
 * explicit choice before freeze, never a silent replacement.
 *
 * The catalog itself is a port. CWE-008 owns the registry and
 * selection policy (CC providers plus the ONB registry binding lands
 * at integration); hosts supply the client's configured routes here.
 */
import { type ModelPolicy } from '../contracts/index.js';
import { type RouteCatalogEntry, type RouteChoice, type RouteSnapshot } from './types.js';
export type { RouteCatalogEntry, RouteIdentityLevel, RouteSnapshot, } from './types.js';
/** The CWE-008 catalog as intake consumes it (explicit-route-catalog). */
export interface RouteCatalogPort {
    listSelectableRoutes(): readonly RouteCatalogEntry[];
    /** The client's configured default route, or null when none exists. */
    configuredDefault(): RouteCatalogEntry | null;
}
export declare function pinRouteSnapshot(entry: RouteCatalogEntry, selectionSource: RouteSnapshot['selection_source'], pinnedAt: string): RouteSnapshot;
/**
 * Resolve a route choice against the catalog and pin the snapshot.
 * An explicit choice must name a route the catalog actually offers;
 * an inherited choice uses the configured default. Either way the
 * result is displayed before start (Section 13.1) and pinned.
 */
export declare function resolveRouteSnapshot(catalog: RouteCatalogPort, choice: RouteChoice, pinnedAt: string): RouteSnapshot;
/**
 * Drift check for display and verification: has the catalog entry the
 * snapshot was pinned from changed since? The snapshot itself never
 * moves; this only reports that the world did.
 */
export declare function routeSnapshotDrift(snapshot: RouteSnapshot, currentEntry: RouteCatalogEntry | null): {
    readonly drifted: boolean;
    readonly reason: string | null;
};
/** The SessionSpec model policy for the frozen spec, from the snapshot. */
export declare function modelPolicyFromSnapshot(snapshot: RouteSnapshot): ModelPolicy;
