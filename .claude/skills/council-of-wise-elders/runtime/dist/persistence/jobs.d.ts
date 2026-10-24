/**
 * Job substrate and operation checkpoints (CWE-006, directive Sections
 * 15.4 and 16.2; belongs to unit CWE-006's repository layer).
 *
 * The canonical council_jobs table is a generic durable job row: a
 * kind, a deterministic idempotency key, a lifecycle state, lease
 * fields, and JSON payload and checkpoint columns. This repository
 * gives it the operation semantics Section 15.4 defines:
 *
 * - An operation job is addressed by the deterministic identity
 *   (session, attempt, phase_job_key, input_sha256), carried as the
 *   idempotency key. Claiming the same operation twice returns the
 *   same job row instead of creating a duplicate (Sections 15.4, 17).
 * - A checkpoint is written only after its output has passed full
 *   schema validation (Section 15.4); this repository re-validates the
 *   checkpoint against the canonical contract before storing it in the
 *   checkpoint row's checkpoint_json, so an invalid partial can never
 *   be persisted as a resumable result. Checkpoints are their own job
 *   rows (kind 'operation_checkpoint') keyed by the full checkpoint
 *   identity, which adds the seat to the operation identity.
 * - Resume is fenced: the stored cancellation generation must equal
 *   the caller's current generation, or the checkpoint is refused
 *   (Section 15.2). A brief-revision mismatch is likewise refused.
 * - Job lifecycle writes are compare-and-swap on the current state and
 *   lease epoch, so two workers cannot both own or finish one job,
 *   and a replaced worker's late finish is rejected (Section 15.8).
 */
import { type Clock, type IdSource, type JobCheckpoint } from '../contracts/index.js';
import type { AuthorizationEnvelope } from './envelope.js';
import type { CouncilDatabase } from './sqlite.js';
export declare const OPERATION_JOB_KIND = "operation";
export declare const CHECKPOINT_JOB_KIND = "operation_checkpoint";
export type JobState = 'queued' | 'leased' | 'running' | 'succeeded' | 'failed' | 'dead_letter' | 'cancelled';
export interface JobRecord {
    id: string;
    session_id: string;
    attempt: number;
    phase_job_key: string;
    input_sha256: string;
    state: JobState;
    lease_epoch: number;
    cancel_generation: number;
    brief_revision: number;
}
export declare class CouncilJobs {
    private readonly db;
    private readonly deps;
    constructor(db: CouncilDatabase, deps: {
        clock: Clock;
        ids: IdSource;
    });
    private assertSessionUsable;
    private jobRowByKey;
    private toRecord;
    /**
     * Claim the deterministic job for an operation, creating it queued
     * when absent. Idempotent: the same identity always returns the same
     * job row.
     */
    claimJob(envelope: AuthorizationEnvelope, input: {
        sessionId: string;
        attempt: number;
        briefRevision: number;
        phaseJobKey: string;
        inputSha256: string;
        cancelGeneration: number;
        seatId: string | null;
    }): JobRecord;
    /**
     * Lease a queued job to a worker, bumping the lease epoch so any
     * prior owner's late commit fails its fence (Section 15.8).
     * Compare-and-swap on state: a job that is not queued, or whose
     * recorded cancellation generation no longer matches the caller's
     * current generation, is not leasable and returns null.
     */
    leaseJob(envelope: AuthorizationEnvelope, jobId: string, workerId: string, leaseSeconds: number, currentCancelGeneration: number): JobRecord | null;
    /**
     * Terminal job write, compare-and-swap from the leased state at the
     * caller's lease epoch. Returns false when the job is no longer the
     * caller's to finish (already finished, or the lease moved on).
     */
    finishJob(envelope: AuthorizationEnvelope, jobId: string, leaseEpoch: number, outcome: {
        status: 'succeeded';
        resultRef: string;
    } | {
        status: 'failed' | 'cancelled';
        errorClass: string;
    }): boolean;
    /**
     * Persist a validated operation checkpoint. The payload is validated
     * against the canonical JobCheckpoint contract first: an invalid
     * partial is refused, never stored as a resumable result. Saving the
     * same checkpoint identity again replaces the stored checkpoint
     * (checkpoints are resumable snapshots, not immutable records).
     */
    saveCheckpoint(envelope: AuthorizationEnvelope, checkpoint: JobCheckpoint, sessionCancelGeneration: number): void;
    /**
     * Load a checkpoint for resume, fenced by the caller's CURRENT
     * cancellation generation and brief revision: a checkpoint written
     * under a superseded generation or revision is refused (returns
     * null), never silently reused (Sections 15.2 and 15.4).
     */
    getCheckpoint(envelope: AuthorizationEnvelope, input: {
        sessionId: string;
        attempt: number;
        briefRevision: number;
        phaseJobKey: string;
        seatId: string | null;
        inputSha256: string;
        currentCancelGeneration: number;
    }): JobCheckpoint | null;
}
