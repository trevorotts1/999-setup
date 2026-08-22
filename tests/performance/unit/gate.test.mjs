/**
 * WS-45 unit tests — threshold gate semantics against the REAL WS-24 /
 * WS-30 registries (imported, never copied).
 *
 * Owned by WR-020 / WS-45 lane (ownership map 9.2: tests/performance/**).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gatePhase, gateReport, loadThresholdRegistries } from '../lib/thresholds-gate.mjs';

function fakeWindow(cpuPercentMean, cpuPercentMax) {
  return {
    samples: [{ cpuPercent: cpuPercentMean, rssMiB: 50, atMs: 0 }],
    cpuPercentMean,
    cpuPercentMax,
    rssMiBMean: 50,
    rssMiBMax: 50,
    windowMs: 1000,
    sampleCount: 1,
  };
}

test('registries load from both lanes (macos WS-24 + windows WS-30)', async () => {
  const regs = await loadThresholdRegistries();
  assert.ok(regs.macos, 'macOS WS-24 registry missing');
  assert.ok(regs.windows, 'Windows WS-30 registry missing');
  assert.ok(regs.macos.REGRESSION_THRESHOLDS.idle, 'idle thresholds missing');
  assert.ok(regs.windows.REGRESSION_THRESHOLDS.idle, 'idle thresholds missing');
});

test('a clean window passes the REAL ws-24 checkThresholds', async () => {
  const regs = await loadThresholdRegistries();
  const g = gatePhase({
    platform: 'macos',
    phase: 'idle',
    window: fakeWindow(1.0, 3.0), // far below idle cpuMeanMax 10
    registry: regs.macos,
  });
  assert.equal(g.gateOk, true, g.violations.join('; '));
});

test('an over-threshold window FAILS through the owning lanes comparator', async () => {
  const regs = await loadThresholdRegistries();
  const g = gatePhase({
    platform: 'macos',
    phase: 'idle',
    window: fakeWindow(1234.5, 1234.5), // far above idle cpuMeanMax 10
    registry: regs.macos,
  });
  assert.equal(g.gateOk, false);
  assert.equal(g.status, 'violation');
  assert.ok(g.violations.length > 0);
});

test('a missing window FAILS — a failed measurement is never a silent pass', async () => {
  const regs = await loadThresholdRegistries();
  const g = gatePhase({ platform: 'macos', phase: 'listening', window: null, registry: regs.macos });
  assert.equal(g.gateOk, false);
  assert.match(g.violations[0], /no measurement window recorded/);
});

test('a missing registry module FAILS', () => {
  const g = gatePhase({ platform: 'macos', phase: 'idle', window: fakeWindow(1, 2), registry: null });
  assert.equal(g.gateOk, false);
  assert.match(g.violations[0], /registry unavailable/);
});

test('gateReport: one missing phase fails the whole report', async () => {
  const regs = await loadThresholdRegistries();
  const rep = gateReport({
    platform: 'macos',
    windows: { idle: fakeWindow(1, 3), speaking: null, listening: null },
    registry: regs.macos,
  });
  assert.equal(rep.ok, false);
  assert.equal(rep.failures.length, 2);
});
