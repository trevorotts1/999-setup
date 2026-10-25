#!/usr/bin/env node
// Council of Wise Elders: seal the vendored tree and declare its LOCAL
// divergence from canonical (999-setup).
//
// scripts/vendor-council-bundle.mjs copies the canonical Council tree and
// writes manifest.json, DISTRIBUTION-RECONCILIATION.json and
// installer-registration/council-vendoring.json together. It knows nothing
// about 999-only changes. Those live as reviewable `git apply` patches in
// installer-registration/council-local-patches/ and are applied by
// scripts/revendor-council.mjs after the vendoring tool runs.
//
// This tool runs after the patches are applied. It never absorbs a change
// silently: every file in the tree that is not byte-identical to its
// canonical hash (and is not one of the vendoring tool's own declared
// differences) must be the target of a patch artifact, and every patch
// target must actually diverge. Then it:
//
//   - leaves canonical_source and canonical_files EXACTLY as the vendoring
//     tool wrote them (canonical hashes only; a 999-only file never appears
//     there);
//   - declares the divergence as one `local_divergence` entry (files with
//     their hashes, patch artifacts with their hashes) in BOTH the
//     bundle's DISTRIBUTION-RECONCILIATION.json and the vendoring record;
//   - reseals manifest.json over the tree with the canonical hash method;
//   - recomputes distribution.distribution_aggregate_sha256 / _file_count.
//
// Usage:
//   node scripts/realign-council-vendor-record.mjs [--write] [--repo <dir>]
//
// Without --write it prints the verdict and writes nothing. Exit 1 on an
// unexplained divergence, a patch target that did not diverge, or a
// canonical file missing from the tree.
//
// The dist02 packaging manifest measures the tree directory itself, so
// afterwards refresh it with the black-friday-launcher generator:
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

const VENDORED = ".claude/skills/council-of-wise-elders";
const PATCH_DIR = "installer-registration/council-local-patches";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const byPath = (a, b) => (a[0] < b[0] ? -1 : 1);

function walk(dir, base = dir, acc = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, base, acc);
    else acc.push(relative(base, p).split("\\").join("/"));
  }
  return acc;
}

const tree = join(root, ...VENDORED.split("/"));
const recPath = join(root, "installer-registration", "council-vendoring.json");
const reconPath = join(tree, "DISTRIBUTION-RECONCILIATION.json");
const manifestPath = join(tree, "manifest.json");
const patchDir = join(root, ...PATCH_DIR.split("/"));

const record = JSON.parse(readFileSync(recPath, "utf8"));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const recon = JSON.parse(readFileSync(reconPath, "utf8"));
const errors = [];

// The files the release contract changes are taken from the vendoring tool's
// own record (distribution.files), never from a hand-kept list here: a list
// that happens to match today's release silently mis-declares the next one.
const canonicalFiles = record.canonical_files ?? {};
const contractFiles = new Map((record.distribution?.files ?? []).map((f) => [f.path, f.sha256]));
if (contractFiles.size === 0) {
  console.error("FAIL the vendoring record carries no distribution contract (distribution.files): " +
    "re-vendor with scripts/vendor-council-bundle.mjs before realigning");
  process.exit(1);
}
const DECLARED = new Set([
  ...[...contractFiles.keys()].filter((p) => canonicalFiles[p] !== contractFiles.get(p)),
  "manifest.json",
  "DISTRIBUTION-RECONCILIATION.json",
]);

// Tree hashes (the canonical hash method excludes manifest.json, *.skill
// and the generated runtime/dist and runtime/node_modules trees; the
// built entry point is recorded in runtime_entry instead).
const isGeneratedRuntime = (p) =>
  p === "runtime/dist" || p.startsWith("runtime/dist/")
  || p === "runtime/node_modules" || p.startsWith("runtime/node_modules/");
const present = walk(tree);
const hashes = new Map(present.map((rel) => [rel, sha256(readFileSync(join(tree, rel)))]));
const sealed = [...hashes.entries()].filter(([p]) => p !== "manifest.json" && !p.endsWith(".skill") && !isGeneratedRuntime(p)).sort(byPath);

// Patch artifacts: their sha256 and the paths they touch.
const patches = readdirSync(patchDir).filter((n) => n.endsWith(".patch")).sort();
const patchArtifacts = [];
const patchTargets = new Set();
for (const name of patches) {
  const text = readFileSync(join(patchDir, name), "utf8");
  patchArtifacts.push({ path: `${PATCH_DIR}/${name}`, sha256: sha256(Buffer.from(text, "utf8")) });
  for (const m of text.matchAll(/^\+\+\+ b\/(.+)$/gm)) {
    if (!m[1].startsWith(`${VENDORED}/`)) errors.push(`patch ${name} targets a path outside ${VENDORED}: ${m[1]}`);
    else patchTargets.add(m[1].slice(VENDORED.length + 1));
  }
}

