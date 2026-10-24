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
import type { CouncilSettings, RunGrant } from '../contracts/index.js';
import { DurableBudgetService, type BudgetCostKnowledge, type PinnedRouteSnapshot } from '../budgets/index.js';
import type { AuthorizationEnvelope } from '../persistence/envelope.js';
import type { BudgetLedger, BudgetReservation, BudgetSnapshot } from './host-ports.js';
export declare class InProcessBudgetLedger implements BudgetLedger {
    private readonly settings;
    private readonly operations;
    constructor(settings?: CouncilSettings);
    private ceilings;
    private sessionRecords;
    reserve(input: {
        session_id: string;
        operation_key: string;
        kind: BudgetReservation['kind'];
    }): BudgetReservation;
    commit(reservation: BudgetReservation): void;
    release(reservation: BudgetReservation): void;
    markProviderCompletionUnknown(reservation: BudgetReservation): void;
    snapshot(session_id: string): BudgetSnapshot;
}
/**
 * The grant that pays for a session's operations, as resolved by the
 * host's authorization port. `durable` is true only when the durable
 * authorization store holds the grant record (a real CWE-049 grant),
 * which is what makes the durable budget service the authority.
 */
export interface DurableBudgetGrantBinding {
    grant: RunGrant;
    durable: boolean;
}
export interface DurableBudgetLedgerOptions {
    service: DurableBudgetService;
    envelope: AuthorizationEnvelope;
    /** The grant binding captured when the engine admitted the session. */
    grantFor(sessionId: string): DurableBudgetGrantBinding | null;
    /** The pinned route snapshot for the session's selected route. */
    routeSnapshotFor(sessionId: string): PinnedRouteSnapshot;
    /**
     * The session's current DURABLE lease generation, or null when the
     * session has no record in the durable authorization store.
     */
    leaseEpochFor(sessionId: string): number | null;
    /**
     * Worst-case hold per operation in minor units. The standalone CLI
     * does not meter prices, so the default is 0 with `estimated`
     * knowledge: request-count ceilings are the enforced bound.
     */
    estimateMinor?: number;
    /** `estimated` (default) or `unknown`; unknown refuses a zero hold. */
    costKnowledge?: BudgetCostKnowledge;
    currency?: string | null;
    /**
     * Foundation ledger for a session whose grant was injected by a
     * synthetic host and never issued by the durable service. Never used
     * for a durable grant.
     */
    fallback?: BudgetLedger;
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
export declare class DurableBudgetLedger implements BudgetLedger {
    private readonly service;
    private readonly envelope;
    private readonly options;
    private readonly fallbackKeys;
    constructor(options: DurableBudgetLedgerOptions);
    private isDurable;
    private reservationFor;
    reserve(input: {
        session_id: string;
        operation_key: string;
        kind: BudgetReservation['kind'];
    }): BudgetReservation;
    commit(reservation: BudgetReservation): void;
    /**
     * Release a reservation for an operation that is KNOWN not to have
     * been dispatched. An unknown-completion reservation is never free.
     */
    release(reservation: BudgetReservation): void;
    /**
     * Provider completion is unknown: keep the reservation counted at its
     * estimate. It is settle-able later and never releasable as free.
     */
    markProviderCompletionUnknown(reservation: BudgetReservation): void;
    snapshot(sessionId: string): BudgetSnapshot;
    private key;
    private usesFallback;
}
