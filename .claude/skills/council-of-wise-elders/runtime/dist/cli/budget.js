/**
 * Budget ledger composition (CWE-004 foundation; service owned by
 * CWE-028; durable wiring WER-010).
 *
 * `DurableBudgetLedger` is the CLI host's ledger: every admission
 * reserves through the ONE `DurableBudgetService` (src/budgets), which
 * applies the tightest applicable ceiling (the minimum of the session
 * settings and the run grant's ceilings, field by field) inside the
 * reservation transaction, before any dispatch. Reservations settle,
 * release, and mark provider completion unknown through the same
 * service, so the fencing generation is the session's journaled lease
 * epoch and no process-local counter can win an admission.
 *
 * `InProcessBudgetLedger` remains the foundation form for hosts that
 * inject a SYNTHETIC run grant the durable store never issued (the
 * CWE-004 unit fixtures). It is never composed for a grant the durable
 * authorization service issued: `DurableBudgetLedger` routes to it only
 * when the binding explicitly reports `durable: false`.
 *
 * In-process budget ledger (CWE-004 foundation; service owned by
 * CWE-028). Implements directive Section 15.6 reservation accounting:
 *
 *   available = authorized limit - consumed - outstanding reservations
 *
 * Every actual provider request counts toward the session ceiling of 50,
 * whatever its kind: planned generations, output repairs, transport
 * retries, and semantic verifications share the one hard ceiling
 * (Section 15.9). Repairs and retries additionally have their own
 * ceilings. A request whose provider completion is unknown keeps its
 * reservation; it is never released as though it were free, and unknown
 * usage is never reported as zero.
 */
import { DEFAULT_COUNCIL_SETTINGS } from '../contracts/index.js';
import { BudgetCapacityError, isBudgetCapacityError, } from '../budgets/index.js';
import { CouncilError } from './errors.js';
export class InProcessBudgetLedger {
    settings;
    operations = new Map();
    constructor(settings = DEFAULT_COUNCIL_SETTINGS) {
        this.settings = settings;
    }
    ceilings() {
        return {
            max_provider_requests: this.settings.max_session_provider_requests,
            max_output_repairs: this.settings.max_output_repair_requests,
            max_transport_retries: this.settings.max_transport_retries_total,
            max_semantic_verifications: this.settings.max_semantic_verification_requests,
        };
    }
    sessionRecords(sessionId) {
        return [...this.operations.values()].filter((r) => r.reservation.session_id === sessionId);
    }
    reserve(input) {
        const existing = this.operations.get(input.operation_key);
        if (existing && existing.state !== 'released') {
            return existing.reservation; // idempotent re-reserve of the same operation
        }
        const records = this.sessionRecords(input.session_id);
        const ceilings = this.ceilings();
        const spentOrHeld = records.filter((r) => r.state === 'committed' || r.state === 'reserved' || r.state === 'unknown').length;
        if (spentOrHeld + 1 > ceilings.max_provider_requests) {
            throw new CouncilError('COUNCIL_BUDGET_EXHAUSTED', `Session ${input.session_id} has reached its provider request ceiling of ${ceilings.max_provider_requests}. No further requests can be reserved.`, {
                retryable: false,
                action: 'Review the session usage, or start a separately authorized session with its own envelope.',
                exitCode: 3,
            });
        }
        const kindCount = records.filter((r) => r.reservation.kind === input.kind &&
            (r.state === 'committed' || r.state === 'reserved' || r.state === 'unknown')).length;
        const kindCeiling = input.kind === 'output_repair'
            ? ceilings.max_output_repairs
            : input.kind === 'transport_retry'
                ? ceilings.max_transport_retries
                : input.kind === 'semantic_verification'
                    ? ceilings.max_semantic_verifications
                    : ceilings.max_provider_requests;
        if (kindCount + 1 > kindCeiling) {
            throw new CouncilError('COUNCIL_BUDGET_EXHAUSTED', `Session ${input.session_id} has reached its ${input.kind} ceiling of ${kindCeiling}.`, {
                retryable: false,
                action: 'Continue with the completed work, or record a partial result honestly.',
                exitCode: 3,
            });
        }
        const reservation = {
            operation_key: input.operation_key,
            session_id: input.session_id,
            kind: input.kind,
        };
        this.operations.set(input.operation_key, { reservation, state: 'reserved' });
        return reservation;
    }
    commit(reservation) {
        const record = this.operations.get(reservation.operation_key);
        if (record)
            record.state = 'committed';
    }
    release(reservation) {
        const record = this.operations.get(reservation.operation_key);
        if (record && record.state === 'reserved')
            record.state = 'released';
    }
    markProviderCompletionUnknown(reservation) {
        const record = this.operations.get(reservation.operation_key);
        if (record)
            record.state = 'unknown';
    }
    snapshot(session_id) {
        const records = this.sessionRecords(session_id);
        const count = (kind, states) => records.filter((r) => r.reservation.kind === kind && states.includes(r.state)).length;
        const active = ['committed', 'unknown'];
        return {
            session_id,
            ceilings: this.ceilings(),
            consumed: {
                provider_requests: records.filter((r) => ['committed', 'unknown'].includes(r.state)).length,
                output_repairs: count('output_repair', active),
                transport_retries: count('transport_retry', active),
                semantic_verifications: count('semantic_verification', active),
            },
            reserved: records.filter((r) => r.state === 'reserved').length,
            unknown: records.filter((r) => r.state === 'unknown').length,
        };
    }
}
/**
 * CLI host budget ledger over CWE-028's one durable service.
 *
 * Every reserve() call goes through `DurableBudgetService.reserve`
 * BEFORE the engine dispatches: the service re-checks schema, session,
 * the session's journaled lease epoch, the durable grant row, the
 * tightest ceilings, and the money ceiling inside one transaction. The
 * returned reservation carries the epoch it was minted under, so a
 * later commit/release/mark-unknown from a stale generation is refused
 * with BUDGET_LEASE_FENCED and finalizes nothing.
 *
 * Known not-dispatched operations release; UNKNOWN provider completion
 * never does (the reservation stays counted at its estimate and can be
 * settled when the outcome is confirmed).
 */
