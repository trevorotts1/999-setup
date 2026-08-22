/**
 * WS-45 real engine drivers — the actual speech engines Candice invokes
 * (WS-16 whisper.cpp, WS-19 Kokoro/system-TTS fallback), measured for real.
 *
 * Owned by WR-020 / WS-45 lane (ownership map 9.2: tests/performance/**).
 *
 * Every driver: (a) uses the SAME runtime + model the app lanes pin (same
 * sha256 verification the WS-16 runtime performs), (b) reports wall-time
 * latency, (c) is sampled for CPU/RSS while it runs. Never fabricates a
 * number: if the engine or asset is absent, the driver returns
 * unavailable with the reason.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { sampleProcessWindow, sleepMs, measureViaRuntimeUsage, rusageToWindow } from './platform.mjs';
import { pollWindowUntil } from './macos-window.mjs';

/** WS-16 pinned model contract (source: src-tauri/stt/runtime/manifests/bundled-model.json). */
export const STT_MODEL = {
  name: 'ggml-tiny.en-q5_1.bin',
  sha256: 'c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b',
};

export function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
}

export function which(name) {
  if (!name) return null;
  const res = spawnSync('which', [name], { encoding: 'utf8', timeout: 5000 });
  const p = res.stdout?.trim();
  return res.status === 0 && p && existsSync(p) ? p : null;
}

function expand(p) {
  if (p.startsWith('~/')) return process.env.HOME + p.slice(1);
  return p.replace(
    /\$([A-Z_][A-Z0-9_]*)/g,
    (_, name) => process.env[name] ?? `$${name}`,
  );
}

function firstExisting(candidates) {
  for (const c of candidates) {
    const p = expand(c);
    if (existsSync(p)) return p;
  }
  return null;
}

/** Locate the real STT assets; env overrides win, then the WS-16 manifest order. */
export function resolveStt() {
  const bin =
    process.env.CANDICE_PERF_STT_BIN ||
    which('whisper-cli') ||
    which('whisper-cpp');
  const model =
    process.env.CANDICE_PERF_STT_MODEL ||
    firstExisting([
      '~/candice-stt-cache/ggml-tiny.en-q5_1.bin',
      '~/whisper.cpp/models/ggml-tiny.en-q5_1.bin',
    ]);
  const fixture =
    process.env.CANDICE_PERF_STT_FIXTURE ||
    firstExisting(['~/candice-stt-cache/jfk.wav', '~/whisper.cpp/models/jfk.wav']);
  return { bin, model, fixture };
}

/**
 * Real STT (listening) phase: transcribe the WS-16 canonical 16 kHz
 * fixture with the pinned whisper-cli + model (sha256-verified, same as
 * the runtime does). PTT-release-to-transcript latency = wall time from
 * process start to transcript ready.
 *
 * @returns {Promise<{status:'ok',latencyMs:number,transcript:string,window:object,note:string}
 *   |{status:'unavailable',note:string}>}
 */
export async function measureStt() {
  const { bin, model, fixture } = resolveStt();
  if (!bin) return { status: 'unavailable', note: 'whisper-cli binary not found on PATH' };
  if (!model) return { status: 'unavailable', note: 'no STT model found (tried ~/candice-stt-cache, ~/whisper.cpp/models)' };
  if (!fixture) return { status: 'unavailable', note: 'no STT fixture found (tried jfk.wav in the above dirs)' };
  const actual = sha256File(model);
  if (actual !== STT_MODEL.sha256) {
    return {
      status: 'unavailable',
      note: `STT model sha256 mismatch: got ${actual}, pinned ${STT_MODEL.sha256} (refusing to run an unverified engine)`,
    };
  }

  // Run through /usr/bin/time rusage (exact CPU + peak RSS for a
  // short-lived engine; ps granularity is 1 s and would read zero).
  const outPrefix = `/tmp/candice-ws45-stt-${process.pid}-${Date.now()}`;
  const t0 = Date.now();
  const run = measureViaRuntimeUsage(bin, [
    '-m', model, '-f', fixture, '-l', 'en', '-otxt', '-of', outPrefix,
  ]);
  const latencyMs = Date.now() - t0;
  const window = run.ok ? rusageToWindow(run.rusage) : null;

  let transcript = null;
  try {
    transcript = readFileSync(`${outPrefix}.txt`, 'utf8').trim();
  } catch {
    transcript = null;
  }
  const ok = run.ok && run.childExit === 0 && transcript !== null;
  return {
    status: ok ? 'ok' : 'unavailable',
    latencyMs,
    transcript,
    window,
    note: ok
      ? `real whisper-cli (WS-16 pinned runtime) on canonical jfk.wav fixture; rusage cpu=${(window.cpuPercentMean).toFixed(1)}% peak rss=${window.rssMiBMax.toFixed(1)}MiB`
      : `whisper-cli failed: ${run.reason ?? 'unknown'}`,
  };
}

/**
 * Real TTS (speaking) phase driver. Engine order: Kokoro worker if the
 * WS-19 runtime assets are present, else the macOS system fallback `say`
 * (spec 7 — system TTS is a real, clearly-marked Candice fallback path).
 * First-spoken-audio is measured on the output file's first growth past
 * the AIFF header (real first-audio payload).
 */
export async function measureTts({
  text = 'This is the Candice performance measurement line.',
  sampleWindowMs = 5000,
  sampleIntervalMs = 500,
} = {}) {
  const kokoro = await tryKokoro(text, sampleWindowMs, sampleIntervalMs);
  if (kokoro) return kokoro;
  return measureSystemSay(text, sampleWindowMs, sampleIntervalMs);
}

