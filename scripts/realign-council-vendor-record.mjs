#!/usr/bin/env node
// Council of Wise Elders: realign the vendoring record after a deliberate
// change to the vendored tree (999-setup).
//
// scripts/vendor-council-bundle.mjs has no regeneration mode: it re-vendors
// from a clean canonical openclaw-onboarding tree and writes manifest.json,
// DISTRIBUTION-RECONCILIATION.json and installer-registration/council-vendoring.json
// together. A runtime fix that lands in the vendored tree (runtime/src/cli/*)
// is therefore not covered by any tool, and the integrity test fails.
//
// This tool closes that gap WITHOUT touching the canonical identity: the
// record keeps its canonical_source, its canonical_files, and every
// intentional_distribution_differences entry exactly as the vendoring tool
// wrote them. It only adds/updates the distribution side:
//
//   - every manifest.json entry is recorded in canonical_files with the hash
//     that file actually has (the three Brunson strip files stay as the
//     vendoring tool's strip left them; the reconciliation report and
//     manifest.json are declarable differences and are not recorded);
//   - distribution.distribution_aggregate_sha256 / _file_count are
//     recomputed from the tree with the canonical hash method;
//   - a distribution_local_changes entry records the paths it realigned,
//     by hash only, so the fact that they are not canonical is on the record.
//
// A file present in canonical_files but absent from the tree still fails
// the integrity test: this tool never registers a deletion.
//
// Usage:
//   node scripts/realign-council-vendor-record.mjs [--write] [--repo <dir>]
//
// Without --write it prints what it would change and writes nothing. Exit 1
// when the tree does not recompute to its own manifest.json, when a manifest
// entry does not match the tree, or when a recorded file is missing from it.
//
// The dist02 packaging manifest measures the tree directory itself, so after
// a realign it is refreshed with the black-friday-launcher generator:
//   python3 .claude/skills/black-friday-launcher/scripts/generate_dist02_manifest.py

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const write = argv.includes("--write");
const repoArg = argv.indexOf("--repo");
const root = repoArg >= 0 ? resolve(argv[repoArg + 1]) : repoRoot;

const DECLARED = new Set([
  "advisors/russell-brunson/frameworks.json",
  "advisors/russell-brunson/failure-patterns.json",
  "advisors/russell-brunson/decision-rules.json",
  "manifest.json",
  "DISTRIBUTION-RECONCILIATION.json",
]);

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function walk(dir, base = dir, acc = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, base, acc);
    else acc.push(relative(base, p).split("\\").join("/"));
  }
  return acc;
}

const tree = join(root, ".claude", "skills", "council-of-wise-elders");
const recPath = join(root, "installer-registration", "council-vendoring.json");

const record = JSON.parse(readFileSync(recPath, "utf8"));
const manifest = JSON.parse(readFileSync(join(tree, "manifest.json"), "utf8"));
const errors = [];

const manifestFiles = Array.isArray(manifest.files) ? manifest.files : [];
const hashes = new Map(manifestFiles.map((e) => [e.path, e.sha256]));
const entries = [...hashes.entries()]
  .sort((a, b) => (a[0] < b[0] ? -1 : 1))
  .map(([p, h]) => `${h}  ${p}`);
const aggregate = sha256(Buffer.from(entries.join("\n") + "\n", "utf8"));
if (aggregate !== manifest.aggregate_sha256 || entries.length !== manifest.file_count) {
  console.error(`FAIL manifest.json does not recompute: tree ${aggregate}/${entries.length}, manifest ${manifest.aggregate_sha256}/${manifest.file_count}`);
  process.exit(1);
}
for (const e of manifestFiles) {
  const actual = sha256(readFileSync(join(tree, e.path)));
  if (actual !== e.sha256) errors.push(`manifest entry ${e.path} does not match the tree`);
}
const present = new Set(walk(tree));
for (const path of Object.keys(record.canonical_files ?? {})) {
  if (!present.has(path)) errors.push(`canonical file missing from the tree: ${path}`);
}
if (errors.length) {
  for (const e of errors) console.error(`FAIL ${e}`);
  process.exit(1);
}

const nextFiles = { ...(record.canonical_files ?? {}) };
const realigned = [];
for (const e of manifestFiles) {
  if (DECLARED.has(e.path)) continue;
  if (nextFiles[e.path] === e.sha256) continue;
  realigned.push({ path: e.path, sha256: e.sha256, previous_sha256: nextFiles[e.path] ?? null });
  nextFiles[e.path] = e.sha256;
}

const differences = (record.intentional_distribution_differences ?? []).filter(
  (d) => d.kind !== "distribution_local_changes");
if (realigned.length) {
  differences.push({
    kind: "distribution_local_changes",
    rule: "Files changed in the distribution tree on top of the vendoring tool's strip (for example a runtime fix that has no canonical counterpart yet), realigned by scripts/realign-council-vendor-record.mjs. Each entry records the vendored hash and, when there was one, the canonical hash it replaced. The canonical source is unchanged; re-vendoring from a canonical tree that carries the change folds these into canonical_files and removes this entry.",
    files: realigned.map(({ path, sha256, previous_sha256 }) => ({ path, sha256, previous_sha256 })),
  });
}

const nextRecord = {
  ...record,
  intentional_distribution_differences: differences,
  // Mirrors the key order vendor-council-bundle.mjs writes.
  distribution: {
    vendored_path: record.distribution.vendored_path,
    distribution_aggregate_sha256: aggregate,
    distribution_file_count: entries.length,
  },
  canonical_files: Object.fromEntries(
    [...Object.entries(nextFiles)].sort((a, b) => (a[0] < b[0] ? -1 : 1))),
};

const summarize = (r) => [
  `distribution aggregate: record=${record.distribution.distribution_aggregate_sha256}/${record.distribution.distribution_file_count} record-after=${r.distribution.distribution_aggregate_sha256}/${r.distribution.distribution_file_count}`,
  `manifest: ${manifest.aggregate_sha256}/${manifest.file_count}`,
  `realigned files: ${realigned.length}`,
  ...realigned.map((f) => `  ${f.path}: ${f.previous_sha256 ?? "(new)"} -> ${f.sha256}`),
];
const changed = JSON.stringify(record) !== JSON.stringify(nextRecord);
if (!changed) {
  console.log("REALIGN: OK (record already matches the tree)");
  process.exit(0);
}
if (!write) {
  console.log("REALIGN: DRY RUN, would write (pass --write)");
  process.exit(0);
}
writeFileSync(recPath, JSON.stringify(nextRecord, null, 2) + "\n");
for (const line of summarize(nextRecord)) console.log(`  ${line}`);
console.log(`REALIGN: WROTE ${recPath}`);
