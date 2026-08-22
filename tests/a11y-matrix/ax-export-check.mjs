#!/usr/bin/env node
/**
 * FIX-008 QC — AX export parser + coverage check (deterministic).
 *
 * Parses the macOS Accessibility (AX) tree JSON exports captured from the
 * live candidate app (hash-bound bundle at commit 3bca501) and asserts:
 *   - the export parses (valid JSON, expected shape)
 *   - every visible control in the candidate UI is covered:
 *       AXWindow "Candice", AXWebArea desc "Candice",
 *       AXStaticText "Candice shell ready",
 *       AXImage desc "Candice holographic assistant, standing idle",
 *       AXStaticText "Candice visual shell is available. ..."
 *   - no interactive controls are exposed (button/checkbox/textfield/...)
 *     — consistent with the documented full pass-through policy; recorded
 *     as "not enabled / no visible interactive control", not a synthetic
 *     PASS
 *   - both runs are identical modulo the capturedAt timestamp
 *
 * Usage: node tests/a11y-matrix/ax-export-check.mjs [run1.json] [run2.json]
 * Exit 0 only when every check passes.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const run1Path = process.argv[2] ?? '/tmp/ax-export-run1.json';
const run2Path = process.argv[3] ?? '/tmp/ax-export-run2.json';

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const parse = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    check(`parse ${p}`, false, String(e));
    return null;
  }
};

const run1 = parse(run1Path);
const run2 = parse(run2Path);
check('run1 parses', run1 !== null);
check('run2 parses', run2 !== null);

if (run1 && run2) {
  check('run1 has process + window', run1.process?.pid && run1.window);
  check('run2 has process + window', run2.process?.pid && run2.window);
  check('same process in both runs', run1.process?.pid === run2.process?.pid,
    `pid=${run1.process?.pid}`);

  // ---- flatten the tree -----------------------------------------------------
  const flatten = (n, out = []) => {
    out.push(n);
    for (const c of n.children ?? []) flatten(c, out);
    return out;
  };
  const nodes1 = flatten(run1.window);
  const nodes2 = flatten(run2.window);

  const roles = (nodes) => nodes.map((n) => n.role).filter(Boolean);
  const texts = (nodes) => nodes.map((n) => n.value ?? n.title ?? '').filter((s) => s && s.trim());

  // ---- coverage: every visible control --------------------------------------
  const has = (nodes, pred) => nodes.some(pred);
  const byRole = (nodes, role) => nodes.filter((n) => n.role === role);

  check('AXWindow titled Candice', has(nodes1, (n) => n.role === 'AXWindow' && n.title === 'Candice'));
  check('AXWebArea desc Candice', has(nodes1, (n) => n.role === 'AXWebArea' && n.description === 'Candice'));
  check('AXStaticText "Candice shell ready"',
    has(nodes1, (n) => n.role === 'AXStaticText' && n.value === 'Candice shell ready'));
  check('AXImage desc "Candice holographic assistant, standing idle"',
    has(nodes1, (n) => n.role === 'AXImage'
      && n.description === 'Candice holographic assistant, standing idle'));
  check('AXStaticText fallback guidance present',
    has(nodes1, (n) => n.role === 'AXStaticText'
      && (n.value ?? '').includes('Candice visual shell is available')));
  check('AXApplicationStatus groups present (live regions)',
    byRole(nodes1, 'AXGroup').filter((n) => n.subrole === 'AXApplicationStatus').length >= 1,
    `${byRole(nodes1, 'AXGroup').filter((n) => n.subrole === 'AXApplicationStatus').length} found`);

  // ---- no interactive controls (documented pass-through policy) --------------
  const interactiveRoles = [
    'AXButton', 'AXCheckBox', 'AXRadioButton', 'AXTextField', 'AXTextArea',
    'AXSlider', 'AXComboBox', 'AXPopUpButton', 'AXMenuButton', 'AXLink',
    'AXTabGroup', 'AXScrollBar', 'AXSwitch',
  ];
  const interactive = nodes1.filter((n) => interactiveRoles.includes(n.role));
  check('no interactive controls exposed (full pass-through policy)',
    interactive.length === 0,
    interactive.length ? interactive.map((n) => n.role).join(',') : 'none found');

  // ---- determinism: identical modulo capturedAt + animated geometry ----------
  // The AXImage is the idle holographic assistant; its breathe animation
  // legitimately moves its bounds between captures. Everything else —
  // roles, labels, values, focus order, window geometry — must be
  // byte-identical across runs.
  const strip = (d) => {
    const copy = JSON.parse(JSON.stringify(d));
    delete copy.capturedAt;
    const walk = (n) => {
      if (n.role === 'AXImage') {
        delete n.position;
        delete n.size;
      }
      for (const c of n.children ?? []) walk(c);
    };
    walk(copy.window);
    return JSON.stringify(copy);
  };
  check('AX export deterministic across two runs', strip(run1) === strip(run2));

  // ---- node count sanity ------------------------------------------------------
  check('tree non-trivial', nodes1.length >= 8, `${nodes1.length} nodes`);
}

console.log(failures === 0 ? '\nAX EXPORT CHECK ALL GREEN' : `\n${failures} AX CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
