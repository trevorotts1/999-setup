import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import manifest from '../asset-manifest.json' with { type: 'json' };
import { AssetRegistry, validateManifest, type ManifestShape } from '../loader.ts';

const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(here, '..');
const canonicalDir = join(assetsDir, 'source', 'operator-approved');
const downloadsDir = join(process.env.CANDICE_OPERATOR_ORIGINALS_DIR || '/Users/blackceomacmini/Downloads');
const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const pngDimensions = (file: string) => {
  const data = readFileSync(file);
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
};

test('operator-original manifest validates as the only canonical authority', () => {
  assert.deepEqual(validateManifest(manifest as ManifestShape), []);
  assert.equal(manifest.assetCount, 16);
  assert.equal(manifest.canonicalAuthority, 'operator-originals');
  assert.equal(manifest.sourceDirectory, 'source/operator-approved/');
  assert.equal(manifest.derivedAssets.length, 0);
});

test('canonical directory contains exactly the 16 manifest PNGs and no KIE selection', () => {
  const files = readdirSync(canonicalDir).filter((file) => file.endsWith('.png')).sort();
  const expected = manifest.assets.map((asset) => asset.file).sort();
  assert.deepEqual(files, expected);
  assert.equal(files.length, 16);
  assert.equal(manifest.assets.some((asset) => /kie|experimental/i.test(asset.file)), false);
  assert.equal(existsSync(join(assetsDir, 'derived', 'experimental-kie')), true);
});

test('every canonical copy exactly matches its approved Downloads original', () => {
  const inventory = new Map<string, number>();
  for (const asset of manifest.assets) {
    const canonical = join(canonicalDir, asset.file);
    const original = join(downloadsDir, asset.provenance.originalFilename);
    assert.equal(existsSync(original), true, `missing Downloads original: ${asset.provenance.originalFilename}`);
    const dims = pngDimensions(canonical);
    assert.equal(hash(canonical), asset.sha256, asset.id);
    assert.equal(hash(canonical), asset.provenance.sourceSha256, asset.id);
    assert.equal(hash(canonical), hash(original), asset.id);
    assert.equal(readFileSync(canonical).length, asset.bytes, asset.id);
    assert.equal(readFileSync(canonical).length, asset.provenance.sourceBytes, asset.id);
    assert.deepEqual(dims, { width: asset.width, height: asset.height }, asset.id);
    assert.equal(asset.provenance.copiedByteForByte, true);
    assert.equal(asset.approval, 'operator-approved');
    inventory.set(`${asset.width}x${asset.height}`, (inventory.get(`${asset.width}x${asset.height}`) || 0) + 1);
  }
  assert.deepEqual(Object.fromEntries(inventory), { '941x1672': 2, '1254x1254': 7, '1024x1536': 7 });
});

test('all active state mappings resolve only to canonical original metadata', () => {
  const registry = AssetRegistry.create();
  for (const [group, map] of Object.entries(manifest.stateMap)) {
    for (const key of Object.keys(map)) {
      const entry = registry.resolve(group, key);
      assert.equal(entry.approval, 'operator-approved');
      assert.match(entry.file, /^[0-9]{2}-[a-z0-9-]+\.png$/);
    }
  }
});

test('loader remains lazy and resolves the canonical source path', () => {
  const decoded: string[] = [];
  const registry = AssetRegistry.create((src) => {
    decoded.push(src);
    return { src } as HTMLImageElement;
  });
  const entry = registry.resolve('body', 'idle-standing');
  assert.equal(decoded.length, 0);
  registry.loadImage(entry);
  assert.deepEqual(decoded, ['source/operator-approved/01-fullbody-idle.png']);
});
