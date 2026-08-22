#!/usr/bin/env node
/**
 * Candice bundled-components.json fragment builder (WS-33).
 *
 * Emits the versioned component manifest described by MASTER-SPEC section 21
 * and E.1 WS-33: the active bundled components (5 skills, plugin, STT assets,
 * TTS assets) with version, platform, SHA-256 (published payloads), install
 * source, license, and operator-controlled source URL. No application payload
 * is emitted until a future release-authorized candidate exists.
 *
 * OUTPUT IS A PROPOSAL — CONTROL/bundled-components.json is 9.4 shared-class
 * (manifest owner applies; PROJECT-MANIFEST 9.2 WR-017). This lane never
 * writes CONTROL/**. Run:
 *
 *   node build-manifest.mjs [--out <path>]
 *
 * Exit 0 on success.
 */
import { writeFileSync } from "node:fs";
import {
  PUBLISHED_PAYLOADS,
  REPO_TREE_COMPONENTS,
  RUNTIME_PINS,
  RELEASE_CHANNEL,
  MANIFEST_NAME,
} from "./components.mjs";

const args = process.argv.slice(2);
const readArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const outPath = readArg("--out");
const now = new Date().toISOString();

const licenseByComponent = {
  "nine-router-setup": "MIT (repo license)",
  "spec-protocol": "MIT (repo license)",
  kaizen: "MIT (repo license)",
  eli5: "MIT (repo license)",
  bro: "MIT (repo license)",
  "candice-integration": "MIT (plugin.json)",
  "candice-companion": "MIT (repo license)",
  "stt-assets": "whisper.cpp MIT; ggml-tiny.en-q5_1 MIT (whisper.cpp repo)",
  "tts-assets": "Kokoro weights Apache-2.0; kokoro-onnx MIT; onnxruntime MIT; phonemizer GPL-3.0 (worker process only)",
};

const components = {};

for (const [, entry] of Object.entries(PUBLISHED_PAYLOADS)) {
  components[entry.id] ??= [];
  components[entry.id].push({
    version: entry.version,
    platform: entry.platform,
    installFrom: "release",
    file: entry.payload.file,
    sha256: entry.payload.sha256,
    sizeBytes: entry.payload.sizeBytes,
    sourceUrl: entry.payload.sourceUrl,
    license: licenseByComponent[entry.id],
  });
}

for (const [, entry] of Object.entries(REPO_TREE_COMPONENTS)) {
  const existing = components[entry.id];
  if (existing && existing.some((c) => c.version === entry.version)) continue;
  components[entry.id] ??= [];
  components[entry.id].push({
    version: entry.version,
    platform: "any",
    installFrom: "repo-tree",
    repoPath: entry.repoPath,
    license: licenseByComponent[entry.id],
  });
}

const manifest = {
  schema: "candice.bundled-components/v1",
  generatedBy: "scripts/candice-updater/checksums/build-manifest.mjs (WS-33 lane)",
  generatedAt: now,
  channel: {
    default: "github-releases",
    base: RELEASE_CHANNEL,
    operatorControlledOnly: true,
    note:
      "GitHub Releases in trevorotts1/999-setup is the default channel (spec 21). " +
      "Documented limit is 2 GiB per release asset (verified 2026-08-21): the speech " +
      "model payloads fit, but are distributed from their pinned upstream release tags " +
      "(operator-approved immutable locations, spec 21) until the operator publishes " +
      "them as 999-setup release assets. Verified 2026-08-21: trevorotts1/999-setup " +
      "currently has zero releases; release-tarball checksums for repo-tree components " +
      "are added by the 9.4 release owner at publish time.",
  },
  runtimePins: RUNTIME_PINS,
  components,
};

const text = `${JSON.stringify(manifest, null, 2)}\n`;

if (outPath) {
  writeFileSync(outPath, text);
  console.log(`wrote ${outPath}`);
} else {
  process.stdout.write(text);
}
