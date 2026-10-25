/**
 * The shared budget reservation service (CWE-028, directive Sections
 * 13, 15.6, 15.9, and 34 CWE-028).
 *
 * This is THE single shared budget service for the council. It is
 * backed by CWE-006's scoped store: reservations are rows in the
 * canonical council_budget_reservations table (CWE-005 schema),
 * every lifecycle transition is journaled in CWE-006's durable,
 * hash-chained event journal inside the same transaction as the row
 * write, and a projection-outbox intent is enqueued in that same
 * transaction, exactly like CWE-006's accepted-card commit unit.
 *
 * Relationship to the CWE-004 foundation (composition, not
 * duplication): CWE-004's InProcessBudgetLedger (cli/budget.ts) is the
 * local standalone form of these same Section 15.6 semantics behind
 * the BudgetLedger host port: same ceilings, same counting rule
 * (committed, reserved, and unknown all spend; released and expired
 * free the slot), same unknown-completion rule. The local host
 * (cli/local-host.ts) composes that in-process form because a
 * standalone single-user run has no scoped store and no durable grant
 * record. This service is the shared form: the same accounting over
 * the scoped store, plus the parts only the shared form can carry:
 * durability across restart, an authorization envelope on every call,
 * a durable RunGrant record (council_approvals, issued by CWE-049's
 * service) as the money authority, lease-epoch fencing, and the
 * pinned CWE-008 route snapshot on every charge. There is never a
 * second ledger competing with this one inside a composition: a host
 * composes either the local form (standalone) or this service
 * (shared), and CWE-050 performs that final composition.
 *
 * Accounting enforced here, all inside the reservation transaction
 * (compare-and-swap discipline of Section 16.4, so two concurrent
 * admissions cannot spend the same remaining allowance, test T061):
 * - The hard session ceiling on TOTAL provider requests
 *   (CouncilSettings.max_session_provider_requests, schema-capped at
 *   50). Every kind counts toward it: planned generations
 *   (provider_request), output repairs, transport retries, and
 *   semantic verifications share the one ceiling (Sections 15.9 and
 *   35.7, test T150: the planning envelope is 33 planned generations
 *   + 9 repairs + 8 transport retries = 50, and the two
 *   semantic-verification calls fit inside the same 50).
 * - Per-kind ceilings from the same settings object, enforced by this
 *   same service (never a second counter): output repairs
 *   (max_output_repair_requests, default 9), transport retries in
 *   total (max_transport_retries_total, default 8), semantic
 *   verifications (max_semantic_verification_requests, default 2),
 *   retries per original request (max_transport_retries_per_request,
 *   default 1), and repairs per original operation
 *   (max_output_repairs_per_original_operation, default 1).
 * - The grant money ceiling: the sum of outstanding worst-case
 *   reservations (estimates for reserved and unknown rows, actuals
 *   for committed rows) plus the new estimate may not exceed the
 *   grant record's max_cost_minor. Unknown completion keeps its
 *   reservation at the estimate: it is never reported as zero and
 *   never auto-released (tests T062, T063).
 *
 * Fencing (Section 15.8): reserve, settle, release, and
 * markProviderCompletionUnknown all present the caller's operation
 * lease epoch, which must equal the session's current lease epoch as
 * recorded in the journaled state record (the same fence source
 * CWE-006's acceptCard checks). A stale epoch is refused with
 * BUDGET_LEASE_FENCED and finalizes nothing.
 *
 * Route accounting (Section 13): every reservation pins the CWE-008
 * route selection snapshot it charges against (see
 * route-snapshot.ts). The snapshot is written verbatim into the
 * operation_reserved journal payload and never mutated. A route
 * change therefore cannot move a charge: the old reservation is
 * released with the RouteChangeRecord journaled
 * (releaseForRouteChange) and a new reservation is minted against the
 * new pinned snapshot. Resolution outcomes ride the journal in the
 * form CWE-009/CWE-010 established: accepted and approved-substitution
 * outcomes are payload on the operation_reserved event they enable,
 * and a refused outcome is journaled as an operation_completed event
 * with outcome 'route_resolution_refused' via recordRouteResolution.
 * The canonical event vocabulary (CWE-003 EVENT_TYPES) has no
 * route_changed type and none is invented here.
 *
 * Lifecycle: reserved -> committed (settle), reserved -> released,
 * reserved -> unknown (provider completion unknown; still counted,
 * settle-able when the outcome is later confirmed, never releasable
 * as free), reserved -> expired (hold lapsed before finalization, via
 * expireHolds or lazily at settle/release time). Every terminal
 * transition is exactly once: the state guard is re-checked inside
 * the transaction and a second settle or release fails with
 * BUDGET_RESERVATION_FINALIZED.
 */
