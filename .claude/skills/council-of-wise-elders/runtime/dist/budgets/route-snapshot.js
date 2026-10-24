/**
 * The pinned route snapshot the budget service charges against
 * (CWE-028, directive Sections 13 and 15.6).
 *
 * These types mirror, field for field, the CWE-008 explicit route
 * catalog semantics defined in the Command Center worktree
 * (src/lib/council/providers.ts and explicit-selection.ts, CWE-008
 * commit fb714b7b): the CouncilRouteSelection snapshot, the five route
 * identity levels in ascending strength order, the hidden-identity
 * statement, the RouteChangeRecord, and the RouteResolutionOutcome.
 * The shapes are consumed here, never re-derived: the runtime does not
 * import Command Center code across the repository boundary, so the
 * snapshot arrives as data (host-filled by the selection layer) and is
 * pinned verbatim into the durable event journal with the reservation
 * it pays for.
 *
 * Accounting law that follows from the mirror:
 * - A reservation names exactly one pinned snapshot (route id, route
 *   revision, ordered combination members, reasoning outcome). The
 *   snapshot is stored with the operation_reserved journal event and
 *   never edited afterwards; a reservation cannot migrate routes.
 * - A reasoning preference the route does not support stays recorded
 *   as requested with `applied: null`; the budget service never
 *   renames it and never treats it as active (CWE-008 guarantee 1).
 * - Credential material is presence only (env var name and source);
 *   no credential value exists in this shape, so none can be charged,
 *   logged, or leaked through accounting.
 * - A prose identity claim is never identity evidence: resolution
 *   outcomes carry it only as a `prose_identity_claim_ignored` event.
 */
import { canonicalHash } from '../contracts/index.js';
/** The five route identity levels, weakest to strongest (Section 13.4). */
export const ROUTE_IDENTITY_LEVELS = [
    'configured',
    'transport_probed',
    'reported_identity',
    'resolved_identity_verified',
    'quality_qualified',
];
/**
 * The exact statement shown when a router hides the underlying model
 * identity (Section 13.4; identical to CWE-008's
 * HIDDEN_IDENTITY_STATEMENT).
 */
export const HIDDEN_IDENTITY_STATEMENT = 'Selected route used; underlying model identity not independently exposed.';
/** Canonical fingerprint of a pinned snapshot, for journal audit. */
export function routeSnapshotFingerprint(snapshot) {
    return canonicalHash(snapshot);
}