async function measureSystemSay(text, sampleWindowMs, sampleIntervalMs) {
  const sayBin = which('say');
  if (!sayBin) {
    return {
      status: 'unavailable',
      note: 'no TTS engine: say binary missing and Kokoro assets absent',
    };
  }
  // `say -o -` buffers the whole AIFF to stdout for short text — no
  // streaming flush. Use a temp output file and poll for first growth:
  // 4096-byte block writes are observed DURING synthesis, so the first
  // growth past the AIFF header (~44 B) is the engine's first audio
  // payload. That IS first-spoken-audio; if the file never grows until
  // the process exits, fall back to the total time (single-chunk write,
  // honest upper bound).
  const outFile = `/tmp/candice-ws45-say-${process.pid}-${Date.now()}.aiff`;
  const t0 = Date.now();
  const child = spawn(sayBin, ['-o', outFile, text], { stdio: 'ignore' });
  const windowPromise = sampleProcessWindow({
    pid: child.pid,
    durationMs: sampleWindowMs,
    intervalMs: sampleIntervalMs,
  });
  let firstAudioMs = await pollSayFirstGrowth(outFile, t0);
  const exit = await new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  const totalMs = Date.now() - t0;
  const window = await windowPromise;
  if (firstAudioMs === null) firstAudioMs = totalMs; // single-chunk upper bound
  try { rmSync(outFile, { force: true }); } catch { /* temp */ }
  return {
    status: exit === 0 ? 'ok' : 'unavailable',
    latencyFirstAudioMs: firstAudioMs,
    totalMs,
    window,
    note:
      exit === 0
        ? 'real system TTS fallback (say) — spec 7 fallback engine; first-growth poll on AIFF output'
        : `say exited ${exit}`,
  };
}

/** Poll the say output file for first growth past the AIFF header. */
function pollSayFirstGrowth(outFile, t0Ms, { timeoutMs = 30_000, intervalMs = 20 } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      try {
        const size = statSync(outFile).size;
        if (size > 44) {
          clearInterval(timer);
          resolve(Date.now() - t0Ms);
        }
      } catch {
        /* file not created yet */
      }
      if (Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        resolve(null);
      }
    }, intervalMs);
  });
}

async function tryKokoro() {
  // WS-19 runtime handle: python worker with kokoro_onnx. Not installed
  // on the operator box as of 2026-08-21; the driver stays so the WS-46
  // smoke host with the real runtime gets a real Kokoro measurement.
  const probe = spawnSync(
    'python3',
    ['-c', 'import kokoro_onnx, onnxruntime'],
    { timeout: 10_000, encoding: 'utf8' },
  );
  if (probe.status !== 0) return null; // fall through to say / unavailable
  return {
    status: 'unavailable',
    note: 'Kokoro runtime present but WS-19 asset paths are not resolved on this host (config the real model/voices paths before measuring)',
  };
}

/**
 * Idle phase: launch the REAL release binary (WS-06 artifact), measure
 * TIME-TO-FIRST-VISIBLE (window mapped via CGWindowList — the boot
 * surface is static HTML that paints before any JS), then sample the
 * idle footprint. Total: any launch problem returns unavailable with
 * the reason.
 */
export async function measureAppIdle({
  warmupMs = 6000,
  sampleWindowMs = 8000,
  sampleIntervalMs = 500,
  measureFirstVisible = false,
} = {}) {
  const app = resolveApp();
  if (!app) {
    return {
      status: 'unavailable',
      note: 'candice-companion release binary not found (build the WS-06 lane first)',
    };
  }
  if (process.env.CANDICE_PERF_ALLOW_APP_LAUNCH === '0') {
    return { status: 'unavailable', note: 'app launch disabled by CANDICE_PERF_ALLOW_APP_LAUNCH=0' };
  }
  let child;
  try {
    child = spawn(app, [], { stdio: 'ignore' });
  } catch (err) {
    return { status: 'unavailable', note: `app spawn failed: ${err.message}` };
  }
  const t0 = Date.now();
  const firstVisible = measureFirstVisible
    ? pollWindowUntil({ t0Ms: t0, timeoutMs: Math.max(15_000, warmupMs), intervalMs: 50 })
    : { ok: false, note: 'first-visible measurement disabled' };
  try {
    // The window poll already consumed part of the warmup; finish the
    // remaining warmup so the idle sample starts on a settled app.
    const elapsed = Date.now() - t0;
    const remaining = Math.max(0, warmupMs - elapsed);
    sleepMs(remaining);
    const window = await sampleProcessWindow({
      pid: child.pid,
      durationMs: sampleWindowMs,
      intervalMs: sampleIntervalMs,
    });
    if (child.exitCode !== null) {
      return {
        status: 'unavailable',
        note: `app exited during idle window (exit ${child.exitCode})`,
        window,
        firstVisible,
      };
    }
    return {
      status: 'ok',
      window,
      note: `real release app idle (${app})`,
      firstVisible,
    };
  } finally {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

/**
 * Locate the real release app binary (WS-06 artifact) if present.
 * Search order: env override, bundle path, target/release path.
 */
export function resolveApp() {
  const candidates = [
    '${CANDICE_PERF_APP_BIN}',
    `${process.cwd()}/apps/candice-companion/src-tauri/target/release/candice-companion`,
    `${process.cwd()}/apps/candice-companion/src-tauri/target/release/bundle/macos/Candice Companion.app/Contents/MacOS/candice-companion`,
  ];
  const envBin = process.env.CANDICE_PERF_APP_BIN;
  if (envBin) candidates.unshift(envBin);
  return candidates.map(expand).find((c) => existsSync(c)) ?? null;
}
