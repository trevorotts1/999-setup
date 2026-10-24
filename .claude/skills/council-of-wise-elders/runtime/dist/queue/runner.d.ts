/**
 * Durable deliberation job runner (CWE-027, directive Sections 15, 16,
 * 18, 29 and 34 CWE-027). This module produces the graph artifact
 * `durable-worker-and-operation-leases`.
 *
 * What this is: the durable scheduling layer between the accepted
 * foundations and the round logic. CWE-024/CWE-025 (composed at
 * CWE-050) decide WHAT a session's operations are; this runner owns
 * HOW they run durably: workers claim operation jobs from CWE-006's
 * scoped store (council_jobs), execute them under council operation
 * leases, admit every provider dispatch through CWE-049's
 * RunAdmissionService (budget reservations only from CWE-028's one
 * DurableBudgetService; this module keeps no ledger of its own), and
 * commit accepted cards only through CWE-006's fenced acceptCard.
 * Per Section 34.3, CWE-028 supplies the single budget service and
 * CWE-049 the purpose-bound grant admission; durable scheduling is
 * built against those real services and a controlled operation
 * callback (the OperationExecutorPort below), without waiting for
 * CWE-024's openings. queue/capacity.ts is CWE-028's and is consumed,
 * never modified, here.
 *
 * Two lease layers, deliberately separate (Section 15.8, binding B05):
 * - The HOST scheduler lease (observed runLeasedJob default 90s) is a
 *   short maintenance/admission wakeup only. No council operation ever
 *   runs inside it. A provider call longer than 90 seconds is governed
 *   by the council operation lease below, never killed by the host
 *   lease (T156).
 * - The COUNCIL operation lease: TTL 60s, heartbeat every 15s, held on
 *   the durable job row (lease_owner, lease_epoch, lease_expires_at)
 *   and paired with a session fencing generation: claiming a job bumps
 *   the session state record's lease_epoch (the epoch CWE-028's budget
 *   service and CWE-049's admission fence on, and one third of
 *   CWE-006's acceptCard commit fence). A worker may commit only while
 *   lease owner, job epoch, session epoch, state version (read fresh
 *   at commit), and cancellation generation all remain current.
 *
 * Self-fencing (T157): the host's throwIfJobLeaseLost() returns
 * immediately when no AsyncLocalStorage job context exists, so it
 * proves nothing for a council worker. This runner never consults host
 * job context. Before EVERY protected commit (card commit, job
 * finish) the worker re-reads the durable job row and session record
 * and checks its own fence (assertFenceCurrent): owner, job epoch,
 * session epoch, cancellation generation. A worker with no host
 * context fences itself from durable state alone.
 *
 * Crash honesty (Sections 15.2, 15.3, 15.9): network calls never run
 * inside a store transaction; every store write here is a short
 * transaction through the composed services. The durable trail of an
 * operation is: job row (claim), budget reservation (admission),
 * attempt-ledger row (council_provider_attempts), validated checkpoint
 * (CWE-006 CouncilJobs), committed card (acceptCard). A crash leaves
 * some prefix of that trail; recovery (recoverExpiredLease) reads the
 * trail and resolves it truthfully:
 * - card committed or checkpoint accepted: the work is done; the job
 *   finishes succeeded and the unrecorded charge is marked UNKNOWN
 *   (counted at estimate, never zero, never invented). Completed
 *   inference is never repeated (T049).
 * - attempt dispatched, no card: provider completion is UNKNOWN. The
 *   reservation is marked unknown through recordConsumption, the
 *   checkpoint records provider_completion_unknown, and the job ends
 *   failed with that reason. It is NEVER auto-replayed (T050).
 * - admitted but never dispatched: the reservation is released (it was
 *   never dispatched, the one case CWE-028 release exists for) and the
 *   job returns to queued.
 * - claimed but never admitted: the job returns to queued.
 * Counters never reset: transport retries and output repairs are
 * separate admitted operations (kinds transport_retry and
 * output_repair, each with original_operation_id) in CWE-028's one
 * ledger, so their ceilings (8 total retries, 1 per original; repairs
 * inside the session envelope, 1 per original; 50 total requests) are
 * enforced across resumption, renewal, and worker changes by the
 * ledger itself (T066). Lease renewal touches no counter and no grant.
 *
 * Transport outcome law (the executor port contract): a dispatch error
 * flagged retryable asserts the provider did NOT accept the request
 * (a transport-level failure before acceptance). Only then may the
 * runner release that attempt's reservation and admit one
 * transport_retry for the same logical operation. An error flagged
 * unknownCompletion, a provider-deadline overrun, or an ambiguous
 * failure is provider completion unknown: never replayed, reservation
 * retained at estimate. A definite rejection settles at the reported
 * actual charge and fails the operation.
 *
 * Session controls (Section 15.4, runner half of T055): pause stops
 * new dispatch and lets in-flight work finish within its deadline;
 * resume returns to the recorded resume phase with the same pinned
 * route and limits (they live in the grant and session spec, which
 * pause never touches, T054); cancel increments the cancellation
 * generation immediately, fences late results out of every commit, and
 * leaves CANCELLED terminal with usage reconciled (Section 29).
 * Pause and cancel are idempotent at their targets; an illegal control
 * is a precise JOB_CONTROL_CONFLICT naming the current state.
 *
 * Control transitions use the canonical assertTransition table and
 * CWE-006's compare-and-swap state writer directly, because the
 * record's resume_phase must be the phase the session was in BEFORE
 * PAUSE_REQUESTED (the CWE-004 engine's own pause does the same record
 * override through its store port). repositories.transitionState is
 * not used for the two-step pause: entering PAUSED through it records
 * resume_phase as PAUSE_REQUESTED, a state the resume legality rule
 * can never target. This divergence is named for CWE-050 in the build
 * report; legality, CAS discipline, event types, and journaling are
 * identical to the repository path.
 */
