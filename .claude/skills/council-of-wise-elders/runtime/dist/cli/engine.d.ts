/**
 * Deliberation engine (CWE-004 foundation).
 *
 * Runs a council session end to end against the injected host ports and
 * the CWE-003 canonical contracts: frozen brief in, validated cards,
 * deterministic crux extraction, a code-composed draft resolution,
 * ratification, deterministic scoring (contracts scoring module; the
 * chair's prose never changes arithmetic, Section 14.4), and a
 * validated verdict out.
 *
 * Scope honesty: the production round protocol depth is CWE-024
 * (openings) and CWE-025 (challenge, draft resolution, ratification),
 * verdict validation depth is CWE-026, and the durable worker lifecycle
 * that carries this engine across processes is CWE-027. This foundation
 * engine executes the same state machine and contracts in-process for
 * the standalone adapter and for isolated tests, with the same budget,
 * lease, cancellation, and idempotency rules, so those units compose a
 * proven core instead of a sketch.
 *
 * Hard rules held here:
 * - No provider request is admitted without a resolved run grant
 *   (CWE-049's service issues grants; without one, start refuses with
 *   RUN_AUTHORIZATION_REQUIRED and nothing is dispatched).
 * - Every request is reserved in the budget ledger before dispatch and
 *   counted toward the 50-request session ceiling whatever its kind.
 * - A card is committed only while its operation lease is current and
 *   the session's cancellation generation has not moved; late results
 *   are fenced out, never published.
 * - The operation lease is renewed at the Section 15.8 heartbeat
 *   cadence for the duration of an in-flight operation (RP-046-3,
 *   DEFECT-046-B Cause 1), by the claiming holder only, mirroring the
 *   CWE-027 runner's dispatch heartbeat. Renewal never renews a grant
 *   or resets a retry counter, and the commit-time fence check is
 *   unchanged: a holder that genuinely loses fencing still cannot
 *   commit.
 * - Every composed request carries the canonical card contract (the
 *   exact card_kind for the purpose, a JSON-only instruction, and the
 *   JSON Schema generated from the enforced zod definition), and
 *   response text is parsed by locating the card JSON object inside
 *   it (RP-046-3, DEFECT-046-B Cause 2). Validation itself is never
 *   weakened: an out-of-enum card_kind still fails and flows to the
 *   one permitted repair.
 * - The contract is also stated in prose, per call (RP-046-4,
 *   DEFECT-046-C; cli/card-contract.ts): the single exact card_kind,
 *   the complete required-field list, the opaque-ID format rule, the
 *   challenge IDs issued for this call (an empty issuance in Round 1,
 *   where challenges_answered must be an empty array), and the
 *   due_at format with a concrete example. Two enforced rules live
 *   only in zod refinements and never reach the JSON Schema the
 *   model sees, so before this repair they were conveyed nowhere.
 *   The one permitted repair restates the full contract beside the
 *   validator's verbatim failures (Section 15.5), instead of
 *   forwarding the error strings alone.
 * - Completed operations are never redone: a stored card for the same
 *   logical operation (session, round, seat, input hash) is reused on
 *   resume instead of spending again (Section 15.3).
 * - Raw provider bodies are memory-only (Section 16.6): only validated
 *   cards, safe receipts, and hashes are persisted.
 * - A missing seat is a visible BLOCKED partial result, never a
 *   silently completed smaller council (Section 10).
 */
import { type CouncilEvent, type CouncilSettings, type DecisionBrief, type ScopeFields, type SeatId, type SessionSpec, type Verdict } from '../contracts/index.js';
import type { CouncilHost, StoredSession } from './host-ports.js';
/** Section 7 owned questions, used as seat focus in prompt assembly. */
export declare const SEAT_FOCUS: Record<SeatId, string>;
/**
 * The Section 14.2 opening-round system text. CWE-050 consolidation:
 * this is the SINGLE source for the round system texts; the protocol
 * executors (opening, challenge, ratification, consult) import these
 * constants instead of carrying their own copies.
 */
