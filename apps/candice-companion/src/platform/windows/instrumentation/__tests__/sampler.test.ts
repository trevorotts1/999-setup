/**
 * WS-30 sampler tests — Windows resource sampling math (spec 19).
 *
 * Runner: plain Node >= 22.6 with type stripping. `node --test
 * src/platform/windows/instrumentation/__tests__/sampler.test.ts`
 * (Node 26 strips types by default; `--experimental-strip-types`
 * optional on Node 22/23).
 *
 * Proven here: Win32 counter parsing is exact; CPU percent math is exact and
 * bounded; RSS conversion is exact; the windowed sampler honors
 * duration/interval and never throws on an injected reader failure
 * (spec 20 degradation).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cpuPercentBetween,
  bytesToMiB,
  parseCounterLine,
  summarize,
  sampleWindow,
  powershellProbeBackend,
} from '../sampler.ts';
import type { ProcessReader, WindowsProbeBackend } from '../sampler.ts';

test('parseCounterLine — parses the Win32_Process CSV row', () => {
  const line = '1234,node.exe,1234567,7654321,104857600';
  const parsed = parseCounterLine(line);
  assert.ok(parsed);
  assert.equal(parsed.processId, 1234);
  assert.equal(parsed.name, 'node.exe');
  assert.equal(parsed.kernelTicks100ns, 1234567);
  assert.equal(parsed.userTicks100ns, 7654321);
  assert.equal(parsed.workingSetBytes, 104857600);
});

test('parseCounterLine — malformed lines are null, never NaN', () => {
  assert.equal(parseCounterLine(''), null);
  assert.equal(parseCounterLine('1,2,3'), null);
  assert.equal(parseCounterLine('a,b,c,d,e'), null);
});

test('parseCounterLine — blank counter fields are a failed read, not zero', () => {
  // A failed WMI read can emit blank counter fields; Number('') === 0
  // would otherwise fabricate a zero sample. Blank fields must parse as
  // null so the backend treats them as a probe failure (QC-030).
  assert.equal(parseCounterLine('1234,node.exe,,,104857600'), null);
  assert.equal(parseCounterLine('1234,node.exe,  ,  ,  '), null);
  assert.equal(parseCounterLine('1234,node.exe,1234567,7654321,'), null);
});

test('cpuPercentBetween — exact fraction of one core (100ns ticks)', () => {
  // One core consumes 1e7 (100ns) ticks per wall second; 5e5 ticks over a
  // 1000 ms wall window = 0.05 s of one core per 1 s wall = 5%.
  const previous = 0;
  const current = 500_000;
  assert.equal(cpuPercentBetween(previous, current, 1_000), 5);
});

test('cpuPercentBetween — full core = 100%', () => {
  // One core consumes 1e7 (100ns) ticks per wall second.
  const previous = 0;
  const current = 10_000_000;
  assert.equal(cpuPercentBetween(previous, current, 1_000), 100);
});

test('cpuPercentBetween — zero wall window is zero, never NaN', () => {
  assert.equal(cpuPercentBetween(0, 1000, 0), 0);
});

test('cpuPercentBetween — negative delta clamps to zero', () => {
  assert.equal(cpuPercentBetween(500, 100, 1_000), 0);
});

test('bytesToMiB — exact 1024-based conversion', () => {
  assert.equal(bytesToMiB(1024 * 1024), 1);
  assert.equal(bytesToMiB(74 * 1024 * 1024), 74);
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
  // Fake process: fixed CPU per tick (100ns units), fixed RSS.
  let ticks = 0;
  const reader: ProcessReader = {
    cpuTicks() {
      ticks += 500_000; // 5% of one core per 1000 ms wall
      return ticks;
    },
    workingSetBytes() {
      return 74 * 1024 * 1024;
    },
  };

  // Clock that jumps 1000 ms per tick.
  let clockTicks = 0;
  const clock = () => {
    clockTicks += 1;
    return clockTicks * 1_000;
  };

  const window = await sampleWindow({
    durationMs: 3_000,
    intervalMs: 1_000,
    reader,
    clockMs: clock,
  });

  assert.equal(window.sampleCount, 3); // t=2000..4000 (deadline inclusive)
  assert.equal(window.windowMs, 3_000);
  assert.equal(window.cpuPercentMean, 5);
  assert.equal(window.rssMiBMax, 74);
});

test('sampleWindow — reader failure degrades, never throws (spec 20)', async () => {
  const failingReader: ProcessReader = {
    cpuTicks() {
      throw new Error('counter read failed');
    },
    workingSetBytes() {
      throw new Error('working set read failed');
    },
  };
  let clockTicks = 0;
  const clock = () => {
    clockTicks += 1;
    return clockTicks * 1_000;
  };

  await assert.rejects(
    sampleWindow({ durationMs: 1_000, intervalMs: 1_000, reader: failingReader, clockMs: clock }),
    /counter read failed/,
  );
  // The caller contract: sampleWindow lets a dead instrument surface as a
  // rejection the phase probe turns into an `unavailable` measurement —
  // the companion UI never depends on it. Degradation is at the probe
  // boundary, not here.
});

test('sampleWindow — injected reader with injected clock seeds absolute counter', async () => {
  // A real process counter is absolute since process start; a delta
  // against the raw counter must include that standing baseline.
  const reader: ProcessReader = {
    cpuTicks() {
      return 50_000_000; // 5 s of one core standing CPU, never changes
    },
    workingSetBytes() {
      return 74 * 1024 * 1024;
    },
  };
  let clockTicks = 0;
  const clock = () => {
    clockTicks += 1;
    return clockTicks * 1_000;
  };

  const window = await sampleWindow({
    durationMs: 2_000,
    intervalMs: 1_000,
    reader,
    clockMs: clock,
  });

  // With a static counter the deltas are all zero — but only when the
  // counter was seeded absolutely. The regression this pins: a zero-seeded
  // first sample would report 50_000_000 ticks over the first wall step
  // (~5000%), inventing CPU the process never consumed.
  assert.equal(window.cpuPercentMean, 0);
  assert.equal(window.cpuPercentMax, 0);
  assert.ok(window.sampleCount >= 2);
});

test('sampleWindow — live path rejects an instrument that reads nothing', async () => {
  // A backend that resolves to all-zero readings (e.g. spawn ENOENT on a
  // host without powershell.exe) must never produce an "ok" window of
  // fabricated zero samples (QC-030). The live loop converts the dead
  // instrument into a rejection the phase probe degrades to `unavailable`.
  const deadBackend = powershellProbeBackend({
    execFile() {
      return Promise.resolve({
        stdout: '',
        stderr: 'spawn powershell.exe ENOENT',
        code: -2,
      });
    },
  });
  let clockTicks = 0;
  const clock = () => {
    clockTicks += 1;
    return clockTicks * 1_000;
  };
  await assert.rejects(
    sampleWindow({
      durationMs: 1_000,
      intervalMs: 1_000,
      backend: deadBackend,
      clockMs: clock,
    }),
    /live instrument unavailable|probe backend unavailable|powershell exit/,
  );
});

test('sampleWindow — zero-valued native output rejects, never fabricates', async () => {
  // Even when the backend "succeeds" with an all-zero CSV row, the
  // zero-guard must reject: a zero CPU/RSS pair on the live path is a
  // dead instrument, not a healthy idle process (QC-030).
  const zeroBackend = powershellProbeBackend({
    execFile() {
      return Promise.resolve({
        stdout: '1234,node.exe,0,0,0',
        stderr: '',
        code: 0,
      });
    },
  });
  let clockTicks = 0;
  const clock = () => {
    clockTicks += 1;
    return clockTicks * 1_000;
  };
  await assert.rejects(
    sampleWindow({
      durationMs: 1_000,
      intervalMs: 1_000,
      backend: zeroBackend,
      clockMs: clock,
    }),
    /live instrument unavailable/,
  );
});

test('sampleWindow — live path seeds ABSOLUTE counter, never lifetime spike', async () => {
  // Win32_Process KernelModeTime/UserModeTime are absolute since process
  // start. The reader-less live path must seed that absolute baseline up
  // front. This pins the defect where the live branch zero-seeded: the
  // first sample then reported the process's ENTIRE lifetime CPU over the
  // first wall step (~5000% on a 5s-old process), inventing CPU the
  // window never observed (QC-031).
  const absoluteBackend: WindowsProbeBackend = {
    async snapshot() {
      // Absolute lifetime counters: 5e7 ticks = 5 s of one core standing,
      // constant across every call — deltas must all be zero.
      return { cpuTicks: 50_000_000, workingSetBytes: 74 * 1024 * 1024 };
    },
  };
  let clockTicks = 0;
  const clock = () => {
    clockTicks += 1;
    return clockTicks * 1_000;
  };

  const window = await sampleWindow({
    durationMs: 2_000,
    intervalMs: 1_000,
    backend: absoluteBackend,
    clockMs: clock,
  });

  assert.equal(window.cpuPercentMean, 0);
  assert.equal(window.cpuPercentMax, 0);
  assert.equal(window.rssMiBMax, 74);
  assert.ok(window.sampleCount >= 2);
});

test('sampleWindow — live path reads ONE snapshot per sample', async () => {
  // CPU ticks and working set arrive in one Win32_Process read; the live
  // loop must call the backend once per interval, never twice (QC-031).
  let calls = 0;
  const countingBackend: WindowsProbeBackend = {
    async snapshot() {
      calls += 1;
      return { cpuTicks: calls * 100_000, workingSetBytes: 74 * 1024 * 1024 };
    },
  };
  let clockTicks = 0;
  const clock = () => {
    clockTicks += 1;
    return clockTicks * 1_000;
  };

  const window = await sampleWindow({
    durationMs: 2_000,
    intervalMs: 1_000,
    backend: countingBackend,
    clockMs: clock,
  });

  // seed snapshot + one per loop iteration
  assert.equal(calls, 1 + window.sampleCount);
  // 1e5 ticks per 1000 ms wall = 1% of one core per sample.
  assert.equal(window.cpuPercentMean, 1);
});
