#!/usr/bin/env node
// Re-vendor the Council of Wise Elders AND re-apply the 999-only patches.
//
// scripts/vendor-council-bundle.mjs deletes the output folder and copies the
// canonical tree, so on its own it silently drops every 999-local change
// (installer-registration/council-local-patches/). Always re-vendor through
// this wrapper:
//
//   1. vendor-council-bundle.mjs   (canonical copy, strip, canonical record)
//   2. git apply --check, then git apply, each patch in name order
//   3. realign-council-vendor-record.mjs --write
//      (declares the local divergence, reseals manifest and record)
//   4. bundle_adapter.py --write-digests
//      (CONTROL/bundle-digests.json records the bundle digest the pin guard
//      compares against the tree: re-vendoring changes the tree, so leaving
//      the record alone turns every later build red)
//
// Usage:
//   node scripts/revendor-council.mjs --source <canonical skill folder> --source-commit <full sha>
//
// Afterwards refresh the packaging manifest:
//   python3 .claude/skills/black-friday-launcher/scripts/generate_dist02_manifest.py

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const patchDir = join(repoRoot, "installer-registration", "council-local-patches");
const run = (cmd, args) => execFileSync(cmd, args, { cwd: repoRoot, stdio: "inherit" });

try {
  run("node", [join(repoRoot, "scripts", "vendor-council-bundle.mjs"), ...process.argv.slice(2)]);
  for (const name of readdirSync(patchDir).filter((n) => n.endsWith(".patch")).sort()) {
    const patch = join(patchDir, name);
    run("git", ["apply", "--check", patch]);
    run("git", ["apply", patch]);
    console.log(`PASS applied local patch ${name}`);
  }
  run("node", [join(repoRoot, "scripts", "realign-council-vendor-record.mjs"), "--write"]);
  run("python3", ["-I", "-B", join(repoRoot, "installer-registration", "bundle_adapter.py"), "--write-digests"]);
} catch {
  console.log("REVENDOR: FAIL");
  process.exit(1);
}
console.log("REVENDOR: PASS");
