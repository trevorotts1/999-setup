#!/usr/bin/env node
/**
 * FIX-006 production-bundle assertion.
 *
 * Vite must carry the exact canonical idle PNG into the packaged frontend,
 * and the obsolete development placeholder must not be present in emitted JS.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const dist = join(appRoot, 'src-tauri', 'dist');
const canonicalIdle = join(
  appRoot,
  'assets',
  'candice',
  'source',
  'operator-approved',
  '01-fullbody-idle.png',
);

function filesRecursively(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesRecursively(path) : [path];
  });
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

if (!existsSync(dist)) {
  throw new Error(`frontend bundle is missing: ${dist}; run npm run build first`);
}

const expectedHash = sha256(canonicalIdle);
const emitted = filesRecursively(dist);
const matchingPng = emitted.find(
  (file) => file.endsWith('.png') && sha256(file) === expectedHash,
);
if (!matchingPng) {
  throw new Error('packaged frontend does not contain the canonical idle PNG bytes');
}

const emittedJavaScript = emitted
  .filter((file) => file.endsWith('.js'))
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');
if (/candice-placeholder|data-placeholder|dev-art/.test(emittedJavaScript)) {
  throw new Error('obsolete development placeholder leaked into packaged frontend JS');
}
if (/BOOT_TIMEOUT_MS|10_000/.test(emittedJavaScript)) {
  throw new Error('packaged frontend retains a synthetic boot-readiness timeout');
}

console.log(`PASS canonical idle PNG is packaged: ${matchingPng}`);
