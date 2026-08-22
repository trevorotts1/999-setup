#!/usr/bin/env node
/** FIX-008 package assertion: checks the built payload, never source alone. */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../src-tauri/dist/', import.meta.url);
const assets = new URL('./assets/', dist);
const files = readdirSync(assets).sort();
const js = files.filter((file) => file.endsWith('.js'))
  .map((file) => readFileSync(join(assets.pathname, file), 'utf8'))
  .join('\n');
const cssFile = files.find((file) => file.endsWith('.css'));
if (!cssFile) throw new Error('FIX-008 FAIL: built CSS missing');
const css = readFileSync(join(assets.pathname, cssFile), 'utf8');

for (const token of [
  'setIgnoreCursorEvents',
  'candiceA11yRuntime',
  'candiceTextScale',
  'candice-window-ready',
]) {
  if (!js.includes(token)) throw new Error(`FIX-008 FAIL: built JS omits ${token}`);
}
for (const token of ['forced-colors', '--candice-ui-surface', '--candice-text-scale']) {
  if (!css.includes(token)) throw new Error(`FIX-008 FAIL: built CSS omits ${token}`);
}
if (/show\(\)[\s\S]{0,120}setFocus\(\)/.test(js)) {
  throw new Error('FIX-008 FAIL: wake/show still steals focus in the built payload');
}

console.log('FIX-008 PASS: built payload contains a11y wiring, pass-through policy, and contrast tokens.');
