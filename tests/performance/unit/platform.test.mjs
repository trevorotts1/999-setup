/**
 * WS-45 unit tests — platform CPU/RSS math (own runner: node --test,
 * Node >= 22.6 strips types; these are plain .mjs so it always works).
 *
 * Owned by WR-020 / WS-45 lane (ownership map 9.2: tests/performance/**).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMacTime,
  cpuPercentBetween,
  bytesToMiB,
  summarizeSamples,
  parseRusage,
  rusageToWindow,
} from '../lib/platform.mjs';

test('parseMacTime — mm:ss, hh:mm:ss, dd-hh:mm:ss forms', () => {
  assert.equal(parseMacTime('00:05'), 5);
  assert.equal(parseMacTime('01:00:00'), 3600);
  assert.equal(parseMacTime('01:02:03'), 3600 + 123);
  assert.equal(parseMacTime('2-01:00:00'), 2 * 86400 + 3600);
});

test('parseMacTime — malformed input is NaN, never a number', () => {
  assert.ok(Number.isNaN(parseMacTime('abc')));
  assert.ok(Number.isNaN(parseMacTime('')));
  assert.ok(Number.isNaN(parseMacTime(':') ));
});

test('cpuPercentBetween — exact fraction of one core', () => {
  // 0.5s CPU over 10s wall = 5% of one core.
  assert.equal(cpuPercentBetween(0, 0.5, 10_000), 5);
});

test('cpuPercentBetween — full core for 1s = 100%', () => {
  assert.equal(cpuPercentBetween(0, 1, 1_000), 100);
});

test('cpuPercentBetween — zero wall window is 0, never NaN', () => {
  assert.equal(cpuPercentBetween(0, 10, 0), 0);
});

test('cpuPercentBetween — negative delta clamps to 0 (pid reuse guard)', () => {
  assert.equal(cpuPercentBetween(5, 2, 1_000), 0);
});

test('cpuPercentBetween — caps at 200% (loop-stall artifact guard, same as WS-24)', () => {
  assert.equal(cpuPercentBetween(0, 100, 1000), 200);
});

test('bytesToMiB — 1024-based', () => {
  assert.equal(bytesToMiB(1024 * 1024), 1);
  assert.equal(bytesToMiB(68 * 1024 * 1024), 68);
});

test('summarizeSamples — mean/max, empty-safe, rss max', () => {
  const s = summarizeSamples(
    [
      { cpuPercent: 2, rssMiB: 70, atMs: 0 },
      { cpuPercent: 6, rssMiB: 80, atMs: 10 },
    ],
    10,
  );
  assert.equal(s.cpuPercentMean, 4);
  assert.equal(s.cpuPercentMax, 6);
  assert.equal(s.rssMiBMean, 75);
  assert.equal(s.rssMiBMax, 80);
  assert.equal(s.sampleCount, 2);

  const empty = summarizeSamples([], 0);
  assert.equal(empty.sampleCount, 0);
  assert.equal(empty.cpuPercentMean, 0);
  assert.equal(empty.cpuPercentMax, 0);
  assert.equal(empty.rssMiBMax, 0);
});

test('parseRusage — exact real/user/sys/peak-rss extraction', () => {
  const text = [
    '        0.22 real         0.11 user         0.07 sys',
    '           172032000  maximum resident set size',
  ].join('\n');
  const r = parseRusage(text);
  assert.ok(r);
  assert.equal(r.realSec, 0.22);
  assert.equal(r.userSec, 0.11);
  assert.equal(r.sysSec, 0.07);
  assert.equal(r.peakRssBytes, 172032000);
});

test('parseRusage — missing rusage lines returns null, never fabricates', () => {
  assert.equal(parseRusage('no rusage here'), null);
  assert.equal(parseRusage(''), null);
});

test('rusageToWindow — CPU percent exact, RSS converted 1024-based', () => {
  // 0.18s CPU (user+sys) over 0.22s wall = 81.8% of one core.
  const win = rusageToWindow(
    { realSec: 0.22, userSec: 0.11, sysSec: 0.07, peakRssBytes: 164 * 1024 * 1024 },
  );
  assert.ok(Math.abs(win.cpuPercentMean - 81.8) < 0.1, `got ${win.cpuPercentMean}`);
  assert.ok(Math.abs(win.rssMiBMax - 164) < 0.01);
  assert.equal(win.sampleCount, 1);
});

test('rusageToWindow — zero wall is zero, never NaN', () => {
  const win = rusageToWindow({ realSec: 0, userSec: 0, sysSec: 0, peakRssBytes: 0 });
  assert.equal(win.cpuPercentMean, 0);
});
