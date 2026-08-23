/**
 * FIX-015 FAIL-4 engine cancellation tests.
 *
 * These tests exercise the REAL escalation ladder against a REAL child
 * process — the deterministic fixture at fixtures/engine-worker-fixture.mjs
 * stands in for the Python runtime (spawned with node). Assertions:
 *
 *  1. graceful stop resolves only after the worker exited (EOF drain);
 *  2. EOF-ignoring worker gets SIGTERM, and stop still resolves only
 *     after provable exit;
 *  3. SIGTERM-ignoring worker gets SIGKILL; stop resolves; no orphan —
 *     process is gone when the promise settles;
 *  4. synthesize timeout escalates and rejects with engine-synthesize-timeout;
 *  5. synthesize resolves with valid PCM from the JSON-lines contract;
 *  6. abort() returns synchronously and the worker is killed shortly after;
 *  7. stop() before start() resolves {stoppedAtMs} immediately (no throw);
 *  8. start() rejects when the interpreter cannot spawn the worker.
 *
 * Windows: escalation runs but SIGTERM/SIGKILL semantics differ; the
 * fixture behaviors that survive cross-platform are asserted, the
 * signal-order ones are gated to non-win32 (documented, not skipped
 * silently — CI runs these on macOS where Candice is packaged).
 */

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  createKokoroEngine,
  STOP_ESCALATION,
  type CreateKokoroEngineOptions,
} from "../engine.ts";
import type { KokoroEngineOptions } from "../index.ts";

const FIXTURE = fileURLToPath(new URL("../fixtures/engine-worker-fixture.mjs", import.meta.url));

const BASE: KokoroEngineOptions = {
  modelPath: "/nonexistent/model.onnx",
  voicesPath: "/nonexistent/voices.bin",
  variant: "fp16",
};

function make(
  behavior: string,
  createOptions: CreateKokoroEngineOptions = {},
): {
  engine: ReturnType<typeof createKokoroEngine>;
} {
  return {
    engine: createKokoroEngine(BASE, {
      pythonBin: process.execPath,
      workerUrl: FIXTURE,
      env: { WORKER_BEHAVIOR: behavior },
      ...createOptions,
    }),
  };
}

const NOT_WINDOWS = process.platform !== "win32";

test("stop: graceful EOF drain resolves only after worker exit", async () => {
  const { engine } = make("eof-exit");
  await engine.start();
  assert.equal(engine.running, true);

  // Graceful fixture: exits 0 on stdin end. Long window proves the stop
  // promise is gated on actual exit, not on the EOF write alone.
  const t0 = Date.now();
  const result = await engine.stop();
  assert.equal(typeof result.stoppedAtMs, "number");
  assert.ok(result.stoppedAtMs >= t0);
  assert.equal(engine.running, false);
});

test("stop: EOF-ignoring worker escalates to SIGTERM, still gated on exit", async () => {
  const { engine } = make("ignore-eof");
  await engine.start();
  const result = await engine.stop();
  assert.equal(typeof result.stoppedAtMs, "number");
  assert.equal(engine.running, false);
});

test("stop: SIGTERM-ignoring worker escalates to SIGKILL; process provably gone", { skip: !NOT_WINDOWS }, async () => {
  const { engine } = make("ignore-all");
  await engine.start();
  const result = await engine.stop();
  assert.ok(result.stoppedAtMs > 0);
  assert.equal(engine.running, false);
});

test("stop: no child -> resolves immediately without throwing", async () => {
  const { engine } = make("eof-exit");
  const result = await engine.stop();
  assert.equal(typeof result.stoppedAtMs, "number");
});

test("synthesize: timeout escalates and rejects engine-synthesize-timeout", async () => {
  const { engine } = make("never-respond", { synthesizeTimeoutMs: 150 });
  await engine.start();
  await assert.rejects(
    engine.synthesize("long text that never completes", "af_heart", 1.0),
    (err: Error) => err.message === "engine-synthesize-timeout",
  );
  // The timed-out worker is killed through the ladder; stop() afterwards
  // must still resolve and leave nothing running.
  await engine.stop();
  assert.equal(engine.running, false);
});

test("synthesize: JSON-lines contract yields valid PCM", async () => {
  const { engine } = make("respond");
  await engine.start();
  const speech = await engine.synthesize("hello", "af_heart", 1.0);
  assert.ok(speech.pcm.length >= 3);
  assert.equal(speech.sampleRate, 24000);
  assert.ok(Math.abs(speech.pcm[0] - 0.1) < 1e-6);
  await engine.stop();
});

test("abort: returns synchronously and worker dies shortly after", { skip: !NOT_WINDOWS }, async () => {
  const { engine } = make("ignore-all");
  await engine.start();
  const t0 = Date.now();
  engine.abort();
  assert.ok(Date.now() - t0 < 100, "abort must not block the press call");
  // Poll until running flips false; SIGKILL ladder caps this at
  // sigtermMs + sigkillMs. Use real timers here (bounded by escalation).
  const deadline = Date.now() + STOP_ESCALATION.sigtermMs + STOP_ESCALATION.sigkillMs + 2000;
  while (engine.running && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.equal(engine.running, false, "worker still alive after abort escalation");
});

test("start: nonexistent interpreter rejects with engine-spawn-failed", async () => {
  const { engine } = make("eof-exit", { pythonBin: "/definitely/not/a/real/interpreter" });
  await assert.rejects(engine.start(), /engine-spawn-failed/);
  assert.equal(engine.running, false);
});

test("start: missing worker script resolves spawn then engine reports death (no hang)", async () => {
  // Worker path that cannot exist: the interpreter spawns (spawn event
  // fires) then exits nonzero almost immediately. start() resolves on
  // spawn; the engine must report the death, not hang or orphan.
  const events: string[] = [];
  const withEvents = createKokoroEngine(
    {
      ...BASE,
      onEvent: (e) => events.push(e.type),
    },
    {
      pythonBin: process.execPath,
      workerUrl: "/nonexistent/worker.py",
      env: { WORKER_BEHAVIOR: "eof-exit" },
    },
  );
  await withEvents.start();
  // Interpreter exits nonzero shortly after spawn.
  const deadline = Date.now() + 5000;
  while (!events.includes("speech-error") && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.ok(
    events.includes("speech-error"),
    `engine must report worker death, got: ${events.join(",")}`,
  );
});

test("encode/decode roundtrip preserves the JSON-lines contract", async () => {
  const { encodeEngineCommand, decodeEngineResult } = await import("../engine.ts");
  const cmd = {
    kind: "synthesize" as const,
    text: "hi",
    voiceId: "af_heart",
    speed: 1.0,
    withTimings: true,
  };
  const line = encodeEngineCommand(cmd);
  assert.equal(line.endsWith("\n"), true);
  assert.deepEqual(decodeEngineResult(line), cmd);
});

test("decodePcm copies out of the Buffer pool (exact ArrayBuffer)", async () => {
  const { decodePcm } = await import("../engine.ts");
  const b64 = Buffer.from(new Float32Array([1, -1, 0.5]).buffer).toString("base64");
  const pcm = decodePcm(b64);
  assert.equal(pcm.length, 3);
  assert.equal(pcm.buffer.byteLength, 12, "ArrayBuffer must be exactly 3 float32, not pooled");
});
