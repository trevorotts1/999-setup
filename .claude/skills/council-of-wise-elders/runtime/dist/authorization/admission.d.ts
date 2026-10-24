/**
 * Per-operation admission and consumption for run grants (CWE-049,
 * directive Section 25.6).
 *
 * admitOperation is the only path that turns a grant into a reserved
 * provider operation, and recordConsumption is the only path that
 * settles one. Both compose the ONE RunAuthorizationService
 * (run-grants.ts) with CWE-028's ONE DurableBudgetService: admission
 * checks the grant, then reserves the worst-case allowance ONCE under
 * the caller's unique operation key inside CWE-028's reservation
 * transaction (which re-checks the durable grant record's status,
 * expiry, session binding, ceilings, and money ceiling in that same
 * transaction). There is no second ledger and no network call inside
 * either operation.
 *
 * Fence order in admitOperation (any failure refuses, journals the
 * refusal under the session, and throws a typed error):
 *   1. the grant exists in scope, is a granted (not preview-anchor)
 *      record, and is bound to this session;
 *   2. the grant is active and unexpired (a lapsed grant is flipped to
 *      'expired' and journaled on this first observation);
 *   3. a standing parent, when present, still stands;
 *   4. the session's revocation generation has not advanced past the
 *      grant's revocation epoch (session-level revocation fence);
 *   5. the operation kind is inside the grant's allowed kinds and the
 *      grant's purpose admits this operation's purpose;
 *   6. the pinned route snapshot fingerprint equals the grant's pin
 *      (a grant for route X admits nothing on route Y);
 *   7. CWE-028's reservation transaction enforces the session, grant,
 *      and standing-parent ceilings and the money ceiling.
 *
 * Replay law: admitOperation is idempotent per operation key ONLY
 * while every fence still passes. Replaying an earlier admission after
 * revocation or expiry is refused by fence 2 before the existing
 * reservation is ever consulted, and CWE-028's reserve re-checks the
 * grant record inside its own transaction as a second, independent
 * fence. An operation key already reserved under a DIFFERENT grant is
 * refused (RUN_OPERATION_GRANT_MISMATCH): an operation never migrates
 * between grants.
 *
 * Consumption law: recordConsumption settles the reservation with the
 * actual charge, or marks provider completion unknown (the reservation
 * stays counted at its estimate, never zero, never released as free:
 * CWE-028 semantics, reused, not re-derived). Accounting is recorded
 * even when the grant was revoked between admission and consumption:
 * an already-accepted request retains accounting and may produce a
 * valid result unless revocation or cancellation fences it, and the
 * result reports the grant's current status honestly. A revocation
 * racing transport handoff can leave an already-accepted request
 * billable; this module records that uncertainty and never promises
 * an impossible zero charge.
 */
import { DurableBudgetService, type BudgetReservationKind, type DurableBudgetReservation, type DurableBudgetSnapshot, type PinnedRouteSnapshot } from '../budgets/index.js';
import type { AuthorizationEnvelope } from '../persistence/envelope.js';
import { RunAuthorizationService } from './run-grants.js';
export interface AdmitOperationInput {
    grant_id: string;
    session_id: string;
    /** The caller's unique operation key (idempotency identity). */
    operation_id: string;
    kind: BudgetReservationKind;
    /** The operation's purpose; must equal the grant's purpose binding. */
    purpose?: string;
    /** Worst-case charge in minor units; a safe integer >= 0. */
    estimate_minor: number;
    currency?: string | null;
    /** The caller's current operation lease epoch (CWE-028 fence). */
    lease_epoch: number;
    /** The pinned route snapshot this operation charges against. */
    route_snapshot: PinnedRouteSnapshot;
    /** Required for output_repair and transport_retry (per-original ceilings). */
    original_operation_id?: string | null;
}
export interface Admission {
    operation_id: string;
    reservation_id: string;
    grant_id: string;
    session_id: string;
    kind: BudgetReservationKind;
    state: DurableBudgetReservation['state'];
    estimate_minor: number;
    currency: string;
    route_snapshot_fingerprint: string;
    /** The grant revocation epoch this admission was fenced against. */
    revocation_epoch: number;
    /** True when this call returned an already-existing reservation. */
    replayed: boolean;
}
export interface RecordConsumptionInput {
    grant_id: string;
    session_id: string;
    operation_id: string;
    lease_epoch: number;
    outcome: 'settled' | 'unknown';
    /** Required when outcome is 'settled'; a safe integer >= 0. */
    actual_minor?: number;
}
export interface ConsumptionRecord {
    operation_id: string;
    reservation_id: string;
    grant_id: string;
    state: DurableBudgetReservation['state'];
    actual_minor: number | null;
    estimate_minor: number;
    currency: string;
    /** The grant's status AFTER this consumption was recorded. */
    grant_status: string;
    /** Session totals after recording (CWE-028 snapshot, the one ledger). */
    totals: DurableBudgetSnapshot;
}
export declare class RunAdmissionService {
    private readonly grants;
    private readonly budget;
    constructor(grants: RunAuthorizationService, budget: DurableBudgetService);
    admitOperation(envelope: AuthorizationEnvelope, input: AdmitOperationInput): Admission;
    private admitChecked;
    /**
     * Record what an admitted operation actually consumed, through
     * CWE-028's exactly-once finalization. The returned totals are
     * CWE-028's session snapshot for this grant: reconciliation is a
     * direct comparison, because there is only one ledger.
     */
    recordConsumption(envelope: AuthorizationEnvelope, input: RecordConsumptionInput): ConsumptionRecord;
}