import { type Clock, type CouncilCard, type IdSource, type SeatId, type SessionState, type SessionStateRecord } from '../contracts/index.js';
import type { RunAdmissionService } from '../authorization/admission.js';
import type { RunAuthorizationService } from '../authorization/run-grants.js';
import { DurableBudgetService, type BudgetReservationKind, type PinnedRouteSnapshot } from '../budgets/index.js';
import type { AuthorizationEnvelope } from '../persistence/envelope.js';
import { CouncilJobs, type JobRecord } from '../persistence/jobs.js';
import type { CouncilRepositories } from '../persistence/repositories.js';
import type { CouncilDatabase } from '../persistence/sqlite.js';
import type { StoredSession } from '../cli/host-ports.js';
import { RuntimeCapacity } from './capacity.js';
import { JobRunnerError, SimulatedCrashError, isSimulatedCrash } from './errors.js';
export { SimulatedCrashError, isSimulatedCrash };
/**
 * Council operation lease TTL (60 seconds) and heartbeat cadence
 * (15 seconds), Section 15.8: the canonical constants are CWE-004's
 * (cli/leases.ts, the in-process form of the same lease); they are
 * re-exported here, never redefined, so the two forms cannot drift.
 */
export { OPERATION_LEASE_TTL_MS, OPERATION_LEASE_HEARTBEAT_MS, } from '../cli/leases.js';
/**
 * The host scheduler's observed short lease (runLeasedJob default,
 * binding B05). Named here only to keep the two layers distinct in
 * code and tests: no council operation is ever bounded by it (T156).
 */
export declare const HOST_SCHEDULER_LEASE_MS = 90000;
/** Default provider deadline per operation (Section 15.8). */
export declare const DEFAULT_PROVIDER_DEADLINE_MS = 600000;
/** Default idle poll interval for runnable work (Section 15.8). */
export declare const DEFAULT_POLL_INTERVAL_MS = 1000;
/**
 * Time port for the runner's asynchronous waits (heartbeat cadence,
 * provider deadline). The synchronous clock is the contracts Clock
 * shared with every composed service, so lease math and budget holds
 * read one time source; this port only schedules callbacks. Tests
 * inject a manual implementation and advance it deterministically.
 */