import { type Clock, type CouncilSettings, type IdSource, type RunCeilings } from '../contracts/index.js';
import type { BudgetSnapshot } from '../cli/host-ports.js';
import type { AuthorizationEnvelope } from '../persistence/envelope.js';
import type { CouncilDatabase } from '../persistence/sqlite.js';
import { type PinnedRouteSnapshot, type RouteChangeRecord, type RouteResolutionOutcome } from './route-snapshot.js';
export type BudgetReservationKind = 'provider_request' | 'output_repair' | 'transport_retry' | 'semantic_verification';
export type BudgetReservationState = 'reserved' | 'committed' | 'released' | 'expired' | 'unknown';
/**
 * How well the money on a reservation is known (WER-010). The union is
 * structurally identical to queue/producer.ts CostKnowledge; it is
 * restated here because budgets is the lower layer and must not import
 * upward from the queue.
 *
 * - `verified`: a metered/confirmed amount.
 * - `estimated`: a bounded quote that may differ from the final charge.
 * - `unknown`: pricing or usage is not known. An unknown reservation
 *   ALWAYS keeps a non-zero conservative hold and is never reported or
 *   settled as zero. A zero-unit unknown charge is refused at reserve
 *   time because that would silently treat unknown money as free.
 */
export type BudgetCostKnowledge = 'estimated' | 'verified' | 'unknown';
/** Default hold lifetime for a reservation that is never finalized. */
export declare const DEFAULT_RESERVATION_HOLD_TTL_MS = 900000;
export interface DurableBudgetReservation {
    reservation_id: string;
    session_id: string;
    operation_id: string;
    grant_id: string;
    kind: BudgetReservationKind;
    state: BudgetReservationState;
    estimate_minor: number;
    actual_minor: number | null;
    currency: string;
    /** estimated | verified | unknown; unknown is never treated as zero. */
    cost_knowledge: BudgetCostKnowledge;
    /** The pinned CWE-008 snapshot this charge belongs to. Never migrates. */
    route_snapshot: PinnedRouteSnapshot;
    route_snapshot_fingerprint: string;
    /** Lease epoch the reservation was minted under. */
    lease_epoch: number;
    hold_expires_at: string;
    created_at: string;
    finalized_at: string | null;
}
export interface ReserveInput {
    session_id: string;
    operation_id: string;
    grant_id: string;
    kind: BudgetReservationKind;
    /** Worst-case charge in minor units; a safe integer >= 0. */
    estimate_minor: number;
    /** Defaults to the grant record's currency; a mismatch is refused. */
    currency?: string | null;
    /**
     * estimated | verified | unknown. Defaults to `estimated`. When
     * `unknown`, estimate_minor is a conservative hold and must be > 0:
     * unknown money is never reserved, reported, or settled as zero.
     */
    cost_knowledge?: BudgetCostKnowledge;
    /** The caller's current operation lease epoch (Section 15.8 fence). */
    lease_epoch: number;
    route_snapshot: PinnedRouteSnapshot;
    /** The resolution outcome that produced this snapshot, when any. */
    route_resolution?: RouteResolutionOutcome | null;
    /**
     * For output_repair and transport_retry reservations: the original
     * operation being repaired or retried. The per-original ceilings
     * (one retry per request, one repair per original) key on it.
     */
    original_operation_id?: string | null;
    /**
     * Grant ceilings from the RunGrant contract (CWE-049 composes
     * these). They may only TIGHTEN the settings ceilings: the
     * effective ceiling is the minimum of the two, field by field, so a
     * caller can never gain allowance by supplying values.
     */
    ceilings?: Partial<RunCeilings> | null;
}
export interface DurableBudgetSnapshot extends BudgetSnapshot {
    money: {
        /** The grant record's money ceiling, or null when unbounded/unknown. */
        authorized_minor: number | null;
        /** Worst-case outstanding: estimates held plus committed actuals. */
        outstanding_minor: number;
        committed_actual_minor: number;
        /** Holds that are not yet finalized (reserved and unknown rows). */
        held_minor: number;
        /** Holds whose completion is unknown; still counted, never zero. */
        unknown_minor: number;
        /** Active reservations minted with cost_knowledge 'unknown'. */
        unknown_cost_reservations: number;
        /** Null only when no reservation and no grant name a currency. */
        currency: string | null;
    };
    /** The Section 15.9 planning-envelope view over the one hard ceiling. */
    envelope_breakdown: {
        hard_ceiling: number;
        total_active: number;
        planned_generations: number;
        output_repairs: number;
        transport_retries: number;
        semantic_verifications: number;
    };
}
/** How far an operation got, as observed by the reconciler. */
export type ReconcileDispatch = 'not_dispatched' | 'dispatched_no_response' | 'response_observed';
export interface ReconcileOperationInput {
    session_id: string;
    operation_id: string;
    lease_epoch: number;
    dispatch: ReconcileDispatch;
    /** Required for response_observed: the confirmed actual charge. */
    actual_minor?: number | null;
    /** Defaults to `verified`; `unknown` is never a settlement. */
    cost_knowledge?: BudgetCostKnowledge;
}
export type ReconcileOutcome = 'nothing_to_reconcile' | 'released_not_dispatched' | 'settled' | 'already_settled' | 'held_unknown' | 'already_released' | 'already_expired';
export interface ReconcileResult {
    outcome: ReconcileOutcome;
    session_id: string;
    operation_id: string;
    reservation: DurableBudgetReservation | null;
    charged_minor: number | null;
    currency: string | null;
    /** True only for a recorded not-dispatched release. */
    released_not_dispatched: boolean;
}
export interface GrantRenewalInput {
    grant_id: string;
    session_id: string;
    /** Current operation lease epoch; a stale generation cannot renew. */
    lease_epoch: number;
    /** Capacity added to the durable ceiling; safe integer > 0. */
    additional_minor: number;
    currency?: string | null;
    /** Optional extension; never shortens the existing expiry. */
    new_expires_at?: string | null;
    /** Operator/authority reference recorded with the renewal. */
    authority_ref?: string | null;
}
export interface GrantRenewalResult {
    grant_id: string;
    currency: string;
    previous_max_cost_minor: number;
    new_max_cost_minor: number;
    expires_at: string;
    /** Historical usage at renewal time; renewal never resets it. */
    committed_actual_minor: number;
    consumed_provider_requests: number;
    active_reservations: number;
}
/** Durable granted ceiling plus its live usage and holds (WER-010). */
export interface DurableGrantLedger {
    grant_id: string;
    status: string;
    expires_at: string;
    max_cost_minor: number | null;
    currency: string | null;
    committed_actual_minor: number;
    held_minor: number;
    unknown_minor: number;
    outstanding_minor: number;
    remaining_minor: number | null;
    consumed_provider_requests: number;
    active_reservations: number;
}
export interface DurableBudgetServiceDeps {
    db: CouncilDatabase;
    clock: Clock;
    ids: IdSource;
    settings?: CouncilSettings;
    /** Reservation hold lifetime; defaults to DEFAULT_RESERVATION_HOLD_TTL_MS. */
    holdTtlMs?: number;
    /** Projection outbox attempt bound (CWE-006 default is 5). */
    outboxMaxAttempts?: number;
}
export declare class DurableBudgetService {
    private readonly db;
    private readonly clock;
    private readonly ids;
    private readonly settings;
    private readonly holdTtlMs;
    private readonly journal;
    private readonly outbox;
    constructor(deps: DurableBudgetServiceDeps);
    /**
     * Typed readiness probe: the store must be reachable and carry the
     * canonical schema tables this service depends on. A failed probe
     * throws BUDGET_STORE_UNAVAILABLE; nothing is ever half-granted on
     * the strength of a probe the caller skipped, because reserve()
     * re-checks the schema inside its own transaction.
     */
    readiness(): {
        ready: true;
        tables_checked: string[];
    };
    /**
     * Reserve one provider request against the session ceilings, the
     * grant money ceiling, and the pinned route snapshot, BEFORE
     * dispatch. Idempotent per operation: re-reserving the same
     * operation while its reservation is reserved, committed, or
     * unknown returns the existing reservation and counts nothing twice;
     * re-reserving after a release or expiry revives the operation's row
     * as a fresh reservation (the journal keeps the full history).
     */
    reserve(envelope: AuthorizationEnvelope, input: ReserveInput): DurableBudgetReservation;
    /**
     * Settle a reservation with the actual charge. Allowed from
     * 'reserved' and from 'unknown' (the provider outcome was later
     * confirmed). Exactly once: settling a committed, released, or
     * expired reservation throws BUDGET_RESERVATION_FINALIZED.
     */
    settle(envelope: AuthorizationEnvelope, input: {
        session_id: string;
        operation_id: string;
        lease_epoch: number;
        actual_minor: number;
        /** verified (default) or estimated; `unknown` is never a settle. */
        cost_knowledge?: BudgetCostKnowledge;
    }): DurableBudgetReservation;
    /**
     * Release a reservation that was never dispatched (or was cancelled
     * before dispatch). Only 'reserved' may be released: a committed,
     * unknown, expired, or already released reservation throws
     * BUDGET_RESERVATION_FINALIZED. An unknown-completion request is
     * never released as though it were free.
     */
    release(envelope: AuthorizationEnvelope, input: {
        session_id: string;
        operation_id: string;
        lease_epoch: number;
        reason?: string | null;
    }): DurableBudgetReservation;
    /**
     * Release a reservation because an approved route change superseded
     * its pinned route. The charge never migrates: this reservation
     * ends here, the RouteChangeRecord is journaled with the release,
     * and the caller reserves anew against the replacement snapshot.
     * Only a 'reserved' (not yet dispatched) reservation may be
     * route-released.
     */
    releaseForRouteChange(envelope: AuthorizationEnvelope, input: {
        session_id: string;
        operation_id: string;
        lease_epoch: number;
        change: RouteChangeRecord;
    }): DurableBudgetReservation;
    /**
     * Mark a dispatched request whose provider completion is unknown.
     * The reservation stays fully counted at its estimate (never zero,
     * never auto-replayed); it can later be settled when the outcome is
     * confirmed, but it can never be released as free.
     */
    markProviderCompletionUnknown(envelope: AuthorizationEnvelope, input: {
        session_id: string;
        operation_id: string;
        lease_epoch: number;
    }): DurableBudgetReservation;
    /**
     * Expire every lapsed hold in the envelope scope (optionally one
     * session): reserved rows whose hold_expires_at has passed become
     * 'expired' and free their allowance. Unknown rows are never
     * expired: a possibly-billed request does not become free with time.
     * CWE-027's scheduler calls this on its sweep cadence; settle and
     * release also expire a lapsed hold lazily, in a small commit unit
     * immediately before their own finalize transaction, so the
     * refusal that follows cannot roll the expiry back.
     */
    expireHolds(envelope: AuthorizationEnvelope, sessionId?: string): Array<{
        session_id: string;
        operation_id: string;
        reservation_id: string;
    }>;
    /**
     * Journal a route resolution outcome that produced no reservation.
     * A refused outcome is recorded as an operation_completed event
     * with outcome 'route_resolution_refused', carrying the full
     * CWE-008 outcome (including its substitution_refused event and any
     * prose-claim-ignored record). Accepted and approved-substitution
     * outcomes are NOT journaled here: they ride the operation_reserved
     * event of the reservation they enable, so one resolution is never
     * double-counted in the audit trail.
     */
    recordRouteResolution(envelope: AuthorizationEnvelope, input: {
        session_id: string;
        route_snapshot: PinnedRouteSnapshot;
        resolution: RouteResolutionOutcome;
    }): {
        recorded: boolean;
        reason: string;
    };
    /** One reservation by operation, or null outside the envelope scope. */
    getReservation(envelope: AuthorizationEnvelope, sessionId: string, operationId: string): DurableBudgetReservation | null;
    /** All reservations of a session in the envelope scope, oldest first. */
    listReservations(envelope: AuthorizationEnvelope, sessionId: string): DurableBudgetReservation[];
    /**
     * The session budget snapshot. Count fields match the CWE-004
     * BudgetLedger port shape exactly (consumed counts committed and
     * unknown; reserved counts outstanding holds), extended with the
     * money view and the Section 15.9 envelope breakdown.
     */
    snapshot(envelope: AuthorizationEnvelope, sessionId: string, grantId?: string): DurableBudgetSnapshot;
    /**
     * The durable granted ceiling with its live usage and held
     * reservations (WER-010). A read-only projection over the grant row
     * (the durable authority) and the reservation rows (the durable
     * usage): nothing here is a process-local counter.
     */
    grantLedger(envelope: AuthorizationEnvelope, grantId: string): DurableGrantLedger;
    /**
     * Renew one session-bound grant: add authorized money capacity (and
     * optionally extend expiry) in ONE short transaction, fenced by the
     * caller's current lease epoch.
     *
     * - Only an active, unexpired, bounded grant renews. An unbounded
     *   grant has nothing to add; a standing (session-less) grant has no
     *   lease to fence against and is refused here.
     * - Capacity is ADDITIVE on the durable row. No reservation row, no
     *   journal event, and no counter is deleted or reset: historical
     *   usage and consumed counts are reported back unchanged.
     * - The update is compare-and-swap on the previous ceiling, so two
     *   concurrent renewals cannot silently overwrite each other.
     */
    renewGrantCeiling(envelope: AuthorizationEnvelope, input: GrantRenewalInput): GrantRenewalResult;
    /**
     * Reconcile one operation after a crash (WER-010). Idempotent: the
     * same observation may be replayed any number of times and charges
     * once.
     *
     * - not_dispatched: a 'reserved' hold is released as free. That is
     *   the ONLY outcome that frees money. A committed or unknown
     *   reservation is never released.
     * - dispatched_no_response: the hold is marked unknown and stays
     *   counted at its estimate (never zero, never free).
     * - response_observed: the confirmed actual settles the reservation
     *   exactly once. Replaying the same amount on an already committed
     *   reservation returns `already_settled` and charges nothing again;
     *   a different amount conflicts.
     * - No row at all (crash before reserve): nothing to reconcile.
     *
     * Every branch presents the caller's lease epoch, and the underlying
     * commit re-checks it inside its own transaction.
     */
    reconcileOperation(envelope: AuthorizationEnvelope, input: ReconcileOperationInput): ReconcileResult;
    private finalize;
    /**
     * Transition one reserved row to expired, with its journal event and
     * outbox intent. Returns false when the row was no longer reserved
     * (a concurrent finalization won; impossible inside one write
     * transaction, but the guard keeps the sweep honest).
     */
    private expireRow;
    private assertReserveInput;
    private assertSchema;
    private assertSessionUsable;
    /** The session's current lease epoch, from its journaled state record. */
    private currentLeaseEpoch;
    private assertEpoch;
    private grantRow;
    private reservationRow;
    private sessionRows;
    /** Every reservation row charged to one grant, newest last. */
    private grantRows;
    /**
     * Charge facts the reservation row does not carry (kind, original
     * operation, pinned route snapshot, minting epoch) are read from the
     * operation_reserved journal events: the journal is the durable
     * record, and the latest reserve event per operation wins (a revived
     * operation's newest facts govern).
     */
    private journalFacts;
    private toRecord;
    /**
     * The tightest count ceilings carried by the run grants funding this
     * session, so a report states the cap that is actually enforced instead
     * of the service-wide maximum. The grant's ceilings live in the
     * council_approvals scope proof, the same durable record the admission
     * path enforces. An unreadable proof is skipped: it can neither widen
     * nor narrow the reported cap.
     */
    private grantedCeilings;
    private effectiveCeilings;
    private effectiveMoneyLimit;
    private notFoundError;
    private finalizedError;
}
