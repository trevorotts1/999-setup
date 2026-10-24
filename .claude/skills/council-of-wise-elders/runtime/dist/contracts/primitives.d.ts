/**
 * ID, time, and money primitives for the canonical contracts (CWE-003).
 *
 * Rules from directive Sections 11.1 and 11.6:
 * - IDs are opaque: they must not contain client names, decision text, or
 *   secrets, so only a conservative character set is accepted.
 * - Timestamps are UTC ISO 8601; a display timezone is stored separately.
 * - Money is integer minor units plus an ISO 4217 currency code; fractional
 *   major-unit floats are never a money representation.
 * - Unknown is null, never an empty string masquerading as a fact.
 *
 * Clock and ID generation are host concerns. The core never reads a clock or
 * a random source: hosts inject values through the Clock and IdSource seams
 * below, and the core only validates what it is given.
 */
export declare const MAX_ID_LENGTH = 128;
export declare function isValidId(value: unknown): value is string;
export declare function assertValidId(value: unknown, field: string): string;
export declare function isSha256Hex(value: unknown): value is string;
export declare function assertSha256Hex(value: unknown, field: string): string;
export declare function isUtcTimestamp(value: unknown): value is string;
export declare function assertUtcTimestamp(value: unknown, field: string): string;
/** Money in integer minor units with an ISO 4217 alphabetic currency code. */
export interface Money {
    amount_minor: number;
    currency: string;
}
export declare function isMoney(value: unknown): value is Money;
export declare function money(amountMinor: number, currency: string): Money;
/**
 * Injection seams. The core defines these interfaces only; hosts supply the
 * implementations. Nothing in the core calls Date.now, Math.random, or any
 * host clock/ID source directly.
 */
export interface Clock {
    /** Current time as a UTC ISO 8601 timestamp string. */
    nowUtc(): string;
}
export interface IdSource {
    /** A fresh opaque ID. Implementations must satisfy isValidId. */
    newId(): string;
}