export interface RunnerTimers {
    every(ms: number, fn: () => void): () => void;
    delay(ms: number): Promise<void>;
}
export declare const systemTimers: RunnerTimers;
/**
 * A transport-level dispatch failure, as reported by the executor
 * port. The flags carry the honesty contract the runner acts on:
 * - retryable: the provider did NOT accept the request; safe to admit
 *   one bounded transport retry. Never set when acceptance is unsure.
 * - unknownCompletion: the request may have completed provider-side;
 *   the outcome is unknown and must never be replayed.
 * Neither flag set: a definite rejection; settles at actual_minor.
 */
export declare class TransportDispatchError extends Error {
    readonly code = "TRANSPORT_DISPATCH_FAILED";
    readonly retryable: boolean;
    readonly unknownCompletion: boolean;
    readonly actual_minor: number;
    constructor(message: string, options?: {
        retryable?: boolean;
        unknownCompletion?: boolean;
        actual_minor?: number;
    });
}
export type DispatchAttemptKind = 'initial' | 'transport_retry' | 'output_repair';
export interface OperationDispatchContext {
    session: StoredSession;
    claim: JobClaim;
    /** The admitted operation id for THIS dispatch (retry/repair have their own). */
    dispatch_operation_id: string;
    attempt_kind: DispatchAttemptKind;
    /** Validation issues from the previous output, for output_repair dispatches. */
    repair_issues: string[];
    /**
     * Aborted when the runner gives up on this dispatch (provider deadline),
     * so the executor can kill its harness child instead of leaving it to
     * overlap the next seat. Executors pass it to transport.generate.
     */
    signal?: AbortSignal;
}
export interface OperationDispatchResult {
    /** The card author payload, WITHOUT the host stamp (the runner stamps). */
    author: Record<string, unknown>;
    /** Why the reply did not parse into an author payload (author is then {}). */
    parse_error?: string;
    provider_request_id: string | null;
    /** The actual charge for this dispatch, in minor units. */
    actual_minor: number;
    input_tokens: number | null;
    output_tokens: number | null;
    source_status?: 'verified' | 'unverified' | 'not_applicable';
}
/**
 * The controlled operation callback Section 34.3 names: CWE-024 and
 * CWE-025 implement this port (round logic, brief-bound validation,
 * real transports); the runner supplies durability, admission, leases,
 * and commit fencing. The port performs the provider call and returns
 * the unstamped author payload plus accounting facts. It must never
 * commit anything itself, and it runs outside every store transaction.
 */
export interface OperationExecutorPort {
    dispatch(ctx: OperationDispatchContext): Promise<OperationDispatchResult>;
    /**
     * Optional deeper validation of a stamped card (for example against
     * the frozen brief). Returns issue strings; empty means valid. The
     * runner always applies the canonical validateCard as well; failure
     * of either enters the bounded output-repair path.
     */
    validateCard?(ctx: OperationDispatchContext, card: CouncilCard): string[];
}
/**
 * The durable dispatch descriptor for one logical operation, stored in
 * the job row's payload alongside CWE-006's JobPayload fields (which
 * are preserved untouched). It is written once at enqueue and is part
 * of the job's identity: re-enqueueing the same operation identity
 * with a different descriptor is a JOB_DESCRIPTOR_CONFLICT.
 */
export interface OperationDescriptor {
    kind: BudgetReservationKind;
    /** Admission purpose; must equal the grant's purpose binding. */
    purpose: string;
    grant_id: string;
    estimate_minor: number;
    currency?: string | null;
    /** For jobs that are themselves a repair/retry of another operation. */
    original_operation_id?: string | null;
    round: number;
    pack_version?: string | null;
    model_policy_revision?: number;
}
export interface EnqueueOperationInput {
    session_id: string;
    phase_job_key: string;
    seat_id: SeatId | null;
    input_sha256: string;
    descriptor: OperationDescriptor;
    /** The pinned route snapshot every dispatch of this job charges against. */
    route_snapshot: PinnedRouteSnapshot;
}
/**
 * A worker's claim on one operation job: the job identity, the job
 * lease (owner + epoch), and the session fencing generation the claim
 * established. Every admission, consumption, checkpoint, and commit
 * the worker makes presents this claim's epochs.
 */
