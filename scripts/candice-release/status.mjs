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
import { existsSync, readFileSync, realpathSync, lstatSync } from "node:fs";
import { createHash, createPublicKey, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, resolve, relative, isAbsolute, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RELEASE_GATE_SCHEMA = "candice/release-gate@1";
// QFIX-adhoc: the macOS signing gate accepts BOTH names — the original
// "macosSigningAndNotarization" and the honest post-adhoc alias
// "macosSigningAdhoc". REQUIRED_GATES keeps the original name so existing
// release-gate.json documents (JSON schema consumers) keep validating
// unchanged; a gate author may instead record the alias.
const MACOS_SIGNING_GATE_NAMES = Object.freeze(["macosSigningAndNotarization", "macosSigningAdhoc"]);
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
//
// Q-03 step 1: once configured, the pin is authoritative. The authority loads
// the operator public key from a fixed repository location (below), hashes the
// exact file bytes with SHA-256, and rejects release unless the hash equals
// this compiled pin. A matching hash is required for any later signature
// verification to be meaningful; the key file itself is otherwise inert.
// FIX-024: configured 2026-08-26 from the operator-owned Ed25519 key at
// ~/.ssh/candice-release/release-authority.key. The PUBLIC half was derived
// with `openssl pkey -pubout` and committed as CONTROL/release-authority.pub;
// the private half was never read, copied, printed or committed, and does not
// live in this repository. This pin is the whole-file SHA-256 of that .pub,
// so PEM armor and line endings are part of it, exactly as documented above.
//
// Configuring the pin does NOT by itself authorize a release: the gate still
// requires every other check, and a matching hash only makes later signature
// verification meaningful.
const OPERATOR_RELEASE_AUTHORITY_PUBLIC_KEY_SHA256 = "463087c76446d0e0fccc0a2ca06ce23e9a5ce80c9f563dcfe1b37d873cc0a864";

// Fixed repository location of the operator release-authority public key.
// This path is code, not control-document configuration: a forged
// release-gate.json cannot redirect it. The pin above covers the exact bytes
// of this file (whole-file SHA-256), so PEM armor and line endings are part
// of the pin, not normalized away.
const RELEASE_AUTHORITY_KEY_FILE = "CONTROL/release-authority.pub";

// QFIX-q3-paths: the only directory a signed artifact's localPath may point
// into. This root is code, not control-document configuration: a forged
// release-gate.json cannot redirect the artifact lookup outside it. Artifact
// bytes are large and never committed; the release lane stages them here on
// the machine that runs the authority.
const CANDIDATE_ARTIFACTS_ROOT = "release-artifacts";

/**
 * Resolves one artifact localPath to a verified, contained, real file path,
 * or returns null. Rules, in order:
 * - the record value must be a non-empty string and NOT absolute;
 * - every component of the value (including the leaf) must lstat, and no
 *   component may be a symbolic link — a symlink anywhere in the chain is
 *   rejected even when it points back inside the root;
 * - the designated root itself may not be a symlink (lstat, then realpath
 *   for containment comparison; a symlinked root is rejected);
 * - the realpath of the leaf must exist, be a regular file, and live inside
 *   realpath(root)/release-artifacts — `..` escapes, absolute paths, and
 *   hard links to outside files are all refused.
 * A realpath that throws (dangling link, missing file) yields null, never a
 * partially resolved path.
 */
function resolveArtifactLocalPath(root, artifact) {
  const localPath = typeof artifact?.localPath === "string" ? artifact.localPath : null;
  if (!localPath || localPath.length === 0) return null;
  if (isAbsolute(localPath)) return null;
  const joined = resolve(root, localPath);
  const relativePath = relative(root, joined);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) return null;
  const components = relativePath.split(sep).filter((part) => part.length > 0);
  const baseComponents = CANDIDATE_ARTIFACTS_ROOT.split("/").filter((part) => part.length > 0);
  if (components.length <= baseComponents.length) return null;
  for (let i = 0; i < baseComponents.length; i += 1) {
    if (components[i] !== baseComponents[i]) return null;
  }
  // Walk every component from repo root through the leaf; lstat so a
  // symlink is seen as a link, never followed.
  let current = root;
  for (const component of components) {
    current = join(current, component);
    try {
      const stat = lstatSync(current);
      if (!stat.isFile() && !stat.isDirectory()) return null;
    } catch {
      return null;
    }
  }
  try {
    const artifactRootReal = realpathSync(resolve(root, CANDIDATE_ARTIFACTS_ROOT));
    const leafReal = realpathSync(current);
    const rel = relative(artifactRootReal, leafReal);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
    if (!lstatSync(leafReal).isFile()) return null;
    return leafReal;
  } catch {
    return null;
  }
}

