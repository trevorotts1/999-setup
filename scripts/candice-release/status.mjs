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
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RELEASE_GATE_SCHEMA = "candice/release-gate@1";
const REQUIRED_GATES = Object.freeze([
  "independentQc",
  "packagedEndToEnd",
  "privacy",
  "visualParity",
  "cleanMachine",
  "macosSigningAndNotarization",
  "windowsSigningAndInteractiveSmoke",
  "ciRequiredChecks",
  "supplyChain",
]);

// This pin is deliberately unconfigured until FIX-024. It is code, not a
// user-controlled JSON field or environment variable, so no edited control
// document can make a release pass. FIX-024 may replace it with the SHA-256
// of an operator-owned Ed25519 public key after its independent clean-machine
// review; that change itself requires review and a release-gate recheck.
const OPERATOR_RELEASE_AUTHORITY_PUBLIC_KEY_SHA256 = "UNCONFIGURED";

// FIX-021: every report artifact the required CI matrix must upload. The
// evidence record must name all of them; names live here (code), never in a
// user-editable control document, so a forged evidence record cannot invent
// its own artifact set.
const REQUIRED_CI_ARTIFACTS = Object.freeze([
  "commit-sha",
  "perf-report",
  "verifier-macos",
  "verifier-windows",
  "windows-shell-compat",
  "cargo-test-output",
  "determinism-evidence",
]);

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

