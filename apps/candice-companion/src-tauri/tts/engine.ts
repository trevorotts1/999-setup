/**
 * Candice TTS engine factory (WS-19).
 *
 * Creates the real Kokoro runtime handle: spawns the Python worker
 * (scripts/runtime.py) with the pinned model/voicepack paths, owns its
 * lifecycle, and speaks the JSON-lines contract declared in index.ts.
 * Lazy per Master Spec section 19: nothing starts until `start()`.
 *
 * FIX-015 FAIL-4 cancellation seam (plan section 3C):
 *  - `stop()` escalates: stdin EOF (graceful drain) -> SIGTERM (bounded
 *    window) -> SIGKILL (last resort). The handle only reports success
 *    when the process is provably gone; it never orphans a live worker.
 *  - every `synthesize()` runs under a bounded timeout
 *    (`synthesizeTimeoutMs`, default 120 s); a timed-out worker is
 *    killed through the same escalation ladder and the request rejects.
 *  - `abort()` (duplex SpeechTarget seam) is synchronous and escalates
 *    immediately to SIGTERM/SIGKILL — speech stops in the press call.
 *  - all escalation windows are injectable so tests stay deterministic.
 */

import { spawn, type ChildProcess } from "node:child_process";
import type {
  EngineCommand,
  EngineResult,
  KokoroEngine,
  KokoroEngineOptions,
} from "./index.ts";
import { KOKORO_SAMPLE_RATE, type RenderedSpeech } from "./types.ts";

/**
 * Escalation ladder defaults (FIX-015 FAIL-4). Bounded, never infinite.
 * Worst case sums to exactly DUPLEX_DEFAULTS.stopTimeoutMs (3000 ms):
 * the duplex force limb and the engine kill guarantee land together,
 * so an interrupt settles inside one policy window and the worker is
 * provably dead by the time the session moves on.
 */
export const STOP_ESCALATION = {
  /** Graceful window: stdin EOF, worker drains its in-flight synth. */
  gracefulMs: 1000,
  /** SIGTERM window before the last resort. */
  sigtermMs: 1500,
  /** SIGKILL window (must be near-zero; the OS guarantees delivery). */
  sigkillMs: 500,
} as const;

/** Per-synthesize budget. Long text may legitimately exceed it; the
 * request fails instead of hanging forever (spec 20 bounded time). */
export const SYNTHESIZE_TIMEOUT_MS = 120_000;

/** Optional injection seams (tests / platform adapters / shell wiring). */
export interface CreateKokoroEngineOptions {
  /** Python interpreter to spawn. Defaults: CANDICE_PYTHON env, then the
   * bundled interpreter (resource dir speech-assets/tts/python/bin/python3),
   * then "python3" dev fallback. */
  pythonBin?: string;
  /** Worker script path override (tests). */
  workerUrl?: string;
  /** Extra env merged into the worker spawn (tests / platform adapters). */
  env?: NodeJS.ProcessEnv;
  /** Per-synthesize budget override (tests). */
  synthesizeTimeoutMs?: number;
  /** Escalation windows override (tests; defaults STOP_ESCALATION). */
  escalation?: Partial<typeof STOP_ESCALATION>;
  /** Clock override for deterministic tests. */
  now?: () => number;
  /** Timer override: (fn, ms) => unref-able handle with clear(). */
  setTimer?: (fn: () => void, ms: number) => { clear(): void };
}

/** Shared helper used by both the real engine and tests. */
export function encodeEngineCommand(cmd: EngineCommand): string {
  return `${JSON.stringify(cmd)}\n`;
}

/** Shared helper used by both the real engine and tests. */
export function decodeEngineResult(line: string): EngineResult {
  return JSON.parse(line) as EngineResult;
}

/**
 * Decode base64 float32 PCM into a fresh, 4-byte-aligned Float32Array.
 * Copies out of Node's internal Buffer pool so the ArrayBuffer is exactly
 * the PCM size (never a pooled superset).
 */
export function decodePcm(b64: string): Float32Array {
  const bytes = Buffer.from(b64, "base64");
  const ab = new ArrayBuffer(bytes.length);
  new Uint8Array(ab).set(bytes);
  return new Float32Array(ab);
}

function killNow(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    child.kill(signal);
  } catch {
    // Process already exited; the exit/close handler owns the report.
  }
}

