#!/usr/bin/env node
/**
 * FIX-014 interaction-composition package assertion: checks the built
 * payload, never source alone. Proves the packaged bundle contains:
 *  - the application-owned interaction composition sentinel,
 *  - the first-run name prompt surface (spec 4 question text + style),
 *  - the dedicated answer-controls and captions mount ids (the I-13
 *    mount-wipe fix: neither view may clear the shared #app root),
 *  - the native prefs seam commands (cmd_load_profile / cmd_save_profile),
 *  - the a11y text-scale token consumed by the answer surface and the
 *    name prompt (spec 9),
 * and proves the bundle does NOT pull the node:fs prefs store (store.ts
 * must never leak into the webview payload).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../src-tauri/dist/', import.meta.url);
const assets = new URL('./assets/', dist);
const files = readdirSync(assets).sort();
const js = files.filter((file) => file.endsWith('.js'))
  .map((file) => readFileSync(join(assets.pathname, file), 'utf8'))
  .join('\n');
const cssFile = files.find((file) => file.endsWith('.css'));
if (!cssFile) throw new Error('FIX-014 FAIL: built CSS missing');
const css = readFileSync(join(assets.pathname, cssFile), 'utf8');

for (const token of [
  'candice-interaction-composition',
  'candice-name-prompt',
  'candice-name-prompt-style',
  "Hi, I'm Candice. What's your name?",
  'Welcome back, ',
  'candice-answer-controls-mount',
  'candice-captions-mount',
  'cmd_load_profile',
  'cmd_save_profile',
  'candiceVoiceOutput',
  'candicePreferredName',
]) {
  if (!js.includes(token)) throw new Error(`FIX-014 FAIL: built JS omits ${token}`);
}
for (const token of ['calc(14px * var(--candice-text-scale']) {
  if (!css.includes(token)) throw new Error(`FIX-014 FAIL: built CSS omits ${token}`);
}
// The webview bundle must never pull the node:fs prefs store (store.ts).
for (const token of ['node:fs', 'readFileSync', 'writeFileSync']) {
  if (js.includes(token)) throw new Error(`FIX-014 FAIL: built JS leaks the node:fs prefs store (${token})`);
}

console.log('FIX-014 PASS: built payload contains the interaction composition, name flow, dedicated mounts, prefs seam, and text-scale token.');
