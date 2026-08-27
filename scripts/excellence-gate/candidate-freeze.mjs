#!/usr/bin/env node
/**
 * FIX-024 candidate freeze.
 *
 * Validates and freezes the release candidate identity: the pinned commit,
 * the coordinated release tag (a new semantic version — never a reuse of the
 * quarantined 0.2.0 tag), and the exact published artifacts with sizes,
 * SHA-256 hashes, and signature records. Freezing re-verifies live state;
 * it never moves tags, regenerates manifests, or rebuilds artifacts — a
 * rebuilt artifact invalidates the candidate and restarts the gate
 * (FIX-024 conflict-resolution rules).
 *
 * Usage:
 *   node scripts/excellence-gate/candidate-freeze.mjs \
 *     --commit <full-sha> --tag <vX.Y.Z> \
 *     --artifact name=...,url=...,sha256=...,sizeBytes=...,signature=... \
 *     [--artifact ...] [--root <repository-root>] [--write <path>]
 *
 * Exit codes: 0 frozen (record written to --write path or stdout);
 * 1 freeze rejected; 2 usage error; 3 tooling failure (git unavailable).
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPO_ROOT, git, isSha, isSha256, isSemverTag, fail, isMainModule } from "./lib.mjs";

const QUARANTINED_TAGS = new Set(["v0.2.0", "candice-v0.2.0"]);

function parseArtifact(raw) {
  const parts = {};
  for (const piece of raw.split(",")) {
    const eq = piece.indexOf("=");
    if (eq < 1) return null;
    parts[piece.slice(0, eq)] = piece.slice(eq + 1);
  }
  if (!parts.name || !parts.url || !parts.sha256) return null;
  return {
    name: parts.name,
    url: parts.url,
    sha256: parts.sha256,
    sizeBytes: parts.sizeBytes ? Number(parts.sizeBytes) : 0,
    signature: parts.signature || "",
    localPath: parts.localPath || "",
  };
}

export function evaluateFreeze({ commit, tag, artifacts }, root) {
  const errors = [];
  if (!isSha(commit)) errors.push(`commit must be a full 40-char SHA, got ${JSON.stringify(commit)}`);
  if (!isSemverTag(tag)) errors.push(`tag must be a new semantic version vX.Y.Z, got ${JSON.stringify(tag)}`);
  if (QUARANTINED_TAGS.has(tag)) {
    errors.push(`tag ${tag} is the quarantined 0.2.0 tag family — never reused (FIX-024 production design)`);
  }
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    errors.push("at least one artifact record is required (name, url, sha256)");
  }
  for (const a of artifacts || []) {
    if (!a || !a.name || !/^https:\/\//.test(a.url || "")) errors.push(`artifact ${a?.name || "unnamed"} has no https URL`);
    if (!isSha256(a.sha256)) errors.push(`artifact ${a?.name || "unnamed"} sha256 is not a 64-char hex digest`);
    if (!Number.isInteger(a.sizeBytes) || a.sizeBytes <= 0) errors.push(`artifact ${a?.name || "unnamed"} sizeBytes must be a positive integer`);
    if (!a.signature) errors.push(`artifact ${a?.name || "unnamed"} has no signature record`);
  }
  if (errors.length > 0) return { ok: false, errors };

  if (git(root, ["rev-parse", "--verify", `${commit}^{commit}`]) !== commit.toLowerCase()) {
    return { ok: false, errors: [`commit ${commit} does not resolve in repository ${root}`] };
  }
  const head = git(root, ["rev-parse", "HEAD"]);
  if (head !== commit.toLowerCase()) {
    return { ok: false, errors: [`candidate commit ${commit} is not the checked-out HEAD (${head ?? "unknown"})`] };
  }
  const tagCommit = git(root, ["rev-list", "-n", "1", tag]);
  if (tagCommit === null) {
    return { ok: false, errors: [`tag ${tag} is absent — a new coordinated tag is required`] };
  }
  if (tagCommit !== commit.toLowerCase()) {
    return { ok: false, errors: [`tag ${tag} resolves to ${tagCommit}, not candidate commit ${commit}`] };
  }
  const existing = git(root, ["tag", "-l", tag]);
  if (existing !== tag) {
    return { ok: false, errors: [`tag ${tag} not found in git tag list (expected the pinned tag to exist)`] };
  }
  return {
    ok: true,
    errors: [],
    frozen: { commit: commit.toLowerCase(), tag, artifacts, frozenAt: new Date().toISOString() },
  };
}

function main() {
  const args = process.argv.slice(2);
  const readArg = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const commit = readArg("--commit");
  const tag = readArg("--tag");
  const root = resolve(readArg("--root") || REPO_ROOT());
  const write = readArg("--write");
  const artifacts = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--artifact" && args[i + 1]) {
      const parsed = parseArtifact(args[i + 1]);
      if (!parsed) fail(`--artifact parse failed: ${args[i + 1]} (expected name=...,url=...,sha256=...,sizeBytes=...,signature=...)`);
      artifacts.push(parsed);
    }
  }
  if (!commit || !tag) {
    fail("usage: node candidate-freeze.mjs --commit <full-sha> --tag <vX.Y.Z> --artifact name=...,url=...,sha256=...,sizeBytes=...,signature=... [--write <path>] [--root <dir>]");
  }
  const result = evaluateFreeze({ commit, tag, artifacts }, root);
  if (!result.ok) {
    console.error("FREEZE_REJECTED");
    for (const e of result.errors) console.error(`- ${e}`);
    process.exit(1);
  }
  const json = JSON.stringify(result.frozen, null, 2);
  if (write) {
    writeFileSync(resolve(root, write), json + "\n");
    console.log(`FREEZE_OK: ${write}`);
  } else {
    console.log("FREEZE_OK");
    console.log(json);
  }
  process.exit(0);
}

if (isMainModule(import.meta.url)) main();
