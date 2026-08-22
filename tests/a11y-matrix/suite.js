#!/usr/bin/env node
/**
 * FIX-008 QC — a11y-matrix suite aggregator.
 *
 * Runs every automated harness in this directory in order and fails the
 * suite if any harness fails. Deterministic harnesses (contrast, motion,
 * input-policy, ax-export) run twice each and their outputs are diffed to
 * prove determinism. Live harnesses (pass-through grid, appearance
 * captures) require the packaged candidate app to be running; pass the
 * candidate PID via CANDICE_PID (default 41228).
 *
 * Usage:
 *   node tests/a11y-matrix/suite.js [--skip-live]
 *   CANDICE_PID=<pid> node tests/a11y-matrix/suite.js
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const skipLive = process.argv.includes('--skip-live');
const pid = process.env.CANDICE_PID ?? '41228';
const evidenceDir = join(here, '..', '..', 'evidence', 'FIX-008', 'qc');
mkdirSync(evidenceDir, { recursive: true });

const results = [];
const run = (label, cmd, args, opts = {}) => {
  const out = execFileSync(cmd, args, { encoding: 'utf8', ...opts });
  results.push({ label, ok: true, out });
  console.log(`PASS ${label}`);
  return out;
};

const runTwice = (label, cmd, args) => {
  const a = run(`${label} (run 1)`, cmd, args);
  const b = run(`${label} (run 2)`, cmd, args);
  const deterministic = a === b;
  results.push({ label: `${label} determinism`, ok: deterministic, out: deterministic ? 'identical' : 'DIFFERS' });
  console.log(`${deterministic ? 'PASS' : 'FAIL'} ${label} determinism (two runs identical)`);
  return deterministic;
};

let failed = false;
const fail = (label, err) => {
  failed = true;
  results.push({ label, ok: false, out: String(err) });
  console.log(`FAIL ${label}: ${err}`);
};

try {
  run('contrast.test.mjs (node --test)', 'node', ['--test', join(here, 'contrast.test.mjs')]);
} catch (e) { fail('contrast.test.mjs', e.message); }

try {
  run('motion-scale.test.mjs (node --test)', 'node', ['--test', join(here, 'motion-scale.test.mjs')]);
} catch (e) { fail('motion-scale.test.mjs', e.message); }

try {
  run('live-contrast.test.mjs (node --test)', 'node', ['--test', join(here, 'live-contrast.test.mjs')]);
} catch (e) { fail('live-contrast.test.mjs', e.message); }

try {
  runTwice('contrast-harness', 'node', [join(here, 'contrast-harness.mjs')]);
} catch (e) { fail('contrast-harness', e.message); }

try {
  runTwice('motion-harness', 'node', [join(here, 'motion-harness.mjs')]);
} catch (e) { fail('motion-harness', e.message); }

try {
  runTwice('input-policy-harness', 'node', [join(here, 'input-policy-harness.mjs')]);
} catch (e) { fail('input-policy-harness', e.message); }

try {
  runTwice('ax-export-check', 'node', [join(here, 'ax-export-check.mjs')]);
} catch (e) { fail('ax-export-check', e.message); }

if (!skipLive) {
  try {
    run('live-pass-through-grid', 'python3', [join(here, 'live-pass-through-grid.py'), pid, 'Terminal']);
  } catch (e) { fail('live-pass-through-grid', e.message); }

  try {
    run('live-appearance-captures', 'python3',
      [join(here, 'live-appearance-captures.py'), pid, join(evidenceDir, 'captures')]);
  } catch (e) { fail('live-appearance-captures', e.message); }
} else {
  console.log('SKIP live harnesses (--skip-live)');
}

const report = {
  suite: 'tests/a11y-matrix',
  candidate: '3bca501794d51cacbb3b8a05f8d68868d750120e',
  ranAt: new Date().toISOString(),
  skipLive,
  results,
  verdict: failed ? 'FAIL' : 'PASS',
};
writeFileSync(join(evidenceDir, 'suite-results.json'), JSON.stringify(report, null, 2));
console.log(`\nSUITE VERDICT: ${report.verdict}`);
process.exit(failed ? 1 : 0);
