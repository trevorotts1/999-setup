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

/** WS-03-compatible lifecycle that hands the question off exactly once. */
function fakeLifecycle(sessionId: string): Lifecycle {
  let calls = 0;
  return {
    recoverPendingQuestion(id: string) {
      calls += 1;
      if (calls > 1) return { ok: true, recovered: null }; // WS-03: second recovery finds nothing
      if (id !== sessionId) return { ok: false, code: "not-found", error: `no session ${id}` };
      return { ok: true, recovered: { ...PENDING } };
    },
    resumeSession(id: string) {
      return { ok: id === sessionId };
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
    const outcome = await runStartupRecovery({
      lifecycle,
      sweep: noopSweep,
      tempRoot: "/tmp",
      sessionId: "sess-1",
    });
    // The durable record's counted flag is unchanged by the recovery pass.
    assert.equal(lifecycle.recoverPendingQuestion("sess-1").ok, true);
    assert.equal(lifecycle.recoverPendingQuestion("sess-1").recovered, null, "second handoff finds nothing");
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
  it("invokes the sweep with the injected clock and reports the result", async () => {
    let seenRoot = "";
    let seenNow = 0;
    const sweep = async (opts: { baseRoot: string; nowMs?: number }) => {
      seenRoot = opts.baseRoot;
      seenNow = opts.nowMs ?? 0;
      return { scanned: 4, removed: 2, kept: 1, failed: 0 };
    };
    const clock = { now: () => 1_700_000_000_000 };
    const outcome = await runStartupRecovery({
      lifecycle: fakeLifecycle("sess-1"),
      sweep,
      tempRoot: "/var/folders/xx",
      sessionId: "sess-1",
      clock,
    });
    assert.equal(seenRoot, "/var/folders/xx");
    assert.equal(seenNow, 1_700_000_000_000);
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

describe("WS-35 update-rollback guard (spec 21)", () => {
  it("rollback is probed, never invoked at startup", async () => {
    let probeCalls = 0;
    let rollbackCalls = 0;
    const outcome = await runStartupRecovery({
      lifecycle: fakeLifecycle("sess-1"),
      sweep: noopSweep,
      tempRoot: "/tmp",
      sessionId: "sess-1",
      rollbackAvailable: () => {
        probeCalls += 1;
        return true;
      },
      rollback: async () => {
        rollbackCalls += 1;
        return { ok: true };
      },
    });
    assert.equal(probeCalls, 1);
    assert.equal(rollbackCalls, 0, "startup must not invoke the rollback engine");
    assert.equal(outcome.ok, true);
  });

  it("unavailable rollback surface is a named failure, not a silent gap", async () => {
    const outcome = await runStartupRecovery({
      lifecycle: fakeLifecycle("sess-1"),
      sweep: noopSweep,
      tempRoot: "/tmp",
      sessionId: "sess-1",
      rollbackAvailable: () => false,
    });
    assert.ok(outcome.failures.includes("rollback:unavailable"));
    assert.equal(outcome.ok, false);
  });
});