export declare const OPENING_SYSTEM: string;
export declare const CHALLENGE_SYSTEM: string;
export declare const RATIFICATION_SYSTEM: string;
export declare const CONSULT_SYSTEM: string;
/**
 * Scheduling port for the operation-lease heartbeat, mirroring the
 * CWE-027 runner's RunnerTimers discipline: the port only schedules
 * callbacks, and tests inject a manual implementation to advance the
 * cadence deterministically. Production uses real timers.
 */
export interface EngineTimers {
    every(ms: number, fn: () => void): () => void;
}
export declare class CouncilEngine {
    private readonly host;
    private readonly settings;
    private readonly ownerId;
    private readonly heartbeatMs;
    private readonly timers;
    constructor(host: CouncilHost, options?: {
        settings?: CouncilSettings;
        ownerId?: string;
        /** Lease heartbeat cadence. Default: Section 15.8 (15 seconds). */
        heartbeatMs?: number;
        /** Scheduling seam for the heartbeat. Default: real timers. */
        timers?: EngineTimers;
    });
    createSession(input: {
        spec: SessionSpec;
        brief: DecisionBrief;
        scope: ScopeFields;
        sample?: boolean;
    }): Promise<StoredSession>;
    getSession(sessionId: string): Promise<StoredSession>;
    listEvents(sessionId: string, afterSequence?: number): Promise<CouncilEvent[]>;
    /** Replay is a read of committed events only; it spends nothing. */
    replaySession(sessionId: string): Promise<CouncilEvent[]>;
    getVerdict(sessionId: string): Promise<Verdict | null>;
    startSession(sessionId: string, grantRef: string): Promise<StoredSession>;
    resumeSession(sessionId: string, grantRef: string): Promise<StoredSession>;
    pauseSession(sessionId: string): Promise<StoredSession>;
    cancelSession(sessionId: string): Promise<StoredSession>;
    private admit;
    private emit;
    private transition;
    private block;
    /** True when an external control (pause/cancel) should stop dispatch. */
    private controlStop;
    private runPipeline;
    private operationKey;
    private inputManifestSha;
    /**
     * Renew the claimed operation lease at the heartbeat cadence for
     * the duration of an in-flight operation (RP-046-3, DEFECT-046-B
     * Cause 1; Section 15.8, T156). This is the standalone engine's form
     * of the CWE-027 runner's dispatch heartbeat: the runner renews its
     * durable claim while its executor's provider call is in flight;
     * the engine renews the lease it claimed in runOperation while its
     * transport call is in flight. Before this repair the engine never
     * renewed, so any call longer than the 60 second TTL lost its lease
     * and its completion was discarded at the fence check.
     *
     * Renewal is by the current fencing holder only: the provider's
     * heartbeat compares operation key, owner, and epoch, and refuses a
     * lease that already expired or was taken over, so a stale holder
     * can never resurrect its authority (T052). A refused renewal stops
     * the heartbeat; the loss surfaces at the commit-time fence check
     * exactly as before. Renewal touches only the lease expiry: it
     * never renews a spending grant and never resets a retry or repair
     * counter. Renewal also stops when the session is observed
     * cancelled, and always stops when the operation settles (the
     * caller invokes the returned stop in its finally block).
     */
    private startOperationHeartbeat;
    /**
     * Execute one provider operation with reservation, lease, fencing,
     * bounded repair, and idempotent reuse. Returns the validated author
     * payload, or throws a SeatFailure-shaped CouncilError.
     */
    private runOperation;
    private saveCheckpointStatus;
    private runAdvisorRound;
    private runConsult;
    private runRatification;
    private cardsOfKind;
    /** Deterministic crux extraction from valid Round 1 cards (max 3). */
    private computeCruxes;
    private scoreEntries;
    private composeDraft;
    private quickSkipApplies;
    private buildVerdict;
}
