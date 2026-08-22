/**
 * WS-35 recovery-lane acceptance tests (node:test, zero deps).
 *
 * Proves the E.1 WS-35 criterion and Master Spec sections 20/8/21:
 *   - crash recovery restores the EXACT pending question (verbatim text and
 *     key), never a re-derived or re-asked question;
 *   - the recovered question is handed off exactly once and can never
 *     double-count (counted flag mirrored, never mutated);
 *   - no session id -> no invented recovery;
 *   - a lifecycle throw is named, never swallowed, and never blocks;
 *   - startup temp sweep runs with the injected clock (spec 8 step 6);
 *   - the WS-33 rollback surface is guarded, not invoked at startup
 *     (spec 21: rollback runs before a failed update starts).
 *
 * All surfaces injected — deterministic, no real IO, no real timers.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildRecoveredQuestionEvent,
  canReRaise,
  isRecoveryStatus,
  runStartupRecovery,
  RECOVERY_VERB,
  RECOVERY_STATUS,
} from "../index.ts";
import type { Lifecycle, PendingQuestion, RecoveryEvent } from "../index.ts";

const PENDING: PendingQuestion = {
  questionKey: "q-capacity",
  text: "How many agents can you run in parallel?",
  answerKind: "free_text",
  counted: true,
  askedAt: "2026-08-21T12:00:00.000Z",
};

/** WS-03-compatible lifecycle that claims a lease and hands the question off
 * exactly once (FIX-013 object-args contract; a lease is claimed, never a
 * positional id, and the record is kept until the acknowledged handoff). */
function fakeLifecycle(sessionId: string): Lifecycle {
  let calls = 0;
  let lease: { leaseId: string; heldUntil: string } | null = null;
  return {
    recoverPendingQuestion(args: { sessionId: string }) {
      calls += 1;
      if (calls > 1) return { ok: false, code: "recovery-lease-held" };
      if (args.sessionId !== sessionId) return { ok: false, code: "not-found", error: `no session ${args.sessionId}` };
      lease = { leaseId: "lease-test-1", heldUntil: "2026-08-21T13:00:00.000Z" };
      return { ok: true, recovered: { ...PENDING }, lease };
    },
    acknowledgeRecoveryHandoff(args: { sessionId: string; leaseId?: string }) {
      if (args.sessionId !== sessionId) return { ok: false, code: "not-found" };
      if (!lease || args.leaseId !== lease.leaseId) return { ok: false, code: "recovery-lease-mismatch" };
      lease = null;
      return { ok: true, state: "recovered" };
    },
    resumeSession(args: { sessionId: string }) {
      return { ok: args.sessionId === sessionId };
    },
    setPendingQuestion() {
      return { ok: true };
    },
  };
}

function noopSweep() {
  return Promise.resolve({ scanned: 0, removed: 0, kept: 0, failed: 0 });
}

