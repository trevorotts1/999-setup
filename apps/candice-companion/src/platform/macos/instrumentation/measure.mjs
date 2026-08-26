#!/usr/bin/env node
/**
 * WS-24 live measurement CLI — Apple Silicon reference instrument
 * (Master Spec 19: measure first, then set thresholds).
 *
 * Owned by WR-015 / WS-24 lane (ownership map 9.2). Measures the
 * CURRENT process's own CPU/RSS over a wall window and reports the
 * window aggregates in one line plus the exact JSON the thresholds
 * consumer reads. Operator/CI-facing; the companion app itself reads
 * the same module.
 *
 * Failure isolation (spec 20): the CLI never throws; a dead instrument
 * prints an error line and exits non-zero (a failed measurement is a
 * failed regression gate — never a silent pass).
 *
 * Usage:
 *   node measure.mjs [--duration-ms 30000] [--interval-ms 1000]
 *   CANDICE_MEASURE_DURATION_MS=30000 CANDICE_MEASURE_INTERVAL_MS=1000 node measure.mjs
 */

import { sampleWindow, summarize } from './sampler.ts';
import { checkThresholds, REGRESSION_THRESHOLDS, PHASE_NAMES } from './thresholds.ts';

const DURATION_MS_DEFAULT = 30_000;
const INTERVAL_MS_DEFAULT = 1_000;

function argMs(name, fallback) {
  // Accept both `--duration-ms=3000` and `--duration-ms 3000`.
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
  const fromEnv = process.env[`CANDICE_MEASURE_${name.toUpperCase()}`];
  if (fromEnv) {
    const value = Number(fromEnv);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return fallback;
}

function main() {
  const durationMs = argMs('duration-ms', DURATION_MS_DEFAULT);
  const intervalMs = argMs('interval-ms', INTERVAL_MS_DEFAULT);

  sampleWindow({ durationMs, intervalMs }).then((window) => {
    if (window.error) {
      process.stderr.write(`[ws24] instrument failed: ${window.error}\n`);
      process.exit(1);
    }
    // One-line human summary + the machine-readable payload.
    const summary = summarize(window.samples, window.windowMs);
    process.stdout.write(
      `[ws24] ${PHASE_NAMES.join('/')} measured window ${durationMs}ms ` +
        `(n=${summary.sampleCount}): cpuMean=${summary.cpuPercentMean.toFixed(2)}% ` +
        `cpuMax=${summary.cpuPercentMax.toFixed(2)}% ` +
        `rssMean=${summary.rssMiBMean.toFixed(1)}MiB rssMax=${summary.rssMiBMax.toFixed(1)}MiB\n`,
    );
    process.stdout.write(
      JSON.stringify({ durationMs, intervalMs, window: summary }, null, 2) + '\n',
    );
    // Optional phase check when the phase is passed on the command line.
    const phaseArg = process.argv.find((a) => a.startsWith('--phase='));
    if (phaseArg) {
      const phase = phaseArg.split('=')[1];
      const result = checkThresholds(summary, phase, REGRESSION_THRESHOLDS);
      process.stdout.write(
        JSON.stringify({ phase, ok: result.ok, violations: result.violations }, null, 2) + '\n',
      );
      process.exit(result.ok ? 0 : 1);
    }
    process.exit(0);
  });
}

main();
