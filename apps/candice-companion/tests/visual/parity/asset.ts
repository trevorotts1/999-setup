/**
 * FIX-020 parity review harness — asset authority module.
 *
 * Owned lane: tests/visual/parity/** (this file).
 *
 * Loads and validates `assets/candice/asset-manifest.json` (contract
 * candice-operator-originals-v1) and resolves canonical ids to cited
 * sources. The manifest is the only lawful LEFT side of every parity row:
 * a runtime capture may only cite asset ids that exist there, with the
 * manifest's SHA-256 and byte size, otherwise the cite is rejected.
 *
 * Zero dependencies (Node built-ins + the WS-15 codec) so the harness
 * runs in CI containers without the app toolchain.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import type { AssetCite, CheckProof } from './types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSET_ROOT = path.resolve(
  HERE,
  '../../../assets/candice',
);
const MANIFEST_PATH = path.join(ASSET_ROOT, 'asset-manifest.json');
const SOURCE_DIR = path.join(ASSET_ROOT, 'source', 'operator-approved');

export interface AssetManifestEntry {
  id: string;
  file: string;
  role: string;
  semanticPose?: string;
  format: string;
  colorType: string;
  alpha?: { present: boolean };
  width: number;
  height: number;
  sha256: string;
  bytes: number;
  readOnly?: boolean;
  approval?: string;
  provenance?: Record<string, unknown>;
}

export interface AssetManifest {
  manifestVersion: number;
  contract: string;
  spec?: string;
  generatedAt?: string;
  assetCount: number;
  sourceDirectory: string;
  canonicalAuthority: string;
  assets: AssetManifestEntry[];
  stateMap?: Record<string, Record<string, string>>;
  derivedAssets?: unknown[];
  notes?: string[];
}

let cached: AssetManifest | null = null;

/** Load and validate the asset manifest. Throws on contract break. */
export function loadManifest(): AssetManifest {
  if (cached) return cached;
  const raw = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as AssetManifest;
  if (raw.contract !== 'candice-operator-originals-v1') {
    throw new Error(
      `asset manifest contract is '${raw.contract}', expected 'candice-operator-originals-v1'`,
    );
  }
  if (raw.canonicalAuthority !== 'operator-originals') {
    throw new Error(
      `asset manifest authority is '${raw.canonicalAuthority}', expected 'operator-originals'`,
    );
  }
  if (!Array.isArray(raw.assets) || raw.assets.length !== raw.assetCount) {
    throw new Error('asset manifest asset list does not match assetCount');
  }
  for (const a of raw.assets) {
    if (!/^[0-9a-f]{64}$/.test(a.sha256)) {
      throw new Error(`asset '${a.id}' has malformed sha256`);
    }
    if (a.colorType !== 'RGBA') {
      throw new Error(`asset '${a.id}' is not RGBA`);
    }
    if (a.approval !== 'operator-approved') {
      throw new Error(`asset '${a.id}' lacks operator-approved status`);
    }
  }
  cached = raw;
  return raw;
}

/** Resolve an asset id to its cited source (manifest SHA, bytes, role). */
export function cite(id: string): AssetCite {
  const m = loadManifest();
  const entry = m.assets.find((a) => a.id === id);
  if (!entry) {
    throw new Error(`asset id '${id}' is not in the operator manifest`);
  }
  return {
    id: entry.id,
    role: entry.role,
    file: entry.file,
    sha256: entry.sha256,
    bytes: entry.bytes,
    approval: entry.approval ?? 'unknown',
  };
}

/** Absolute path of an asset's source PNG inside source/operator-approved/. */
export function sourcePathOf(c: AssetCite): string {
  const p = path.join(SOURCE_DIR, c.file);
  if (!fs.existsSync(p)) {
    throw new Error(`cited source file missing on disk: ${p}`);
  }
  return p;
}

/** SHA-256 of arbitrary bytes (used to re-derive capture and source hashes). */
export function sha256Bytes(data: Uint8Array): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** SHA-256 of a file. */
export function sha256File(filePath: string): string {
  return sha256Bytes(new Uint8Array(fs.readFileSync(filePath)));
}

/**
 * Re-derive and match the manifest SHA for every canonical asset of a state
 * (negative-result contract: the harness proves the manifest claims against
 * the bytes on disk, it does not trust the manifest).
 */