// Divergence = tree files that are not their recorded canonical bytes.
// The built runtime is not divergence: it is a recorded build artifact,
// verified byte for byte against the manifest's runtime_entry (a missing
// or unrecorded build is a visible failure, never silently accepted).
const canonical = canonicalFiles;
const runtimeEntry = manifest.runtime_entry ?? record.runtime_entry ?? null;
const distFiles = present.filter((rel) => rel.startsWith("runtime/dist/"));
if (runtimeEntry) {
  const entryRel = runtimeEntry.path;
  const entrySha = hashes.get(entryRel) ?? null;
  if (entrySha === null) errors.push(`recorded runtime entry is missing from the tree: ${entryRel}`);
  else if (entrySha !== runtimeEntry.sha256) {
    errors.push(`stale runtime entry: ${entryRel} is ${entrySha} but the manifest records ${runtimeEntry.sha256}`);
  }
} else if (distFiles.length > 0) {
  errors.push(`tree carries an unrecorded built runtime (${distFiles[0]}): the manifest records no runtime_entry`);
}
const diverged = [];
for (const [rel, h] of hashes) {
  if (DECLARED.has(rel)) continue;
  if (isGeneratedRuntime(rel)) continue;
  if (canonical[rel] === h) continue;
  diverged.push({ path: rel, kind: rel in canonical ? "modified" : "added", sha256: h, canonical_sha256: canonical[rel] ?? null });
}
for (const d of diverged) if (!patchTargets.has(d.path)) errors.push(`unexplained divergence, no patch covers it: ${d.path}`);
for (const t of patchTargets) if (!diverged.some((d) => d.path === t)) errors.push(`patch target did not diverge from canonical (patch not applied?): ${t}`);
for (const rel of Object.keys(canonical)) if (!hashes.has(rel)) errors.push(`canonical file missing from the tree: ${rel}`);
if (errors.length) {
  for (const e of errors) console.error(`FAIL ${e}`);
  process.exit(1);
}

const localDivergence = diverged.length === 0 ? null : {
  kind: "local_divergence",
  rule: "999-only changes applied on top of the vendored canonical tree by scripts/revendor-council.mjs with git apply. They are NOT in the Council source (canonical_files carries only canonical hashes) and a plain re-vendor with scripts/vendor-council-bundle.mjs deletes them. Each file is recorded with its distribution hash and, when canonical has the file, the canonical hash it replaces; the patch artifacts are recorded by hash. Whether to upstream them is a decision for the Council source owner.",
  patch_artifacts: patchArtifacts,
  files: diverged,
};
const withoutLocal = (list) => (list ?? []).filter((d) => d.kind !== "local_divergence" && d.kind !== "distribution_local_changes");
const nextRecon = { ...recon, intentional_distribution_differences: [...withoutLocal(recon.intentional_distribution_differences), ...(localDivergence ? [localDivergence] : [])] };
const reconText = JSON.stringify(nextRecon, null, 2) + "\n";

// Reseal: the reconciliation report is part of the tree, so hash it as it will be written.
hashes.set("DISTRIBUTION-RECONCILIATION.json", sha256(Buffer.from(reconText, "utf8")));
const entries = [...hashes.entries()].filter(([p]) => p !== "manifest.json" && !p.endsWith(".skill") && !isGeneratedRuntime(p)).sort(byPath);
const aggregate = sha256(Buffer.from(entries.map(([p, h]) => `${h}  ${p}`).join("\n") + "\n", "utf8"));
const nextManifest = {
  ...manifest,
  file_count: entries.length,
  aggregate_sha256: aggregate,
  files: entries.map(([p, h]) => ({
    path: p, sha256: h,
    bytes: p === "DISTRIBUTION-RECONCILIATION.json" ? Buffer.byteLength(reconText) : statSync(join(tree, p)).size,
  })),
};
const nextRecord = {
  ...record,
  intentional_distribution_differences: nextRecon.intentional_distribution_differences,
  distribution: {
    // Keep the release contract the vendoring tool recorded (files,
    // runtime_dist, added_paths): resealing only restates the aggregate.
    ...record.distribution,
    vendored_path: record.distribution.vendored_path,
    distribution_aggregate_sha256: aggregate,
    distribution_file_count: entries.length,
  },
};

const next = {
  recon: reconText,
  manifest: JSON.stringify(nextManifest, null, 2) + "\n",
  record: JSON.stringify(nextRecord, null, 2) + "\n",
};
const current = {
  recon: readFileSync(reconPath, "utf8"),
  manifest: readFileSync(manifestPath, "utf8"),
  record: readFileSync(recPath, "utf8"),
};
console.log(`  distribution aggregate: ${aggregate} (${entries.length} files)`);
console.log(`  local divergence: ${diverged.length} file(s) covered by ${patchArtifacts.length} patch artifact(s)`);
for (const d of diverged) console.log(`    ${d.kind} ${d.path}: ${d.canonical_sha256 ?? "(no canonical)"} -> ${d.sha256}`);
if (next.recon === current.recon && next.manifest === current.manifest && next.record === current.record) {
  console.log("REALIGN: OK (tree, manifest and record already agree)");
  process.exit(0);
}
if (!write) {
  console.log("REALIGN: DRY RUN, would write (pass --write)");
  process.exit(0);
}
writeFileSync(reconPath, next.recon);
writeFileSync(manifestPath, next.manifest);
writeFileSync(recPath, next.record);
console.log(`REALIGN: WROTE ${recPath}, ${manifestPath}, ${reconPath}`);
