/**
 * Candice Companion — final-art loader (WS-11).
 *
 * Owned by WR-013 (ownership map 9.2: assets/candice/**). Lives inside the
 * asset directory because the slice map beats the workflow prompt wording:
 * WR-013 may create only under assets/candice/ (claim-before-create rule for
 * src/** paths).
 *
 * Contract (Master Spec 11/11A/11B):
 *  - Reads the asset manifest; every asset is addressed by STABLE id/role,
 *    never by a raw ChatGPT download filename (those are provenance only).
 *  - LAZY: resolving a role returns metadata; nothing is fetched or decoded
 *    until the caller asks for pixels (spec 11B: runtime derivatives load on
 *    demand, so the shell stays light during boot).
 *  - Source PNGs are read-only. This loader never writes or derives; derived
 *    assets appear in the manifest under derivedAssets when WS-12/WS-13 land.
 *
 * Zero dependencies: pure TypeScript, works under `node --test` (Node type
 * stripping) and under Vite in the shell payload.
 */

import manifest from './asset-manifest.json' with { type: 'json' };

/** One manifest entry: metadata only, no pixels. */
export interface AssetEntry {
  id: string;
  file: string;
  role: string;
  batch?: string;
  format: string;
  colorType: "RGBA";
  semanticPose: string;
  width: number;
  height: number;
  alpha: { present: true };
  sha256: string;
  bytes: number;
  readOnly: true;
  approval: "operator-approved";
  provenance: {
    originalFilename: string;
    sourceBatch: string;
    sourceSha256: string;
    sourceBytes: number;
    copiedByteForByte: true;
  };
}

export interface DerivedAssetEntry {
  id: string;
  file: string;
  sourceIds: string[];
  width: number;
  height: number;
  sha256: string;
}

export interface ManifestShape {
  manifestVersion: number;
  contract: string;
  spec: string;
  generatedAt: string;
  assetCount: number;
  sourceDirectory: string;
  canonicalAuthority: string;
  assets: AssetEntry[];
  stateMap: Record<string, Record<string, string>>;
  derivedAssets: DerivedAssetEntry[];
  notes: string[];
}

/** Decode entry -> HTMLImageElement. Injected so tests can prove laziness. */
export type ImageFactory = (src: string) => HTMLImageElement;

const defaultImageFactory: ImageFactory = (src) => {
  const img = new Image();
  img.src = src;
  return img;
};

const SHA256_HEX = /^[0-9a-f]{64}$/;

export class AssetManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetManifestError';
  }
}

/** Validate the manifest shape; throws AssetManifestError on contract break. */
export function validateManifest(m: ManifestShape): string[] {
  const problems: string[] = [];
  if (m.manifestVersion !== 2) {
    problems.push(`manifestVersion must be 2, got ${m.manifestVersion}`);
  }
  if (m.contract !== 'candice-operator-originals-v1') {
    problems.push(`unknown contract: ${m.contract}`);
  }
  if (!Array.isArray(m.assets) || m.assets.length !== m.assetCount) {
    problems.push(`assetCount ${m.assetCount} does not match ${m.assets?.length ?? 0} entries`);
  }
  const seen = new Set<string>();
  for (const a of m.assets ?? []) {
    if (seen.has(a.id)) problems.push(`duplicate id: ${a.id}`);
    seen.add(a.id);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(a.id)) problems.push(`non-stable id: ${a.id}`);
    if (!a.sha256 || !SHA256_HEX.test(a.sha256)) problems.push(`bad sha256 for ${a.id}`);
    if (!(a.width > 0) || !(a.height > 0)) problems.push(`bad dimensions for ${a.id}`);
    if (a.file !== `${a.id}.png`) problems.push(`file/name mismatch for ${a.id}: ${a.file}`);
    if (/chatgpt|download|\([0-9]+\)/i.test(a.file)) problems.push(`raw download filename leaked: ${a.file}`);
  }
  if (m.assets.length !== 16) problems.push(`need exactly 16 operator originals, have ${m.assets.length}`);
  if (m.sourceDirectory !== 'source/operator-approved/') {
    problems.push(`canonical sourceDirectory must be source/operator-approved/, got ${m.sourceDirectory}`);
  }
  if (m.canonicalAuthority !== 'operator-originals') problems.push('canonical authority must be operator-originals');
  for (const [group, map] of Object.entries(m.stateMap ?? {})) {
    for (const [key, file] of Object.entries(map)) {
      const id = file.replace(/\.png$/, '');
      if (!seen.has(id)) problems.push(`stateMap ${group}.${key} -> ${file} not in assets`);
    }
  }
  return problems;
}

/**
 * Lazy asset registry. Construction parses metadata only; image decode
 * happens exclusively inside loadImage().
 */
export class AssetRegistry {
  private readonly byId = new Map<string, AssetEntry>();
  private readonly manifest: ManifestShape;
  private readonly imageFactory: ImageFactory;

  constructor(
    manifestData: ManifestShape,
    imageFactory: ImageFactory = defaultImageFactory,
  ) {
    const problems = validateManifest(manifestData);
    if (problems.length > 0) {
      throw new AssetManifestError(problems.join('; '));
    }
    this.manifest = manifestData;
    this.imageFactory = imageFactory;
    for (const entry of manifestData.assets) {
      this.byId.set(entry.id, entry);
    }
  }

  /** Registry over the checked-in manifest. */
  static create(
    imageFactory: ImageFactory = defaultImageFactory,
  ): AssetRegistry {
    return new AssetRegistry(manifest as ManifestShape, imageFactory);
  }

  get(id: string): AssetEntry {
    const entry = this.byId.get(id);
    if (!entry) {
      throw new AssetManifestError(`unknown asset id: ${id}`);
    }
    return entry;
  }

  /** Resolve a state role (stateMap group + key) to metadata. No decode. */
  resolve(group: string, key: string): AssetEntry {
    const map = this.manifest.stateMap[group];
    if (!map) throw new AssetManifestError(`unknown state group: ${group}`);
    const file = map[key];
    if (!file) throw new AssetManifestError(`unknown state key: ${group}.${key}`);
    return this.get(file.replace(/\.png$/, ''));
  }

  list(): readonly AssetEntry[] {
    return this.manifest.assets;
  }

  /** The only pixel-producing call: decode exactly the requested entry. */
  loadImage(entry: AssetEntry, sourceUrl?: string): HTMLImageElement {
    return this.imageFactory(sourceUrl ?? `${this.manifest.sourceDirectory}${entry.file}`);
  }
}
