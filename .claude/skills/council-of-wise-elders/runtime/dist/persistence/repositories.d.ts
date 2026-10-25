/**
 * Scoped council repositories (CWE-006, directive Sections 15, 16, 18;
 * unit CWE-006 build steps 1, 2, and 4).
 *
 * This is the repository layer over the canonical council_* schema
 * (CWE-005, persistence/migrations). Every method takes an
 * AuthorizationEnvelope and enforces tenant/company scope before
 * loading or writing content (Section 16.2: never rely on globally
 * unique UUIDs as authorization; composite scope is enforced here in
 * checked repository methods and structurally by the schema's
 * composite foreign keys).
 *
 * Commit discipline (Section 16.4): session state, validated cards,
 * ordered events, and projection outbox intents that belong together
 * are written in the SAME short transaction, with the caller's fence
 * (state version, cancellation generation, lease epoch) rechecked
 * inside the transaction immediately before commit. A crash or fault
 * between the operations rolls the whole unit back: no half-committed
 * accepted result. A duplicate commit of the same logical operation
 * returns the original outcome and duplicates nothing.
 *
 * Mapping notes (canonical contracts to the CWE-005 columnar schema):
 * - SessionSpec JSON and the full SessionStateRecord are carried in
 *   the journal (the session_created and state-change event payloads),
 *   which is the durable record Section 18 defines; the sessions row
 *   columns stay the authoritative index for state, state_version,
 *   brief_revision, and the archive flag, and reconstruction
 *   cross-checks the journal record against them.
 * - council_brief_revisions carries intake-owned columns
 *   (decision_type, stakes, reversibility, success criteria) that the
 *   CWE-003 brief contract does not define; the caller supplies them
 *   via BriefRevisionProfile (CWE-023 owns their semantics) and the
 *   defaults below record "not_recorded" honestly rather than
 *   inventing values.
 * - council_verdicts.label is NOT NULL in the CWE-005 schema while a
 *   consult result carries no label in the contract (Section 11.5:
 *   never invent scores or labels for consults). Consult verdict rows
 *   therefore store the contract JSON verbatim and the placeholder
 *   label INSUFFICIENT_EVIDENCE in the column only; consumers must
 *   read result_kind from the JSON. Flagged for the coordinator as a
 *   schema-mapping gap for CWE-005.
 */
import { type Clock, type CouncilCard, type CouncilEventType, type DecisionBrief, type IdSource, type SessionMode, type SessionState, type SessionStateRecord, type Verdict } from '../contracts/index.js';
import type { StoredSession } from '../cli/host-ports.js';
import { type AuthorizationEnvelope } from './envelope.js';
import { EventJournal, type JournalEvent } from './journal.js';
import { ProjectionOutbox, type OutboxIntent, type OutboxIntentInput } from './outbox.js';
import type { CouncilDatabase } from './sqlite.js';
import type { CouncilPersistenceConfig } from './config.js';
export declare const DELETION_TOMBSTONE_SOURCE = "council-persistence";
export declare const DELETION_TOMBSTONE_OPERATION = "session_deleted";
/**
 * ponytail: council_sessions.mode has a SQL CHECK (0001-council-schema.sql)
 * that lists only the four old modes, and the column is never read back —
 * the spec is rebuilt from the session_created journal event and the state
 * record carries the real mode. So the row column stores a CHECK-satisfying
 * alias only; spec, state and events keep the real mode. Upgrade: widen the
 * CHECK in a later migration and delete this map.
 */
