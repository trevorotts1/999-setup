/**
 * Session-close protocol (W74-A).
 *
 * A council sitting is one session, and every sitting closes; a
 * sitting never hangs open. The contract, in full:
 *
 * - Five minutes after the last client interaction in an open session,
 *   the council sends ONE soft-close question
 *   (SOFT_CLOSE_QUESTION). One per quiet spell: a client answer is a
 *   new interaction and restarts the five-minute quiet clock.
 * - An explicit close phrase (CLOSE_PHRASES, e.g. "that's all",
 *   "we're done", "finalize") finalizes immediately — no question.
 * - Ten minutes of silence after the soft-close question
 *   auto-finalizes. The session is never left open.
 * - Finalize = mark the session closed in the store, hand the session
 *   record to the artifact renderer's `renderArtifact(sessionRecord)`
 *   (the W74-B entry point, called by export name; returns
 *   `{ path, link }`), and the caller emits the artifact link in the
 *   reply.
 *
 * Bound state (rule 6): at most one active session per client stays
 * ("resolve existing sessions first, never create a duplicate" is
 * unchanged), and the close timers are RESUMABLE: no state lives in
 * memory. Everything is derived from store timestamps — the last
 * journal event on the session and the durable close marker written to
 * the projection outbox — so a service restart continues the same
 * quiet spell and can never send a second soft-close question.
 */
import type { StoredSession } from '../cli/host-ports.js';
import { type RenderSessionRecord } from '../reports/artifact-renderer.js';
import type { AuthorizationEnvelope } from '../persistence/envelope.js';
import type { CouncilRepositories } from '../persistence/repositories.js';
/** The session record at the render seam: the stored session as-is, or the assembled render record. */
export type RenderableSession = StoredSession | RenderSessionRecord;
/** Quiet time after the last client interaction before the soft close. */
export declare const SOFT_CLOSE_IDLE_MS: number;
/** Silence after the soft-close question before auto-finalize. */
export declare const AUTO_FINALIZE_SILENCE_MS: number;
export declare const SOFT_CLOSE_QUESTION = "Is that all, or are we still working?";
/**
 * Explicit close phrases. Matched after normalization (lowercase,
 * apostrophes and punctuation stripped, whitespace collapsed): the
 * message equals one of these, or ends with one as its final clause.
 */
export declare const CLOSE_PHRASES: readonly ["that's all", "that is all", "thats all", "that's it", "that is it", "thats it", "we're done", "we are done", "were done", "we're finished", "we are finished", "finalize", "finalise", "all done", "close it", "close the session", "wrap it up", "wrap up", "that's all for now"];
export declare function normalizeCloseText(text: string): string;
/** True when the message is an explicit close phrase. */
export declare function isClosePhrase(text: string): boolean;
export type CloseReason = 'client_close_phrase' | 'auto_finalize';
/** Durable close state, as derived from the store. */
export interface SessionCloseMarker {
    /** Created-at of the latest soft-close question, or null. */
    soft_close_sent_at: string | null;
    /** Closed-at of the finalize, or null while open. */
    closed_at: string | null;
    close_reason: CloseReason | null;
}
/** The store facts the close state derives from — never timers. */
export interface SessionCloseSnapshot {
    /** Timestamp of the last journal event on the session (the last client interaction). */
    last_event_at: string | null;
    marker: SessionCloseMarker;
}
export type CloseAction = {
    action: 'none';
    due_in_ms: number | null;
} | {
    action: 'send_soft_close';
    question: typeof SOFT_CLOSE_QUESTION;
} | {
    action: 'auto_finalize';
};
/**
 * Pure derivation of the close action from store timestamps. Restart
 * safe by construction: the same snapshot and clock always produce the
 * same action, whatever process reads them.
 */
export declare function deriveCloseAction(snapshot: SessionCloseSnapshot, nowIso: string): CloseAction;
/** The W74-B renderer contract: one call, artifact path plus link. */
export interface ArtifactRenderResult {
    path: string;
    link: string;
}
export type RenderArtifactFn = (sessionRecord: RenderableSession) => ArtifactRenderResult | Promise<ArtifactRenderResult>;
/**
 * Resolve the W74-B renderer entry point BY EXPORT NAME: the first
 * candidate module exporting a function named `renderArtifact` wins.
 * Absent modules are skipped; a module without that export is skipped
 * too, so a partially-landed renderer never breaks finalize.
 */
