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
 *      FIX-013 S5: the sweep surface IS the real `sweepStaleTempAudio`
 *      signature (`{ fs, baseRoot, nowMs? }`) — the real Node-fs adapter
 *      passes directly, never an injected test-only fake. A partial or
 *      failed sweep fails SOFT: it records a bounded degraded status with a
 *      safe retry at the next startup and never blocks the interactive
 *      surface or Claude.
 *   3. Update startup disposition (spec 21). The WS-33 engine OWNS rollback
 *      and runs it BEFORE a failed update starts; this lane receives ONLY
 *      the updater's journaled outcome, validated here. Rollback itself is
 *      never invoked from this lane. An invalid disposition degrades the
 *      startup state and remains the updater's to replace.
 *
 * Failure isolation (spec 20): every leg is total. A failed leg is
 * recorded in `failures`/`degraded` and returned — it never throws into
 * the caller, and no leg ever blocks the interactive surface.
 */

import type {
  FsAdapter,
  Lifecycle,
  PendingQuestion,
  RecoveryEvent,
  StartupOutcome,
  StartupRecoveryResult,
  StartupSweepResult,
  SweepFn,
  UpdaterDisposition,
  UpdaterJournal,
} from "./types.ts";
import { readUpdaterDisposition } from "./disposition.ts";
// NOTE (FIX-013 S1): startup never calls resumeSession immediately after
// constructing a recovery event — the recovered record stays `recovering`
// until the exact handoff is acknowledged.

/** Wall-clock facade — injectable for deterministic tests. */
export interface Clock {
  now(): number;
}

const REAL_CLOCK: Clock = { now: () => Date.now() };

export interface StartupRecoveryOptions {
  /** WS-03 lifecycle surface (recoverPendingQuestion / setPendingQuestion). */
  lifecycle: Lifecycle;
  /** The REAL WS-20 sweep engine — `sweepStaleTempAudio` passes directly. */
  sweep: SweepFn;
  /** Real filesystem adapter handed to the sweep engine (node:fs/promises). */
  fs: FsAdapter;
  /** Platform temp root (os.tmpdir() / %LOCALAPPDATA%\Temp). */
  tempRoot: string;
  /** Session id of the session being recovered, when known. */
  sessionId?: string;
  /**
   * FIX-013 S5: the production runner already discovered there is nothing to
   * recover (no pending record in the real store). When true and no session
   * id is bound, the recovery leg is neutral (question:none, no failure) —
   * a clean restart must not be a named failure. Direct callers keep the
   * strict contract: an unbound session with no explicit discovery is a
   * named `recovery:no-session-id` failure.
   */
  recoveryOptional?: boolean;
  /** Updater journal surface; a disposition is validated (never executed). */
  updaterJournal?: UpdaterJournal;
  /** The updater component whose install disposition gates startup. */
  updaterComponent?: string;
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
 * the only IO is what the injected lifecycle/sweep/journal do. Deterministic
 * when the clock is injected. Every failure is named in the result; partial
 * cleanup degrades (soft-fail, bounded) and never blocks the caller.
 */
export async function runStartupRecovery(options: StartupRecoveryOptions): Promise<StartupOutcome> {
  const lifecycle = options.lifecycle;
  const sessionId = options.sessionId ?? null;
  const clock = options.clock ?? REAL_CLOCK;
  const onEvent = options.onEvent ?? noopEvent;

  const failures: string[] = [];
  let degraded: StartupOutcome["degraded"] = null;
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
  // handoff.
  if (sessionId == null) {
    if (options.recoveryOptional !== true) {
      failures.push("recovery:no-session-id");
    } else {
      onEvent({ type: "question:none" });
    }
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

  // ---- Leg 2: startup temp sweep (spec 8 step 6, FIX-013 S5). ----
  // The REAL WS-20 engine signature — `{ fs, baseRoot, nowMs? }` — is the
  // contract; the production caller passes `sweepStaleTempAudio` with the
  // real Node-fs adapter directly. A partial/failed sweep fails SOFT: it is
  // a named failure AND a bounded degraded status with a safe retry at the
  // next startup — it never blocks the interactive surface or Claude.
  let sweep: StartupSweepResult;
  try {
    const raw = await options.sweep({ fs: options.fs, baseRoot: options.tempRoot, nowMs: clock.now() });
    sweep = {
      scanned: raw.scanned ?? 0,
      removed: raw.removed ?? 0,
      kept: raw.kept ?? 0,
      failed: raw.failed ?? 0,
    };
    if (sweep.failed > 0) {
      failures.push("sweep:partial-failure");
      degraded = { reason: "sweep-partial", detail: `${sweep.failed} stale dir(s) could not be removed`, retryAtStartup: true };
      onEvent({ type: "sweep:failure" });
    } else {
      onEvent({ type: "sweep:done" });
    }
  } catch (err) {
    sweep = { scanned: 0, removed: 0, kept: 0, failed: 1 };
    failures.push("sweep:threw");
    degraded = { reason: "sweep-failed", detail: err instanceof Error ? err.message : String(err), retryAtStartup: true };
    onEvent({ type: "sweep:failure", code: err instanceof Error ? err.message : String(err) });
  }

  // ---- Leg 3: update startup disposition (spec 21, FIX-013 S5). ----
  // The WS-33 engine runs rollback BEFORE a failed update starts; startup
  // never executes rollback itself. This leg validates the updater's own
  // journaled outcome. When a journal is configured and invalid, startup
  // degrades (bounded) and the updater replaces it later — the leg never
  // invents a rollback decision and never blocks Claude. When NO journal
  // is configured (this build has no updater wiring), the leg is neutral:
  // a clean companion startup must not fail for lack of a journal.
  let disposition: UpdaterDisposition | null = null;
  if (options.updaterJournal && options.updaterComponent) {
    disposition = readUpdaterDisposition(options.updaterJournal, options.updaterComponent);
    if (disposition.valid) {
      onEvent({ type: "disposition:valid" });
    } else if (disposition.invalidReason === "updater-journal:missing") {
      // A never-run updater is a neutral fact: nothing to validate, no
      // degradation — a clean companion startup must not fail for it.
    } else {
      failures.push(`disposition:invalid:${disposition.invalidReason ?? "unknown"}`);
      degraded = {
        reason: "disposition-invalid",
        detail: disposition.invalidReason ?? "unknown",
        retryAtStartup: true,
      };
      onEvent({ type: "disposition:invalid", code: disposition.invalidReason ?? "invalid" });
    }
  }

  onEvent({ type: "startup:complete" });

  return {
    recovery,
    sweep,
    failures,
    ok: failures.length === 0,
    degraded,
  };
}
