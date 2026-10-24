/**
 * Typed errors for the portable core host/CLI layer (CWE-004).
 *
 * Codes follow the stable-code style of directive Section 17.3: callers
 * branch on `code`, never on message text. Every error carries a plain
 * English message, whether it is retryable, the next action a user or
 * operator can take, and the process exit code the CLI dispatcher maps
 * it to. FEATURE_NOT_READY is the honest state for behavior owned by a
 * downstream unit that has not been composed into this foundation
 * (Sections 17.5 and 25.6): it is never simulated success.
 */
export type CouncilErrorCode = 'COUNCIL_USAGE' | 'COUNCIL_INVALID_INPUT' | 'COUNCIL_SESSION_NOT_FOUND' | 'COUNCIL_STATE_CONFLICT' | 'COUNCIL_VERDICT_NOT_READY' | 'COUNCIL_FEATURE_NOT_READY' | 'COUNCIL_ROUTE_UNAVAILABLE' | 'COUNCIL_TRANSPORT_FAILED' | 'COUNCIL_CARD_INVALID' | 'COUNCIL_BUDGET_EXHAUSTED' | 'COUNCIL_LEASE_LOST' | 'RUN_AUTHORIZATION_REQUIRED' | 'COUNCIL_STORE_UNAVAILABLE' | 'COUNCIL_INTERNAL';
export declare class CouncilError extends Error {
    readonly code: CouncilErrorCode;
    readonly retryable: boolean;
    readonly action: string;
    readonly exitCode: number;
    constructor(code: CouncilErrorCode, message: string, options?: {
        retryable?: boolean;
        action?: string;
        exitCode?: number;
    });
    /** Section 17.3 style error envelope; safe for machine consumers. */
    toEnvelope(requestId?: string | null): Record<string, unknown>;
}
export declare function featureNotReady(what: string, ownerUnit: string): CouncilError;
export declare function usageError(message: string): CouncilError;
export declare function invalidInput(message: string): CouncilError;
export declare function isCouncilError(value: unknown): value is CouncilError;
