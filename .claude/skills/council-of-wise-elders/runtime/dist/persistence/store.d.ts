/**
 * The composed council store (CWE-006, directive Sections 15, 16, 18).
 *
 * CouncilStoreService is the standalone composition of the CWE-006
 * persistence layer: it opens the council database in the data
 * directory, applies the canonical CWE-005 schema (additive, IF NOT
 * EXISTS, safe to re-apply on every open), enforces the recorded
 * state-authority profile, and wires the scoped repositories, the
 * event journal, the projection outbox, the job/checkpoint
 * repository, and the single diagnostic sink behind one object. It
 * also implements the CWE-004 CouncilStore host port, so the portable
 * engine can run on the full canonical schema instead of the
 * foundation's minimal local store.
 *
 * Authority law (Sections 4.5 and 16.1): the mode recorded in the
 * installation profile governs. This composition IS the standalone
 * authority; when the recorded or requested mode is 'managed', the
 * Command Center adapter owns the store and this composition refuses
 * to open rather than silently becoming a second, divergent
 * authority.
 *
 * Restart behavior (Section 16.5): opening an existing database
 * re-reads the profile, re-applies the additive schema, and serves
 * sessions, journal chains, byte counters, and outbox intents exactly
 * as they were committed; nothing is rebuilt from volatile state.
 */
import { type Clock, type CouncilCard, type CouncilEvent, type IdSource, type JobCheckpoint, type SeatId, type SessionStateRecord, type Verdict } from '../contracts/index.js';
import type { CouncilStore, StoredSession } from '../cli/host-ports.js';
import { type CouncilPersistenceConfig } from './config.js';
import { DiagnosticSink, type DiagnosticRedactor } from './diagnostics.js';
import { type AuthorizationEnvelope } from './envelope.js';
import { CouncilJobs } from './jobs.js';
import { type CouncilInstallationProfile } from './profile.js';
import { CouncilRepositories } from './repositories.js';
export interface OpenCouncilStoreOptions {
    /** Council data directory; resolved via cli/paths when omitted. */
    dataDir?: string;
    /** Database file path; defaults to <dataDir>/council.db. */
    databasePath?: string;
    /** Persistence configuration input; parsed against the locked surface. */
    config?: unknown;
    clock: Clock;
    ids: IdSource;
    /**
     * The host-resolved service envelope (CWE-007 owns principal
     * resolution). Port calls act under this envelope's scope and actor.
     */
    envelope: AuthorizationEnvelope;
    /** Managed-mode authority locator (reference only, never a credential). */
    authorityRef?: string | null;
    /** Optional stronger diagnostic redactor; defaults to the built-in one. */
    redact?: DiagnosticRedactor;
}
export declare class CouncilStoreService implements CouncilStore {
    readonly config: CouncilPersistenceConfig;
    readonly profile: CouncilInstallationProfile;
    readonly dataDir: string;
    readonly repositories: CouncilRepositories;
    readonly jobs: CouncilJobs;
    readonly diagnostics: DiagnosticSink;
    private readonly db;
    private readonly envelope;
    private readonly clock;
    private constructor();
    static open(options: OpenCouncilStoreOptions): CouncilStoreService;
    close(): void;
    /** Verify every session journal chain in the service scope (restart audit). */
    verifyAllChains(): Array<{
        session_id: string;
        ok: boolean;
        checked: number;
    }>;
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
