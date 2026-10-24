/**
 * Operation/attempt ledger for subprocess dispatches (WER-008 slice).
 *
 * The record is written BEFORE the child process is launched, so a
 * timeout or a crash can never be mistaken for proof that the provider
 * did no work. Only a definite pre-launch failure is retry-safe.
 *
 * Dispositions:
 * - `launching`   recorded, spawn not yet observed.
 * - `running`     spawn succeeded; the provider may be working.
 * - `completed`   the child exited and a result was accepted.
 * - `failed_definitely`  spawn failed (ENOENT/EACCES); no provider work.
 * - `potentially_dispatched`  deadline/abort/non-zero exit; the provider
 *   may have completed, so replay is refused.
 */
export type AttemptDisposition = 'launching' | 'running' | 'completed' | 'failed_definitely' | 'potentially_dispatched';
export interface AttemptRecord {
    operationId: string;
    attemptId: string;
    routeId: string;
    disposition: AttemptDisposition;
    /** ISO timestamp when the record was created (before launch). */
    startedAt: string;
    updatedAt: string;
    /** Plain-English reason, safe to show an operator (no prompt content). */
    detail: string | null;
}
export interface AttemptInput {
    operationId: string;
    attemptId: string;
    routeId: string;
}
export declare class AttemptLedgerError extends Error {
    readonly code = "TRANSPORT_ATTEMPT_UNKNOWN";
    constructor(message: string);
}
/**
 * In-memory ledger. Production durability belongs to the queue/persistence
 * owners; this recorder is the transport-local contract they can wrap.
 */
export declare class OperationAttemptLedger {
    private readonly records;
    private readonly now;
    constructor(options?: {
        now?: () => Date;
    });
    private key;
    /** Record the attempt BEFORE launch. Reusing a key is refused. */
    begin(input: AttemptInput): AttemptRecord;
    private update;
    markRunning(operationId: string, attemptId: string): AttemptRecord;
    markCompleted(operationId: string, attemptId: string): AttemptRecord;
    markFailedDefinitely(operationId: string, attemptId: string, detail: string): AttemptRecord;
    markPotentiallyDispatched(operationId: string, attemptId: string, detail: string): AttemptRecord;
    get(operationId: string, attemptId: string): AttemptRecord | null;
    list(): AttemptRecord[];
}
/**
 * Whether replaying the SAME provider request is safe. Only a definite
 * pre-launch failure qualifies; every other non-success may have reached
 * the provider.
 */
export declare function isSafeToRetry(record: AttemptRecord): boolean;
