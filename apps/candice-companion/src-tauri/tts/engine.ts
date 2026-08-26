/**
 * Candice TTS engine factory (WS-19).
 *
 * Creates the real Kokoro runtime handle: spawns the Python worker
 * (scripts/runtime.py) with the pinned model/voicepack paths, owns its
 * lifecycle, and speaks the JSON-lines contract declared in index.ts.
 * Lazy per Master Spec section 19: nothing starts until `start()`.
 */

import { spawn, type ChildProcess } from "node:child_process";
import type {
  EngineCommand,
  EngineResult,
  KokoroEngine,
  KokoroEngineOptions,
} from "./index.ts";
import { KOKORO_SAMPLE_RATE, type RenderedSpeech } from "./types.ts";

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

export function createKokoroEngine(options: KokoroEngineOptions): KokoroEngine {
  const { modelPath, voicesPath, onEvent } = options;

  let child: ChildProcess | null = null;

  return {
    get running(): boolean {
      return child !== null && child.exitCode === null;
    },

    async start(): Promise<void> {
      if (this.running) {
        return;
      }
      const worker = new URL("./scripts/runtime.py", import.meta.url);
      child = spawn(
        process.env.CANDICE_PYTHON ?? "python3",
        [worker.pathname],
        {
          env: {
            ...process.env,
            CANDICE_KOKORO_MODEL: modelPath,
            CANDICE_KOKORO_VOICES: voicesPath,
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      onEvent?.({ type: "speech-start", utteranceId: "engine" });
      return new Promise<void>((resolve, reject) => {
        const childRef = child;
        if (!childRef) {
          reject(new Error("engine-spawn-failed"));
          return;
        }
        const onError = (err: Error) => {
          reject(err);
        };
        childRef.once("error", onError);
        childRef.once("spawn", () => {
          childRef.removeListener("error", onError);
          resolve();
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

    async stop(): Promise<void> {
      if (!child) {
        return;
      }
      // EOF on stdin makes the worker exit cleanly (its documented contract).
      child.stdin?.end();
      await new Promise<void>((resolve) => {
        if (!child) {
          resolve();
          return;
        }
        child.once("close", () => resolve());
        setTimeout(resolve, 5000).unref();
      });
      child = null;
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
              reject(new Error("engine-bad-json"));
              cleanup();
              return;
            }
            if (!result.ok) {
              reject(new Error(result.error ?? "engine-error"));
              cleanup();
              return;
            }
            if (!result.pcmB64) {
              reject(new Error("engine-missing-pcm"));
              cleanup();
              return;
            }
            const pcm = decodePcm(result.pcmB64);
            if (pcm.length === 0) {
              reject(new Error("engine-empty-pcm"));
              cleanup();
              return;
            }
            cleanup();
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
            });
          }
        };
        childRef.stdout?.on("data", onData);
        childRef.stdin?.write(encodeEngineCommand(cmd));
      });
    },
  };
}