export class DurableBudgetLedger {
    service;
    envelope;
    options;
    fallbackKeys = new Set();
    constructor(options) {
        this.options = options;
        this.service = options.service;
        this.envelope = options.envelope;
    }
    isDurable(sessionId) {
        const binding = this.options.grantFor(sessionId);
        return binding !== null && binding.durable;
    }
    reservationFor(sessionId, operationKey) {
        return this.service.getReservation(this.envelope, sessionId, operationKey);
    }
    reserve(input) {
        if (!this.isDurable(input.session_id)) {
            if (this.options.fallback) {
                this.fallbackKeys.add(this.key(input.session_id, input.operation_key));
                return this.options.fallback.reserve(input);
            }
            throw new BudgetCapacityError('BUDGET_GRANT_NOT_FOUND', `Session ${input.session_id} has no durable run grant. No provider request is admitted without the grant record the run authorization service issues.`, {
                retryable: false,
                action: 'Resolve a grant through the authorization service, then reserve.',
                detail: { session_id: input.session_id },
            });
        }
        const binding = this.options.grantFor(input.session_id);
        if (!binding) {
            // Unreachable: isDurable() required a binding. Kept fail-closed.
            throw new BudgetCapacityError('BUDGET_GRANT_NOT_FOUND', `Session ${input.session_id} lost its grant binding before admission.`);
        }
        const leaseEpoch = this.options.leaseEpochFor(input.session_id);
        if (leaseEpoch === null) {
            throw new BudgetCapacityError('BUDGET_STORE_UNAVAILABLE', `Session ${input.session_id} has no durable session record to fence against. The reservation was not recorded.`, {
                retryable: false,
                action: 'Mirror the session into the authorization store, then reserve.',
            });
        }
        const reserveInput = {
            session_id: input.session_id,
            operation_id: input.operation_key,
            grant_id: binding.grant.grant_id,
            kind: input.kind,
            estimate_minor: this.options.estimateMinor ?? 0,
            cost_knowledge: this.options.costKnowledge ?? 'estimated',
            currency: this.options.currency ??
                binding.grant.ceilings.max_money?.currency ??
                // ISO 4217 XXX: "no currency involved". A grant with no money
                // ceiling still enforces the request-count ceilings; naming the
                // absent currency explicitly keeps the service's currency rule
                // satisfiable without inventing a dollar amount.
                'XXX',
            lease_epoch: leaseEpoch,
            route_snapshot: this.options.routeSnapshotFor(input.session_id),
            // The grant is the tighter authority, field by field; the service
            // takes the minimum, so a caller-supplied value can never widen it.
            ceilings: binding.grant.ceilings,
        };
        this.service.reserve(this.envelope, reserveInput);
        return {
            operation_key: input.operation_key,
            session_id: input.session_id,
            kind: input.kind,
        };
    }
    commit(reservation) {
        if (this.usesFallback(reservation)) {
            this.options.fallback.commit(reservation);
            return;
        }
        const current = this.reservationFor(reservation.session_id, reservation.operation_key);
        if (!current) {
            if (this.options.fallback) {
                this.options.fallback.commit(reservation);
                return;
            }
            throw new BudgetCapacityError('BUDGET_RESERVATION_NOT_FOUND', `No durable reservation exists for operation ${reservation.operation_key}. A completed operation can never be charged to an unfunded reservation.`, { retryable: false });
        }
        // Unknown-money reservations are never settled at an invented
        // amount: the honest terminal record keeps the hold.
        if (current.cost_knowledge === 'unknown') {
            this.service.markProviderCompletionUnknown(this.envelope, {
                session_id: reservation.session_id,
                operation_id: reservation.operation_key,
                lease_epoch: current.lease_epoch,
            });
            return;
        }
        this.service.settle(this.envelope, {
            session_id: reservation.session_id,
            operation_id: reservation.operation_key,
            lease_epoch: current.lease_epoch,
            actual_minor: current.estimate_minor,
            cost_knowledge: 'estimated',
        });
    }
    /**
     * Release a reservation for an operation that is KNOWN not to have
     * been dispatched. An unknown-completion reservation is never free.
     */
    release(reservation) {
        if (this.usesFallback(reservation)) {
            this.options.fallback.release(reservation);
            return;
        }
        const current = this.reservationFor(reservation.session_id, reservation.operation_key);
        if (!current) {
            if (this.options.fallback) {
                this.options.fallback.release(reservation);
                return;
            }
            throw new BudgetCapacityError('BUDGET_RESERVATION_NOT_FOUND', `No durable reservation exists for operation ${reservation.operation_key}.`, { retryable: false });
        }
        this.service.release(this.envelope, {
            session_id: reservation.session_id,
            operation_id: reservation.operation_key,
            lease_epoch: current.lease_epoch,
            reason: 'known_not_dispatched',
        });
    }
    /**
     * Provider completion is unknown: keep the reservation counted at its
     * estimate. It is settle-able later and never releasable as free.
     */
    markProviderCompletionUnknown(reservation) {
        if (this.usesFallback(reservation)) {
            this.options.fallback.markProviderCompletionUnknown(reservation);
            return;
        }
        const current = this.reservationFor(reservation.session_id, reservation.operation_key);
        if (!current) {
            if (this.options.fallback) {
                this.options.fallback.markProviderCompletionUnknown(reservation);
                return;
            }
            throw new BudgetCapacityError('BUDGET_RESERVATION_NOT_FOUND', `No durable reservation exists for operation ${reservation.operation_key}.`, { retryable: false });
        }
        this.service.markProviderCompletionUnknown(this.envelope, {
            session_id: reservation.session_id,
            operation_id: reservation.operation_key,
            lease_epoch: current.lease_epoch,
        });
    }
    snapshot(sessionId) {
        if (this.options.leaseEpochFor(sessionId) === null) {
            if (this.options.fallback)
                return this.options.fallback.snapshot(sessionId);
        }
        try {
            return this.service.snapshot(this.envelope, sessionId);
        }
        catch (error) {
            if (this.options.fallback && isBudgetCapacityError(error)) {
                return this.options.fallback.snapshot(sessionId);
            }
            throw error;
        }
    }
    key(sessionId, operationKey) {
        return `${sessionId}\u0000${operationKey}`;
    }
    usesFallback(reservation) {
        return this.fallbackKeys.has(this.key(reservation.session_id, reservation.operation_key));
    }
}
