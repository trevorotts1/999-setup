import { assembleContext, } from './assembly.js';
import { ContextError } from './types.js';
export async function loadStoredSessionInputs(store, sessionId) {
    const session = await store.getSession(sessionId);
    if (session === null)
        return null;
    return {
        spec: session.spec,
        brief: session.brief,
        target: { scope: session.scope, visibility: session.spec.visibility },
    };
}
/**
 * Assemble context for a session held in the scoped store. The
 * request's session and brief fields are filled from the stored record;
 * everything else (principal, operation, route, catalog) comes from the
 * caller. A session the store does not resolve in this envelope fails
 * with CONTEXT_SESSION_UNAVAILABLE, with no distinction between missing
 * and out-of-scope, mirroring the store's own rule.
 */
export async function assembleStoredSessionContext(store, request) {
    const loaded = await loadStoredSessionInputs(store, request.session_id);
    if (loaded === null) {
        throw new ContextError('CONTEXT_SESSION_UNAVAILABLE', 'The session is not available in this scope.');
    }
    return assembleContext({
        ...request,
        brief: loaded.brief,
        session: {
            ...loaded.target,
            session_id: request.session_id,
            mode: loaded.spec.mode,
            seat_ids: loaded.spec.seat_ids,
        },
    });
}
