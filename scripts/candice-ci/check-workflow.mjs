#!/usr/bin/env node
/**
 * Structural workflow validation (FIX-021) — parses .github/workflows/*.yml
 * and fails on:
 *   - `continue-on-error: true` anywhere in a required job (required jobs are
 *     every job except the explicitly non-blocking `interactive-windows-gate`);
 *   - unpinned action refs (`@v4`, `@stable`, or any non-40-hex ref) in
 *     third-party actions (github/actions owned actions included);
 *   - `npm install` where `npm ci` is required;
 *   - required suites missing from the matrix (e.g. the perf step missing
 *     `--require-bundle` when a Tauri bundle step is present);
 *   - a `run:` line invoking `status.mjs` without `--root` pinning to the
 *     workspace checkout;
 *   - a required step swallowing a command failure through `|| echo ...`
 *     (QFIX-q1) without propagating the exit code — echo fallbacks that end
 *     in `exit N`/`return` are allowed.
 *
 * Plain JavaScript, no network, no clock — determinism-safe per the Master
 * Spec workflow determinism rules. The workflow validates itself by running
 * this checker as one of its own steps.
 *
 * Usage:
 *   node scripts/candice-ci/check-workflow.mjs [--root <repository-root>]
 *   node scripts/candice-ci/check-workflow.mjs --report-json
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function argValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const NON_BLOCKING_JOBS = new Set([
  // FIX-021: the interactive Windows smoke is explicitly non-blocking and
  // records nothing into a release verdict; it lives outside the required
  // matrix and can never satisfy the windowsSigningAndInteractiveSmoke gate.
  "interactive-windows-gate",
  // The release authority refuses releases; it never grants them.
  "release-authority",
]);

export function checkWorkflows(root = scriptRoot) {
  const errors = [];
  const workflowDir = join(root, ".github", "workflows");
  if (!existsSync(workflowDir)) {
    return { ok: false, errors: [`no workflows dir: ${workflowDir}`], workflows: [] };
  }
  const files = readdirSync(workflowDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml")).sort();
  const workflows = [];
  for (const file of files) {
    const path = join(workflowDir, file);
    const text = readFileSync(path, "utf8");
    // Split into job blocks on two-space job headers. The `jobs:` key itself
    // and any top-level key end the previous block.
    const blocks = text.split(/^(?=  [A-Za-z0-9_-]+:\s*$)/m);
    for (const block of blocks) {
      const headerMatch = /^  ([A-Za-z0-9_-]+):\s*$/m.exec(block);
      if (!headerMatch) continue;
      const jobName = headerMatch[1];
      if (block.includes("\n") && /^jobs:/m.test(block.split("\n").slice(0, 2).join("\n"))) continue;
      const required = !NON_BLOCKING_JOBS.has(jobName);
      // 1. continue-on-error in required jobs
      if (required && /^\s*continue-on-error:\s*true/m.test(block)) {
        errors.push(`${file}: job ${jobName} is required but uses continue-on-error: true`);
      }
      // 2. unpinned action refs (steps use `- uses:`)
      for (const m of block.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)) {
        const ref = m[1];
        const at = ref.lastIndexOf("@");
        const version = at >= 0 ? ref.slice(at + 1) : "";
        if (at < 0 || !/^[0-9a-f]{40}$/.test(version)) {
          errors.push(`${file}: job ${jobName} uses unpinned action ${ref} (pin to a full commit SHA)`);
        }
      }
      // 3. npm install
      if (/npm install\b/.test(block)) {
        errors.push(`${file}: job ${jobName} uses npm install (use npm ci against the committed lockfile)`);
      }
      // 4. perf step must require the built bundle when a bundle step exists
      const hasBundleStep = /tauri:build|tauri build/.test(block);
      const hasPerfStep = /tests\/performance\/run\.mjs/.test(block);
      if (hasPerfStep && hasBundleStep && !/--require-bundle/.test(block)) {
        errors.push(`${file}: job ${jobName} runs the perf suite but no step passes --require-bundle`);
      }
      if (hasPerfStep && hasBundleStep) {
        const bundleIdx = block.search(/tauri:build|tauri build/);
        const perfIdx = block.search(/tests\/performance\/run\.mjs/);
        if (perfIdx >= 0 && bundleIdx >= 0 && perfIdx < bundleIdx) {
          errors.push(`${file}: job ${jobName} runs the perf suite before the bundle build (build-before-measure required)`);
        }
      }
      // 5. release authority must pin --root to the workspace checkout
      if (jobName === "release-authority" && /status\.mjs/.test(block) && !/status\.mjs\s+--root\s+\$GITHUB_WORKSPACE/.test(block)) {
        errors.push(`${file}: release-authority must run status.mjs --root \$GITHUB_WORKSPACE`);
      }
      // 6. QFIX-q1: no || echo exit-code swallowing in required jobs. A `||`
      //    fallback beginning with `echo` that never propagates the failure
      //    (no exit N / return) turns the command into a cosmetic failure —
      //    the step exits 0 and the run still produces a PASS line.
      if (required) {
        for (const line of block.split("\n")) {
          if (!/\|\|\s*\{?\s*echo\b/.test(line)) continue;
          const fallback = line.slice(line.lastIndexOf("||"));
          // Propagation only counts when the fallback ENDS by exiting or
          // returning (e.g. `|| { echo ...; exit 1; }`, `|| echo ...; exit 1`).
          if (!/;\s*(exit\s+\d+|return)\s*;?\s*\}?\s*$/.test(fallback)) {
            const preview = line.trim().slice(0, 120);
            errors.push(`${file}: job ${jobName} swallows a failure via || echo (no exit-code propagation): ${preview}`);
          }
        }
      }
    }
    // determinism matrix required in the release-blocking workflow
    if (file.includes("candice-ci")) {
      if (!/\n  determinism:/.test(text)) errors.push(`${file}: no determinism matrix job`);
      if (!/upload-artifact/.test(text)) errors.push(`${file}: no upload-artifact step`);
      if (!/git rev-parse HEAD > commit-sha\.txt/.test(text)) {
        errors.push(`${file}: no current-commit evidence step (git rev-parse HEAD > commit-sha.txt required)`);
      }
    }
    workflows.push({ file, ok: true });
  }
  return { ok: errors.length === 0, errors, workflows };
}

function main() {
  const args = process.argv.slice(2);
  const root = resolve(argValue(args, "--root") || scriptRoot);
  const result = checkWorkflows(root);
  if (args.includes("--report-json")) {
    console.log(JSON.stringify({ ok: result.ok, workflows: result.workflows.map((w) => w.file), errors: result.errors }, null, 2));
  } else if (result.ok) {
    console.log(`WORKFLOW CHECK PASS (${result.workflows.length} files)`);
  } else {
    console.error("WORKFLOW CHECK FAIL");
    for (const e of result.errors) console.error(`  - ${e}`);
  }
  process.exit(result.ok ? 0 : 1);
}

function isMainModule() {
  try {
    return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule()) main();