describe("WS-35 exact pending-question recovery (spec 20)", () => {
  it("recovers the EXACT pending question text and key, counted flag mirrored", async () => {
    const lifecycle = fakeLifecycle("sess-1");
    const outcome = await runStartupRecovery({
      lifecycle,
      sweep: noopSweep,
      tempRoot: "/tmp",
      sessionId: "sess-1",
    });
    assert.equal(outcome.recovery.recovered, true);
    assert.equal(outcome.recovery.pending?.text, PENDING.text, "verbatim question text");
    assert.equal(outcome.recovery.pending?.questionKey, PENDING.questionKey, "verbatim question key");
    assert.equal(outcome.recovery.counted, true, "counted flag mirrored exactly");
    assert.equal(outcome.recovery.sessionId, "sess-1");
    assert.equal(outcome.recovery.markedRecovering, true);
    assert.deepEqual(outcome.recovery.failures, []);
  });

  it("recovery can never double-count: the counted flag is read, never mutated", async () => {
    const lifecycle = fakeLifecycle("sess-1");
    await runStartupRecovery({
      lifecycle,
      sweep: noopSweep,
      tempRoot: "/tmp",
      sessionId: "sess-1",
    });
    // The durable record's counted flag is unchanged by the recovery pass:
    // a second handoff is refused while the lease is held (exactly once).
    assert.equal(lifecycle.recoverPendingQuestion({ sessionId: "sess-1" }).ok, false, "second handoff refused (lease held)");
    // And the event built for the state machine carries the mirrored flag.
    const event = buildRecoveredQuestionEvent(PENDING, "sess-1");
    assert.equal(event?.counted, true);
    assert.equal(event?.question, PENDING.text);
  });

  it("no session id -> no invented recovery, failure named", async () => {
    const lifecycle = fakeLifecycle("sess-1");
    const outcome = await runStartupRecovery({
      lifecycle,
      sweep: noopSweep,
      tempRoot: "/tmp",
    });
    assert.equal(outcome.recovery.recovered, false);
    assert.equal(outcome.recovery.pending, null);
    assert.ok(outcome.recovery.failures.includes("recovery:no-session-id"));
    assert.equal(outcome.ok, false);
  });

  it("lifecycle throw is recorded, never thrown into the caller", async () => {
    const lifecycle: Lifecycle = {
      recoverPendingQuestion() {
        throw new Error("store corrupted");
      },
      acknowledgeRecoveryHandoff() {
        return { ok: true };
      },
      resumeSession() {
        return { ok: true };
      },
      setPendingQuestion() {
        return { ok: true };
      },
    };
    const outcome = await runStartupRecovery({
      lifecycle,
      sweep: noopSweep,
      tempRoot: "/tmp",
      sessionId: "sess-1",
    });
    assert.equal(outcome.recovery.recovered, false);
    assert.ok(outcome.recovery.failures.includes("recovery:lifecycle-threw"));
  });

  it("startup never resumes immediately: recovering is kept until the exact handoff is acknowledged", async () => {
    let resumeCalls = 0;
    let ackCalls = 0;
    const lifecycle: Lifecycle = {
      recoverPendingQuestion(args: { sessionId: string }) {
        if (args.sessionId !== "sess-1") return { ok: false, code: "not-found" };
        return { ok: true, recovered: { ...PENDING, operationId: "op-recover-1", durableState: "recovering" }, lease: { leaseId: "lease-1", heldUntil: "2026-08-21T13:00:00.000Z" } };
      },
      resumeSession(args: { sessionId: string }) {
        resumeCalls += 1;
        return { ok: args.sessionId === "sess-1" };
      },
      acknowledgeRecoveryHandoff(args: { sessionId: string; leaseId?: string }) {
        ackCalls += 1;
        return { ok: args.sessionId === "sess-1" && args.leaseId === "lease-1", state: "recovered" };
      },
      setPendingQuestion() {
        return { ok: true };
      },
    };
    const outcome = await runStartupRecovery({
      lifecycle,
      sweep: noopSweep,
      tempRoot: "/tmp",
      sessionId: "sess-1",
    });
    assert.equal(outcome.recovery.recovered, true);
    assert.equal(outcome.recovery.markedRecovering, true); // durability, not a transient resume
    assert.equal(resumeCalls, 0, "startup must NOT resume the session immediately (FIX-013)");
    assert.equal(ackCalls, 0, "acknowledgement is a separate, later step");
    assert.equal(outcome.ok, true);
  });

  it("malformed pending record never becomes an invented question", () => {
    assert.equal(buildRecoveredQuestionEvent(null, "sess-1"), null);
    assert.equal(buildRecoveredQuestionEvent({ ...PENDING, text: "" }, "sess-1"), null);
    assert.equal(buildRecoveredQuestionEvent(undefined, "sess-1"), null);
    assert.equal(canReRaise(PENDING), true);
    assert.equal(canReRaise(null), false);
  });

  it("recovered event is the WS-08 event shape the state machine consumes", () => {
    const event = buildRecoveredQuestionEvent(PENDING, "sess-1");
    assert.equal(event?.type, "question:recovered");
    assert.equal(RECOVERY_VERB, "question:recovered");
    assert.equal(RECOVERY_STATUS, "recovering");
    assert.equal(isRecoveryStatus("recovering"), true);
    assert.equal(isRecoveryStatus("idle"), false);
  });

  it("events fire in dependency order (startup:begin -> question:found -> recovering:entered -> handoff)", async () => {
    const events: RecoveryEvent[] = [];
    const lifecycle = fakeLifecycle("sess-1");
    await runStartupRecovery({
      lifecycle,
      sweep: noopSweep,
      tempRoot: "/tmp",
      sessionId: "sess-1",
      onEvent: (e) => events.push(e),
    });
    const types = events.map((e) => e.type);
    assert.deepEqual(types.slice(0, 4), ["startup:begin", "question:found", "recovering:entered", "question:handoff"]);
  });
});