export interface JobClaim {
    job: JobRecord;
    operation_id: string;
    seat_id: SeatId | null;
    worker_id: string;
    /** The job row's lease epoch under this claim. */
    job_lease_epoch: number;
    /** The session fencing generation this claim bumped the record to. */
    session_lease_epoch: number;
    /** The cancellation generation captured at claim time. */
    cancel_generation: number;
    state_version_at_claim: number;
    descriptor: OperationDescriptor;
    route_snapshot: PinnedRouteSnapshot;
}
export interface FenceSnapshot {
    job_lease_epoch: number;
    session_lease_epoch: number;
    cancel_generation: number;
    session_state_version: number;
    session_state: SessionState;
}
export type OperationOutcomeStatus = 'committed' | 'already_committed' | 'provider_completion_unknown' | 'failed' | 'cancelled' | 'deferred' | 'admission_refused' | 'fenced';
export interface OperationOutcome {
    status: OperationOutcomeStatus;
    operation_id: string;
    /** Machine-readable cause for non-committed outcomes. */
    reason: string | null;
    /** The committed card, for 'committed' and 'already_committed'. */
    card: CouncilCard | null;
}
export interface RecoveryOutcome {
    job_id: string;
    operation_id: string;
    outcome: 'recovered_committed' | 'recovered_unknown' | 'recovered_requeued' | 'recovered_cancelled';
}
export interface DurableJobRunnerDeps {
    db: CouncilDatabase;
    repositories: CouncilRepositories;
    jobs: CouncilJobs;
    budget: DurableBudgetService;
    admission: RunAdmissionService;
    grants: RunAuthorizationService;
    clock: Clock;
    ids: IdSource;
    executor: OperationExecutorPort;
    timers?: RunnerTimers;
    /** CWE-028 runtime capacity admission; optional composition. */
    capacity?: RuntimeCapacity;
    leaseTtlMs?: number;
    heartbeatMs?: number;
    /** Route-specific deadline when known; default 600s (Section 15.8). */
    providerDeadlineMs?: number;
    /**
     * Called when a paid response is discarded because the settle was
     * fenced (a newer lease epoch, or a revoked grant). Never swallowed:
     * the host logs and journals it. A throw here is ignored.
     */
    onFencedSettle?: (error: JobRunnerError, context: {
        session_id: string;
    }) => void;
}
export declare class DurableJobRunner {
    private readonly db;
    private readonly repositories;
    private readonly jobs;
    private readonly budget;
    private readonly admission;
    private readonly grants;
    private readonly clock;
    private readonly ids;
    private readonly executor;
    private readonly timers;
    private readonly capacity;
    private readonly leaseTtlMs;
    private readonly heartbeatMs;
    private readonly providerDeadlineMs;
    private readonly onFencedSettle;
    private readonly capacityTokens;
    constructor(deps: DurableJobRunnerDeps);
    private nowIso;
    private nowMs;
    private scopeKey;
    private jobRow;
    private sessionOrThrow;
    /**
     * Enqueue one logical operation for a session. Idempotent per
     * operation identity (session, attempt, phase, input hash): the same
     * identity always resolves to the same durable job. The dispatch
     * descriptor is stored with the job; the same identity with a
     * different descriptor is a conflict, never a silent overwrite.
     */
    enqueueOperation(envelope: AuthorizationEnvelope, input: EnqueueOperationInput): JobRecord;
    /** Sessions visible to the envelope, newest first (worker scans). */
    listSessions(envelope: AuthorizationEnvelope): StoredSession[];
    /** All operation jobs of a session, oldest first. */
    listSessionJobs(envelope: AuthorizationEnvelope, sessionId: string): Array<JobRecord & {
        lease_owner: string | null;
        lease_expires_at: string | null;
    }>;
    /** Failed operation jobs of a session, oldest first: the seat and the code it ended with. */
    listSessionFailures(envelope: AuthorizationEnvelope, sessionId: string): Array<{
        seat_id: string | null;
        phase_job_key: string;
        outcome_code: string | null;
    }>;
    /**
     * Claim the session's next runnable operation job for a worker.
     * Returns null when nothing is claimable (no queued job, the session
     * is not runnable, or a live lease already owns the work): a null
     * return IS the rejected claim of T051, never an exception, because
     * losing a claim race is normal operation. The claim is atomic: the
     * job row compare-and-swap (queued, or expired lease after recovery)
     * admits exactly one worker, and the session fencing generation is
     * bumped so every token the previous owner held goes stale.
     */
    claimNextOperation(envelope: AuthorizationEnvelope, sessionId: string, workerId: string): JobClaim | null;
    /**
     * Advance the session fencing generation for a new claim. Any token
     * minted under an earlier epoch (budget reservations, card commit
     * fences, in-flight workers) goes stale at this instant. Retried on
     * a state-version conflict: losing the epoch race means the other
     * claimer is the current generation, and this bump then fences IT
     * out in turn only if this worker actually won the job CAS first;
     * callers here always hold the job CAS when they bump.
     */
    private bumpSessionEpoch;
    /**
     * Return a claimed job to queued without executing it (the session
     * paused, capacity refused, or the claim was fenced before dispatch
     * and the work is still wanted). Only the claim owner at the claim
     * epoch can release; anyone else's release is a no-op returning
     * false, so a stale worker cannot free a live worker's job.
     */
    releaseClaim(envelope: AuthorizationEnvelope, claim: JobClaim): boolean;
    /**
     * Renew the claim's job lease for another TTL. Renewal touches only
     * the job row's expiry: it never renews a spending grant, never
     * resets a retry or repair counter, and never moves the session
     * fencing generation (Section 15.8). A lease that already expired
     * cannot be renewed back to life; the job must be reconciled and
     * re-claimed, so a late heartbeat from a replaced worker fails with
     * JOB_LEASE_LOST instead of resurrecting its authority.
     */
    heartbeatClaim(envelope: AuthorizationEnvelope, claim: JobClaim): string;
    /**
     * The worker's OWN fence check (T157): re-reads the durable job row
     * and session record and verifies owner, job epoch, session epoch,
     * and cancellation generation. It consults no host job context, so
     * it protects commits identically inside and outside a host
     * scheduler invocation. Called before every protected commit.
     */
    assertFenceCurrent(envelope: AuthorizationEnvelope, claim: JobClaim): FenceSnapshot;
    /**
     * Execute one claimed operation end to end: admission, attempt
     * ledger, checkpoint, dispatch through the injected executor (never
     * inside a store transaction), bounded transport retry and output
     * repair as separately admitted operations, fence-checked card
     * commit, and exactly-once consumption recording. SimulatedCrashError
     * from the executor propagates uncaught by design: a crash is
     * reconciled from durable state by the next worker, not converted
     * into a failure verdict here.
     */
    executeClaimedOperation(envelope: AuthorizationEnvelope, claim: JobClaim): Promise<OperationOutcome>;
    /**
     * One dispatch attempt for an admitted operation, plus its bounded
     * follow-ons. Retry and repair recurse exactly once, each as its own
     * admitted operation, so CWE-028's per-original ceilings (1 and 1)
     * and the session totals (8 retries, 9 repairs, 50 requests) are the
     * binding enforcement, not counters kept here.
     */
    private dispatchAndSettle;
    /**
     * Keep why an attempt failed. The attempts table stores only the
     * outcome code, so the message (at most 300 characters, key-shaped
     * text redacted) is journaled beside it; the service reads it back to
     * explain a BLOCKED session. Never throws: it must not fail a dispatch.
     */
    private journalAttemptFailure;
    /** Admit a retry or repair follow-on operation and dispatch it. */
    private admitAndDispatchFollowOn;
    /**
     * Provider completion unknown: retain the reservation at its
     * estimate through recordConsumption, record the checkpoint and
     * attempt truthfully, and end the job. Nothing here replays the
     * operation, and no later path requeues it (T050).
     */
    private settleUnknown;
    /**
     * Commit a validated result. The fence is re-checked immediately
     * before the protected commit (T157); a fenced late result is
     * discarded (no card, no verdict material) while its consumption is
     * still recorded, because the provider work really happened and the
     * accounting must stay truthful (Sections 15.4 and 29).
     */
    private commitResult;
    /**
     * A fenced settle cannot finalize money, but the provider call was
     * paid for: mark the still-reserved hold 'unknown' under the session's
     * current epoch so it stays counted at its estimate. Left alone it
     * would lapse to 'expired' and free its allowance, dropping a paid
     * call from the ledger.
     */
    private keepFencedReservationCounted;
    /**
     * Discard a late or authority-less result: no card is committed,
     * nothing downstream can build a verdict on it, and the job ends.
     * The consumption is still recorded whenever this worker's fencing
     * generation is the one that admitted the operation; when a newer
     * generation has taken the session over, CWE-028 refuses the stale
     * finalization (BUDGET_LEASE_FENCED) and the reservation stays held
     * for the current owner's reconciliation, which is the honest
     * outcome: a fenced worker neither commits nor finalizes money.
     */
    private discardLateResult;
    /**
     * Reconcile one operation job whose lease expired under a previous
     * worker. Reads only durable state (job row, attempt ledger,
     * checkpoint, committed cards, budget reservation) and resolves the
     * job to its truthful end: committed work finishes, dispatched-but-
     * uncommitted work becomes provider_completion_unknown and is never
     * replayed, never-dispatched work is released and requeued, and work
     * under a superseded cancellation generation is cancelled. The
     * session fencing generation is advanced first, so every token the
     * dead worker held is stale before any accounting is finalized.
     * Returns null when the job is not an expired leased/running job.
     */
    recoverExpiredLease(envelope: AuthorizationEnvelope, jobId: string, workerId: string): RecoveryOutcome | null;
    /**
     * Scope sweep for the worker supervisor: expire lapsed budget holds
     * (CWE-028's sweep, which the CWE-049 composition assigns to this
     * scheduler's cadence) and reconcile every expired operation lease
     * in the scope. Idempotent; safe on every poll cycle and at boot.
     */
    reconcileScope(envelope: AuthorizationEnvelope, workerId: string): {
        expired_holds: number;
        recoveries: RecoveryOutcome[];
    };
    /**
     * Pause a session (Section 15.4): stops new dispatch, lets in-flight
     * work finish within its deadline, preserves all accounting.
     * Idempotent: pausing a PAUSE_REQUESTED or PAUSED session returns
     * its current record unchanged. The recorded resume phase is the
     * state the session was in when pause was requested.
     */
    pauseSession(envelope: AuthorizationEnvelope, sessionId: string): SessionStateRecord;
    /**
     * Resume a paused or blocked session to its recorded resume phase.
     * The pinned route and limits are untouched (they live in the grant
     * and session spec, which pause/resume never modify, T054). A resume
     * of a session that is not paused or blocked is a precise conflict.
     */
    resumeSession(envelope: AuthorizationEnvelope, sessionId: string): SessionStateRecord;
    /**
     * Cancel a session (Section 15.4): the cancellation generation
     * increments immediately (at CANCEL_REQUESTED), in-flight transports
     * are fenced at their next fence check, queued jobs are cancelled in
     * place, held capacity is freed in the same call, and CANCELLED is
     * terminal: no late result can emit a verdict, create actions, or
     * resurrect the session, and usage already spent stays reconciled
     * in CWE-028's ledger. Idempotent at CANCELLED.
     */
    cancelSession(envelope: AuthorizationEnvelope, sessionId: string): SessionStateRecord;
    /**
     * One legal control transition over the canonical table, written
     * with CWE-006's compare-and-swap state writer and journaled with
     * the same event vocabulary repositories.transitionState uses. The
     * record's resume_phase is set explicitly by the caller for the
     * PAUSED leg (see the module header for why).
     */
    private controlTransition;
    /**
     * The phase a RESUMING session returns to: the recorded resume
     * phase when it names a runnable state; otherwise (records written
     * before this runner, where the phase was not preserved) the most
     * recent runnable phase in the session's journaled state history.
     */
    private resumeTarget;
    private dispatchGate;
    private findCommittedCard;
    private findCommittedCardByIdentity;
    private stampCard;
    private validateStamped;
    private markJobRunning;
    private finishJobRow;
    private claimShell;
    private recordAttempt;
    private updateAttempt;
    private attemptStatus;
    private saveCheckpoint;
}