export declare function resolveRenderArtifact(): Promise<RenderArtifactFn | null>;
/** The durable store surface the close protocol reads and writes. */
export interface SessionClosePort {
    /** Timestamp of the session's last journal event, or null. */
    lastEventAt(sessionId: string): string | null;
    readMarker(sessionId: string): SessionCloseMarker;
    /** Record the soft-close question; idempotent per quiet spell. */
    recordSoftClose(sessionId: string, sentAt: string): void;
    /** Record a client interaction (non-close) as the session's newest event. */
    recordClientInteraction(sessionId: string, at: string): void;
    /** Mark the session closed in the store; idempotent. */
    markClosed(sessionId: string, closedAt: string, reason: CloseReason): void;
    /** The session record finalize hands to renderArtifact: stored session or assembled render record. */
    sessionRecord(sessionId: string): RenderableSession | null;
}
export interface FinalizeResult {
    session_id: string;
    closed: true;
    close_reason: CloseReason;
    artifact: ArtifactRenderResult | null;
    render_error: string | null;
}
export interface TickResult {
    action: CloseAction['action'];
    question?: typeof SOFT_CLOSE_QUESTION;
    finalized?: FinalizeResult;
}
export declare class SessionCloseService {
    private readonly deps;
    constructor(deps: {
        port: SessionClosePort;
        /** W74-B renderer; resolved by export name on first finalize when omitted. */
        renderArtifact?: RenderArtifactFn;
    });
    private snapshot;
    /** Pure read of the derived close state for one session. */
    status(sessionId: string, nowIso: string): CloseAction;
    /**
     * Evaluate one session against the store clock. Sends the ONE
     * soft-close question when the quiet spell is old enough, and
     * auto-finalizes after the ten quiet minutes. Callable at any
     * cadence and after any restart: nothing here is a timer.
     */
    tick(sessionId: string, nowIso: string): Promise<TickResult>;
    /**
     * A client message. An explicit close phrase finalizes NOW;
     * anything else is an interaction that restarts the quiet clock.
     */
    handleClientMessage(sessionId: string, text: string, nowIso: string): Promise<{
        finalized: FinalizeResult | null;
    }>;
    /**
     * Finalize a sitting: mark the session closed in the store, render
     * the counsel artifact through W74-B's `renderArtifact`, and hand
     * back path+link for the reply. Idempotent: an already-closed
     * session is not re-rendered and not re-marked.
     */
    finalize(sessionId: string, reason: CloseReason, nowIso: string): Promise<FinalizeResult>;
}
/**
 * Honest placeholder for the one renderer row the store cannot derive by
 * construction: the store is client-name-free (the repo ships no client
 * names; a client name enters only as runtime data through the door
 * that knows the client). The default store-backed close path renders
 * the sitting the STORE can account for and says exactly this in the
 * header, rather than fabricating a client identity or bypassing the
 * privacy boundary to guess one.
 */
export declare const CLIENT_NAME_UNRECORDED = "Client name not recorded for this sitting";
/**
 * The store-backed close port's half of the close-to-render contract.
 * When the store carries the sitting's own card and verdict rows, this
 * assembles the renderer's record from them (the DEFAULT close path).
 * When it does not — the explicit conveneFlow path runs deliberation
 * live and supplies its own runtime rows — it returns the bare
 * StoredSession so the caller's extras seam assembles the record. It
 * never fabricates takes, a verdict, or a client identity, and never
 * crosses the privacy boundary; a bare record with no extras surfaces
 * the typed `RenderInputError` at the renderer's own trust boundary.
 */
export declare function assembleStoreRenderRecord(repositories: CouncilRepositories, envelope: AuthorizationEnvelope, session: StoredSession): RenderSessionRecord | StoredSession;
/**
 * The close port over the canonical CWE-006 store. The close marker
 * lives in the projection outbox as durable intents (idempotent per
 * quiet spell / per session), and the last interaction timestamp is
 * the newest journal event — so every derivation input is in the store
 * and survives a restart.
 */
export declare function storeSessionClosePort(repositories: CouncilRepositories, envelope: AuthorizationEnvelope, deps: {
    newId: () => string;
}): SessionClosePort;
