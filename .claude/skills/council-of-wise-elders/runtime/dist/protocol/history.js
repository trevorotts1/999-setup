/**
 * Session history (CWE-050; directive Sections 17.5, 18, 19): the
 * read side of the council. Lists and detail over the accepted
 * CWE-006 store: session summaries, one session's full record (spec,
 * frozen brief, state, committed cards, verdict), and the session's
 * hash-chained event journal in committed order.
 *
 * Read discipline (T076's portable half): history reads NEVER create
 * inference, jobs, or tasks. Every read is scope-checked through the
 * repositories (an out-of-scope session is indistinguishable from a
 * missing one), and event reads verify session visibility before the
 * journal is touched.
 */
import { ProtocolError } from './errors.js';
export class SessionHistoryService {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    listSessions(envelope, options = {}) {
        return this.deps.repositories
            .listSessions(envelope, options)
            .map((session) => ({
            session_id: session.spec.session_id,
            mode: session.spec.mode,
            visibility: session.spec.visibility,
            state: session.state.state,
            state_version: session.state.state_version,
            brief_revision: session.state.brief_revision,
            seat_count: session.spec.seat_ids.length,
            archived: session.state.archived,
            updated_at: session.state.updated_at,
        }));
    }
    getSession(envelope, sessionId) {
        const session = this.deps.repositories.getSession(envelope, sessionId);
        if (!session) {
            throw new ProtocolError('SESSION_NOT_FOUND', `Session ${sessionId} was not found.`, {
                session_id: sessionId,
            });
        }
        return {
            session,
            cards: this.deps.repositories.listCards(envelope, sessionId),
            verdict: this.deps.repositories.getVerdict(envelope, sessionId),
        };
    }
    /**
     * The session's event journal after a sequence cursor (replay
     * order). Visibility is verified through the repositories before
     * any journal row is read.
     */
    listEvents(envelope, sessionId, afterSequence = 0) {
        const session = this.deps.repositories.getSession(envelope, sessionId);
        if (!session) {
            throw new ProtocolError('SESSION_NOT_FOUND', `Session ${sessionId} was not found.`, {
                session_id: sessionId,
            });
        }
        return this.deps.repositories.journal.list(envelope, sessionId, afterSequence);
    }
}
