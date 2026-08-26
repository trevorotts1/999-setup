/**
 * WS-24 threshold tests — regression gates for the measured baseline
 * (Master Spec 19: measured baseline first, thresholds after).
 *
 * Runner: plain Node >= 22.6 with type stripping. `node --test
 * src/platform/macos/instrumentation/__tests__/thresholds.test.ts`.
 *
 * Proven here: threshold checks are pure and exact; a report missing a
 * phase window FAILS (a missing measurement is a failed regression gate,
 * never a silent pass); the machine-readable registry matches the
 * in-code thresholds.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkThresholds,
  verifyReport,
  REGRESSION_THRESHOLDS,
  MEASURED_BASELINE_MACOS_AS_2026_08_21,
  PHASE_NAMES,
} from '../thresholds.ts';
import { MACHINE_READABLE_THRESHOLDS_JSON } from '../thresholds-registry.ts';
import type { WindowSample } from '../sampler.ts';

function windowOf(cpuPercentMean: number, cpuPercentMax: number, rssMiBMax: number): WindowSample {
  return {
    samples: [],
    cpuPercentMean,
    cpuPercentMax,
    rssMiBMax,
    rssMiBMean: rssMiBMax,
    windowMs: 30_000,
    sampleCount: 30,
  };
}

test('checkThresholds — clean window passes all three phases', () => {
  const clean = windowOf(3.04, 6.4, 70); // under every phase cap (real-baseline recalibration 2026-08-21)
  for (const phase of PHASE_NAMES) {
    const result = checkThresholds(clean, phase);
    assert.equal(result.ok, true, `${phase} should pass`);
    assert.deepEqual(result.violations, []);
  }
});

test('checkThresholds — leak (RSS over) fails with named violation', () => {
  const leaky = windowOf(3.04, 6.4, 300); // RSS far above the 180/220 MiB caps
  const result = checkThresholds(leaky, 'idle');
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.startsWith('idle rssMiBMax')));
});

test('checkThresholds — CPU runaway fails with named violation', () => {
  const busy = windowOf(250, 300, 70); // far above the listening cpuMeanMax cap (180)
  const result = checkThresholds(busy, 'listening');
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.startsWith('listening cpuPercentMean')));
});

test('checkThresholds — boundary values are inclusive (at-limit passes)', () => {
  const atLimit = windowOf(REGRESSION_THRESHOLDS.idle.cpuMeanMax, REGRESSION_THRESHOLDS.idle.cpuMaxMax, REGRESSION_THRESHOLDS.idle.rssMiBMax);
  const result = checkThresholds(atLimit, 'idle');
  assert.equal(result.ok, true);
});

test('verifyReport — missing phase window FAILS (never a silent pass)', () => {
  const report = verifyReport({ idle: windowOf(3.04, 6.4, 70) });
  assert.equal(report.ok, false);
  const listening = report.results.find((r) => r.phase === 'listening');
  assert.ok(listening);
  assert.equal(listening.ok, false);
  assert.ok(listening.violations.some((v) => v.includes('no measurement window')));
});

test('verifyReport — full three-phase report verdicts', () => {
  const report = verifyReport({
    idle: windowOf(0.0, 6.4, 98),
    speaking: windowOf(14.1, 43, 37),
    listening: windowOf(70.9, 85, 164),
  });
  assert.equal(report.ok, true);
  assert.equal(report.results.length, 3);
});

test('machine-readable registry — matches in-code thresholds exactly', () => {
  const parsed = JSON.parse(MACHINE_READABLE_THRESHOLDS_JSON) as {
    schemaVersion: number;
    platform: string;
    phases: typeof REGRESSION_THRESHOLDS;
  };
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.platform, MEASURED_BASELINE_MACOS_AS_2026_08_21.platform);
  assert.deepEqual(parsed.phases, REGRESSION_THRESHOLDS);
});

test('measured baseline — emulated flag on, every phase mean under its own threshold', () => {
  // A baseline that trips its own regression threshold is a fabrication
  // signal: the threshold must always clear the measurement it derives
  // from, or the honest healthy run fails the gate.
  // emulated:true now means PHASE-EMULATED (real engine windows driven by
  // the WS-45 harness; the app does not yet emit real phase titles).
  assert.equal(MEASURED_BASELINE_MACOS_AS_2026_08_21.emulated, true);
  const b = MEASURED_BASELINE_MACOS_AS_2026_08_21;
  assert.ok(b.idleCpuPercentMean <= REGRESSION_THRESHOLDS.idle.cpuMeanMax);
  assert.ok(b.speakingCpuPercentMean <= REGRESSION_THRESHOLDS.speaking.cpuMeanMax);
  assert.ok(b.listeningCpuPercentMean <= REGRESSION_THRESHOLDS.listening.cpuMeanMax);
  assert.ok(b.idleRssMiB <= REGRESSION_THRESHOLDS.idle.rssMiBMax);
  assert.ok(b.speakingRssMiB <= REGRESSION_THRESHOLDS.speaking.rssMiBMax);
  assert.ok(b.listeningRssMiB <= REGRESSION_THRESHOLDS.listening.rssMiBMax);
});
