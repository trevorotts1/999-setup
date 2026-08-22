#!/usr/bin/env node
/**
 * FIX-008 QC — contrast harness (deterministic, pure Node, zero deps).
 *
 * Parses the candidate styles.css fixture (exact blob at commit 3bca501)
 * and computes WCAG 2.1 contrast ratios for every declared token pair:
 *   - text/surface, muted/surface >= 4.5:1 (normal text)
 *   - border/surface, focus-ring/surface >= 3:1 (non-text UI)
 * Also verifies: forced-colors block covers every visible surface class,
 * text-scale token is bounded by the runtime constants, and the
 * reduced-motion media query stops the continuous CSS loops.
 *
 * Usage: node tests/a11y-matrix/contrast-harness.mjs [fixture.css]
 * Exit 0 only when every check passes. Prints PASS/FAIL per check.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = process.argv[2] ?? join(here, 'fixtures', 'candidate-a11y', 'apps', 'candice-companion', 'src', 'styles.css');
const css = readFileSync(cssPath, 'utf8');

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// ---- token extraction -----------------------------------------------------
const token = (name) => {
  const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
};

const hex = (v) => {
  if (!v) return null;
  const m = v.match(/^#([0-9a-fA-F]{6})$/);
  return m ? m[1].toLowerCase() : null;
};

const lum = (h) => {
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};

const ratio = (a, b) => {
  const [la, lb] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (la + 0.05) / (lb + 0.05);
};

const TEXT = hex(token('candice-text'));
const MUTED = hex(token('candice-muted'));
const SURFACE = hex(token('candice-ui-surface'));
const BORDER = hex(token('candice-ui-border'));
const FOCUS = hex(token('candice-focus-ring'));

check('tokens present', [TEXT, MUTED, SURFACE, BORDER, FOCUS].every(Boolean),
  `text=${TEXT} muted=${MUTED} surface=${SURFACE} border=${BORDER} focus=${FOCUS}`);

const textRatio = TEXT && SURFACE ? ratio(TEXT, SURFACE) : 0;
const mutedRatio = MUTED && SURFACE ? ratio(MUTED, SURFACE) : 0;
const borderRatio = BORDER && SURFACE ? ratio(BORDER, SURFACE) : 0;
const focusRatio = FOCUS && SURFACE ? ratio(FOCUS, SURFACE) : 0;

check('text/surface >= 4.5:1', textRatio >= 4.5, `${textRatio.toFixed(2)}:1`);
check('muted/surface >= 4.5:1', mutedRatio >= 4.5, `${mutedRatio.toFixed(2)}:1`);
check('border/surface >= 3:1', borderRatio >= 3, `${borderRatio.toFixed(2)}:1`);
check('focus-ring/surface >= 3:1', focusRatio >= 3, `${focusRatio.toFixed(2)}:1`);

// ---- forced-colors coverage ----------------------------------------------
const visibleSurfaces = [
  '.candice-status-surface',
  '.fallback-title',
  '.fallback-hint',
  '.candice-runtime-status',
];
const fcBlock = css.match(/@media \(forced-colors: active\) \{([\s\S]*?)\n\}/);
check('forced-colors block present', fcBlock !== null);
if (fcBlock) {
  for (const sel of visibleSurfaces) {
    check(`forced-colors covers ${sel}`, fcBlock[1].includes(sel));
  }
  check('forced-colors uses system Canvas tokens',
    fcBlock[1].includes('Canvas') && fcBlock[1].includes('CanvasText'));
  check('forced-colors focus outline uses Highlight', fcBlock[1].includes('Highlight'));
}

// ---- text-scale token -----------------------------------------------------
const scaleToken = token('candice-text-scale');
check('text-scale token declared', scaleToken === '1', `value=${scaleToken}`);
const scaleUses = (css.match(/var\(--candice-text-scale\)/g) ?? []).length;
check('text-scale token consumed by visible surfaces', scaleUses >= 3, `${scaleUses} uses`);

// ---- reduced-motion coverage ----------------------------------------------
const rmBlock = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/);
check('reduced-motion media query present', rmBlock !== null);
if (rmBlock) {
  check('reduced-motion stops boot-glow animation', rmBlock[1].includes('.boot-glow'));
  check('reduced-motion stops character animation', rmBlock[1].includes('.candice-character-image'));
}
const keyframes = (css.match(/@keyframes/g) ?? []).length;
check('continuous CSS loops exist to be stopped', keyframes >= 1, `${keyframes} keyframes`);

// ---- focus visibility -----------------------------------------------------
check('focus-visible outline declared', /:focus-visible\s*\{[^}]*outline:\s*3px/.test(css));
check('focus outline offset declared', /:focus-visible\s*\{[^}]*outline-offset:\s*3px/.test(css));

// ---- no baked background --------------------------------------------------
check('body background transparent', /body\s*\{[^}]*background:\s*transparent/.test(css));

console.log(failures === 0 ? '\nCONTRAST HARNESS ALL GREEN' : `\n${failures} CONTRAST CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
