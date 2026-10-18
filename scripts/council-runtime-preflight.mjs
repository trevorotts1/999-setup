#!/usr/bin/env node
// WER-004: 999 distribution Council prerequisite probe.
//
// Always run through the RESOLVED Node executable, never through a PATH
// lookup repeated by a child:
//
//   "<resolved node>" council-runtime-preflight.mjs --verify-source <dir>
//   "<resolved node>" council-runtime-preflight.mjs --probe --source <dir>
//
// --verify-source recomputes the portable source tree with the canonical
//   hash method and refuses any tree that no longer matches its own
//   manifest. A copied folder is therefore not a separately editable
//   product: an edit breaks the identity and the install stops before it
//   writes anything.
//
// --probe invokes the exact Node/SQLite prerequisite check, in this order:
//   1. the resolved source's own canonical installer,
//      scripts/install-runtime.mjs --root <dir> --check-prereqs, when that
//      script publishes the diagnostic flag;
//   2. the resolved source's scripts/node-runtime-preflight.mjs, when the
//      distribution carries it;
//   3. the pinned byte-identical copy shipped beside this file
//      (council-node-runtime-preflight.mjs, SHA-256
//      3b7e6169eb39b53f5caa004c1157540391f4dc5f34444d117601d3a4287e7b1f,
//      copied from openclaw-onboarding 77-council-of-wise-elders).
//
// It never installs, never builds, never writes to the source and never
// touches the active release.
//
// Exit 0 = prerequisite proven; 1 = refused.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const PINNED_MODULE = join(SELF_DIR, "council-node-runtime-preflight.mjs");
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const sourceOption = option("--source") ?? option("--verify-source");
const sourceDir = sourceOption ? resolve(sourceOption) : null;

function fail(message) {
  console.log(`FAIL ${message}`);
  process.exit(1);
}

function walk(dir, base = dir, acc = []) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      fail(`portable source contains a symlink, refusing to treat it as canonical: ${relative(base, path)}`);
    }
    if (stat.isDirectory()) walk(path, base, acc);
    else acc.push(relative(base, path).split("\\").join("/"));
  }
  return acc;
}

function verifySource(dir) {
  if (!dir || !existsSync(join(dir, "manifest.json"))) {
    fail(`portable source has no manifest.json: ${dir ?? "(missing --source)"}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  } catch (error) {
    fail(`portable source manifest.json is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  const hashes = new Map();
  for (const rel of walk(dir)) {
    hashes.set(rel, createHash("sha256").update(readFileSync(join(dir, rel))).digest("hex"));
  }
  const entries = [...hashes.entries()]
    .filter(([path]) => path !== "manifest.json" && !path.endsWith(".skill"))
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([path, hash]) => `${hash}  ${path}`);
  const aggregate = createHash("sha256")
    .update(Buffer.from(entries.join("\n") + "\n", "utf8"))
    .digest("hex");
  if (aggregate !== manifest.aggregate_sha256 || entries.length !== manifest.file_count) {
    fail(`portable source does not recompute: computed ${aggregate} over ${entries.length}, manifest says ${manifest.aggregate_sha256} over ${manifest.file_count}. A hand-edited copy is not a canonical source`);
  }
  let reconciliation = null;
  const reconciliationPath = join(dir, "DISTRIBUTION-RECONCILIATION.json");
  if (existsSync(reconciliationPath)) {
    try {
      reconciliation = JSON.parse(readFileSync(reconciliationPath, "utf8"));
    } catch {
      fail("portable source carries an unreadable DISTRIBUTION-RECONCILIATION.json");
    }
  }
  const canonicalCommit = manifest.source_commit
    ?? reconciliation?.canonical_source?.source_commit
    ?? null;
  const canonicalAggregate = manifest.canonical_aggregate_sha256
    ?? reconciliation?.canonical_source?.canonical_aggregate_sha256
    ?? null;
  if (!canonicalCommit || !canonicalAggregate) {
    fail("portable source carries no canonical provenance (source_commit / canonical_aggregate_sha256); refusing an unowned copy");
  }
  if (manifest.canonical_aggregate_sha256 && reconciliation
    && reconciliation.canonical_source?.canonical_aggregate_sha256
    && manifest.canonical_aggregate_sha256 !== reconciliation.canonical_source.canonical_aggregate_sha256) {
    fail("manifest canonical aggregate disagrees with DISTRIBUTION-RECONCILIATION.json");
  }
  console.log(`SOURCE-INTEGRITY: PASS ${aggregate} (${entries.length} files; canonical ${canonicalAggregate} at ${canonicalCommit})`);
}

async function probe(dir) {
  if (!dir) fail("--probe requires --source");
  const installer = join(dir, "scripts", "install-runtime.mjs");
  if (existsSync(installer) && readFileSync(installer, "utf8").includes("--check-prereqs")) {
    const result = spawnSync(
      process.execPath,
      [installer, "--root", dir, "--check-prereqs"],
      { stdio: "inherit" }
    );
    if (result.error) {
      fail(`could not run the canonical installer probe through ${process.execPath}: ${result.error.message}`);
    }
    if (result.status !== 0) {
      fail(`the canonical installer prerequisite probe exited ${result.status} through ${process.execPath}`);
    }
    console.log(`PREREQ: PASS ${process.version} via canonical install-runtime.mjs --check-prereqs (${process.execPath})`);
    return;
  }
  const published = join(dir, "scripts", "node-runtime-preflight.mjs");
  const modulePath = existsSync(published) ? published
    : existsSync(PINNED_MODULE) ? PINNED_MODULE : null;
  if (!modulePath) {
    fail("no prerequisite probe is available: the source publishes no --check-prereqs installer and the pinned module is missing");
  }
  let module;
  try {
    module = await import(pathToFileURL(modulePath).href);
  } catch (error) {
    fail(`could not load the prerequisite probe ${modulePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!module.isSupportedCouncilRuntimeNode(process.version)) {
    fail(`Council runtime requires Node.js ^22.13.0 || >=24 with node:sqlite; found ${process.version} (${process.execPath})`);
  }
  try {
    await module.verifyCouncilSqlite();
  } catch (error) {
    fail(`node:sqlite read/write is unavailable in ${process.execPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  console.log(`PREREQ: PASS ${process.version} with node:sqlite read/write (${process.execPath}; probe ${modulePath})`);
}

if (args.includes("--verify-source")) {
  verifySource(sourceDir);
  if (!args.includes("--probe")) process.exit(0);
}
if (args.includes("--probe")) {
  await probe(sourceDir);
  process.exit(0);
}
fail("usage: council-runtime-preflight.mjs --verify-source <dir> [--probe] | --probe --source <dir>");
