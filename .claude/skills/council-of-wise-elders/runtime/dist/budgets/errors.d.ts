/**
 * Typed errors for the shared budget and capacity service (CWE-028,
 * directive Sections 13, 15.6, 15.7, 17.3).
 *
 * Codes follow the stable-code style of Section 17.3, matching the
 * shape of the CWE-004 CouncilError and the CWE-006 PersistenceError:
 * callers branch on `code`, never on message text. Every error carries
 * a plain English message, whether it is retryable, the next action an
 * operator can take, and optional machine-readable detail that never
 * contains secret values, raw provider bodies, or private decision
 * text.
 *
 * Readiness law (Sections 13.5 and 15.6): when a reservation cannot be
 * honored (no grant record, an inactive grant, an exhausted ceiling, a
 * fenced lease epoch, an unavailable store), the service fails with one
 * of these typed errors and records nothing. There is no partial
 * grant, no silent queue, and no best-effort reservation.
 */
export type BudgetCapacityErrorCode = 'BUDGET_INVALID_INPUT' | 'BUDGET_GRANT_NOT_FOUND' | 'BUDGET_GRANT_INACTIVE' | 'BUDGET_GRANT_SESSION_MISMATCH' | 'BUDGET_CURRENCY_MISMATCH' | 'BUDGET_EXHAUSTED' | 'BUDGET_RESERVATION_NOT_FOUND' | 'BUDGET_RESERVATION_FINALIZED' | 'BUDGET_LEASE_FENCED' | 'BUDGET_RECONCILE_CONFLICT' | 'BUDGET_ROUTE_RESOLUTION_REFUSED' | 'BUDGET_STORE_UNAVAILABLE' | 'CAPACITY_CONFIG_INVALID';
export declare class BudgetCapacityError extends Error {
    readonly code: BudgetCapacityErrorCode;
    readonly retryable: boolean;
    readonly action: string;
    /** Machine-readable detail: ceiling names, counts, states. No content. */
    readonly detail: Record<string, unknown> | null;
    constructor(code: BudgetCapacityErrorCode, message: string, options?: {
        retryable?: boolean;
        action?: string;
        detail?: Record<string, unknown> | null;
    });
}
export declare function isBudgetCapacityError(value: unknown): value is BudgetCapacityError;
export declare function budgetInvalidInput(message: string): BudgetCapacityError;
export declare function budgetExhausted(args: {
    ceiling: string;
    limit: number;
    current: number;
    sessionId: string;
}): BudgetCapacityError;
export declare function budgetLeaseFenced(args: {
    sessionId: string;
    operationId: string;
    presentedEpoch: number;
    currentEpoch: number;
}): BudgetCapacityError;
export declare function budgetStoreUnavailable(message: string): BudgetCapacityError;
