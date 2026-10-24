/**
 * Canonical durable operation producer (WER-011 dependency-ready slice).
 *
 * This is NOT a second scheduler and NOT a second state machine. It is
 * the single owning path that turns one admission command into durable
 * state, built entirely on the existing substrate:
 *
 * - `CouncilJobs` (persistence/jobs.ts) owns the council_jobs row, its
 *   deterministic operation identity `canonicalHash({session_id,
 *   attempt, phase_job_key, input_sha256})`, and the job lifecycle
 *   (queued -> leased -> running -> succeeded/failed/cancelled).
 * - `CouncilRepositories.transitionState` owns session state legality
 *   and the compare-and-swap state-version write.
 * - `EventJournal` owns the ordered, hash-chained event.
 * - `ProjectionOutbox` owns the durable event/outbox intent.
 * - `council_request_keys` is the canonical idempotency registry:
 *   `(tenant, source, operation, request_key) -> payload_fingerprint,
 *   response_operation_id`. No new key table is introduced.
 *
 * Transaction law: admission commits the requested session transition,
 * the durable job, the `operation_reserved` event, and the outbox
 * intent in ONE short transaction (`CouncilDatabase.write`). A failure
 * anywhere rolls all of them back. No provider call ever runs here.
 *
 * Operation state labels map onto the existing enums (see
 * OPERATION_STATE_LABEL_MAP and queue/producer.test.ts). The semantic
 * label is stored in the existing job payload; the persisted `state`
 * field is always the canonical `JobState`, and the safe accounting
 * projection is the existing `OperationReceipt` contract, validated
 * with `validateOperationReceipt`.
 *
 * Deferred, explicitly NOT claimed here: real provider dispatch, worker
 * acknowledgment, replay against a live transport, and installed
 * acceptance. Those require WER-014/026/027 and are untouched.
 */
import { type Clock, type IdSource, type OperationReceipt as CanonicalOperationReceipt, type SeatId, type SessionState } from '../contracts/index.js';
import type { BudgetReservationKind } from '../budgets/index.js';
import type { AuthorizationEnvelope } from '../persistence/envelope.js';
import { CouncilJobs, type JobState } from '../persistence/jobs.js';
import { ProjectionOutbox } from '../persistence/outbox.js';
import type { CouncilRepositories } from '../persistence/repositories.js';
import type { CouncilDatabase } from '../persistence/sqlite.js';
/** Idempotency source of the admission command in council_request_keys. */
export declare const OPERATION_ADMISSION_SOURCE = "council-operation-admission";
/** Outbox topic for safe operation state fan-out. */
export declare const OPERATION_EVENT_TOPIC = "council.operation";
/** Default council operation lease, matching the runner's canonical TTL. */
export declare const DEFAULT_OPERATION_LEASE_TTL_MS = 60000;
/**
 * The persisted semantic labels WER-011 requires. They are derived /
 * mapped onto existing columns; they are never a parallel state enum in
 * the database. `job_state` is council_jobs.state and
 * `operation_status` is the canonical OPERATION_STATUSES enum used by
 * council_provider_attempts and the OperationReceipt contract.
 */
