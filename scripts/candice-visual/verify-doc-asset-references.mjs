#!/usr/bin/env node
/**
 * Fails if an asset ID/SHA-256 pair cited in Candice visual planning documents
 * is not the immutable pair in the canonical source manifest.  This is a
 * reference-integrity check; it intentionally cannot approve visual parity.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const docsDir = resolve(root, "docs/candice-visual");
const manifestPath = resolve(root, "apps/candice-companion/assets/candice/asset-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const hashById = new Map(manifest.assets.map(({ id, sha256 }) => [id, sha256]));
const docs = readdirSync(docsDir)
  .filter((name) => name.endsWith(".md") && name !== "README.md")
  .map((name) => resolve(docsDir, name));
const errors = [];

for (const doc of docs) {
  const text = readFileSync(doc, "utf8");
  for (const [, id, hash] of text.matchAll(/`([a-z0-9-]+)`\s*(?:—|\|)\s*`([a-f0-9]{64})`/g)) {
    if (!hashById.has(id)) errors.push(`${doc}: unknown asset ID ${id}`);
    else if (hashById.get(id) !== hash) errors.push(`${doc}: hash mismatch for ${id}`);
  }
}

if (errors.length) {
  console.error("Candice visual document reference check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`PASS: ${docs.length} visual planning documents cite only canonical asset ID/hash pairs.`);
}
