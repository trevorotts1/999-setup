/**
 * The durable council event journal (CWE-006, directive Sections 16.2
 * and 18).
 *
 * Events are committed before they are displayed, in a strict per-
 * session sequence, and they form a hash chain: every event records
 * the previous event's hash, so a tampered, reordered, or silently
 * dropped event is detectable by re-walking the chain. The journal is
 * the durable record the live stream, replay, and state reconstruction
 * all read from; consumers deduplicate by event ID and sequence
 * (Section 18.2).
 *
 * Journal appends participate in the caller's transaction (the
 * repository's commit unit), so an event and the state, card, and
 * outbox writes it describes commit or roll back together (Section
 * 16.4). Sequence allocation reads the current maximum inside that
 * same transaction, so concurrent writers cannot interleave sequences.
 */
import { type CouncilEventType } from '../contracts/index.js';
import type { AuthorizationEnvelope } from './envelope.js';
import type { CouncilDatabase, SqliteDatabaseHandle } from './sqlite.js';
export interface JournalEventInput {
    event_id: string;
    type: CouncilEventType;
    from_state: string | null;
    to_state: string | null;
    actor_subject: string;
    /** Safe event payload: metadata and references, never raw bodies or secrets. */
    payload: Record<string, unknown>;
    created_at: string;
}
export interface JournalEvent {
    event_id: string;
    type: CouncilEventType;
    sequence: number;
    from_state: string | null;
    to_state: string | null;
    actor_subject: string;
    payload: Record<string, unknown>;
    prev_hash: string;
    event_hash: string;
    created_at: string;
}
export declare class EventJournal {
    private readonly db;
    constructor(db: CouncilDatabase);
    /**
     * Append one event inside the current transaction. Returns the
     * committed event with its allocated sequence and chain hashes.
     */
    append(handle: SqliteDatabaseHandle, envelope: AuthorizationEnvelope, sessionId: string, input: JournalEventInput): JournalEvent;
    /** Events after `afterSequence`, in committed order (replay cursor). */
    list(envelope: AuthorizationEnvelope, sessionId: string, afterSequence?: number): JournalEvent[];
    /** The most recent event of one type, or null. Used for state reconstruction. */
    latestOfType(envelope: AuthorizationEnvelope, sessionId: string, types: CouncilEventType[]): JournalEvent | null;
    /**
     * Re-walk the chain for one session: every sequence increments by
     * one, every prev_hash links to the prior event_hash, and every
     * event_hash recomputes from its stored fields. Any break is
     * reported with the first offending sequence.
     */
    verifyChain(envelope: AuthorizationEnvelope, sessionId: string): {
        ok: boolean;
        checked: number;
        first_bad_sequence: number | null;
    };
}
