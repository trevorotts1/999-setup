import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_TEXT_SCALE,
  MAX_TEXT_SCALE,
  MIN_TEXT_SCALE,
  normalizeTextScale,
} from '../runtime.ts';

test('FIX-008 text-scale normalization is bounded and never invents a value', () => {
  assert.equal(normalizeTextScale(undefined), DEFAULT_TEXT_SCALE);
  assert.equal(normalizeTextScale(null), DEFAULT_TEXT_SCALE);
  assert.equal(normalizeTextScale('1.2'), DEFAULT_TEXT_SCALE);
  assert.equal(normalizeTextScale(0.1), MIN_TEXT_SCALE);
  assert.equal(normalizeTextScale(99), MAX_TEXT_SCALE);
  assert.equal(normalizeTextScale(1.25), 1.25);
});
