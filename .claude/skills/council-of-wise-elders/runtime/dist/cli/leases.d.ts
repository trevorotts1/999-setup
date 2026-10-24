/**
 * Operation leases (CWE-004 foundation; production worker lifecycle
 * owned by CWE-027; durable wiring WER-010).
 *
 * `DurableOperationLeaseProvider` is the CLI host's lease provider. A
 * claim raises the session's journaled `lease_epoch` with a
 * compare-and-swap write through CWE-006's repository layer, which is
 * exactly the fencing generation CWE-028's budget service reads before
 * it reserves, settles, releases, or renews. The generation therefore
 * lives in the durable store, never in a process-local variable: a
 * stale holder presenting an older epoch is fenced out of every
 * spending commit even if it kept its lease object.
 *
 * `InProcessLeaseProvider` remains the foundation form for sessions
 * the durable authorization store does not hold (CWE-004 synthetic
 * fixtures); the durable provider routes to it only when the session is
 * absent from that store.
 *
 * In-process operation leases (CWE-004 foundation; production worker
 * lifecycle owned by CWE-027). Implements the council operation lease of
 * directive Section 15.8, which is deliberately separate from the host
 * scheduler's observed 90-second job lease:
 *
 * - TTL 60 seconds, heartbeat every 15 seconds while the owner is alive.
 * - Every claim raises a monotonically increasing fencing epoch for the
 *   operation key; only the current epoch may commit.
 * - Losing a lease (expiry or a newer claim) fences out late results:
 *   a stale worker can never publish or release money twice.
 * - Lease renewal never renews a spending grant or resets retry
 *   counters; those live in the budget ledger and the grant service.
 */
import type { Clock } from '../contracts/index.js';
import type { AuthorizationEnvelope } from '../persistence/envelope.js';
import type { CouncilRepositories } from '../persistence/repositories.js';
import type { CapacityLeaseProvider, OperationLease } from './host-ports.js';
export declare const OPERATION_LEASE_TTL_MS = 60000;
export declare const OPERATION_LEASE_HEARTBEAT_MS = 15000;
export declare class InProcessLeaseProvider implements CapacityLeaseProvider {
    private readonly leases;
    private readonly now;
    constructor(now?: () => number);
    claim(operation_key: string, owner_id: string, ttl_ms?: number): OperationLease;
    private current;
    heartbeat(lease: OperationLease): OperationLease;
    assertCurrent(lease: OperationLease): void;
    release(lease: OperationLease): void;
}
export interface DurableLeaseProviderOptions {
    repositories: CouncilRepositories;
    envelope: AuthorizationEnvelope;
    clock: Clock;
    /**
     * Resolve the session an operation key belongs to. The engine's keys
     * are scope-qualified and include the session id; a host supplies its
     * own derivation here rather than having the lease layer guess.
     */
    sessionIdForOperation(operationKey: string): string | null;
    nowMs?: () => number;
    ttlMs?: number;
    /**
     * Foundation provider for synthetic sessions the durable
     * authorization store never mirrored. Never used for a durable
     * session record.
     */
    fallback?: CapacityLeaseProvider;
}
/**
 * Durable operation lease provider (Section 15.8).
 *
 * Claiming writes the next fencing generation into the session's
 * journaled state record (compare-and-swap), so the generation is
 * durable and is the SAME value CWE-028's budget service fences on.
 * Renewal rewrites the journaled state record (same generation, new
 * expiry) and never touches spending grants or retry counters.
 *
 * A holder that lost its lease — a newer claim, expiry, or a restart —
 * is refused by `assertCurrent`, and every budget finalization it
 * attempts is independently refused by the service's epoch fence.
 */
export declare class DurableOperationLeaseProvider implements CapacityLeaseProvider {
    private readonly held;
    private readonly repositories;
    private readonly envelope;
    private readonly clock;
    private readonly sessionIdForOperation;
    private readonly nowMs;
    private readonly ttlMs;
    private readonly fallback?;
    constructor(options: DurableLeaseProviderOptions);
    /** The session's current DURABLE generation, or null when unmirrored. */
    currentEpoch(sessionId: string): number | null;
    claim(operation_key: string, owner_id: string, ttl_ms?: number): OperationLease;
    private current;
    private heldSession;
    heartbeat(lease: OperationLease): OperationLease;
    assertCurrent(lease: OperationLease): void;
    release(lease: OperationLease): void;
}
