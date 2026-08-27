#!/usr/bin/env node
/**
 * FIX-008 QC — input-policy harness (deterministic, pure Node).
 *
 * Imports the candidate window/input-policy.ts (exact blob at commit
 * 3bca501) and drives it against fake window/adapter objects. Exercises:
 *   - enablePassThrough success/failure (mode transitions, no throw)
 *   - fail-closed setInteractiveRegions: null adapter, empty regions,
 *     invalid regions, adapter rejection, adapter throw — every path must
 *     reassert pass-through and return false
 *   - valid regions + adapter success → partial-interactive
 *   - null window → unavailable, never throws
 *
 * Usage: node tests/a11y-matrix/input-policy-harness.mjs
 * Exit 0 only when every check passes. Prints PASS/FAIL per check.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, 'fixtures', 'candidate-a11y', 'apps', 'candice-companion', 'src');
const { createWindowInputPolicy } = await import(join(FIX, 'window', 'input-policy.ts'));

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const goodRegion = { x: 10, y: 20, width: 100, height: 40, purpose: 'control' };

// ---- 1. pass-through enable -------------------------------------------------
{
  const calls = [];
  const win = { setIgnoreCursorEvents: async (v) => { calls.push(v); } };
  const p = createWindowInputPolicy(win);
  check('initial mode pass-through', p.mode === 'pass-through');
  const ok = await p.enablePassThrough();
  check('enablePassThrough returns true', ok === true);
  check('enablePassThrough calls setIgnoreCursorEvents(true)', calls.length === 1 && calls[0] === true);
  check('mode stays pass-through', p.mode === 'pass-through');
}
{
  const win = { setIgnoreCursorEvents: async () => { throw new Error('unsupported'); } };
  const p = createWindowInputPolicy(win);
  const ok = await p.enablePassThrough();
  check('enablePassThrough failure returns false', ok === false);
  check('enablePassThrough failure mode unavailable', p.mode === 'unavailable');
}
{
  const p = createWindowInputPolicy(null);
  const ok = await p.enablePassThrough();
  check('null window: unavailable, returns false', p.mode === 'unavailable' && ok === false);
}

// ---- 2. fail-closed setInteractiveRegions ------------------------------------
{
  const calls = [];
  const win = { setIgnoreCursorEvents: async (v) => { calls.push(v); } };
  const p = createWindowInputPolicy(win, null);
  const ok = await p.setInteractiveRegions([goodRegion]);
  check('null adapter: returns false', ok === false);
  check('null adapter: reasserts pass-through', calls.length === 1 && calls[0] === true);
  check('null adapter: mode pass-through', p.mode === 'pass-through');
}
{
  const calls = [];
  const win = { setIgnoreCursorEvents: async (v) => { calls.push(v); } };
  const adapter = { setInteractiveRegions: async () => true };
  const p = createWindowInputPolicy(win, adapter);
  const ok = await p.setInteractiveRegions([]);
  check('empty regions: returns false', ok === false);
  check('empty regions: reasserts pass-through', calls.length === 1 && calls[0] === true);
}
{
  const calls = [];
  const win = { setIgnoreCursorEvents: async (v) => { calls.push(v); } };
  const adapter = { setInteractiveRegions: async () => true };
  const p = createWindowInputPolicy(win, adapter);
  const bad = [
    { x: NaN, y: 0, width: 10, height: 10, purpose: 'control' },
    { x: 0, y: Infinity, width: 10, height: 10, purpose: 'control' },
    { x: 0, y: 0, width: 0, height: 10, purpose: 'control' },
    { x: 0, y: 0, width: 10, height: -5, purpose: 'control' },
    { x: 0, y: 0, width: 10, height: 10, purpose: 'control' }, // valid
  ];
  const ok = await p.setInteractiveRegions(bad);
  check('any invalid region: returns false', ok === false);
  check('any invalid region: reasserts pass-through', calls.length === 1 && calls[0] === true);
  check('any invalid region: mode pass-through', p.mode === 'pass-through');
}
{
  const calls = [];
  const win = { setIgnoreCursorEvents: async (v) => { calls.push(v); } };
  const adapter = { setInteractiveRegions: async () => false };
  const p = createWindowInputPolicy(win, adapter);
  const ok = await p.setInteractiveRegions([goodRegion]);
  check('adapter returns false: policy returns false', ok === false);
  check('adapter returns false: reasserts pass-through', calls.length === 1 && calls[0] === true);
  check('adapter returns false: mode pass-through', p.mode === 'pass-through');
}
{
  const calls = [];
  const win = { setIgnoreCursorEvents: async (v) => { calls.push(v); } };
  const adapter = { setInteractiveRegions: async () => { throw new Error('native failure'); } };
  const p = createWindowInputPolicy(win, adapter);
  const ok = await p.setInteractiveRegions([goodRegion]);
  check('adapter throws: returns false', ok === false);
  check('adapter throws: reasserts pass-through', calls.length === 1 && calls[0] === true);
  check('adapter throws: mode pass-through', p.mode === 'pass-through');
}

// ---- 3. happy path ------------------------------------------------------------
{
  const calls = [];
  const win = { setIgnoreCursorEvents: async (v) => { calls.push(v); } };
  const installed = [];
  const adapter = { setInteractiveRegions: async (regions) => { installed.push(regions); return true; } };
  const p = createWindowInputPolicy(win, adapter);
  const ok = await p.setInteractiveRegions([goodRegion]);
  check('valid regions + adapter success: returns true', ok === true);
  check('valid regions + adapter success: mode partial-interactive', p.mode === 'partial-interactive');
  check('adapter received exact regions', installed.length === 1 && installed[0][0] === goodRegion);
  check('no pass-through call on success', calls.length === 0);
}

// ---- 4. mode getter reflects state --------------------------------------------
{
  const win = { setIgnoreCursorEvents: async () => {} };
  const p = createWindowInputPolicy(win);
  await p.enablePassThrough();
  check('mode getter pass-through after enable', p.mode === 'pass-through');
}

console.log(failures === 0 ? '\nINPUT-POLICY HARNESS ALL GREEN' : `\n${failures} INPUT-POLICY CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
