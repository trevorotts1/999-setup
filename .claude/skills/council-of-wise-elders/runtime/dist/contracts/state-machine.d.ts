/**
 * Canonical session state machine (directive Sections 15.1 and 11.7).
 *
 * There are no unrestricted transitions by string assignment: every state
 * change goes through this table, carries an expected state_version
 * (optimistic concurrency), and names its actor. Mode paths differ: the
 * consult branch runs PREPARING -> CONSULTING -> VERIFYING -> COMPLETED and
 * never enters the round states; quick mode reaches ROUND_3 only when the
 * Section 10 skip predicate fails (the caller records which path was taken;
 * the table permits the DRAFT_RESOLUTION -> VERIFYING quick exit and the
 * DRAFT_RESOLUTION -> ROUND_3 full path).
 *
 * COMPLETED is immutable: no outgoing transitions. Archive is a separate
 * visibility flag on the record, never a state.
 */
import { type SessionMode, type SessionState } from './enums.js';
export type TransitionActor = 'owner' | 'system' | 'worker' | 'chair';
export declare function allowedTransitions(mode: SessionMode, from: SessionState): SessionState[];
export declare function canTransition(mode: SessionMode, from: SessionState, to: SessionState, resumePhase?: SessionState | null): boolean;
export interface TransitionRequest {
    mode: SessionMode;
    from: SessionState;
    to: SessionState;
    /** The record's current state_version; the transition consumes exactly it. */
    expectedVersion: number;
    currentVersion: number;
    actor: TransitionActor;
    resumePhase?: SessionState | null;
    /** Required when entering CANCEL_REQUESTED: bumps cancel_generation. */
    cancelGeneration?: number;
    currentCancelGeneration?: number;
}
/**
 * Validate a transition and return the next state_version. Throws a typed
 * ContractError (ILLEGAL_TRANSITION or VERSION_MISMATCH) on any violation.
 */
export declare function assertTransition(req: TransitionRequest): {
    stateVersion: number;
};
