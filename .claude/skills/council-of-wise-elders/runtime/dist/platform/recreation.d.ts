/**
 * Restart / container-recreation restore (WER-022).
 *
 * A recreated container gets a NEW process and an EMPTY in-memory view. What
 * must survive is durable state written BEFORE the recreate: the session
 * authority records and the budget reservations. This module reads that
 * handoff and rebuilds the view without ever creating a second copy.
 *
 * The handoff is the OWNING AUTHORITY's record, not a second implementation
 * of the queue or session store: sessions reference their owning URL and
 * reservations reference their operation id, and nothing here re-derives a
 * budget or re-admits work.
 *
 * Guarantees proven by the colocated tests:
 * - a recreated process restores every session and reservation;
 * - restoring twice into the same view adds nothing the second time
 *   (`duplicates_created` is always 0);
 * - a snapshot with duplicate ids is refused, never silently deduplicated;
 * - a stale generation is refused, so a released reservation is never
 *   resurrected over a newer view.
 */
import { HANDOFF_SCHEMA, type PlatformRefusal } from './types.js';
export interface HandoffSession {
    session_id: string;
    authority: 'standalone' | 'managed';
    owning_session_url?: string | null;
}
export interface HandoffReservation {
    reservation_id: string;
    operation_id: string;
    state: 'held' | 'released' | 'unknown';
}
/** The durable document the owning authority leaves for the next process. */
export interface DurableHandoff {
    schema_version: typeof HANDOFF_SCHEMA;
    /** Monotonic; a lower generation must never overwrite a higher view. */
    generation: number;
    sessions: HandoffSession[];
    reservations: HandoffReservation[];
    written_at: string;
}
export interface DurableStateStore {
    read(): string | null | Promise<string | null>;
    write(text: string): void | Promise<void>;
    describe(): string;
}
/**
 * Durable-file store. Writes are atomic (temporary file in the same
 * directory, then rename) so a crash mid-write cannot leave a truncated
 * handoff behind.
 */
export declare function fileStateStore(path: string): DurableStateStore;
/** The in-memory view a service runs against after a recreate. */
export interface RestoredView {
    generation: number | null;
    sessions: Map<string, HandoffSession>;
    reservations: Map<string, HandoffReservation>;
}
export declare function createRestoredView(): RestoredView;
export type RestoreOutcome = {
    kind: 'restored';
    generation: number;
    sessions: number;
    reservations: number;
    added_sessions: number;
    existing_sessions: number;
    added_reservations: number;
    existing_reservations: number;
    /** Always 0: restore never adds an id the view already holds. */
    duplicates_created: 0;
    source: string;
    checked: string[];
} | {
    kind: 'empty';
    generation: null;
    sessions: 0;
    reservations: 0;
    duplicates_created: 0;
    source: string;
    checked: string[];
} | PlatformRefusal;
/**
 * Parse and validate a durable handoff. Total: every malformed shape is a
 * typed refusal naming what was wrong.
 */
export declare function parseHandoff(text: string, checked?: string[]): DurableHandoff | PlatformRefusal;
export interface RestoreOptions {
    store: DurableStateStore;
    view: RestoredView;
    nowUtc?: () => string;
}
/**
 * Restore durable sessions and reservations into a (usually fresh) view.
 *
 * Re-running this against the same view is a no-op for records already
 * present: `added_*` becomes 0 and `existing_*` reports the matched ids, so a
 * double-init bug cannot duplicate a session or a reservation.
 */
export declare function restoreAfterRecreation(options: RestoreOptions): Promise<RestoreOutcome>;