export type OperationStateLabel = 'never_dispatched' | 'potentially_dispatched' | 'response_observed' | 'accepted' | 'known_failed' | 'cancelled_fenced' | 'outcome_unknown';
export declare const OPERATION_STATE_LABEL_MAP: {
    readonly never_dispatched: {
        readonly job_state: "queued";
        readonly operation_status: "reserved";
    };
    readonly potentially_dispatched: {
        readonly job_state: "running";
        readonly operation_status: "dispatched";
    };
    readonly response_observed: {
        readonly job_state: "running";
        readonly operation_status: "dispatched";
    };
    readonly accepted: {
        readonly job_state: "succeeded";
        readonly operation_status: "accepted";
    };
    readonly known_failed: {
        readonly job_state: "failed";
        readonly operation_status: "failed";
    };
    readonly cancelled_fenced: {
        readonly job_state: "cancelled";
        readonly operation_status: "cancelled";
    };
    readonly outcome_unknown: {
        readonly job_state: "failed";
        readonly operation_status: "provider_completion_unknown";
    };
};
export type CostKnowledge = 'estimated' | 'verified' | 'unknown';
export type RetryDisposition = 'not_needed' | 'safe_to_retry' | 'reconcile_first' | 'blocked';
/** Integer-unit reservation; unknown values stay null, never zero. */
export interface OperationReservation {
    requests: number;
    tokens: number | null;
    moneyMinorUnits: number | null;
    currency: string | null;
    costKnowledge: CostKnowledge;
}
/** The canonical durable operation record for this producer. */
export interface ProducerOperationReceipt {
    operationId: string;
    sessionId: string;
    ownerId: string;
    runGeneration: number;
    operationKind: BudgetReservationKind;
    round: number | null;
    seatId: SeatId | null;
    purpose: string;
    inputHash: string;
    routeSnapshotHash: string;
    grantId: string;
    packHash: string | null;
    attemptId: string;
    /** Persisted; never reset by process restart. */
    attemptOrdinal: number;
    leaseOwner: string | null;
    /** Fencing token rechecked on every mutable commit. */
    leaseGeneration: number;
    leaseExpiresAt: string | null;
    providerRequestId: string | null;
    /** Canonical persisted job state, never a parallel enum. */
    state: JobState;
    stateLabel: OperationStateLabel;
    reservation: OperationReservation;
    observedUsage: Record<string, unknown> | null;
    acceptedResultHash: string | null;
    eventSequence: number | null;
    retryDisposition: RetryDisposition;
    /** Safe accounting projection validated against the canonical contract. */
    canonicalReceipt: CanonicalOperationReceipt;
}
export interface AdmissionCommand {
    sessionId: string;
    /** Caller idempotency key, scoped to this session and source. */
    idempotencyKey: string;
    operationKind: BudgetReservationKind;
    purpose: string;
    inputHash: string;
    routeSnapshotHash: string;
    grantId: string;
    packHash?: string | null;
    round?: number | null;
    seatId?: SeatId | null;
    ownerId?: string;
    reservation: OperationReservation;
    /**
     * Optional session transition committed atomically with the job.
     * expectedVersion is excluded from the idempotency fingerprint so an
     * exact retry may retain its original revision after the first
     * success advanced the session (plan Section "Admission, execution
     * and recovery algorithm", step 2).
     */
    transition?: {
        to: SessionState;
        expectedVersion: number;
    };
}
export interface AdmissionResult {
    outcome: 'admitted' | 'replayed';
    receipt: ProducerOperationReceipt;
}
export interface OperationLeaseFence {
    operationId: string;
    leaseOwner: string;
    leaseGeneration: number;
}
export interface ReconcileQueuedWithoutJobResult {
    scanned: number;
    blocked: Array<{
        sessionId: string;
        reason: 'queued_without_job';
    }>;
}
export interface DurableOperationProducerDeps {
    db: CouncilDatabase;
    repositories: CouncilRepositories;
    jobs: CouncilJobs;
    outbox?: ProjectionOutbox;
    clock: Clock;
    ids: IdSource;
    /** Outbox delivery attempt bound; defaults to the outbox's own 5. */
    outboxMaxAttempts?: number;
}
export declare class DurableOperationProducer {
    private readonly db;
    private readonly repositories;
    private readonly jobs;
    private readonly outbox;
    private readonly clock;
    private readonly ids;
    constructor(deps: DurableOperationProducerDeps);
    /**
     * Admit one logical operation. One short owning-store transaction
     * commits: request-key claim, optional session transition, durable
     * job, `operation_reserved` event, and outbox intent.
     *
     * - Same idempotency key + same fingerprint: returns the committed
     *   receipt, performs no mutation.
     * - Same key + changed fingerprint: conflicts before any write.
     * - Concurrent loser: the request-key primary key serializes the
     *   race; the loser replays the committed matching receipt.
     * - A recorded admission whose job row is absent is rejected as
     *   QUEUED-without-job, never silently re-admitted.
     */
    admitOperation(envelope: AuthorizationEnvelope, command: AdmissionCommand): AdmissionResult;
    readReceipt(envelope: AuthorizationEnvelope, operationId: string): ProducerOperationReceipt;
    /**
     * Claim a queued operation under a durable lease. The compare-and-swap
     * bumps lease_epoch (the fencing generation); a losing claimer gets a
     * typed fence error, never a second owner.
     */
    claimOperation(envelope: AuthorizationEnvelope, operationId: string, workerId: string, leaseTtlMs?: number): ProducerOperationReceipt;
    /** Return a claimed operation to queued. Fence-checked. */
    releaseLease(envelope: AuthorizationEnvelope, fence: OperationLeaseFence): boolean;
    /**
     * Persist the dispatch intent before any network call. The persisted
     * label becomes `potentially_dispatched`: the intent exists, but the
     * send outcome is not proved, so retry is `reconcile_first`.
     */
    recordDispatchIntent(envelope: AuthorizationEnvelope, fence: OperationLeaseFence, input?: {
        providerRequestId?: string | null;
    }): ProducerOperationReceipt;
    /** Record that a provider response was observed but not yet accepted. */
    recordResponseObserved(envelope: AuthorizationEnvelope, fence: OperationLeaseFence, input: {
        providerRequestId: string | null;
        observedUsage?: Record<string, unknown> | null;
    }): ProducerOperationReceipt;
    /**
     * Accept a validated result. Finishes the durable job through the
     * existing `CouncilJobs.finishJob` CAS, appends the canonical
     * `operation_completed` event, and enqueues the outbox intent in the
     * same transaction.
     */
    recordAcceptedResult(envelope: AuthorizationEnvelope, fence: OperationLeaseFence, input: {
        acceptedResultHash: string;
        providerRequestId?: string | null;
        observedUsage?: Record<string, unknown> | null;
    }): ProducerOperationReceipt;
    /**
     * Reject a QUEUED session that has no durable operation job. This is
     * the explicit "QUEUED without its job is not a valid admission"
     * check; it never writes.
     */
    assertQueuedHasJob(envelope: AuthorizationEnvelope, sessionId: string): void;
    /**
     * Deterministic historical repair through the owning service: every
     * session in QUEUED with no operation job is moved to BLOCKED with a
     * `queued_without_job` reason, in stable session-id order. Idempotent:
     * a second pass finds nothing still QUEUED and orphans nothing. It
     * never invents a job, a grant, or an input hash.
     */
    reconcileQueuedWithoutJob(envelope: AuthorizationEnvelope, actor?: 'owner' | 'system' | 'worker' | 'chair'): ReconcileQueuedWithoutJobResult;
    private requireSession;
    private sessionRow;
    private readJobById;
    private readJobByOperationId;
    private readRequestKey;
    private insertRequestKey;
    private parsePayload;
    private writeProducerPayload;
    /**
     * Re-read the job and session inside the mutable transaction and
     * recheck the fencing generation: owner, lease epoch, live expiry,
     * and the session cancellation generation captured at admission.
     * This is the one fence every mutable commit calls.
     */
    private fence;
}
