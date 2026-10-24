/**
 * Typed errors for the council persistence layer (CWE-006).
 *
 * Codes follow the stable-code style of directive Section 17.3: callers
 * branch on `code`, never on message text. Messages are plain English and
 * never carry secret values, raw provider bodies, or private decision
 * text; a failure to persist is reported with the boundary that failed
 * and what was preserved (nothing partial is ever committed, Section
 * 16.4).
 */
export type PersistenceErrorCode = 'PERSISTENCE_CONFIG_INVALID' | 'PERSISTENCE_SCOPE_DENIED' | 'PERSISTENCE_SESSION_NOT_FOUND' | 'PERSISTENCE_SESSION_DELETED' | 'PERSISTENCE_STATE_CONFLICT' | 'PERSISTENCE_DUPLICATE_OPERATION' | 'PERSISTENCE_OPERATION_CONFLICT' | 'PERSISTENCE_STORE_DEFERRED' | 'PERSISTENCE_AUTHORITY_MODE_MISMATCH' | 'PERSISTENCE_SCHEMA_UNAVAILABLE' | 'PERSISTENCE_DIAGNOSTIC_DENIED' | 'PERSISTENCE_VALIDATION_FAILED' | 'PERSISTENCE_INTERNAL';
export declare class PersistenceError extends Error {
    readonly code: PersistenceErrorCode;
    readonly retryable: boolean;
    readonly action: string;
    /** Machine-readable detail: field paths, counts, attempt numbers. No content. */
    readonly detail: Record<string, unknown> | null;
    constructor(code: PersistenceErrorCode, message: string, options?: {
        retryable?: boolean;
        action?: string;
        detail?: Record<string, unknown> | null;
    });
}
export declare function isPersistenceError(value: unknown): value is PersistenceError;
export declare function configInvalid(message: string, detail?: Record<string, unknown>): PersistenceError;
export declare function scopeDenied(message: string): PersistenceError;
export declare function sessionNotFound(sessionId: string): PersistenceError;
export declare function sessionDeleted(sessionId: string): PersistenceError;
/**
 * The database stayed locked past the bounded busy budget (Section 16.4,
 * test T056). The write was NOT applied; the caller records a visible
 * deferred state and retries later. Nothing was partially committed.
 */
export declare class PersistenceDeferredError extends PersistenceError {
    readonly attempts: number;
    readonly waitedMs: number;
    constructor(attempts: number, waitedMs: number);
}