export declare function sessionRowMode(mode: SessionMode): SessionMode;
export interface SessionRow {
    id: string;
    tenant_id: string;
    company_id: string;
    installation_id: string;
    owner_subject: string | null;
    created_by_subject: string;
    archived: number;
    mode: string;
    visibility: string;
    state: string;
    state_version: number;
    brief_revision: number;
    brief_hash: string;
    cancellation_generation: number;
    selected_seats_json: string;
    created_at: string;
    updated_at: string;
}
/** Intake-owned brief columns the CWE-003 brief contract does not carry. */
export interface BriefRevisionProfile {
    decision_type?: string;
    stakes?: string;
    reversibility?: string;
    success_criteria?: unknown[];
}
export interface EvidenceRecordInput {
    id: string;
    source_kind: 'owner_statement' | 'company_data' | 'customer_data' | 'external_reference' | 'generated_summary';
    attachment_ref: string | null;
    summary: unknown | null;
    content_hash: string;
    attribution: 'source_principle' | 'blackceo_adaptation';
    claim: string;
    strength: 'low' | 'medium' | 'high';
    verification: 'pending' | 'valid' | 'invalid';
}
export interface CommitFence {
    expected_state_version: number;
    cancel_generation: number;
    lease_epoch: number;
}
export interface AcceptCardResult {
    outcome: 'committed' | 'duplicate';
    event: JournalEvent | null;
    card: CouncilCard;
}
export interface SaveVerdictResult {
    outcome: 'committed' | 'duplicate';
    event: JournalEvent | null;
}
export declare class CouncilRepositories {
    private readonly db;
    private readonly deps;
    readonly journal: EventJournal;
    readonly outbox: ProjectionOutbox;
    constructor(db: CouncilDatabase, deps: {
        clock: Clock;
        ids: IdSource;
        config: CouncilPersistenceConfig;
    });
    /** True when an explicit deletion tombstone exists for this session. */
    isDeleted(tenantId: string, sessionId: string): boolean;
    private assertNotDeleted;
    private sessionRow;
    /**
     * Create a session, its first brief revision, and its session_created
     * journal event in one transaction. The envelope scope must match the
     * session scope exactly; a deleted session ID stays retired.
     */
    createSession(envelope: AuthorizationEnvelope, session: StoredSession, profile?: BriefRevisionProfile): StoredSession;
    private insertSessionRow;
    private insertBriefRevisionRow;
    /**
     * Load a session for the envelope. Returns null when the session does
     * not exist in this scope or is not visible to the envelope actor
     * (private sessions answer only to their owner); the two cases are
     * indistinguishable by design. Works for archived sessions (archival
     * reads) exactly as for live ones.
     */
    getSession(envelope: AuthorizationEnvelope, sessionId: string): StoredSession | null;
    private reconstruct;
    /** Sessions in scope for the envelope actor, newest first. */
    listSessions(envelope: AuthorizationEnvelope, options?: {
        includeArchived?: boolean;
        state?: SessionState;
    }): StoredSession[];
    /**
     * Save a new brief revision: insert the immutable revision row, move
     * the session's current-revision pointer, and journal the change in
     * one transaction. Revisions are strictly sequential; a skipped or
     * replayed revision number is a conflict, never an overwrite.
     */
    saveBriefRevision(envelope: AuthorizationEnvelope, brief: DecisionBrief, profile?: BriefRevisionProfile): void;
    /**
     * Write a state record with compare-and-swap on state_version. Used
     * directly by the CouncilStore port adapter (the engine validates
     * transition legality) and by transitionState below.
     */
    writeStateRecord(envelope: AuthorizationEnvelope, record: SessionStateRecord, expectedVersion: number, event: {
        type: CouncilEventType;
        payload: Record<string, unknown>;
    }): void;
    /**
     * A legal, fenced state transition: legality comes from the canonical
     * transition table (CWE-003 assertTransition, including the
     * cancel-generation rule), persistence is compare-and-swap, and the
     * journal event commits in the same transaction.
     */
    transitionState(envelope: AuthorizationEnvelope, sessionId: string, to: SessionState, expectedVersion: number, options?: {
        resumePhase?: SessionState | null;
    }): SessionStateRecord;
    /** Set or clear the archive visibility flag (never a state change). */
    setArchived(envelope: AuthorizationEnvelope, sessionId: string, archived: boolean): void;
    /**
     * THE atomic accepted-work commit (Sections 15.2 and 16.4): fence
     * recheck, card insert, journal event, and projection outbox intent
     * in one short transaction. No network call, render, or notification
     * happens inside it. A duplicate commit of the same logical
     * operation returns the original card and writes nothing; the same
     * operation with different content is a conflict.
     */
    acceptCard(envelope: AuthorizationEnvelope, card: CouncilCard, fence: CommitFence): AcceptCardResult;
    /** All validated cards for a session, in commit order. */
    listCards(envelope: AuthorizationEnvelope, sessionId: string): CouncilCard[];
    findCard(envelope: AuthorizationEnvelope, sessionId: string, round: number, seatId: string, inputSha256: string): CouncilCard | null;
    /**
     * Persist a validated verdict revision with its journal event and
     * outbox intent in one transaction. Duplicate saves of the identical
     * revision return the original outcome; a different verdict under
     * the same revision is a conflict (verdicts are immutable,
     * Section 16.2).
     */
    saveVerdict(envelope: AuthorizationEnvelope, verdict: Verdict): SaveVerdictResult;
    /** The latest committed verdict for a session, or null. */
    getVerdict(envelope: AuthorizationEnvelope, sessionId: string): Verdict | null;
    /**
     * Record one authorized case-evidence item (Section 16.2: references
     * and hashes, never secrets). The frozen evidence manifest itself
     * lives in the brief; these rows are the scoped evidence records a
     * session accumulates.
     */
    addEvidenceRecord(envelope: AuthorizationEnvelope, sessionId: string, record: EvidenceRecordInput): void;
    listEvidenceRecords(envelope: AuthorizationEnvelope, sessionId: string): Array<Record<string, unknown>>;
    /**
     * API idempotency (Section 17): the first claim records the payload
     * fingerprint and wins; a replay with the same fingerprint returns
     * the recorded claim; a replay with a DIFFERENT fingerprint is a
     * conflict and records nothing (the host maps it to HTTP 409).
     */
    /**
     * Commit one projection-outbox intent outside a caller transaction
     * (W74-A session-close marker). Idempotent per (scope, topic,
     * idempotency_key): a replay returns the existing intent and writes
     * nothing.
     */
    enqueueOutboxIntent(envelope: AuthorizationEnvelope, input: OutboxIntentInput): {
        intent: OutboxIntent;
        created: boolean;
    };
    claimRequestKey(input: {
        tenantId: string;
        source: string;
        operation: string;
        requestKey: string;
        payloadFingerprint: string;
        sessionId: string | null;
    }): {
        outcome: 'claimed' | 'replay' | 'conflict';
        payloadFingerprint: string;
    };
    /**
     * Explicit authorized deletion (Section 16.5). In one transaction:
     * record the minimal non-content tombstone, collect the session's
     * diagnostic payload references, and delete the session row (the
     * schema's composite foreign keys cascade to every child table:
     * briefs, evidence, cards, verdicts, events, jobs, attempts,
     * reservations, proposals, approvals, previews, diagnostic rows,
     * task links, outcome reviews, and outbox intents). The caller
     * deletes the returned protected payload files after commit; reads
     * are blocked by the tombstone and the missing rows even if a file
     * sweep is delayed, and late writes fail with SESSION_DELETED, so a
     * deleted session is never reconstituted by a delayed event or a
     * stale worker. Backup copies follow the host's retention policy;
     * this method makes no claim of immediate physical erasure from
     * historical backups.
     */
    deleteSession(envelope: AuthorizationEnvelope, sessionId: string): {
        deleted: true;
        diagnosticProtectedRefs: string[];
    };
}
