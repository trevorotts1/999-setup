#!/usr/bin/env node
/**
 * Fail-closed Candice release authority.
 *
 * This command is the only mechanism allowed to approve distribution. It
 * reads repository control state and refuses a release unless the repair
 * inventory, required gates, candidate identity, and signed artifact records
 * are all complete. There are no environment overrides.
 *
 * Usage:
 *   node scripts/candice-release/status.mjs [--root <repository-root>]
 */
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function readJson(path, errors, label) {
  if (!existsSync(path)) {
    errors.push(`missing ${label}: ${path}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`invalid ${label}: ${error.message}`);
    return null;
  }
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) && !/^0{64}$/.test(value);
}

function git(root, args) {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export function evaluateRelease(root) {
  const errors = [];
  const project = readJson(resolve(root, "CONTROL/project_state.json"), errors, "project state");
  const gate = readJson(resolve(root, "CONTROL/release-gate.json"), errors, "release gate");
  if (!project || !gate) return { ok: false, errors };

  const candice = project.candice || {};
  if (candice.release_ready !== true) errors.push("candice.release_ready is not true");
  if (candice.repair_status && candice.repair_status !== "RELEASE_CANDIDATE") {
    errors.push(`candice.repair_status is ${candice.repair_status}, not RELEASE_CANDIDATE`);
  }
  if (gate.lifecycle !== "RELEASE_CANDIDATE") {
    errors.push(`release gate lifecycle is ${gate.lifecycle}, not RELEASE_CANDIDATE`);
  }
  if (!Array.isArray(gate.openFixIds) || gate.openFixIds.length !== 0) {
    errors.push(`open fixes remain: ${(gate.openFixIds || []).join(", ") || "missing inventory"}`);
  }
  if (!Number.isInteger(gate.checklist?.requiredUnchecked) || gate.checklist.requiredUnchecked !== 0) {
    errors.push("required checklist items remain unchecked or uncounted");
  }
  const gates = gate.requiredGates || {};
  for (const [name, result] of Object.entries(gates)) {
    if (result !== "PASS") errors.push(`required gate ${name} is ${result}, not PASS`);
  }
  if (Object.keys(gates).length === 0) errors.push("required gates are missing");

  const candidate = gate.candidate;
  if (!candidate || !/^[0-9a-f]{40}$/i.test(candidate.commit) || !/^v?\d+\.\d+\.\d+/.test(candidate.tag || "")) {
    errors.push("candidate must contain a full commit SHA and semantic version tag");
  } else {
    const tagCommit = git(root, ["rev-list", "-n", "1", candidate.tag]);
    if (!tagCommit) errors.push(`candidate tag is absent: ${candidate.tag}`);
    else if (tagCommit !== candidate.commit) errors.push("candidate tag does not resolve to candidate commit");
    const head = git(root, ["rev-parse", "HEAD"]);
    if (head !== candidate.commit) errors.push("candidate commit is not the checked-out commit");
  }

  if (!Array.isArray(gate.artifacts) || gate.artifacts.length === 0) {
    errors.push("no signed release artifacts recorded");
  } else {
    for (const artifact of gate.artifacts) {
      if (!artifact?.name || !/^https:\/\//.test(artifact.url || "") || !isSha256(artifact.sha256) || !artifact.signature) {
        errors.push(`invalid artifact record: ${artifact?.name || "unnamed"}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

function main() {
  const root = resolve(argValue(process.argv.slice(2), "--root") || scriptRoot);
  const result = evaluateRelease(root);
  if (result.ok) {
    console.log("RELEASE_READY");
    return 0;
  }
  console.error("NOT_RELEASE_READY");
  for (const error of result.errors) console.error(`- ${error}`);
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main());