function repairMarker(path, errors, label) {
  if (!existsSync(path)) {
    errors.push(`missing ${label}: ${path}`);
    return null;
  }
  const match = readFileSync(path, "utf8").match(
    /<!-- CANDICE_RELEASE_REPAIR_STATUS: lifecycle=([A-Z_]+) open=(\d+) complete=(\d+) -->/,
  );
  if (!match) {
    errors.push(`missing release-repair marker in ${label}`);
    return null;
  }
  return { lifecycle: match[1], open: Number(match[2]), complete: Number(match[3]) };
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) && !/^0{64}$/.test(value);
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
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
  const markers = [
    repairMarker(resolve(root, "CONTROL/TODO.md"), errors, "CONTROL/TODO.md"),
    repairMarker(resolve(root, "CONTROL/CHECKLIST.md"), errors, "CONTROL/CHECKLIST.md"),
    repairMarker(resolve(root, "CONTROL/LEDGER.md"), errors, "CONTROL/LEDGER.md"),
  ];
  if (!project || !gate) return { ok: false, errors };

  if (gate.schema !== RELEASE_GATE_SCHEMA) {
    errors.push(`release gate schema is ${gate.schema ?? "MISSING"}, expected ${RELEASE_GATE_SCHEMA}`);
  }

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
  const gates = gate.requiredGates;
  if (!gates || typeof gates !== "object" || Array.isArray(gates)) {
    errors.push("required gates are missing or malformed");
  } else {
    const actual = Object.keys(gates).sort();
    const expected = [...REQUIRED_GATES].sort();
    if (actual.join("|") !== expected.join("|")) {
      errors.push("required gate names do not exactly match the fixed release schema");
    }
    for (const name of REQUIRED_GATES) {
      if (gates[name] !== "PASS") errors.push(`required gate ${name} is ${gates[name] ?? "MISSING"}, not PASS`);
    }
  }
  for (const marker of markers) {
    if (!marker) continue;
    if (marker.lifecycle !== gate.lifecycle || marker.open !== gate.openFixIds.length || marker.complete + marker.open !== 24) {
      errors.push("repair status marker disagrees with release-gate inventory");
    }
  }

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

  // FIX-021: ciRequiredChecks evidence enforcement (fail closed, no
  // environment override — consistent with the rest of this authority).
  // The evidence record lives on the gate document itself and is written by
  // the control-owner lane after independent QC; a PASS string in
  // requiredGates alone is not evidence.
  const ciEvidence = gate.ciRequiredChecks;
  if (!ciEvidence || typeof ciEvidence !== "object" || Array.isArray(ciEvidence)) {
    errors.push("ciRequiredChecks evidence record is missing from the release gate");
  } else {
    if (!/^[0-9a-f]{40}$/i.test(ciEvidence.commitSha || "")) {
      errors.push("ciRequiredChecks evidence commitSha is missing or not a full commit SHA");
    } else if (candidate && ciEvidence.commitSha.toLowerCase() !== candidate.commit.toLowerCase()) {
      errors.push("ciRequiredChecks evidence commitSha does not equal the candidate commit");
    }
    const runIds = Array.isArray(ciEvidence.runIds) ? ciEvidence.runIds : [];
    const hosted = runIds.filter((id) => typeof id === "string" && /^\d{8,13}$/.test(id));
    if (hosted.length !== runIds.length || new Set(hosted).size < 2) {
      errors.push("ciRequiredChecks evidence must carry at least two distinct hosted run IDs");
    }
    if (ciEvidence.requiredFailures !== 0) {
      errors.push(`ciRequiredChecks evidence reports requiredFailures: ${ciEvidence.requiredFailures}, not 0`);
    }
    if (ciEvidence.requiredSkips !== 0) {
      errors.push(`ciRequiredChecks evidence reports requiredSkips: ${ciEvidence.requiredSkips}, not 0`);
    }
    if (ciEvidence.continueOnErrorCount !== 0) {
      errors.push(`ciRequiredChecks evidence reports continueOnErrorCount: ${ciEvidence.continueOnErrorCount}, not 0`);
    }
    const artifacts = Array.isArray(ciEvidence.reportArtifacts)
      ? ciEvidence.reportArtifacts.filter((name) => typeof name === "string" && name.length > 0)
      : [];
    const missingArtifacts = REQUIRED_CI_ARTIFACTS.filter((name) => !artifacts.includes(name));
    if (missingArtifacts.length > 0) {
      errors.push(`ciRequiredChecks evidence is missing uploaded report artifacts: ${missingArtifacts.join(", ")}`);
    }
    if (ciEvidence.windowsProduction !== false && (gates || {})["windowsSigningAndInteractiveSmoke"] !== "PASS") {
      errors.push("windowsProduction must remain false until windowsSigningAndInteractiveSmoke is PASS");
    }
  }

  // FIX-021: the release-blocking workflow file itself is scanned. A
  // continue-on-error in candice-ci.yml means a required verifier can exit
  // green while skipped — refuse release regardless of the evidence record.
  const ciWorkflowPath = resolve(root, ".github", "workflows", "candice-ci.yml");
  if (!existsSync(ciWorkflowPath)) {
    errors.push(`missing CI workflow: ${ciWorkflowPath}`);
  } else if (/^\s*continue-on-error:\s*true/m.test(readFileSync(ciWorkflowPath, "utf8"))) {
    errors.push("candice-ci.yml contains continue-on-error: true (required verifiers must block)");
  }

  if (!Array.isArray(gate.artifacts) || gate.artifacts.length === 0) {
    errors.push("no signed release artifacts recorded");
  } else {
    for (const artifact of gate.artifacts) {
      const localPath = typeof artifact?.localPath === "string" ? resolve(root, artifact.localPath) : null;
      if (
        !artifact?.name || !/^https:\/\//.test(artifact.url || "") || !isSha256(artifact.sha256)
        || !artifact.signature || !localPath || !existsSync(localPath)
      ) {
        errors.push(`invalid artifact record: ${artifact?.name || "unnamed"}`);
      } else if (sha256File(localPath) !== artifact.sha256) {
        errors.push(`artifact hash mismatch: ${artifact.name}`);
      }
    }
  }
  if (OPERATOR_RELEASE_AUTHORITY_PUBLIC_KEY_SHA256 === "UNCONFIGURED") {
    errors.push("operator release authority is not configured; FIX-024 independent approval is required");
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

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) process.exit(main());