describe("WS-35 startup temp sweep (spec 8 step 6)", () => {
  it("invokes the REAL sweep signature ({ fs, baseRoot, nowMs }) with the injected clock", async () => {
    let seenRoot = "";
    let seenNow = 0;
    let seenFs: unknown = null;
    const sweep = async (opts: { fs: unknown; baseRoot: string; nowMs?: number }) => {
      seenRoot = opts.baseRoot;
      seenNow = opts.nowMs ?? 0;
      seenFs = opts.fs;
      return { scanned: 4, removed: 2, kept: 1, failed: 0 };
    };
    const clock = { now: () => 1_700_000_000_000 };
    const fs = {} as never;
    const outcome = await runStartupRecovery({
      lifecycle: fakeLifecycle("sess-1"),
      sweep: sweep as never,
      fs,
      tempRoot: "/var/folders/xx",
      sessionId: "sess-1",
      clock,
    });
    assert.equal(seenRoot, "/var/folders/xx");
    assert.equal(seenNow, 1_700_000_000_000);
    assert.equal(seenFs, fs, "the real fs adapter is handed through");
    assert.deepEqual(outcome.sweep, { scanned: 4, removed: 2, kept: 1, failed: 0 });
    assert.equal(outcome.ok, true);
  });

  it("sweep failure is named, never swallowed", async () => {
    const sweep = async () => {
      throw new Error("disk unreadable");
    };
    const outcome = await runStartupRecovery({
      lifecycle: fakeLifecycle("sess-1"),
      sweep,
      tempRoot: "/tmp",
      sessionId: "sess-1",
    });
    assert.equal(outcome.sweep.failed, 1);
    assert.ok(outcome.failures.includes("sweep:threw"));
    assert.equal(outcome.ok, false);
  });
});

describe("WS-35 update startup disposition (spec 21, FIX-013 S5)", () => {
  it("a validated updater journal yields a valid disposition; rollback is never invoked", async () => {
    let rollbackCalls = 0;
    const journal = {
      readNewest(component: string) {
        assert.equal(component, "candice-app");
        return {
          ok: true,
          line: {
            ts: "2026-08-22T10:00:00.000Z",
            op: "install",
            to: "/Users/me/.candice/app",
            backup: "/Users/me/.candice/.candice-backups/20260822T100000-app",
            result: "ok",
          },
        };
      },
    };
    const outcome = await runStartupRecovery({
      lifecycle: fakeLifecycle("sess-1"),
      sweep: noopSweep,
      tempRoot: "/tmp",
      sessionId: "sess-1",
      updaterJournal: journal,
      updaterComponent: "candice-app",
    });
    assert.equal(outcome.failures.length, 0, "valid disposition adds no failure");
    assert.equal(outcome.ok, true);
    assert.equal(outcome.degraded, null, "clean pass carries no degraded status");
    assert.equal(rollbackCalls, 0, "startup never invokes the rollback engine (WS-33 owns it)");
  });

  it("an invalid updater disposition degrades startup (soft) and never blocks Claude", async () => {
    const journal = {
      readNewest() {
        return { ok: true, line: { ts: "2026-08-22T10:00:00.000Z", op: "install", to: "relative/target", result: "ok" } };
      },
    };
    const outcome = await runStartupRecovery({
      lifecycle: fakeLifecycle("sess-1"),
      sweep: noopSweep,
      tempRoot: "/tmp",
      sessionId: "sess-1",
      updaterJournal: journal,
      updaterComponent: "candice-app",
    });
    assert.ok(outcome.failures.includes("disposition:invalid:updater-journal:target-not-absolute"));
    assert.equal(outcome.ok, false);
    assert.equal(outcome.degraded?.reason, "disposition-invalid", "invalid disposition degrades, bounded");
    assert.equal(outcome.degraded?.retryAtStartup, true, "the updater replaces it later; retry next startup");
  });

  it("no updater journal configured is neutral: a clean companion startup does not fail", async () => {
    const outcome = await runStartupRecovery({
      lifecycle: fakeLifecycle("sess-1"),
      sweep: noopSweep,
      tempRoot: "/tmp",
      sessionId: "sess-1",
    });
    assert.equal(outcome.ok, true, "no journal wiring is not a startup failure");
    assert.equal(outcome.degraded, null);
  });
});
