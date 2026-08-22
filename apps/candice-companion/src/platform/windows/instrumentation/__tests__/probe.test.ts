/**
 * WS-30 probe + threshold tests — Windows phase report and regression
 * verdict (spec 19, CHECKLIST E.1 WS-30).
 *
 * Runner: plain Node >= 22.6 with type stripping. `node --test
 * src/platform/windows/instrumentation/__tests__/probe.test.ts`.
 *
 * Proven here:
 * 1. The three-phase report measures idle/speaking/listening windows.
 * 2. A failed phase window degrades to `unavailable`, never throws (spec 20).
 * 3. Threshold verdicts are exact and a missing window is a violation.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  measurePhase,
  runPhaseReport,
  reportFromWindows,
  PHASE_NAMES,
} from '../probe.ts';
import {
  checkThresholds,
  verifyReport,
  REGRESSION_THRESHOLDS,
} from '../thresholds.ts';
import type { ProcessReader } from '../sampler.ts';
import type { WindowSample } from '../sampler.ts';

/** Deterministic reader: 1% of one core per 1000 ms, fixed 70 MiB RSS. */
function fixedReader(): ProcessReader {
  let ticks = 0;
  return {
    cpuTicks() {
      ticks += 100_000; // 1e5 ticks per 1000 ms wall = 1%
      return ticks;
    },
    workingSetBytes() {
      return 70 * 1024 * 1024;
    },
  };
}

function fixedClock(): () => number {
  let t = 0;
  return () => {
    t += 1_000;
    return t;
  };
}

function sample(
  cpuPercentMean: number,
  cpuPercentMax: number,
  rssMiBMax: number,
): WindowSample {
  return {
    samples: [
      { cpuPercent: cpuPercentMean, rssMiB: rssMiBMax, atMs: 0 },
      { cpuPercent: cpuPercentMax, rssMiB: rssMiBMax, atMs: 1_000 },
    ],
    cpuPercentMean,
    cpuPercentMax,
    rssMiBMean: rssMiBMax,
    rssMiBMax,
    windowMs: 1_000,
    sampleCount: 2,
  };
}

test('measurePhase — captures a window with injected reader and clock', async () => {
  const m = await measurePhase('idle', {
    durationMs: 2_000,
    intervalMs: 1_000,
    reader: fixedReader(),
    clockMs: fixedClock(),
  });
  assert.equal(m.status, 'ok');
  assert.equal(m.window.cpuPercentMean, 1);
  assert.equal(m.window.rssMiBMax, 70);
  assert.ok(m.window.sampleCount >= 2);
});

test('measurePhase — failing reader degrades to unavailable, never throws', async () => {
  const failing: ProcessReader = {
    cpuTicks() {
      throw new Error('boom');
    },
    workingSetBytes() {
      return 0;
    },
  };
  const m = await measurePhase('speaking', {
    durationMs: 1_000,
    intervalMs: 1_000,
    reader: failing,
    clockMs: fixedClock(),
  });
  assert.equal(m.status, 'unavailable');
  assert.match(m.note ?? '', /boom/);
  assert.equal(m.window.sampleCount, 0);
});

test('runPhaseReport — three phases measured, complete when all ok', async () => {
  const report = await runPhaseReport({
    durationMs: 1_000,
    intervalMs: 1_000,
    reader: fixedReader(),
    clockMs: fixedClock(),
  });
  assert.equal(report.platform, 'windows-x64');
  assert.equal(report.phases.length, 3);
  assert.deepEqual(
    report.phases.map((p) => p.phase),
    [...PHASE_NAMES],
  );
  assert.equal(report.complete, true);
});

test('reportFromWindows — missing phase windows become unavailable', () => {
  const report = reportFromWindows({ idle: sample(0.5, 1, 70) });
  assert.equal(report.complete, false);
  const listening = report.phases.find((p) => p.phase === 'listening');
  assert.equal(listening?.status, 'unavailable');
});

test('checkThresholds — within limits passes', () => {
  const result = checkThresholds(sample(0.5, 1, 70), 'idle');
  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
});

test('checkThresholds — CPU mean over limit fails with named violation', () => {
  const result = checkThresholds(sample(12, 12, 70), 'idle');
  assert.equal(result.ok, false);
  assert.match(result.violations[0] ?? '', /idle cpuPercentMean 12\.0 > 2\.5/);
});

test('checkThresholds — RSS over limit fails', () => {
  const result = checkThresholds(sample(0.5, 1, 500), 'idle');
  assert.equal(result.ok, false);
  assert.match(result.violations[0] ?? '', /idle rssMiBMax 500\.0 > 190/);
});

test('verifyReport — all three phases green passes', () => {
  const { results, ok } = verifyReport({
    idle: sample(0.5, 1, 70),
    speaking: sample(7, 20, 80),
    listening: sample(10.5, 30, 78),
  });
  assert.equal(ok, true);
  assert.equal(results.length, 3);
});

test('verifyReport — a missing window is a violation, not a skip', () => {
  const { results, ok } = verifyReport({ idle: sample(0.5, 1, 70) });
  assert.equal(ok, false);
  assert.ok(results.some((r) => !r.ok && r.violations[0]?.includes('no measurement window')));
});

test('verifyReport — regression class defect fails (loop, leak)', () => {
  // A runaway loop: 90% of one core sustained + 1.2 GiB working set.
  const { ok } = verifyReport({
    idle: sample(90, 95, 1200),
    speaking: sample(90, 95, 1200),
    listening: sample(90, 95, 1200),
  });
  assert.equal(ok, false);
});

test('thresholds registry — schema version and baseline are coherent', () => {
  assert.equal(REGRESSION_THRESHOLDS.idle.cpuMeanMax >= 1, true);
  assert.ok(REGRESSION_THRESHOLDS.idle.rssMiBMax > 100);
  assert.ok(REGRESSION_THRESHOLDS.speaking.rssMiBMax >= REGRESSION_THRESHOLDS.idle.rssMiBMax);
});