export function proveManifestShas(ids: string[]): {
  canonicalShas: Record<string, string>;
  proofs: CheckProof[];
} {
  const canonicalShas: Record<string, string> = {};
  const proofs: CheckProof[] = [];
  for (const id of ids) {
    const c = cite(id);
    const p = sourcePathOf(c);
    const buf = fs.readFileSync(p);
    const actual = sha256Bytes(new Uint8Array(buf));
    const pass = actual === c.sha256 && buf.length === c.bytes;
    canonicalShas[id] = c.sha256;
    proofs.push({
      metric: `sha256(${c.file})`,
      value: buf.length,
      threshold: c.bytes,
      pass,
      note: pass
        ? `manifest sha ${c.sha256} re-derived from source bytes`
        : `manifest sha mismatch: derived ${actual}, manifest ${c.sha256}`,
    });
  }
  return { canonicalShas, proofs };
}

/** Global check helpers -------------------------------------------------- */

/** Check 1: capture names an existing canonical asset id + matching SHA. */
export function checkCaptureNamesCanonical(
  captureAssetIds: string[],
  captureSha256: string | undefined,
  captureFile: string,
): CheckProof[] {
  const proofs: CheckProof[] = [];
  let pass = true;
  if (captureAssetIds.length === 0) {
    proofs.push({ metric: 'capture-cites', value: 0, threshold: 1, pass: false, note: 'capture cites no canonical asset id' });
    pass = false;
  }
  for (const id of captureAssetIds) {
    const c = cite(id); // throws if the id is not canonical
    if (captureSha256 !== undefined && captureSha256 !== c.sha256) {
      pass = false;
      proofs.push({
        metric: `capture-sha(${id})`,
        value: captureSha256.length,
        threshold: 64,
        pass: false,
        note: `capture ${captureFile} sha ${captureSha256} does not match canonical ${c.sha256}`,
      });
    } else {
      proofs.push({
        metric: `cite-ok(${id})`,
        value: 1,
        threshold: 1,
        pass: true,
        note: `capture cites canonical ${id} (${c.role})`,
      });
    }
  }
  if (pass) {
    proofs.push({ metric: 'capture-names-canonical', value: captureAssetIds.length, threshold: 1, pass: true, note: 'all cited ids exist in the operator manifest' });
  }
  return proofs;
}

/** Check 2: derivative names its immutable parent id/hash. */
export function checkDerivativeNamesParent(
  derivedAssets: unknown[],
): CheckProof[] {
  const items = derivedAssets as Array<Record<string, unknown>>;
  if (items.length === 0) {
    return [{ metric: 'derivative-count', value: 0, threshold: 0, pass: true, note: 'no derived assets declared; nothing to check' }];
  }
  const proofs: CheckProof[] = [];
  for (const d of items) {
    const sourceIds = Array.isArray(d.sourceIds) ? (d.sourceIds as string[]) : [];
    let pass = sourceIds.length > 0;
    for (const sid of sourceIds) {
      const c = cite(sid as string);
      if (typeof d.sha256 === 'string' && c.sha256 === d.sha256) pass = false; // derived cannot be byte-identical to its parent
    }
    proofs.push({
      metric: `derivative(${String(d.id)})`,
      value: sourceIds.length,
      threshold: 1,
      pass,
      note: pass ? `derivative ${String(d.id)} names parents ${sourceIds.join(', ')}` : `derivative ${String(d.id)} missing parents or sha collides with a parent`,
    });
  }
  return proofs;
}

/** Check 3: no placeholder / generic / experimental-KIE in the release set. */
export function checkNoPlaceholderOrKie(captureFiles: string[], assetIds: string[]): CheckProof[] {
  const proofs: CheckProof[] = [];
  const kie = captureFiles.filter((f) => /experimental-kie/i.test(f));
  const placeholder = assetIds.filter((id) => /placeholder|generic|stock/i.test(id));
  proofs.push({
    metric: 'kie-files',
    value: kie.length,
    threshold: 0,
    pass: kie.length === 0,
    note: kie.length === 0 ? 'no experimental-kie material cited' : `KIE material present: ${kie.join(', ')}`,
  });
  proofs.push({
    metric: 'placeholder-ids',
    value: placeholder.length,
    threshold: 0,
    pass: placeholder.length === 0,
    note: placeholder.length === 0 ? 'no placeholder/generic asset ids cited' : `placeholder ids: ${placeholder.join(', ')}`,
  });
  return proofs;
}
