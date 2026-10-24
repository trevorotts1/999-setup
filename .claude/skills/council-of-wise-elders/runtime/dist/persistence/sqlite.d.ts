/**
 * SQLite handle and transaction discipline for the council persistence
 * layer (CWE-006, directive Sections 16.3 and 16.4).
 *
 * The portable runtime uses the Node.js built-in SQLite module
 * (node:sqlite), the same access pattern as the CWE-004 local store; no
 * new native dependency is introduced. Command Center supplies its own
 * better-sqlite3 handle through getDb() instead (managed mode); this
 * module serves the standalone store and the repository tests.
 *
 * Transaction law (Section 16.4):
 * - State, card, event, and outbox writes that belong together commit in
 *   ONE short transaction. A failure anywhere rolls back everywhere: a
 *   crash between operations cannot produce a half-committed result.
 * - No provider call, process spawn, render, or notification ever runs
 *   inside these transactions; the transaction callback is synchronous
 *   database work only, and the fence (lease, cancellation generation,
 *   state version) is rechecked inside the transaction immediately
 *   before commit.
 * - Locking uses a BOUNDED busy policy: SQLite's own busy timeout per
 *   attempt plus a bounded number of attempts with backoff. Exhausting
 *   the budget raises PersistenceDeferredError (test T056): the write is
 *   visibly deferred, never silently dropped and never half-applied.
 */
export interface SqliteStatement {
    run(...params: unknown[]): {
        changes: number | bigint;
        lastInsertRowid: number | bigint;
    };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
}
export interface SqliteDatabaseHandle {
    exec(sql: string): void;
    prepare(sql: string): SqliteStatement;
    close(): void;
}
/** True when an error is SQLite reporting a locked database. */
export declare function isBusyError(err: unknown): boolean;
export interface BusyPolicy {
    /** Per-attempt SQLite busy timeout in milliseconds (PRAGMA busy_timeout). */
    busyTimeoutMs: number;
    /** Maximum total attempts for one logical write, including the first. */
    busyMaxAttempts: number;
    /** Base backoff between attempts; doubles each retry, capped at 500 ms. */
    busyBaseDelayMs: number;
}
/**
 * A council database: one handle plus the transaction and busy-policy
 * discipline every repository write goes through. Repositories never
 * touch the raw handle's exec for writes outside `write()`/`read()`.
 */
export declare class CouncilDatabase {
    readonly handle: SqliteDatabaseHandle;
    private readonly busy;
    private txDepth;
    constructor(handle: SqliteDatabaseHandle, busy: BusyPolicy);
    static open(path: string, busy: BusyPolicy): CouncilDatabase;
    /** In-memory database for tests and ephemeral compositions. */
    static openMemory(busy: BusyPolicy): CouncilDatabase;
    close(): void;
    /**
     * Run synchronous read work. Reads still respect the busy policy when
     * the database is momentarily locked by another writer.
     */
    read<T>(fn: (db: SqliteDatabaseHandle) => T): T;
    /**
     * Run one logical write as a single transaction under the bounded busy
     * policy. Nested calls participate in the outer transaction (the
     * journal and outbox join the caller's commit unit); only the outer
     * call opens and closes the transaction. On a busy failure the WHOLE
     * unit is rolled back and retried within the budget, so a retried
     * commit can never duplicate a card, event sequence, or outbox intent
     * that a previous attempt half-applied.
     */
    write<T>(fn: (db: SqliteDatabaseHandle) => T): T;
    private runBounded;
}
