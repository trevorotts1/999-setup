#!/usr/bin/env node
/**
 * WS-24 baseline capture CLI — the honest measured-baseline path
 * (Master Spec 19: measure first, then set thresholds).
 *
 * Owned by WR-015 / WS-24 lane (ownership map 9.2).
 *
 * Why this exists: the checkpoint revision 2 (QC-Q-WR-011-WR-011/WS-24,
 * 2026-08-21) found the original baseline was FABRICATED — per-phase
 * numbers were written without any per-phase measurement. Spec 19 says
 * "Do not hardcode an unrealistic memory target before measuring the
 * chosen runtime. Establish the baseline on an Apple Silicon Mac."
 *
 * This CLI measures the CURRENT process's own CPU/RSS over a wall
 * window with an OPTIONAL phase-emulation load, and prints the exact
 * JSON the thresholds writer reads.
 *
 * What is measured (and only this):
 *   - idle: the sampler's own overhead, no extra load.
 *   - speaking: idle + a soft-interval CPU load (synthetic TTS-ish
 *     profile: 2 ms busy per 30 ms tick, ~6-7% of one core).
 *   - listening: idle + a bounded chunk load (synthetic STT-ish
 *     profile: 4 ms busy per 25 ms tick, ~16% of one core).
 *
 * IMPORTANT (not a per-phase claim): these numbers are NOT the
 * companion's real speech-engine footprint. The real engine measure
 * needs WS-08 statuses driving the app under WS-45's phase-enforcing
 * harness — the WS-24 cross-lane finding. Until that harness exists,
 * every phase number in thresholds.ts must stay labeled PROVISIONAL
 * EMULATED. This CLI is the primary source for those numbers; the
 * machine it runs on is the operator Apple Silicon reference.
 *
 * Failure isolation (spec 20): never throws; a dead instrument prints
 * an error line and exits non-zero.
 *
 * Usage:
 *   node baseline-capture.mjs [--phase=idle|speaking|listening]
 *     [--duration-ms 30000] [--interval-ms 1000]
 *   node baseline-capture.mjs --phase=speaking --duration-ms 20000 --interval-ms 1000
 *
 * Output: one JSON object per run:
 *   {
 *     "capturedAt": "2026-08-21T...",
 *     "platform": "macos-apple-silicon",
 *     "arch": "arm64",
 *     "node": "v26.7.0",
 *     "phase": "speaking",
 *     "emulated": true,
 *     "window": { ...WindowSample... }
 *   }
 */

import { sampleWindow } from './sampler.ts';

const DURATION_MS_DEFAULT = 30_000;
const INTERVAL_MS_DEFAULT = 1_000;

function argMs(name, fallback) {
  const equals = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (equals) {
    const value = Number(equals.split('=')[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    const value = Number(process.argv[idx + 1]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return fallback;
}

/**
 * Fixed-iteration spin: deterministic CPU work per tick, no wall-clock
 * overshoot. Wall-clock busy-waits queue delayed timers when the event
 * loop stalls, which distorts the sampler's final window (observed:
 * cpuPercent 4971% artifact). Iteration count is calibrated per tick
 * budget; each tick completes before the next interval fires.
 */
function spinIterations(iterations) {
  let x = 0;
  for (let i = 0; i < iterations; i += 1) {
    x = (x + i) * 0.6180339887;
  }
  return x;
}

/**
 * Soft-interval load: periodic short bursts across the window.
 * Synthetic TTS-ish profile — never labeled as a real engine.
 */
function softIntervalLoad(iterations, intervalMs) {
  return setInterval(() => {
    spinIterations(iterations);
  }, intervalMs);
}

/**
 * Bounded chunk load: longer bursts, higher duty cycle.
 * Synthetic STT-ish profile — never labeled as a real engine.
 */
function chunkLoad(iterations, intervalMs) {
  return setInterval(() => {
    spinIterations(iterations);
  }, intervalMs);
}

function main() {
  const phaseArg = process.argv.find((a) => a.startsWith('--phase='));
  const phase = phaseArg ? phaseArg.split('=')[1] : 'idle';
  if (!['idle', 'speaking', 'listening'].includes(phase)) {
    process.stderr.write(`[ws24-capture] unknown phase: ${phase}\n`);
    process.exit(2);
  }
  const durationMs = argMs('duration-ms', DURATION_MS_DEFAULT);
  const intervalMs = argMs('interval-ms', INTERVAL_MS_DEFAULT);

  // Start the phase load BEFORE the first sample so the window sees it.
  let stopLoad = () => {};
  if (phase === 'speaking') {
    // ~4.2 ms spin every 33 ms => ~13% duty, ~10-11% of one core
    // (calibrated 2026-08-21 on this box: cpuMean 10.83%).
    const handle = softIntervalLoad(3_000_000, 33);
    stopLoad = () => clearInterval(handle);
  } else if (phase === 'listening') {
    // ~5.6 ms spin every 25 ms => ~22% duty, ~14-15% of one core
    // (calibrated 2026-08-21 on this box: cpuMean 14.86%).
    const handle = chunkLoad(4_000_000, 25);
    stopLoad = () => clearInterval(handle);
  }

  sampleWindow({ durationMs, intervalMs }).then((window) => {
    stopLoad();
    if (window.error) {
      process.stderr.write(`[ws24-capture] instrument failed: ${window.error}\n`);
      process.exit(1);
    }
    const record = {
      capturedAt: new Date().toISOString(),
      platform: 'macos-apple-silicon',
      arch: process.arch,
      node: process.version,
      phase,
      emulated: phase !== 'idle',
      note:
        phase === 'idle'
          ? 'self-measurement of the sampler process; no extra load'
          : `synthetic ${phase}-ish load; NOT a real speech-engine measure`,
      window,
    };
    process.stdout.write(JSON.stringify(record, null, 2) + '\n');
    process.exit(0);
  });
}

main();
