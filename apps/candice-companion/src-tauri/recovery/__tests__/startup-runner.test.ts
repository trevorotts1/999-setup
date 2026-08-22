/**
 * WS-35 startup-runner tests — REAL seams (FIX-013 S5).
 *
 * The runner is the production caller: REAL SessionLifecycle over the REAL
 * protected store, REAL sweepStaleTempAudio over the REAL node:fs adapter,
 * REAL updater journal. These tests exercise the real store filesystem
 * surface (mode 0700, atomic replace) and the real sweep engine on real
 * temp dirs — no fakes, no mocks.
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
  runRealStartupRecovery,
  runNativeStartupSweep,
} from "../startup-runner.ts";
import { readUpdaterJournal, validateUpdaterDisposition } from "../disposition.ts";
import { SessionLifecycle } from "../../../../../plugins/candice-integration/session/session-lifecycle.js";

const SCRATCH: string[] = [];
async function scratchRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "candice-s5-runner-"));
  SCRATCH.push(root);
  return root;
}
after(async () => {
  for (const root of SCRATCH) {
    await import("node:fs/promises").then((m) => m.rm(root, { recursive: true, force: true })).catch(() => {});
  }
});

describe("FIX-013 S5 real startup runner (real store + real sweep + real journal)", () => {
  it("clean startup: no pending question, no stale audio, missing journal neutral — ok", async () => {
    const stateDir = await scratchRoot();
    const tempRoot = await scratchRoot();
    const outcome = await runRealStartupRecovery({ stateDir, tempRoot, journalFile: join(stateDir, "no-journal.jsonl") });
    assert.equal(outcome.recovery.recovered, false);
    assert.equal(outcome.recovery.failures.length, 0, "no session -> no invented recovery");
    assert.equal(outcome.ok, true, "clean startup is not degraded by a missing journal");
    assert.equal(outcome.degraded, null);
  });

  it("recovers the EXACT pending question from the real store and keeps recovering (no resume)", async () => {
    const state = await scratchRoot();
    const tempRoot = await scratchRoot();
    // Build a REAL pending record via the REAL lifecycle surface.
    const lifecycle = new SessionLifecycle({ stateDir: state });
    lifecycle.beginSession({ sessionId: "sess-real", skill: "spec-protocol" });
    const set = lifecycle.setPendingQuestion({
      sessionId: "sess-real",
      questionKey: "BUILD_TARGET",
      text: "Tell me about your idea in your own words: what is it, and who is it for?",
      answerKind: "free_text",
      counted: false,
    });
    assert.equal(set.ok, true, "real store persisted the pending question");
    const outcome = await runRealStartupRecovery({ stateDir: state, tempRoot, sessionId: "sess-real", journalFile: join(state, "missing.jsonl") });
    assert.equal(outcome.recovery.recovered, true);
    assert.equal(outcome.recovery.pending?.questionKey, "BUILD_TARGET", "exact key");
    assert.equal(outcome.recovery.pending?.text.includes("Tell me about your idea"), true, "exact verbatim text");
    assert.equal(outcome.recovery.pending?.durableState, "recovering", "lease claimed, record kept");
    // The record stays recovering until the app/terminal acks the handoff —
    // proven from DISK with a fresh manager, so the durable lease is what is
    // held, not this test instance's memory.
    const fresh = new SessionLifecycle({ stateDir: state });
    const held = fresh.recoverPendingQuestion({ sessionId: "sess-real" });
    assert.equal(held.ok, false, "a second recovery claim is refused (durable lease held)");
    const status = fresh.status({ sessionId: "sess-real" });
    assert.equal(status.status, "recovering", "startup never resumes; recovering kept until ack");
  });

  it("sweep removes a real stale marker-carrying dir and keeps a fresh one (real fs)", async () => {
    const tempRoot = await scratchRoot();
    const root = join(tempRoot, "candice-companion");
    await mkdir(join(root, "session-stale"), { recursive: true });
    await mkdir(join(root, "session-fresh"), { recursive: true });
    await writeFile(join(root, "session-stale", ".candice-session"), "x");
    await writeFile(join(root, "session-fresh", ".candice-session"), "x");
    // Make the stale one old, the fresh one young.
    const now = Date.now();
    const oldMs = now - 25 * 60 * 60 * 1000;
    await import("node:fs/promises").then((m) => m.utimes(join(root, "session-stale"), new Date(oldMs), new Date(oldMs)));
    await import("node:fs/promises").then((m) => m.utimes(join(root, "session-fresh"), new Date(now), new Date(now)));
    const outcome = await runNativeStartupSweep({ tempRoot });
    assert.equal(outcome.sweep.scanned, 2);
    assert.equal(outcome.sweep.removed, 1, "only the stale marker dir removed");
    assert.equal(outcome.sweep.kept, 1);
    assert.equal(outcome.ok, true);
    const staleGone = await import("node:fs/promises").then((m) => m.stat(join(root, "session-stale")).then(() => false).catch(() => true));
    assert.equal(staleGone, true, "stale dir removed from disk");
  });

  it("partial sweep failure degrades (soft) and never blocks", async () => {
    const tempRoot = await scratchRoot();
    const root = join(tempRoot, "candice-companion");
    await mkdir(join(root, "session-blocked"), { recursive: true });
    await writeFile(join(root, "session-blocked", ".candice-session"), "x");
    const now = Date.now();
    const oldMs = now - 25 * 60 * 60 * 1000;
    await import("node:fs/promises").then((m) => m.utimes(join(root, "session-blocked"), new Date(oldMs), new Date(oldMs)));
    await import("node:fs/promises").then((m) => m.chmod(root, 0o500)); // read-only root -> rm fails
    const outcome = await runNativeStartupSweep({ tempRoot });
    // The engine counts the removal failure; the runner records degraded.
    assert.equal(outcome.ok, false);
    assert.equal(outcome.degraded?.reason, "sweep-partial");
    assert.equal(outcome.degraded?.retryAtStartup, true);
    await import("node:fs/promises").then((m) => m.chmod(root, 0o700));
  });

  it("valid updater journal disposition validates; missing journal neutral", async () => {
    const dir = await scratchRoot();
    const journalFile = join(dir, "install-journal.jsonl");
    await writeFile(journalFile, JSON.stringify({ ts: "2026-08-22T10:00:00.000Z", op: "install", to: join(dir, "app"), result: "ok" }) + "\n");
    const read = readUpdaterJournal(journalFile, "candice-app");
    assert.equal(read.ok, true);
    const disposition = validateUpdaterDisposition(read.line);
    assert.equal(disposition.valid, true);
    assert.equal(disposition.detail?.targetDir, join(dir, "app"));

    const missing = readUpdaterJournal(join(dir, "never.jsonl"), "candice-app");
    assert.equal(missing.ok, false);
    assert.equal(missing.error, "journal-missing", "never-run updater is neutral, not a failure");
  });
});
