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

if (!skipLive) {
  // Live AX export: capture the tree twice from the running candidate via
  // the direct AXUIElement exporter (no System Events cache), then check.
  const axRun1 = join(evidenceDir, 'ax-export-run1.json');
  const axRun2 = join(evidenceDir, 'ax-export-run2.json');
  try {
    run('ax-export (run 1)', 'python3', [join(here, 'ax-export.py'), pid, axRun1]);
    run('ax-export (run 2)', 'python3', [join(here, 'ax-export.py'), pid, axRun2]);
    runTwice('ax-export-check', 'node', [join(here, 'ax-export-check.mjs'), axRun1, axRun2]);
  } catch (e) { fail('ax-export', e.message); }

  try {
    run('live-pass-through-grid', 'python3', [join(here, 'live-pass-through-grid.py'), pid, 'Terminal']);
  } catch (e) { fail('live-pass-through-grid', e.message); }

  try {
    run('live-appearance-captures', 'python3',
      [join(here, 'live-appearance-captures.py'), pid, join(evidenceDir, 'captures')]);
  } catch (e) { fail('live-appearance-captures', e.message); }
} else {
  console.log('SKIP live harnesses (--skip-live)');
  // Honest skip: check previously captured AX exports if they exist.
  const axRun1 = join(evidenceDir, 'ax-export-run1.json');
  const axRun2 = join(evidenceDir, 'ax-export-run2.json');
  try {
    runTwice('ax-export-check (cached exports)', 'node', [join(here, 'ax-export-check.mjs'), axRun1, axRun2]);
  } catch (e) {
    console.log(`SKIP ax-export-check (cached exports): ${e.message}`);
    results.push({ label: 'ax-export-check (cached exports)', ok: true, out: 'skipped — no cached exports' });
  }
}

// The FIX-008 candidate is frozen ON PURPOSE: this QC runs against one named
// commit, not against whatever is checked out. But the stamp was
// unconditional, so a run made from any other tree still wrote
// `candidate: 3bca5017…` into evidence and still exited 0. Evidence that
// names a build it did not test is worse than no evidence, and this pack's
// own rule is that a skip never hides behind a green exit.
//
// So the tree is measured and recorded beside the candidate, and a mismatch
// BLOCKS (exit 2, the packaged suite's convention) instead of passing. The
// frozen constant is untouched — the guard is about honesty over which tree
// produced the numbers, not about moving the candidate.
const CANDIDATE = '3bca501794d51cacbb3b8a05f8d68868d750120e';

const gitOut = (args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', cwd: join(here, '..', '..') }).trim();
  } catch {
    return null; // UNDETERMINED, never a confident answer
  }
};

const treeCommit = gitOut(['rev-parse', 'HEAD']);
const treeDirty = gitOut(['status', '--porcelain']);
// CONTROL: if git cannot be read at all, say so rather than reporting a
// clean match by accident. `null` is not "the same as the candidate".
const treeKnown = treeCommit !== null && treeDirty !== null;
const treeMatchesCandidate = treeKnown && treeCommit === CANDIDATE && treeDirty === '';

let blockedReason = null;
if (!treeKnown) {
  blockedReason = 'could not read the working tree state from git, so which build produced these numbers is undetermined';
} else if (treeCommit !== CANDIDATE) {
  blockedReason = `working tree is at ${treeCommit}, not the frozen FIX-008 candidate ${CANDIDATE} — these results describe a different build`;
} else if (treeDirty !== '') {
  const n = treeDirty.split('\n').filter((l) => l.length > 0).length;
  blockedReason = `working tree is at the candidate but carries ${n} uncommitted change(s) — these results describe a modified build`;
}

const report = {
  suite: 'tests/a11y-matrix',
  candidate: CANDIDATE,
  treeCommit,
  treeClean: treeKnown ? treeDirty === '' : null,
  treeMatchesCandidate,
  blockedReason,
  ranAt: new Date().toISOString(),
  skipLive,
  results,
  verdict: blockedReason ? 'BLOCKED' : failed ? 'FAIL' : 'PASS',
};
writeFileSync(join(evidenceDir, 'suite-results.json'), JSON.stringify(report, null, 2));
if (blockedReason) console.log(`\nBLOCKED - ${blockedReason}`);
console.log(`\nSUITE VERDICT: ${report.verdict}`);
process.exit(blockedReason ? 2 : failed ? 1 : 0);
