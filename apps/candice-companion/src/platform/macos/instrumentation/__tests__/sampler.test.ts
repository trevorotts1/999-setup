/**
 * WS-24 sampler tests — macOS resource sampling math (spec 19).
 *
 * Runner: plain Node >= 22.6 with type stripping. `node --test
 * src/platform/macos/instrumentation/__tests__/sampler.test.ts`
 * (Node 26 strips types by default; `--experimental-strip-types`
 * optional on Node 22/23).
 *
 * Proven here: CPU percent math is exact and bounded; RSS conversion is
 * exact; the windowed sampler honors duration/interval and never throws
 * on an injected reader failure (spec 20 degradation).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cpuPercentBetween,
  bytesToMiB,
  hrtimeToMs,
  summarize,
  sampleWindow,
} from '../sampler.ts';
import type { CpuUsageLike, ProcessReader } from '../sampler.ts';

test('cpuPercentBetween — exact fraction of one core', () => {
  // 50 ms of CPU use over a 1000 ms wall window = 5% of one core.
  const previous: CpuUsageLike = { user: 0, system: 0 };
  const current: CpuUsageLike = { user: 40_000, system: 10_000 };
  assert.equal(cpuPercentBetween(previous, current, 1_000), 5);
});

test('cpuPercentBetween — full core = 100%', () => {
  const previous: CpuUsageLike = { user: 0, system: 0 };
  const current: CpuUsageLike = { user: 900_000, system: 100_000 };
  assert.equal(cpuPercentBetween(previous, current, 1_000), 100);
});

test('cpuPercentBetween — zero wall window is zero, never NaN', () => {
  const previous: CpuUsageLike = { user: 0, system: 0 };
  const current: CpuUsageLike = { user: 1000, system: 0 };
  assert.equal(cpuPercentBetween(previous, current, 0), 0);
});

test('cpuPercentBetween — negative delta clamps to zero', () => {
  const previous: CpuUsageLike = { user: 500, system: 0 };
  const current: CpuUsageLike = { user: 100, system: 0 };
  assert.equal(cpuPercentBetween(previous, current, 1_000), 0);
});

test('bytesToMiB — exact 1024-based conversion', () => {
  assert.equal(bytesToMiB(1024 * 1024), 1);
  assert.equal(bytesToMiB(68 * 1024 * 1024), 68);
});

test('hrtimeToMs — tuple converts exactly', () => {
  assert.equal(hrtimeToMs([1, 500_000_000]), 1500);
  assert.equal(hrtimeToMs([0, 250_000_000]), 250);
});

test('summarize — mean/max over samples, empty-safe', () => {
  const empty = summarize([], 1_000);
  assert.equal(empty.cpuPercentMean, 0);
  assert.equal(empty.rssMiBMax, 0);
  assert.equal(empty.sampleCount, 0);

  const window = summarize(
    [
      { cpuPercent: 2, rssMiB: 10, atMs: 0 },
      { cpuPercent: 4, rssMiB: 12, atMs: 1_000 },
      { cpuPercent: 6, rssMiB: 11, atMs: 2_000 },
    ],
    2_000,
  );
  assert.equal(window.cpuPercentMean, 4);
  assert.equal(window.cpuPercentMax, 6);
  assert.equal(window.rssMiBMean, 11);
  assert.equal(window.rssMiBMax, 12);
  assert.equal(window.sampleCount, 3);
});

test('sampleWindow — deterministic with injected clock and reader', async () => {
  // Fake process: fixed CPU per tick, fixed RSS.
  const reader: ProcessReader = {
    cpuUsage(previous?: CpuUsageLike) {
      const base = previous ?? { user: 0, system: 0 };
      return { user: base.user + 10_000, system: base.system + 5_000 };
    },
    memoryUsage() {
      return { rss: 70 * 1024 * 1024 };
    },
    hrtime() {
      return [0, 0];
    },
    nowMs() {
      return 0;
    },
  };

  // Clock that jumps 1000 ms per tick.
  let ticks = 0;
  const clock = () => {
    ticks += 1;
    return ticks * 1_000;
  };

  const window = await sampleWindow({
    durationMs: 3_000,
    intervalMs: 1_000,
    reader,
    clockMs: clock,
  });

  // Samples land at t=3000, t=4000 (t=1000 and t=2000 are consumed by
  // start()); deadline = 1000 + 3000 = 4000.
  assert.equal(window.sampleCount, 2);
  assert.equal(window.windowMs, 3_000);
  // 15 ms CPU per 1000 ms wall = 1.5% of one core.
  assert.equal(window.cpuPercentMean, 1.5);
  assert.equal(window.rssMiBMax, 70);
});

test('sampleWindow — reader failure degrades to error field, never throws (spec 20)', async () => {
  const failingReader: ProcessReader = {
    cpuUsage() {
      throw new Error('cpu read failed');
    },
    memoryUsage() {
      throw new Error('rss read failed');
    },
    hrtime() {
      return [0, 0];
    },
    nowMs() {
      return 1_000;
    },
  };
  let clockTicks = 0;
  const clock = () => {
    clockTicks += 1;
    return clockTicks * 1_000;
  };

  const window = await sampleWindow({
    durationMs: 1_000,
    intervalMs: 1_000,
    reader: failingReader,
    clockMs: clock,
  });
  assert.equal(window.sampleCount, 0);
  assert.match(window.error ?? '', /cpu read failed/);

  // Mid-window failure: samples before the failure survive, error set.
  let calls = 0;
  const flakyReader: ProcessReader = {
    cpuUsage(previous?: CpuUsageLike) {
      calls += 1;
      // call 1 = init read, call 2 = first sample, call 3 = second
      // sample -> throws with one sample already captured.
      if (calls === 3) throw new Error('cpu read failed mid-window');
      const base = previous ?? { user: 0, system: 0 };
      return { user: base.user + 5_000, system: 0 };
    },
    memoryUsage() {
      return { rss: 70 * 1024 * 1024 };
    },
    hrtime() {
      return [0, 0];
    },
    nowMs() {
      return 1_000;
    },
  };
  let flakyTicks = 0;
  const flakyClock = () => {
    flakyTicks += 1;
    return flakyTicks * 1_000;
  };
  const partial = await sampleWindow({
    durationMs: 3_000,
    intervalMs: 1_000,
    reader: flakyReader,
    clockMs: flakyClock,
  });
  // One sample survives (t=3000); the t=4000 call throws -> error set.
  assert.equal(partial.sampleCount, 1);
  assert.match(partial.error ?? '', /mid-window/);
});
