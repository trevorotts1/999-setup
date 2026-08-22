/**
 * WS-35 startup recovery orchestrator — crash/restart/recovery.
 *
 * Owned lane (manifest 9.2 WR-018 / WS-35):
 *   `apps/candice-companion/src-tauri/recovery/**`
 *
 * Drives the crash-recovery sequence at companion startup, in dependency
 * order (WS-08 state machine, WS-03 session lifecycle, WS-04 MCP server,
 * WS-20 temp sweep, WS-33 rollback engine):
 *
 *   1. Recover the exact pending question (spec 20). The WS-03
 *      `recoverPendingQuestion` handoff returns the question EXACTLY ONCE
 *      (a second recovery finds nothing), so this lane can never re-ask a
 *      question or double-count an answer. The WS-08 state machine raises
 *      `recovering` via its `status` event; the front-end re-raises the
 *      question with `question:recovered`.
 *   2. Sweep stale temp audio (spec 8 step 6) via the WS-20 sweep engine.
 *   3. Update rollback (spec 21) is NOT attempted at startup on this
 *      machine: the WS-33 rollback engine owns that decision and runs
 *      before the new version starts, not after a boot. This lane only
 *      exposes the guard that proves the rollback surface is reachable and
 *      reports the machine-readable reason when it is not.
 *
 * Failure isolation (spec 20): every leg is total. A failed leg is
 * recorded in `failures` and returned — it never throws into the caller.
 */

import type {
  Lifecycle,
  PendingQuestion,
  RecoveryEvent,
  RollbackFn,
  StartupOutcome,
  StartupRecoveryResult,
  StartupSweepResult,
  SweepFn,
} from "./types.ts";
// NOTE (FIX-013 S1): startup no longer calls resumeSession immediately after
// constructing a recovery event — the recovered record stays `recovering`
// until the exact handoff is acknowledged (stage 5 wires the acknowledged
// completion path through Lifecycle.acknowledgeRecoveryHandoff).

/** Wall-clock facade — injectable for deterministic tests. */
export interface Clock {
  now(): number;
}

const REAL_CLOCK: Clock = { now: () => Date.now() };

export interface StartupRecoveryOptions {
  lifecycle: Lifecycle;
  sweep: SweepFn;
  /** Platform temp root (os.tmpdir() / %LOCALAPPDATA%\Temp). */
  tempRoot: string;
  /** Session id of the session being recovered, when known. */
  sessionId?: string;
  /** WS-33 rollback guard probe. */
  rollbackAvailable?: () => boolean;
  /** WS-33 rollback invocation (may be async). */
  rollback?: RollbackFn;
  clock?: Clock;
  /** Event sink; defaults to a no-op collector. */
  onEvent?: (event: RecoveryEvent) => void;
}

export const RECOVERY_VERB = "question:recovered";
export const RECOVERY_STATUS = "recovering";

export function isRecoveryStatus(status: string | undefined): boolean {
  return status === RECOVERY_STATUS;
}

function noopEvent(_event: RecoveryEvent): void {}

/**
 * Run the startup recovery pass. Pure sequencing over injected surfaces —
 * the only IO is what the injected lifecycle/sweep do. Deterministic when
 * the clock is injected. Every failure is named in the result.
 */
export async function runStartupRecovery(options: StartupRecoveryOptions): Promise<StartupOutcome> {
  const lifecycle = options.lifecycle;
  const sessionId = options.sessionId ?? null;
  const clock = options.clock ?? REAL_CLOCK;
  const onEvent = options.onEvent ?? noopEvent;

  const failures: string[] = [];
  let pending: PendingQuestion | null = null;
  let recoveredSessionId: string | null = null;
  let markedRecovering = false;
  let counted = false;

  onEvent({ type: "startup:begin" });

  // ---- Leg 1: exact pending question recovery (spec 20). ----
  // FIX-013 S1: the recovery call is an OBJECT (never positional), and it
  // CLAIMS a lease on the pending record without deleting it. `recovering`
  // is raised durably by the manager. Startup NEVER resumes the session
  // immediately after constructing a recovery event: the record stays
  // `recovering` until the app or terminal fallback acknowledges the exact
  // handoff (stage 5 wires the acknowledged sequence).
  if (sessionId == null) {
    failures.push("recovery:no-session-id");
  } else {
    let result: { ok: boolean; recovered?: PendingQuestion | null; lease?: { leaseId: string; heldUntil: string } | null; code?: string; error?: string };
    try {
      result = lifecycle.recoverPendingQuestion({ sessionId });
    } catch (err) {
      failures.push("recovery:lifecycle-threw");
      result = { ok: false, code: "lifecycle-threw", error: err instanceof Error ? err.message : String(err) };
    }
    if (result.ok && result.recovered) {
      pending = result.recovered;
      recoveredSessionId = sessionId;
      counted = pending.counted === true;
      onEvent({ type: "question:found" });
      // Recover raised `recovering` durably and claimed the lease (FIX-013
      // S1). The pending record is NOT deleted: only an acknowledged
      // handoff may complete/release it.
      markedRecovering = true;
      onEvent({ type: "recovering:entered" });
      onEvent({ type: "question:handoff" });
    } else {
      onEvent({ type: "question:none" });
      if (!result.ok) {
        failures.push(`recovery:${result.code ?? "unavailable"}`);
      }
    }
  }

  const recovery: StartupRecoveryResult = {
    recovered: pending != null,
    pending,
    sessionId: recoveredSessionId,
    failures: failures.slice(),
    markedRecovering,
    counted,
  };

  // ---- Leg 2: startup temp sweep (spec 8 step 6). ----
  let sweep: StartupSweepResult;
  try {
    const raw = await options.sweep({ baseRoot: options.tempRoot, nowMs: clock.now() });
    sweep = {
      scanned: raw.scanned ?? 0,
      removed: raw.removed ?? 0,
      kept: raw.kept ?? 0,
      failed: raw.failed ?? 0,
    };
    if (sweep.failed > 0) {
      failures.push("sweep:partial-failure");
      onEvent({ type: "sweep:failure" });
    } else {
      onEvent({ type: "sweep:done" });
    }
  } catch (err) {
    sweep = { scanned: 0, removed: 0, kept: 0, failed: 1 };
    failures.push("sweep:threw");
    onEvent({ type: "sweep:failure", code: err instanceof Error ? err.message : String(err) });
  }

  // ---- Leg 3: update-rollback availability guard (spec 21). ----
  // The WS-33 engine runs rollback BEFORE a failed update starts; startup
  // never attempts it itself. This leg only proves the interface is wired.
  const probe = options.rollbackAvailable ?? (() => true);
  try {
    const available = probe();
    if (!available) {
      failures.push("rollback:unavailable");
      onEvent({ type: "rollback:not-needed", code: "probe-denied" });
    } else {
      onEvent({ type: "rollback:not-needed" });
    }
  } catch {
    failures.push("rollback:unavailable");
    onEvent({ type: "rollback:not-needed", code: "probe-threw" });
  }

  onEvent({ type: "startup:complete" });

  return {
    recovery,
    sweep,
    failures,
    ok: failures.length === 0,
  };
}
