/**
 * Receipted operation producer for the Council runtime (WER-011
 * dependency-ready slice, unit W01-U003).
 *
 * TWO producers cover this slice, and they own different things. Both
 * are exported from src/queue/index.ts:
 *
 * - `DurableOperationProducer` (src/queue/producer.ts) owns the
 *   REQUEST-KEYED admission path: council_request_keys as the
 *   idempotency registry, plus the leased lifecycle
 *   (claim / release / dispatch intent / response observed / accepted
 *   result) behind a lease fence, projected onto the canonical
 *   OperationReceipt contract. Use it when the caller supplies its own
 *   idempotency key and drives the full worker lifecycle.
 * - `OperationProducer` (this module) owns the
 *   OperationAdmissionReceipt: the receipt committed INSIDE the job
 *   payload at admission, its admission-fingerprint conflict law, its
 *   non-resetting attempt_ordinal and lease_generation, the
 *   explicit-null mutable commit path with receipt-level fencing, and
 *   reconciliation of a QUEUED session that has no durable job. Use it
 *   when the caller addresses an operation by the deterministic
 *   operation identity (session, attempt, phase_job_key, input_sha256)
 *   and needs the receipt itself to be the durable business record.
 *
 * Neither producer replaces the other; there is no "only" or "primary"
 * producer here.
 *
 * What this adds over DurableJobRunner.enqueueOperation alone:
 * enqueueOperation commits the job row and its dispatch descriptor, but
 * records no receipt, no journal event, and no outbox intent, and the
 * session transition that queues the work happens in a separate call.
 * This producer makes ADMISSION the single owning-store transaction:
 * the session transition to QUEUED, the durable job row, the
 * OperationAdmissionReceipt, the operation_reserved journal event, and the
 * outbox intent all commit in ONE short transaction (Section 16.4), or
 * none of them do. A crash between the writes cannot leave a session
 * QUEUED without its job, a job without its receipt, or a receipt
 * without its event.
 *
 * Composition law (no second state machine, no second scheduler):
 * - The job row itself is still CWE-006's council_jobs through
 *   CouncilJobs.claimJob (called on the SAME handle inside the
 *   producer's transaction via withHandle), so job identity,
 *   idempotency-key derivation, and CAS discipline stay in one place.
 * - Dispatch stays CWE-027's runner; this module only produces. It
 *   never claims, executes, heartbeats, or dispatches. Worker
 *   acknowledgment, real provider dispatch, and live replay are
 *   DEFERRED to the runner units; nothing here claims them.
 * - Budget reservation stays at claim time (CWE-049 admission); the
 *   receipt records the grant and estimate the dispatch will charge
 *   against, never a reservation id (which does not exist yet).
 *
 * OperationAdmissionReceipt semantics (v2.4):
 * - operation_id is the stable business key: the same
 *   canonicalHash({session_id, attempt, phase_job_key, input_sha256})
 *   identity the job row, budget reservation, attempt ledger, and card
 *   host stamp already use. It is never reset by restart.
 * - The admission fingerprint (canonicalStringify of descriptor +
 *   route snapshot fingerprint) is committed with the receipt; the
 *   same idempotency key with a DIFFERENT fingerprint is a conflict
 *   refused before any write.
 * - attempt_ordinal is the receipt's own per-operation dispatch
 *   ordinal: 1 at admission and never reset by restart; retries and
 *   repairs are separate operations with their own receipts.
 * - lease_generation is the fencing token the receipt was admitted
 *   under. Every later mutable commit against this receipt rechecks it
 *   (commitMutable checks job lease_epoch AND session lease_epoch),
 *   so a stale generation cannot commit over a newer claim.
 *
 * State labels: every persisted `state` is an EXISTING canonical enum.
 * RECEIPT_STATE_TO_JOB_STATE maps the semantic label onto CWE-006
 * JobState; dispatch sublabels map onto contracts OPERATION_STATUSES.
 * No parallel state machine. The receipt ALSO persists the semantic
 * label itself (`state_label`), because two labels share one JobState
 * ('potentially_dispatched' and 'response_observed' both map to
 * 'leased') and would otherwise be indistinguishable once written.
 */
