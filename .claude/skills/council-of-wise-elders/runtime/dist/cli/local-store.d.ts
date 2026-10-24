/**
 * Standalone local store (CWE-004 foundation): a SQLite implementation of
 * the CouncilStore port for the standalone adapter (directive Sections
 * 5.3 and 16.1). The database lives in the per-user data directory,
 * never inside the skill folder, so skill updates that replace the
 * folder wholesale cannot sweep client history away.
 *
 * This is the standalone adapter's local schema
 * (`wise-elders.local-store/v1`). The canonical migration set and the
 * full repository layer (event journal, outbox, archival reads) are
 * CWE-005 and CWE-006; nothing here pretends to be them. In managed
 * mode the Command Center adapter supplies its existing database
 * through the same port instead.
 *
 * Rules enforced here: validated cards are unique per logical operation
 * (session, round, seat, input hash); events receive a monotonically
 * increasing per-session sequence inside one short transaction; state
 * writes are compare-and-swap on state_version so a stale worker cannot
 * overwrite a newer record; no provider call ever happens inside these
 * transactions.
 */
import type { CouncilCard, CouncilEvent, JobCheckpoint, SeatId, SessionStateRecord, Verdict } from '../contracts/index.js';
import type { CouncilStore, StoredSession } from './host-ports.js';
export declare const LOCAL_STORE_SCHEMA_VERSION = "wise-elders.local-store/v1";
export declare class LocalSqliteStore implements CouncilStore {
    private readonly db;
    constructor(dataDir: string);
    close(): void;
    private transaction;
    createSession(session: StoredSession): Promise<void>;
    getSession(sessionId: string): Promise<StoredSession | null>;
    updateState(record: SessionStateRecord, expectedVersion: number): Promise<void>;
    saveCard(card: CouncilCard): Promise<void>;
    findCard(sessionId: string, round: number, seatId: SeatId, inputSha256: string): Promise<CouncilCard | null>;
    listCards(sessionId: string): Promise<CouncilCard[]>;
    appendEvent(event: Omit<CouncilEvent, 'sequence'>): Promise<CouncilEvent>;
    listEvents(sessionId: string, afterSequence?: number): Promise<CouncilEvent[]>;
    saveVerdict(verdict: Verdict): Promise<void>;
    getVerdict(sessionId: string): Promise<Verdict | null>;
    saveCheckpoint(checkpoint: JobCheckpoint): Promise<void>;
    getCheckpoint(sessionId: string, phase: string, seatId: SeatId | null, inputSha256: string): Promise<JobCheckpoint | null>;
}
