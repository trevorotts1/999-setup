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
 *
 * FIX-013 S1: every durable operation carries its operation identity
 * `(sessionId, questionKey, operationId)` plus bounded timestamps. The
 * lifecycle recovery lease never deletes this record: `durableState` moves
 * to `recovering` with a `leaseId`/`leaseHeldUntil`, and only an
 * acknowledged handoff may complete the record.
 */
export type PendingDurableState = "displaying" | "displayed" | "fallback-pending" | "recovering";

export interface PendingQuestion {
  /** Stable question key owned by the skill (contract suite pin). */
  questionKey: string;
  /** One operation identity: derived from (sessionId, questionKey). */
  operationId: string;
  /** Durable lifecycle state of this one operation (FIX-013). */
  durableState: PendingDurableState;
  /** Exact governed question text (spec 14) — recovered verbatim. */
  text: string;
  /** Free text or voice transcript answer kind. */
  answerKind: string;
  /** Mirrored accounting flag; recovery never changes it. */
  counted: boolean;
  /** ISO-8601 timestamp of the original ask (bounded). */
  askedAt: string;
  /** ISO-8601 delivery time (null until delivery persisted). */
  deliveredAt: string | null;
  /** ISO-8601 app acknowledgement time (null until acknowledged). */
  acknowledgedAt: string | null;
  /** Recovery lease id; null while no lease is claimed. */
  leaseId: string | null;
  /** ISO-8601 lease horizon; a lease is always bounded. */
  leaseHeldUntil: string | null;
}

/**
 * The lifecycle surface the recovery lane drives (WS-03 session manager
 * shape). FIX-013 S1: OBJECT arguments everywhere — the old positional
 * `(sessionId: string)` form is removed; a positional recovery call no longer
 * exists anywhere in the shared contract, so the real SessionManager calls
 * and the lane's fakes cannot drift apart again.
 */
export interface Lifecycle {
  /** Claim a recovery lease on the exact pending question (kept until the
   * acknowledged handoff completes it). Null when nothing is pending. */
  recoverPendingQuestion(args: {
    sessionId: string;
    operationId?: string;
    leaseId?: string;
    now?: number;
  }): { ok: boolean; recovered?: PendingQuestion | null; lease?: { leaseId: string; heldUntil: string } | null; code?: string; error?: string };
  /** Acknowledge the exact recovery handoff; only then does the pending
   * record complete/release (FIX-013 S1). */
  acknowledgeRecoveryHandoff(args: { sessionId: string; operationId?: string; leaseId?: string }): { ok: boolean; state?: string; code?: string; error?: string };
  /** Return the session to active after recovery completes. */
  resumeSession(args: { sessionId: string }): { ok: boolean; code?: string; error?: string };
  /** Persist a newly pending question (write-through durability, spec 20). */
  setPendingQuestion(args: { sessionId: string; questionKey: string; text: string; answerKind: string; counted: boolean; operationId?: string }): { ok: boolean; code?: string; error?: string };
}

/**
 * The WS-20 startup sweep surface (src-tauri/audio/cleanup/sweep.ts).
 * FIX-013 S5: this IS the real `sweepStaleTempAudio` signature — the `fs`
 * adapter is part of the contract (the real Node-fs adapter passes directly,
 * never an injected test-only fake), plus a `policy` overlay. The lane type
 * re-exports the WS-20 result shape unchanged.
 */
import type { SweepResult } from "../audio/cleanup/sweep.ts";
import type { FsAdapter } from "../audio/cleanup/types.ts";

export type { SweepResult } from "../audio/cleanup/sweep.ts";
export type { FsAdapter } from "../audio/cleanup/types.ts";

export interface SweepOptions {
  fs: FsAdapter;
  baseRoot: string;
  nowMs?: number;
}

export interface SweepFn {
  (options: SweepOptions): Promise<SweepResult>;
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

/**
 * Outcome of the combined startup sequence.
 */
export interface StartupOutcome {
  recovery: StartupRecoveryResult;
  sweep: StartupSweepResult;
  /** Failure reasons from EVERY leg (recovery, sweep, rollback guard). */
  failures: string[];
  /** True when every leg completed without a failure. */
  ok: boolean;
  /**
   * FIX-013 S5: bounded degraded status. A partial cleanup (or an invalid
   * updater disposition) never blocks Claude — the caller runs the
   * interactive surface regardless — but the app is degraded: the sweep
   * retries at the next startup and the disposition stays invalid until the
   * updater replaces it. `null` on a clean pass.
   */
  degraded: {
    reason: "sweep-partial" | "sweep-failed" | "disposition-invalid";
    detail: string;
    retryAtStartup: boolean;
  } | null;
}

/**
 * Validated update startup disposition (FIX-013 S5, audit F13-06). The WS-33
 * updater OWNS rollback execution; the companion receives ONLY the updater's
 * own journaled outcome, parsed and validated here. A disposition is valid
 * only when it is an `install` journal line whose terminal result is `ok` —
 * a failed/missing/malformed journal yields an invalid disposition, never a
 * guess. Rollback itself is never invoked from this lane.
 */
export interface UpdaterDisposition {
  /** True only when the updater journal proves a successful install. */
  valid: boolean;
  /** Validated journal facts (empty on an invalid disposition). */
  detail: {
    component: string;
    targetDir: string;
    backupDir: string | null;
    installedAt: string;
  } | null;
  /** Why the disposition is invalid (missing journal, unreadable, malformed,
   * non-ok result, unvalidated target). Absent when `valid`. */
  invalidReason: string | null;
}

/** The updater journal surface the startup sequence reads. */
export interface UpdaterJournal {
  /** Read the newest journal entry for the component; null when absent. */
  readNewest(component: string): { ok: boolean; line?: Record<string, unknown> | null; error?: string };
}
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
    | 'disposition:valid'
    | 'disposition:invalid'
    | 'startup:complete';
  /** Optional machine-readable failure code (present on failure events). */
  readonly code?: string;
}
