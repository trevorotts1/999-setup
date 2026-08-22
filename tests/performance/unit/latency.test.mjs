/**
 * WS-45 unit tests — latency budgets + summary math.
 *
 * Owned by WR-020 / WS-45 lane (ownership map 9.2: tests/performance/**).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLatency, summarizeLatencies, LATENCY_THRESHOLDS_MS } from '../lib/latency.mjs';

test('latency budgets exist for all three E.1 WS-45 metrics', () => {
  for (const key of ['time-to-first-visible', 'ptt-release-to-transcript', 'first-spoken-audio']) {
    assert.ok(LATENCY_THRESHOLDS_MS[key], `budget missing for ${key}`);
    assert.ok(LATENCY_THRESHOLDS_MS[key].budgetMs > 0);
  }
});

test('checkLatency — at budget passes, over budget fails with violation text', () => {
  const at = checkLatency('ptt-release-to-transcript', LATENCY_THRESHOLDS_MS['ptt-release-to-transcript'].budgetMs);
  assert.equal(at.ok, true);
  const over = checkLatency('ptt-release-to-transcript', LATENCY_THRESHOLDS_MS['ptt-release-to-transcript'].budgetMs + 1);
  assert.equal(over.ok, false);
  assert.match(over.violation, /ms > budget \d+ms/);
});

test('checkLatency — NaN is a violation, never a pass', () => {
  const r = checkLatency('first-spoken-audio', NaN);
  assert.equal(r.ok, false);
  assert.equal(r.valueMs, null);
});

test('checkLatency — unknown key is a violation', () => {
  const r = checkLatency('made-up-key', 5);
  assert.equal(r.ok, false);
  assert.match(r.violation, /unknown metric key/);
});

test('summarizeLatencies — mean/p95/max sorted correctly, empty-safe', () => {
  const s = summarizeLatencies([300, 100, 200, 500, 400]);
  assert.equal(s.meanMs, 300);
  assert.equal(s.maxMs, 500);
  assert.equal(s.count, 5);
  // p95 index = floor(5*0.95)=4 -> sorted[4]=500
  assert.equal(s.p95Ms, 500);

  const empty = summarizeLatencies([]);
  assert.equal(empty.count, 0);
  assert.equal(empty.meanMs, null);
});