import { type Clock, type CouncilEventType, type IdSource, type SeatId } from '../contracts/index.js';
import type { PinnedRouteSnapshot } from '../budgets/index.js';
import type { AuthorizationEnvelope } from '../persistence/envelope.js';
import { CouncilJobs } from '../persistence/jobs.js';
import type { CouncilRepositories } from '../persistence/repositories.js';
import type { CouncilDatabase } from '../persistence/sqlite.js';
import type { OperationDescriptor } from './runner.js';
/**
 * Receipt lifecycle labels, each mapped onto the canonical enums the
 * repo already persists (recorded explicitly per WER-011):
 *
 * - never_dispatched: the operation was admitted durably; no worker
 *   has claimed the job yet. Maps onto JobState 'queued'.
 * - potentially_dispatched: a worker claimed the job (lease_epoch was
 *   bumped) but no provider response was observed. Covers JobState
 *   'leased' and 'running'.
 * - response_observed: a provider response was recorded by the
 *   attempt ledger but acceptance is not final. Maps onto
 *   OPERATION_STATUSES 'reserved'/'dispatched' rows on
 *   council_provider_attempts (JobState still leased/running).
 * - accepted: the job finished succeeded and the attempt ledger shows
 *   'accepted'. Maps onto JobState 'succeeded' + OPERATION_STATUSES
 *   'accepted'.
 * - known_failed: the job finished failed or dead_letter. Maps onto
 *   JobState 'failed'/'dead_letter' + OPERATION_STATUSES 'failed'.
 * - cancelled_fenced: the job was cancelled or fenced out (superseded
 *   cancel generation, session cancellation). Maps onto JobState
 *   'cancelled' + OPERATION_STATUSES 'cancelled'.
 * - outcome_unknown: provider completion is unknown. Maps onto
 *   OPERATION_STATUSES 'provider_completion_unknown' (JobState failed
 *   with that terminal reason per the runner's recovery law).
 */
export type ReceiptStateLabel = 'never_dispatched' | 'potentially_dispatched' | 'response_observed' | 'accepted' | 'known_failed' | 'cancelled_fenced' | 'outcome_unknown';
export declare const RECEIPT_STATE_TO_JOB_STATE: Record<ReceiptStateLabel, string>;
/** How the charge on the grant is known at receipt time. */
export type CostKnowledge = 'estimated' | 'verified' | 'unknown';
/**
 * What a caller should do with a receipt after a fault, per the v2.4
 * disposition law.
 */
export type RetryDisposition = 'not_needed' | 'safe_to_retry' | 'reconcile_first' | 'blocked';
/**
 * The canonical admission receipt persisted in the job row's payload
 * (receipt_json). operation_id is the stable business key; every field
 * survives restart because it lives in the same committed payload as
 * the job itself.
 */