// Q-03 steps 2-3: canonical signed payload. The bytes the operator signs are
// EXACTLY this string (UTF-8, one line per field, `key=value`, no separators
// between fields, no trailing newline, keys in this fixed order):
//
//   candidateCommit=<full 40-hex SHA>
//   tag=<semantic version tag>
//   artifactName=<name>
//   url=<https URL>
//   sha256=<64-hex artifact SHA-256>
//
// Example bytes (the 5 fields joined by U+000A):
//   candidateCommit=0123456789abcdef0123456789abcdef01234567
//   tag=v0.2.0
//   artifactName=candice-companion-0.2.0.dmg
//   url=https://example.test/releases/candice-companion-0.2.0.dmg
//   sha256=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
//
// Any other serialization — different key order, extra fields, trailing
// newline, JSON, whitespace — produces different bytes and therefore a
// signature that does not verify. The signer signs payload bytes directly
// (detached Ed25519), NOT a hash of them, so verification is one step:
//   verify(null, canonicalPayload, key, signature)
// Nothing from the editable release-gate.json participates except the six
// field values themselves; the field names, order, and separators are code.
const SIGNED_PAYLOAD_FIELD_NAMES = Object.freeze([
  "candidateCommit",
  "tag",
  "artifactName",
  "url",
  "sha256",
]);

/**
 * Builds the canonical signed payload for one artifact record. Byte-exact:
 * each field renders as `<name>=<value>` followed by U+000A, in the fixed
 * order above, with no leading/trailing separator, no other characters.
 * Values are rendered as strings exactly as they appear in the gate
 * document (no trimming, no lowercasing, no re-encoding) so a modified
 * candidate, tag, name, URL, or hash changes the bytes and fails verify.
 *
 * Rendering rules, all enforced by construction:
 * - Exactly the five fields of SIGNED_PAYLOAD_FIELD_NAMES appear, in that
 *   order; no record carries extra fields into the payload and no gate
 *   document can reorder or rename them.
 * - Every field is emitted as `<name>=<value>` then one U+000A (LF). The
 *   final field has NO trailing LF — payload ends with the sha256 value's
 *   last hex character.
 * - A value that is missing (undefined/null) renders as the literal string
 *   "undefined"/"null" — never as an empty field — so an incomplete record
 *   yields bytes no honest signer signed and verification fails.
 * - Non-ASCII values are UTF-8 encoded verbatim (no NFC/NFD normalization);
 *   leading/trailing whitespace inside a value is preserved verbatim.
 */
export function canonicalSignedPayload(record) {
  return SIGNED_PAYLOAD_FIELD_NAMES.map((name) => `${name}=${record[name]}`).join("\n");
}

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

