/**
 * Session controls (CWE-050; directive Sections 15.4, 17.5, 19):
 * pause, resume, cancel, and archive over the accepted stores and
 * services. The control mechanics themselves are CWE-027's
 * (DurableJobRunner.pauseSession / resumeSession / cancelSession:
 * idempotent at the target state, precise legal-state conflicts,
 * cancellation generation fencing, budget and capacity release). This
 * service adds the protocol surface around them:
 *
 * - Expected-version checks (T058's portable half): a caller holding
 *   a stale state version gets a precise conflict naming both
 *   versions BEFORE anything moves, so a stale writer can never
 *   overwrite a newer transition.
 * - Idempotency keys (T078): a control call may carry a request key.
 *   The first claim wins; a replay with the same payload returns the
 *   recorded outcome without re-executing; the same key with a
 *   different payload is a conflict and changes nothing. Claims ride
 *   CWE-006's council_request_keys via repositories.claimRequestKey.
 * - Repeated controls are idempotent (T055): pausing a paused session
 *   and cancelling a cancelled session return the current record;
 *   resuming a session that is not paused or blocked is a precise
 *   legal-state conflict, never a silent no-op success.
 *
 * Archive is a visibility flag, not a state change (CWE-006
 * setArchived); archived sessions stay readable to their scope.
 */
import type { SessionStateRecord } from '../contracts/index.js';
import type { AuthorizationEnvelope } from '../persistence/envelope.js';
import type { CouncilRepositories } from '../persistence/repositories.js';
import type { DurableJobRunner } from '../queue/runner.js';
export type SessionControlAction = 'pause' | 'resume' | 'cancel';
export interface SessionControlRequest {
    action: SessionControlAction;
    /** Caller's view of the state version; stale values conflict (T058). */
    expected_version?: number;
    /** Idempotency key for this control call (T078). */
    request_key?: string;
}
export interface SessionControlResult {
    action: SessionControlAction;
    session_id: string;
    record: SessionStateRecord;
    /** True when the idempotency key replayed a recorded outcome. */
    replayed: boolean;
}
export declare class SessionControlsService {
    private readonly deps;
    constructor(deps: {
        repositories: CouncilRepositories;
        runner: DurableJobRunner;
    });
    control(envelope: AuthorizationEnvelope, sessionId: string, request: SessionControlRequest): SessionControlResult;
    pause(envelope: AuthorizationEnvelope, sessionId: string, options?: Omit<SessionControlRequest, 'action'>): SessionControlResult;
    resume(envelope: AuthorizationEnvelope, sessionId: string, options?: Omit<SessionControlRequest, 'action'>): SessionControlResult;
    cancel(envelope: AuthorizationEnvelope, sessionId: string, options?: Omit<SessionControlRequest, 'action'>): SessionControlResult;
    /** Archive or unarchive: a visibility flag, never a state change. */
    setArchived(envelope: AuthorizationEnvelope, sessionId: string, archived: boolean): void;
}