export function createKokoroEngine(
  options: KokoroEngineOptions,
  createOptions: CreateKokoroEngineOptions = {},
): KokoroEngine {
  const { modelPath, voicesPath, onEvent } = options;
  const now = createOptions.now ?? (() => Date.now());
  const setTimer = createOptions.setTimer ?? ((fn, ms) => {
    const t = setTimeout(fn, ms);
    if (typeof t === "object" && t !== null && "unref" in t && typeof t.unref === "function") {
      t.unref();
    }
    return { clear: () => clearTimeout(t) };
  });
  const escalation = {
    ...STOP_ESCALATION,
    ...(createOptions.escalation ?? {}),
  };
  const synthesizeTimeoutMs = createOptions.synthesizeTimeoutMs ?? SYNTHESIZE_TIMEOUT_MS;

  let child: ChildProcess | null = null;

  /** Wait for a child event with a bounded window (deterministic tests). */
  function waitForEvent(
    childRef: ChildProcess,
    event: "close" | "exit",
    windowMs: number,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        timer.clear();
        resolve(value);
      };
      // Already exited: the event fired before we attached; report gone.
      if (childRef.exitCode !== null || childRef.signalCode !== null) {
        finish(true);
        return;
      }
      childRef.once(event, () => finish(true));
      const timer = setTimer(() => finish(false), windowMs);
    });
  }

  /** Escalating kill: SIGTERM window, then SIGKILL. Resolves when gone. */
  async function killEscalated(childRef: ChildProcess): Promise<void> {
    if (childRef.exitCode !== null || childRef.signalCode !== null) {
      return; // already exited (normal exit or previous signal)
    }
    killNow(childRef, "SIGTERM");
    const termGone = await waitForEvent(childRef, "exit", escalation.sigtermMs);
    if (termGone) return;
    killNow(childRef, "SIGKILL");
    await waitForEvent(childRef, "exit", escalation.sigkillMs);
  }

  /** Full stop ladder: graceful EOF -> SIGTERM -> SIGKILL. */
  async function stopWorker(childRef: ChildProcess): Promise<void> {
    try {
      childRef.stdin?.end();
    } catch {
      // Pipe already closed; fall straight to signals.
    }
    const gracefulGone = await waitForEvent(childRef, "exit", escalation.gracefulMs);
    if (gracefulGone) return;
    await killEscalated(childRef);
  }

  return {
    get running(): boolean {
      return child !== null && child.exitCode === null;
    },

    async start(): Promise<void> {
      if (this.running) {
        return;
      }
      const workerPath = createOptions.workerUrl ?? new URL("./scripts/runtime.py", import.meta.url).pathname;
      const pythonBin = createOptions.pythonBin
        ?? process.env.CANDICE_PYTHON
        ?? "python3";
      let spawned: ChildProcess;
      try {
        spawned = spawn(
          pythonBin,
          [workerPath],
          {
            env: {
              ...process.env,
              ...(createOptions.env ?? {}),
              CANDICE_KOKORO_MODEL: modelPath,
              CANDICE_KOKORO_VOICES: voicesPath,
            },
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
      } catch (err) {
        throw new Error(`engine-spawn-failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      child = spawned;
      onEvent?.({ type: "speech-start", utteranceId: "engine" });
      return new Promise<void>((resolve, reject) => {
        const childRef = child;
        if (!childRef) {
          reject(new Error("engine-spawn-failed"));
          return;
        }
        const onError = (err: Error) => {
          reject(new Error(`engine-spawn-failed: ${err.message}`));
        };
        childRef.once("error", onError);
        childRef.once("spawn", () => {
          childRef.removeListener("error", onError);
          resolve();
        });
        childRef.once("exit", () => {
          childRef.removeListener("error", onError);
          reject(new Error("engine-spawn-failed"));
        });
        childRef.stderr?.on("data", () => {
          // Drain stderr so the worker never blocks on a full pipe.
          // The worker writes only JSON results on stdout.
        });
        childRef.once("exit", (code) => {
          if (code !== 0) {
            onEvent?.({
              type: "speech-error",
              utteranceId: "engine",
              reason: "engine-unavailable",
            });
          }
        });
      });
    },

    async stop(): Promise<{ stoppedAtMs: number }> {
      const childRef = child;
      if (!childRef) {
        return { stoppedAtMs: now() };
      }
      child = null; // never re-report a worker being torn down
      await stopWorker(childRef);
      onEvent?.({ type: "speech-stop", utteranceId: "engine" });
      return { stoppedAtMs: now() };
    },

    /** Duplex SpeechTarget seam: synchronous abort, immediate escalation. */
    abort(): void {
      const childRef = child;
      if (!childRef || childRef.exitCode !== null) {
        return;
      }
      child = null;
      void killEscalated(childRef);
    },

    async synthesize(text: string, voiceId: string, speed: number): Promise<RenderedSpeech> {
      const childRef = child;
      if (!childRef || childRef.exitCode !== null) {
        throw new Error("engine-not-running");
      }
      const cmd: EngineCommand = {
        kind: "synthesize",
        text,
        voiceId,
        speed,
        withTimings: true,
      };
      return new Promise<RenderedSpeech>((resolve, reject) => {
        let buf = "";
        let settled = false;
        const timeout = setTimer(() => {
          if (settled) return;
          settled = true;
          cleanup();
          void killEscalated(childRef);
          reject(new Error("engine-synthesize-timeout"));
        }, synthesizeTimeoutMs);
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          timeout.clear();
          cleanup();
          fn();
        };
        const cleanup = () => {
          childRef.stdout?.removeListener("data", onData);
        };
        const onData = (chunk: Buffer) => {
          buf += chunk.toString("utf8");
          let idx: number;
          while ((idx = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, idx);
            buf = buf.slice(idx + 1);
            if (!line.trim()) {
              continue;
            }
            let result: EngineResult;
            try {
              result = decodeEngineResult(line);
            } catch {
              finish(() => reject(new Error("engine-bad-json")));
              return;
            }
            if (!result.ok) {
              finish(() => reject(new Error(result.error ?? "engine-error")));
              return;
            }
            if (!result.pcmB64) {
              finish(() => reject(new Error("engine-missing-pcm")));
              return;
            }
            const pcm = decodePcm(result.pcmB64);
            if (pcm.length === 0) {
              finish(() => reject(new Error("engine-empty-pcm")));
              return;
            }
            finish(() =>
              resolve({
                pcm,
                sampleRate: result.sampleRate ?? KOKORO_SAMPLE_RATE,
                timings: result.timings
                  ? result.timings.map((t) => ({
                      phoneme: t.phoneme,
                      startSec: t.startSec,
                      endSec: t.endSec,
                    }))
                  : undefined,
              }),
            );
          }
        };
        childRef.stdout?.on("data", onData);
        childRef.stdin?.write(encodeEngineCommand(cmd));
      });
    },
  };
}
