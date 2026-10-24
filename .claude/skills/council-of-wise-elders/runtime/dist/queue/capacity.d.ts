/**
 * Runtime capacity admission (CWE-028, directive Sections 13, 15.7,
 * and 34.3: queue/capacity.ts is owned by CWE-028; CWE-027 builds
 * durable scheduling against this service and explicitly excludes
 * this file).
 *
 * Capacity is runtime state, deliberately separate from the durable
 * budget ledger: it bounds how many provider operations may be IN
 * FLIGHT at once, across sessions, while the budget service
 * (src/budgets) bounds how much may be SPENT. A slot here is admission
 * to run, not money; acquiring a slot reserves no budget, and
 * releasing a slot refunds nothing. The two compose at dispatch:
 * reserve budget first (durable, fenced), then acquire capacity,
 * then dispatch; on any failure after admission, release the slot.
 *
 * Fairness (Section 15.7): work is admitted in two classes, 'private'
 * and 'company', mirroring session visibility. A defined minimum
 * share of the total slots (private_reserved_slots) can only ever be
 * taken by private work: company admissions are capped at
 * total_slots - private_reserved_slots no matter how long company
 * work stays busy, so a continuously busy company scope cannot starve
 * private scopes of their minimum share. Private work may use any
 * free slot, including the reserved share.
 *
 * Full means full: when no slot is available for the caller's class,
 * tryAcquire returns a typed CAPACITY_FULL decision. Work is never
 * queued unboundedly inside this service and never silently dropped:
 * the caller sees the refusal, the counts that caused it, and decides
 * (surface it, retry later, or cancel something) with full
 * information. Scheduling and retry policy belong to CWE-027.
 *
 * Cancellation frees capacity immediately: release() and
 * cancelScope() remove slots synchronously, in the same call, not at
 * the next sweep. A slot also carries a TTL aligned with the
 * operation lease (60 seconds, Section 15.8) so a worker that dies
 * without releasing cannot hold capacity forever; heartbeat()
 * renews a live slot, and expired slots are reclaimed lazily on the
 * next admission or explicitly via sweepExpired(). Restart resets
 * capacity to empty, which is correct: no operation of a dead process
 * is still running, and budget durability lives in the budget
 * service, not here.
 */
export type CapacityClass = 'private' | 'company';
export interface CapacityConfig {
    /** Total concurrent operations admitted across all classes. */
    total_slots: number;
    /**
     * Slots only private work may take: the Section 15.7 minimum share
     * company work can never consume. Must leave at least one slot
     * reachable by company work.
     */
    private_reserved_slots: number;
    /** Slot TTL in milliseconds; defaults to the operation lease TTL. */
    slot_ttl_ms?: number;
}
export interface CapacityToken {
    token_id: string;
    operation_key: string;
    work_class: CapacityClass;
    /** Opaque scope identity (for example tenant:company:installation). */
    scope_key: string;
    acquired_at_ms: number;
    expires_at_ms: number;
}
export type CapacityDecision = {
    admitted: true;
    token: CapacityToken;
} | {
    admitted: false;
    code: 'CAPACITY_FULL';
    work_class: CapacityClass;
    /** Slots currently held by the caller's class. */
    class_in_use: number;
    /** The class ceiling that refused this admission. */
    class_limit: number;
    total_in_use: number;
    total_slots: number;
    action: string;
};
export interface CapacityUsage {
    total_in_use: number;
    total_slots: number;
    by_class: Record<CapacityClass, number>;
    class_limits: Record<CapacityClass, number>;
    by_scope: Record<string, number>;
}
/** Default composition values; hosts override through config. */
export declare const DEFAULT_CAPACITY_CONFIG: CapacityConfig;
export declare class RuntimeCapacity {
    private readonly totalSlots;
    private readonly privateReservedSlots;
    private readonly slotTtlMs;
    private readonly nowMs;
    private readonly newTokenId;
    private readonly slots;
    constructor(config?: CapacityConfig, deps?: {
        nowMs?: () => number;
        newTokenId?: () => string;
    });
    /** The admission ceiling for a class (Section 15.7 fairness rule). */
    classLimit(workClass: CapacityClass): number;
    /**
     * Admit one operation, or refuse with a typed CAPACITY_FULL result.
     * Idempotent per operation_key: re-acquiring a live operation
     * returns its existing token instead of consuming a second slot.
     */
    tryAcquire(input: {
        operation_key: string;
        work_class: CapacityClass;
        scope_key: string;
    }): CapacityDecision;
    /** Renew a live slot's TTL (the operation lease heartbeat cadence). */
    heartbeat(tokenId: string): CapacityToken | null;
    /** Free a slot immediately. Returns false when the token is unknown. */
    release(tokenId: string): boolean;
    /**
     * Free every slot held by one scope (session cancellation). The
     * capacity is available to new admissions in the same tick; returns
     * how many slots were freed.
     */
    cancelScope(scopeKey: string): number;
    /** Reclaim slots whose TTL lapsed without a release or heartbeat. */
    sweepExpired(): number;
    /** Current usage, after reclaiming expired slots. */
    usage(): CapacityUsage;
}
