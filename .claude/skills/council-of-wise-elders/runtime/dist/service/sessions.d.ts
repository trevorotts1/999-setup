/**
 * Session authority resolution (WER-021).
 *
 * One authority per session. A managed session is LINKED to its owning
 * Command Center URL and is never started locally; a standalone session
 * lives on this service's verified origin. A managed record without a
 * valid owner URL is BLOCKED — never silently converted into a local
 * session.
 */
import { type SessionAuthorityRecord, type SessionTarget } from './types.js';
/** Canonical local session path; the shared CC UI route is /council/<id>. */
export declare function sessionPath(sessionId: string): string;
export declare function eventsPath(sessionId: string): string;
/**
 * Build the true local session URL from the ACTUAL bound origin (the
 * origin the listener reported), never from a configured pretty host.
 */
export declare function sessionUrl(origin: string, sessionId: string): string;
export declare function resolveSessionTarget(record: SessionAuthorityRecord, options: {
    origin: string | null;
}): SessionTarget;
export interface BlockedReason {
    code: string;
    detail: string;
    missing_seats: string[];
    /** The round the missing seats belong to (1, 2 or 3); null when no seat is missing. */
    missing_round: number | null;
    last_errors: Array<{
        seat_id: string;
        outcome_code: string | null;
        message: string | null;
    }>;
    /** Provider calls that were reserved but never reported a result. */
    unfinished_calls: Array<{
        operation_id: string;
        outcome: string;
        minutes: number | null;
    }>;
}
/**
 * Why a BLOCKED session is blocked, computed at read time from stored
 * data (spec seats minus accepted cards, failed jobs, journaled attempt
 * failures, provider calls that never answered), so sessions blocked
 * before the journal carried messages explain themselves too. Null when
 * the session is not BLOCKED.
 */
export declare function buildBlockedReason(input: {
    state: string;
    mode: string;
    seat_ids: readonly string[];
    cards: ReadonlyArray<{
        card_kind: string;
        round: number;
        seat_id?: string;
    }>;
    failures: ReadonlyArray<{
        seat_id: string | null;
        outcome_code: string | null;
        phase_job_key?: string;
    }>;
    events: ReadonlyArray<{
        type: string;
        payload: Record<string, unknown>;
        created_at?: string;
        to_state?: string | null;
    }>;
}): BlockedReason | null;
