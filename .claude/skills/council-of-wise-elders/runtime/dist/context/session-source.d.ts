/**
 * CWE-022 composition with the CWE-006 scoped store.
 *
 * The store is the source of the session's frozen brief, spec, and
 * trusted scope. Its reads are already envelope-scoped (CWE-006: a read
 * outside the envelope scope resolves to nothing, so "does not exist"
 * and "not yours" are indistinguishable). This helper loads the stored
 * session through the CouncilStore port and hands assembly the exact
 * inputs it needs: the frozen brief, the seat set and mode from the
 * frozen spec, and the session access target for the CWE-007 gate.
 * Authorization still runs inside assembleContext; loading a session
 * record is never itself an authorization decision.
 */
import type { CouncilStore } from '../cli/host-ports.js';
import type { DecisionBrief, SessionSpec } from '../contracts/index.js';
import { type AssembleContextRequest, type ContextAssemblyResult } from './assembly.js';
import { type SessionAccessTarget } from './types.js';
export interface StoredSessionContextInputs {
    readonly spec: SessionSpec;
    readonly brief: DecisionBrief;
    readonly target: SessionAccessTarget;
}
export declare function loadStoredSessionInputs(store: CouncilStore, sessionId: string): Promise<StoredSessionContextInputs | null>;
/**
 * Assemble context for a session held in the scoped store. The
 * request's session and brief fields are filled from the stored record;
 * everything else (principal, operation, route, catalog) comes from the
 * caller. A session the store does not resolve in this envelope fails
 * with CONTEXT_SESSION_UNAVAILABLE, with no distinction between missing
 * and out-of-scope, mirroring the store's own rule.
 */
export declare function assembleStoredSessionContext(store: CouncilStore, request: Omit<AssembleContextRequest, 'session' | 'brief'> & {
    readonly session_id: string;
}): Promise<ContextAssemblyResult>;
