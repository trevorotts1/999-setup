import assert from 'node:assert/strict';
import test from 'node:test';

import { createWindowInputPolicy } from '../input-policy.ts';

test('FIX-008 transparent window defaults to complete pass-through', async () => {
  const calls: boolean[] = [];
  const policy = createWindowInputPolicy({
    setIgnoreCursorEvents: async (ignore) => { calls.push(ignore); },
  });
  assert.equal(await policy.enablePassThrough(), true);
  assert.deepEqual(calls, [true]);
  assert.equal(policy.mode, 'pass-through');
});

test('FIX-008 refuses whole-window capture when partial regions are unsupported', async () => {
  const calls: boolean[] = [];
  const policy = createWindowInputPolicy({
    setIgnoreCursorEvents: async (ignore) => { calls.push(ignore); },
  });
  const accepted = await policy.setInteractiveRegions([
    { x: 1, y: 1, width: 20, height: 20, purpose: 'control' },
  ]);
  assert.equal(accepted, false);
  assert.deepEqual(calls, [true]);
  assert.equal(policy.mode, 'pass-through');
});

test('FIX-008 permits only native-proven visible partial regions', async () => {
  const calls: boolean[] = [];
  const policy = createWindowInputPolicy(
    { setIgnoreCursorEvents: async (ignore) => { calls.push(ignore); } },
    { setInteractiveRegions: async (regions) => regions.length === 1 },
  );
  const accepted = await policy.setInteractiveRegions([
    { x: 4, y: 8, width: 50, height: 24, purpose: 'drag-handle' },
  ]);
  assert.equal(accepted, true);
  assert.deepEqual(calls, []);
  assert.equal(policy.mode, 'partial-interactive');
});
