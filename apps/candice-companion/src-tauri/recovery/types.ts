/**
 * WS-35 recovery-lane types — crash/restart/recovery/update rollback.
 *
 * Owned lane (manifest 9.2 WR-018 / WS-35):
 *   `apps/candice-companion/src-tauri/recovery/**`
 *
 * Master Spec requirements this lane implements:
 *   - section 20 "Candice crashes mid-question": recover the exact pending
 *     question in Claude; never increment/re-ask incorrectly (no
 *     double-count, no invented progress);
 *   - section 8 step 6: startup cleanup for stale temp audio left by
 *     crashes (the sweep engine lives in the WS-20 lane; this lane owns the
 *     startup orchestration contract that calls it);
 *   - section 21: update rollback on failure (the atomic install/rollback
 *     engine lives in the WS-33 lane; this lane owns the rollback guard
 *     that decides when a failed startup may attempt it).
 *
 * Every type is pure data. No clock, no IO in this file.
 */

/**
 * A pending governed question as persisted by the WS-03 session manager
 * (plugins/candice-integration/session/session-manager.js,
 * `pendingQuestion` record). Recovery must hand back the EXACT text and key
 * — never a re-derived question, never an increment.
 */
export interface PendingQuestion {
  /** Stable question key owned by the skill (contract suite pin). */
  questionKey: string;
  /** Exact governed question text (spec 14) — recovered verbatim. */
  text: string;
  /** Free text or voice transcript answer kind. */
  answerKind: string;
  /** Mirrored accounting flag; recovery never changes it. */
  counted: boolean;
  /** ISO-8601 timestamp of the original ask. */
  askedAt: string;
}

/** The lifecycle surface the recovery lane drives (WS-04 MCP server shape). */
export interface Lifecycle {
  /** Recover the exact pending question for a session; null when none. */
  recoverPendingQuestion(sessionId: string): { ok: boolean; recovered?: PendingQuestion | null; code?: string; error?: string };
  /** Return the session to active after recovery completes. */
  resumeSession(sessionId: string): { ok: boolean; code?: string; error?: string };
  /** Persist a newly pending question (write-through durability, spec 20). */
  setPendingQuestion(args: { sessionId: string; questionKey: string; text: string; answerKind: string; counted: boolean }): { ok: boolean; code?: string; error?: string };
}

/** The WS-20 startup sweep surface (src-tauri/audio/cleanup/sweep.ts). */
export interface SweepFn {
  (options: { baseRoot: string; nowMs?: number }): Promise<{ scanned: number; removed: number; kept: number; failed: number }>;
}

/** The WS-33 rollback surface (scripts/candice-updater/rollback). */
export interface RollbackFn {
  (args: { targetDir: string; backupDir?: string }): Promise<{ ok: boolean; restored?: string; error?: string }>;
}

/**
 * Result of one startup recovery pass. Every field is set — the lane never
 * returns partial results with implied meanings.
 */
export interface StartupRecoveryResult {
  /** True when a pending question was found and handed off exactly once. */
  recovered: boolean;
  /** The exact pending question (null when `recovered` is false). */
  pending: PendingQuestion | null;
  /** Session the question belonged to (null when nothing recovered). */
  sessionId: string | null;
  /**
   * Failure reasons from each startup leg. Empty on a clean pass; each
   * entry names the leg — never swallowed.
   */
  failures: string[];
  /** True when the WS-08 `recovering` status was raised for the session. */
  markedRecovering: boolean;
  /** True when the question was previously counted (mirrored, never changed). */
  counted: boolean;
}

/** Result of one startup temp sweep invocation. */
export interface StartupSweepResult {
  scanned: number;
  removed: number;
  kept: number;
  failed: number;
}

/** Outcome of the combined startup sequence. */
export interface StartupOutcome {
  recovery: StartupRecoveryResult;
  sweep: StartupSweepResult;
  /** Failure reasons from EVERY leg (recovery, sweep, rollback guard). */
  failures: string[];
  /** True when every leg completed without a failure. */
  ok: boolean;
}

/**
 * The recovery machine's step event — one event per transition, mirroring
 * the WS-08 state-machine discipline: state only moves when an event fired.
 */
export interface RecoveryEvent {
  readonly type:
    | 'startup:begin'
    | 'question:found'
    | 'question:none'
    | 'recovering:entered'
    | 'question:handoff'
    | 'handoff:failure'
    | 'sweep:done'
    | 'sweep:failure'
    | 'rollback:attempted'
    | 'rollback:not-needed'
    | 'startup:complete';
  /** Optional machine-readable failure code (present on failure events). */
  readonly code?: string;
}