function evaluateWithAuthorityPin(root, releaseAuthorityPublicKeySha256) {
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
    // QFIX-adhoc: the macOS signing dimension may be recorded under its
    // original name (macosSigningAndNotarization) or the honest ad-hoc alias
    // (macosSigningAdhoc). Exactly one of the two must be present and PASS;
    // both present is ambiguous and refused. All other gates are exact-match.
    const macosSigningRecorded = MACOS_SIGNING_GATE_NAMES.filter((name) => {
      // `in` would count an explicit undefined value as recorded; require a
      // real own property with a value.
      return Object.prototype.hasOwnProperty.call(gates, name) && gates[name] != null;
    });
    const otherGates = REQUIRED_GATES.filter((name) => !MACOS_SIGNING_GATE_NAMES.includes(name));
    const actual = Object.keys(gates).sort();
    const expected = [...REQUIRED_GATES].sort();
    let namesOk;
    if (macosSigningRecorded.length === 0) {
      namesOk = false;
      errors.push("required gate macosSigningAndNotarization (or its macosSigningAdhoc alias) is MISSING — record exactly one macOS signing gate (QFIX-adhoc)");
      // A gate document with neither macOS name almost certainly has a wrong
      // key set overall; surface the schema-name refusal for that case too
      // (e.g. a forged doc full of made-up gate names).
      if (actual.join("|") !== expected.join("|")) {
        errors.push("required gate names do not exactly match the fixed release schema");
      }
    } else if (macosSigningRecorded.length > 1) {
      namesOk = false;
      errors.push(`both macOS signing gate names present (${macosSigningRecorded.join(", ")}) — record exactly one (QFIX-adhoc)`);
    } else {
      // Exactly one macOS signing name: every key set is accepted only when
      // it equals REQUIRED_GATES (alias swaps one name for the other, same
      // count). Any extra/missing/made-up key still trips the schema check.
      const aliasExpected = [...REQUIRED_GATES];
      const recordedName = macosSigningRecorded[0];
      const swapped = actual.length === expected.length
        && actual.every((name) => (name === recordedName ? MACOS_SIGNING_GATE_NAMES.includes(name) : true))
        && aliasExpected.filter((name) => !MACOS_SIGNING_GATE_NAMES.includes(name)).every((name) => actual.includes(name))
        && actual.filter((name) => !MACOS_SIGNING_GATE_NAMES.includes(name)).every((name) => aliasExpected.includes(name));
      namesOk = swapped;
      if (!namesOk) errors.push("required gate names do not exactly match the fixed release schema");
    }
    for (const name of otherGates) {
      if (gates[name] !== "PASS") errors.push(`required gate ${name} is ${gates[name] ?? "MISSING"}, not PASS`);
    }
    if (namesOk && macosSigningRecorded.length === 1 && gates[macosSigningRecorded[0]] !== "PASS") {
      errors.push(`required gate ${macosSigningRecorded[0]} is ${gates[macosSigningRecorded[0]]}, not PASS`);
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
  // Q-03 steps 2-3: the release-authority key must load BEFORE any artifact
  // signature check. A key that hashes to the pin is loaded once; if it does
  // not parse as a public key, every artifact signature fails verification
  // below (no artifact is ever accepted with an unparsable authority key).
  let authorityKey = null;
  let authorityKeyConfigured = true;
  if (releaseAuthorityPublicKeySha256 === "UNCONFIGURED") {
    authorityKeyConfigured = false;
    errors.push("operator release authority is not configured; FIX-024 independent approval is required");
  } else {
    const keyPath = resolve(root, RELEASE_AUTHORITY_KEY_FILE);
    if (!existsSync(keyPath)) {
      authorityKeyConfigured = false;
      errors.push(`operator release authority key is missing: ${keyPath}`);
    } else if (sha256File(keyPath) !== releaseAuthorityPublicKeySha256) {
      authorityKeyConfigured = false;
      errors.push("operator release authority key hash does not equal the compiled OPERATOR_RELEASE_AUTHORITY_PUBLIC_KEY_SHA256 pin");
    } else {
      try {
        authorityKey = createPublicKey(readFileSync(keyPath));
      } catch (error) {
        authorityKeyConfigured = false;
        errors.push(`operator release authority key does not parse as a public key: ${error.message}`);
      }
    }
  }

  if (!Array.isArray(gate.artifacts) || gate.artifacts.length === 0) {
    errors.push("no signed release artifacts recorded");
  } else {
    for (const artifact of gate.artifacts) {
      const localPath = resolveArtifactLocalPath(root, artifact);
      if (
        !artifact?.name || !/^https:\/\//.test(artifact.url || "") || !isSha256(artifact.sha256)
        || !localPath || !existsSync(localPath)
      ) {
        errors.push(`invalid artifact record: ${artifact?.name || "unnamed"}`);
        continue;
      }
      // Q-10 artifact path constraints: the release authority only accepts
      // regular files it can hash. A symlink file, directory, FIFO or socket
      // is refused — a candidate artifact must be a real file.
      let stat;
      try {
        stat = lstatSync(localPath);
      } catch {
        errors.push(`artifact is not stat-able: ${artifact.name}`);
        continue;
      }
      if (!stat.isFile() || stat.isSymbolicLink()) {
        errors.push(`artifact is not a regular file: ${artifact.name}`);
        continue;
      }
      if (sha256File(localPath) !== artifact.sha256) {
        errors.push(`artifact hash mismatch: ${artifact.name}`);
      } else if (!authorityKeyConfigured) {
        // Key authority broken: never accept any artifact signature.
        errors.push(`artifact signature not verified (release authority key not available): ${artifact.name}`);
      } else {
        // Q-03 step 3: detached Ed25519 verification over the canonical
        // payload. The payload binds candidate commit, tag, artifact name,
        // URL, and SHA-256; the record passes ONLY if the signature is a
        // valid detached Ed25519 signature of those exact bytes under the
        // pinned key. A truthy non-signature string can never pass.
        const payload = Buffer.from(
          canonicalSignedPayload({
            candidateCommit: candidate.commit,
            tag: candidate.tag,
            artifactName: artifact.name,
            url: artifact.url,
            sha256: artifact.sha256,
          }),
          "utf8",
        );
        const signature = Buffer.from(artifact.signature, "base64");
        try {
          const valid = verify(null, payload, authorityKey, signature);
          if (!valid) {
            errors.push(`artifact signature verification failed: ${artifact.name}`);
          }
        } catch {
          errors.push(`artifact signature could not be verified: ${artifact.name}`);
        }
      }
      // Q-10 signature policy, enforced per posture after the file check:
      //   - updater: true requires a cryptographically usable signature
      //     (>= 64 base64 chars); a smoke-built unsigned artifact must never
      //     be recorded as updater content.
      //   - any artifact record without a real signature is refused outright
      //     (unsigned artifacts may be evidence, never distribution).
      if (artifact.updater === true) {
        if (typeof artifact.signature !== "string" || artifact.signature.length < 64) {
          errors.push(`artifact claims updater-ready posture without a real signature: ${artifact.name} (Q-10)`);
        }
      } else if (typeof artifact.signature !== "string" || artifact.signature.length < 64) {
        errors.push(`artifact record lacks a real signature: ${artifact.name} (Q-10)`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function evaluateRelease(root) {
  // Production path: the pin is the compiled constant. There is no parameter,
  // environment variable, or control-document field that can override it.
  return evaluateWithAuthorityPin(root, OPERATOR_RELEASE_AUTHORITY_PUBLIC_KEY_SHA256);
}

// Test-only seam: exercises the configured state while the compiled pin in
// this branch is still UNCONFIGURED (it becomes the real key hash after the
// FIX-024 independent clean-machine review). Never used by the production
// CLI path or by evaluateRelease.
export function evaluateReleaseWithPin(root, releaseAuthorityPublicKeySha256) {
  return evaluateWithAuthorityPin(root, releaseAuthorityPublicKeySha256);
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