export interface OperationAdmissionReceipt {
    schema_version: 'wise-elders.operation-receipt/v1';
    /** Stable business key; equals the job's idempotency key. */
    operation_id: string;
    operation_id_hash: string;
    session_id: string;
    owner_subject: string;
    /** The session run generation (state lease_epoch) at admission. */
    run_generation: number;
    operation_kind: string;
    round: number;
    seat_id: string | null;
    purpose: string;
    input_hash: string;
    route_snapshot_hash: string;
    grant_id: string;
    pack_hash: string;
    /** The dispatch id when this operation is itself a follow-on. */
    attempt_id: string;
    /** Per-operation dispatch ordinal; 1 at admission, never reset. */
    attempt_ordinal: number;
    /** True when a later admission under the same key replayed. */
    replayed: boolean;
    lease_owner: string | null;
    /** Fencing token at admission; rechecked on every mutable commit. */
    lease_generation: number;
    lease_expires_at: string | null;
    provider_request_id: string | null;
    /** Maps onto JobState (see RECEIPT_STATE_TO_JOB_STATE). */
    state: string;
    /**
     * The semantic dispatch label this receipt was last committed at.
     * Distinct from `state` on purpose: 'potentially_dispatched' and
     * 'response_observed' both map to JobState 'leased', so this field is
     * the only place the two stay distinguishable after the write.
     * Absent on receipts admitted before the field existed; every reader
     * derives the label from the durable rows in that case.
     */
    state_label?: ReceiptStateLabel;
    /** Integer-unit reservation estimate; charged at dispatch. */
    reserved_units: number;
    cost_knowledge: CostKnowledge;
    observed_usage: {
        input_units: number | null;
        output_units: number | null;
    } | null;
    accepted_result_hash: string | null;
    event_sequence: number;
    retry_disposition: RetryDisposition;
    admission_fingerprint: string;
    created_at: string;
    updated_at: string;
}
export interface AdmitOperationRequest {
    session_id: string;
    phase_job_key: string;
    seat_id: SeatId | null;
    input_sha256: string;
    descriptor: OperationDescriptor;
    route_snapshot: PinnedRouteSnapshot;
    /** Pack identity hash (source_pack_version by default). */
    pack_hash?: string | null;
}
export type AdmitOperationResult = {
    outcome: 'committed';
    receipt: OperationAdmissionReceipt;
    created: true;
} | {
    outcome: 'committed';
    receipt: OperationAdmissionReceipt;
    created: false;
};
declare const RECEIPT_STATE_EVENT_TYPES: ReadonlySet<CouncilEventType>;
declare class ProducerStateConflict extends Error {
    readonly detail: Record<string, unknown>;
    readonly code: "PRODUCER_STATE_CONFLICT";
    constructor(message: string, detail: Record<string, unknown>);
}
export interface OperationProducerDeps {
    db: CouncilDatabase;
    repositories: CouncilRepositories;
    jobs: CouncilJobs;
    clock: Clock;
    ids: IdSource;
}
export declare class OperationProducer {
    private readonly db;
    private readonly repositories;
    private readonly jobs;
    private readonly clock;
    private readonly ids;
    constructor(deps: OperationProducerDeps);
    private nowIso;
    private operationId;
    /**
     * Fingerprint the admission: everything that must be identical for
     * the same idempotency key. A changed fingerprint under the same key
     * is a conflict refused before any write.
     */
    private admissionFingerprint;
    private sessionStateRow;
    private sessionRecordFromJournal;
    /**
     * The receipt for an existing job payload, when one was committed.
     */
    private receiptFromPayload;
    private receiptedPayloadMutation;
    /**
     * Admit one operation durably: session transition to QUEUED (when
     * the session is READY), the job row, the receipt, the
     * operation_reserved journal event, and the outbox intent, all in
     * ONE owning-store transaction.
     *
     * Idempotency: the key is the operation identity. A replay under
     * the same key with the SAME fingerprint returns the originally
     * committed receipt (created: false) and writes nothing. A replay
     * with a DIFFERENT fingerprint throws PRODUCER_FINGERPRINT_CONFLICT
     * before any write. A losing concurrent duplicate (the transaction
     * races another admission of the same identity) returns the winner's
     * committed receipt.
     *
     * Invalid admission: a session record whose queueing transition or
     * job identity would be inconsistent is refused before any write;
     * in particular a QUEUED session state without its job row is never
     * produced by this path, and reconciliation of historical
     * queued-without-job rows is reconcileQueuedWithoutJob below.
     */
    admitOperation(envelope: AuthorizationEnvelope, request: AdmitOperationRequest): AdmitOperationResult;
    /**
     * The admission body. `queuedWithoutJob` selects the law for a QUEUED
     * session that has no operation job: 'reject' is normal admission and
     * refuses that historical break, because the session is not a
     * re-admission target; 'readmit' is used only by
     * reconcileQueuedWithoutJob, which has already proved the absence
     * inside its own transaction and exists to close it. An outer
     * transaction is joined, never nested (sqlite.ts tx law), so the
     * readmit path commits as one unit.
     */
    private admitWithPolicy;
    /**
     * The committed receipt for an operation identity, read-only. This
     * is the replay path: after a restart, the caller re-derives the
     * operation identity and reads the same committed receipt back,
     * including its attempt_ordinal and lease_generation (never reset).
     */
    getReceipt(envelope: AuthorizationEnvelope, identity: {
        session_id: string;
        attempt: number;
        phase_job_key: string;
        input_sha256: string;
    }): OperationAdmissionReceipt | null;
    /**
     * Mutable commit against an admitted receipt with the fencing token
     * rechecked inside the transaction: a stale lease_generation (the
     * job row's lease_epoch has moved on, or the session record's
     * lease_epoch has moved on) cannot commit. Restart never resets the
     * token: it is read from the committed receipt, not from memory.
     */
    commitMutable(envelope: AuthorizationEnvelope, identity: {
        session_id: string;
        attempt: number;
        phase_job_key: string;
        input_sha256: string;
    }, mutation: {
        expected_lease_generation: number;
        lease_owner?: string | null;
        lease_expires_at?: string | null;
        provider_request_id?: string | null;
        state?: ReceiptStateLabel;
        cost_knowledge?: CostKnowledge;
        observed_usage?: {
            input_units: number | null;
            output_units: number | null;
        } | null;
        accepted_result_hash?: string | null;
        retry_disposition?: RetryDisposition;
    }): {
        committed: boolean;
        receipt: OperationAdmissionReceipt | null;
    };
    /**
     * Deterministic reconciliation for historical queued-without-job
     * rows: a session left QUEUED (or later) with no operation job row
     * for the identity the caller expected. The owning service resolves
     * it truthfully, and the decision is journaled:
     *
     * - 'fail_session': the session is transitioned out of the broken
     *   queueing state to FAILED.
     * - 'readmit': the missing operation is admitted now, in this same
     *   transaction, when the caller still holds the full request. The
     *   session stays QUEUED because the repair closes the gap rather
     *   than abandoning the queued work. The request must be bound to
     *   `identity.session_id`; a request for any other session is
     *   refused.
     *
     * Queued-without-job is never silently passed through, and a
     * QUEUED session that already has its job is reported as
     * action: 'none'.
     */
    reconcileQueuedWithoutJob(envelope: AuthorizationEnvelope, identity: {
        session_id: string;
    }, resolution: {
        action: 'fail_session';
    } | {
        action: 'readmit';
        request: AdmitOperationRequest;
    }): {
        reconciled: true;
        detail: Record<string, unknown>;
    };
    /**
     * State label for a receipt: the persisted `state_label` for the two
     * labels the durable rows cannot separate, otherwise derived from the
     * job row and attempt ledger rows. This is a read; it never mutates
     * and never invents a state.
     */
    stateLabel(envelope: AuthorizationEnvelope, identity: {
        session_id: string;
        attempt: number;
        phase_job_key: string;
        input_sha256: string;
    }): ReceiptStateLabel | null;
}
/** Exported for tests and CWE-050 reconciliation reporting. */
export { ProducerStateConflict, RECEIPT_STATE_EVENT_TYPES, };
