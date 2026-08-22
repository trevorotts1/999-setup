/**
 * WS-11 tests (node --test, zero deps, Node type stripping).
 *
 * Run:
 *   node --test apps/candice-companion/assets/candice/__tests__/loader.test.ts
 *
 * Covers the E.1 acceptance criterion:
 *   manifest maps all 16 supplied assets (9 first-batch + 7 second-batch)
 *   with stable production filenames, source->derived mapping metadata and
 *   checksums; no ChatGPT download filenames in production code
 *   (Master Spec 11/11A/11B).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import manifest from '../asset-manifest.json' with { type: 'json' };
import {
  AssetRegistry,
  AssetManifestError,
  validateManifest,
  type ManifestShape,
  type ImageFactory,
} from '../loader.ts';

const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(here, '..');
const sourceDir = join(assetsDir, 'source');

const SHA256_HEX = /^[0-9a-f]{64}$/;

test('manifest parses and passes shape validation', () => {
  const problems = validateManifest(manifest as ManifestShape);
  assert.deepEqual(problems, []);
});

test('16 supplied assets mapped + optional 17th, all stable names', () => {
  const ids = manifest.assets.map((a) => a.id);
  assert.equal(manifest.assetCount, 17);
  assert.equal(manifest.assets.length, 17);
  for (const id of ids) {
    assert.match(id, /^[0-9]{2}-[a-z][a-z0-9-]*$/, `unstable id: ${id}`);
  }
  // Every spec-11B role resolves through the stateMap to a stable filename.
  const registry = AssetRegistry.create();
  const expectRole = (group: string, key: string, id: string) => {
    const entry = registry.resolve(group, key);
    assert.equal(entry.id, id, `${group}.${key} -> ${entry.id}`);
    assert.equal(entry.file, `${id}.png`);
  };
  expectRole('body', 'idle-standing', '01-fullbody-idle');
  expectRole('body', 'welcome-wave', '12-gesture-welcome');
  expectRole('body', 'presenting', '13-gesture-presenting');
  expectRole('body', 'listening', '14-gesture-listening');
  expectRole('body', 'thinking', '15-gesture-thinking');
  expectRole('body', 'approval', '16-gesture-affirmative');
  expectRole('face', 'speech-wide', '06-mouth-wide-open');
  expectRole('face', 'idle-neutral', '03-mouth-neutral-closed');
  expectRole('gesture', 'processing', '17-processing-pose');
});

test('every entry carries sha256 + dimensions + byteSize and matches source on disk', () => {
  for (const a of manifest.assets) {
    assert.match(a.sha256, SHA256_HEX, `bad sha256 on ${a.id}`);
    assert.ok(a.width > 0 && a.height > 0, `bad dims on ${a.id}`);
    assert.ok(a.bytes > 0, `bad byteSize on ${a.id}`);
    assert.equal(a.readOnly, true, `source not marked readOnly: ${a.id}`);
    const src = join(sourceDir, a.file);
    const raw = readFileSync(src);
    assert.equal(raw.length, a.bytes, `byteSize mismatch on ${a.id}`);
  }
});

test('source->derived mapping metadata present (derivedAssets slot wired)', () => {
  // WS-12/WS-13 fill derivedAssets later; the slot and shape are contract now.
  assert.ok(Array.isArray(manifest.derivedAssets));
  assert.ok(
    manifest.sourceDirectory === 'source/',
    `sourceDirectory unexpected: ${manifest.sourceDirectory}`,
  );
});

test('no ChatGPT download filenames in any production path', () => {
  const forbidden = /(chatgpt|download|\([0-9]+\)|copy|_\(|\)\.png)/i;
  for (const a of manifest.assets) {
    assert.doesNotMatch(a.file, forbidden, `raw name leaked: ${a.file}`);
  }
  for (const [group, map] of Object.entries(manifest.stateMap)) {
    for (const [key, file] of Object.entries(map)) {
      assert.doesNotMatch(file, forbidden, `raw name in stateMap ${group}.${key}`);
    }
  }
  assert.doesNotMatch(manifest.sourceDirectory, forbidden);
});

test('loader is lazy: resolving never decodes an image', () => {
  const decoded: string[] = [];
  const factory: ImageFactory = (src) => {
    decoded.push(src);
    return { src } as HTMLImageElement;
  };
  const registry = AssetRegistry.create(factory);
  const entries = registry.list();
  assert.equal(entries.length, 17);
  registry.resolve('face', 'speech-wide');
  registry.resolve('gesture', 'thinking');
  assert.equal(decoded.length, 0, 'resolve() must not decode pixels');
  const img = registry.loadImage(registry.resolve('gesture', 'welcome'));
  assert.equal(decoded.length, 1, 'loadImage() decodes exactly one asset');
  assert.equal(decoded[0], 'source/12-gesture-welcome.png');
  assert.equal(img.src, 'source/12-gesture-welcome.png');
});

test('registry rejects unknown ids and keys loudly', () => {
  const registry = AssetRegistry.create();
  assert.throws(() => registry.get('99-bogus'), AssetManifestError);
  assert.throws(() => registry.resolve('face', 'nope'), AssetManifestError);
  assert.throws(() => registry.resolve('nope', 'idle'), AssetManifestError);
});

test('batch provenance is recorded, not used as production identity', () => {
  const first = manifest.assets.filter((a) => a.batch.startsWith('first-batch'));
  const second = manifest.assets.filter((a) => a.batch.startsWith('second-batch'));
  const extra = manifest.assets.filter((a) => a.batch.startsWith('operator-supplied'));
  assert.equal(first.length, 9, 'first batch must be 9');
  assert.equal(second.length, 7, 'second batch must be 7');
  assert.equal(extra.length, 1, 'operator-supplied 17th must be 1');
});

test('flagged anomaly 10-eye-half-blink recorded in notes', () => {
  const ten = manifest.assets.find((a) => a.id === '10-eye-half-blink');
  assert.ok(ten, '10-eye-half-blink missing');
  assert.ok(ten.alpha.mean > 100, `expected near-opaque flag, mean ${ten.alpha.mean}`);
  const note = manifest.notes.find((n: string) => n.includes('10-eye-half-blink'));
  assert.ok(note, 'anomaly note missing for 10-eye-half-blink');
});
