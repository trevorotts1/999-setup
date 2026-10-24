/**
 * The council projection outbox (CWE-006, directive Sections 16.2 and
 * 18.2).
 *
 * Notifications, task projections, and event fan-out are never sent
 * from inside the commit transaction. Instead the commit records a
 * durable intent in council_projection_outbox in the SAME transaction
 * as the state, card, and event writes it describes; a separate
 * consumer delivers intents afterwards. Delivery is therefore
 * crash-safe (an intent survives the process that committed it) and
 * idempotent: each intent carries a unique idempotency key per topic,
 * enqueueing the same intent twice returns the original row, and a
 * consumer that replays after restart sees delivered intents as
 * delivered, so each semantic event reaches the reducer once even when
 * the transport delivers duplicates.
 */
import type { AuthorizationEnvelope } from './envelope.js';
import type { CouncilDatabase, SqliteDatabaseHandle } from './sqlite.js';
export type OutboxState = 'pending' | 'delivered' | 'failed' | 'dead_letter';
export interface OutboxIntentInput {
    id: string;
    session_id: string | null;
    event_sequence: number | null;
    topic: string;
    idempotency_key: string;
    payload: Record<string, unknown>;
    created_at: string;
}
export interface OutboxIntent {
    id: string;
    session_id: string | null;
    event_sequence: number | null;
    topic: string;
    idempotency_key: string;
    payload: Record<string, unknown>;
    state: OutboxState;
    attempt_count: number;
    next_attempt_at: string | null;
    last_error_code: string | null;
    created_at: string;
    delivered_at: string | null;
}
export declare class ProjectionOutbox {
    private readonly db;
    private readonly maxAttempts;
    constructor(db: CouncilDatabase, maxAttempts: number);
    /**
     * Enqueue one intent inside the current transaction. Idempotent: a
     * replay with the same (scope, topic, idempotency_key) returns the
     * existing intent with `created: false` and records nothing new, so
     * a duplicate commit never duplicates the follow-through intent.
     */
    enqueue(handle: SqliteDatabaseHandle, envelope: AuthorizationEnvelope, input: OutboxIntentInput): {
        intent: OutboxIntent;
        created: boolean;
    };
    /**
     * Claim due intents for delivery: pending, or failed and due for a
     * retry. Claiming only reads; the consumer marks the outcome, so a
     * crash mid-delivery leaves the intent claimable again (at-least-once
     * transport, exactly-once semantics via the idempotency key at the
     * consumer).
     */
    claimDue(envelope: AuthorizationEnvelope, nowIso: string, limit?: number): OutboxIntent[];
    /** Mark one intent delivered. Re-marking a delivered intent is a no-op. */
    markDelivered(envelope: AuthorizationEnvelope, id: string, deliveredAt: string): void;
    /**
     * Record a failed delivery attempt. Below the attempt bound the
     * intent becomes claimable again at `nextAttemptAt`; at the bound it
     * is parked as dead_letter for operator attention, never retried
     * silently forever.
     */
    markFailed(envelope: AuthorizationEnvelope, id: string, errorCode: string, nextAttemptAt: string): OutboxIntent | null;
    /** All intents for one session, in creation order (operator view). */
    listForSession(envelope: AuthorizationEnvelope, sessionId: string): OutboxIntent[];
}
