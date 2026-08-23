import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { buildUpdaterManifest } from "../build-updater-manifest.mjs";

const URL_ROOT =
  "https://github.com/trevorotts1/999-setup/releases/download/candice-v1.0.0-rc.1";
const FIXTURE_SIGNATURE =
  "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIG1pbmlzaWduIGRlbmV5IEJsYWNrQ0VPClJXdHBIS3A3bmFpdUJPTW9JWWUxZXJ3RjM2Y1lKMEtKUjh1ZkF0bjNEdnJNTElVNDhSTDdJSmlPZ1B4bVE1R2p3b2Z2ZkF0SE5hbVBQOXpSeStBM1ltbW1BPT0KdHJ1c3RlZCBjb21tZW50OiB0aW1lc3RhbXA6MTc4Mjg0ODQ0MyAgZmlsZTpjYW5kaWNlLnRhci5negpYbjFaL3pNMmVmd1NiZEFGRWpOVWZJVGZ5VUplTURBQXNSMDBxU2d4MVJCOStRS1I5WFVhYlN4eHRGNWt1Y2dnNk0xNENlQk5pRVdTTFRybC9PN1Y0aGc9PQo=";

test("manifest carries version and per-platform url+signature (plugin v2 shape)", () => {
  const result = buildUpdaterManifest({
    version: "1.0.0-rc.1",
    artifactUrlRoot: URL_ROOT,
    platforms: [
      { target: "darwin-aarch64", file: "Candice.app.tar.gz", signature: FIXTURE_SIGNATURE },
    ],
  });
  assert.equal(result.ok, true, result.errors.join("; "));
  assert.equal(result.manifest.version, "1.0.0-rc.1");
  assert.equal(
    result.manifest.platforms["darwin-aarch64"].url,
    `${URL_ROOT}/Candice.app.tar.gz`,
  );
  assert.equal(
    result.manifest.platforms["darwin-aarch64"].signature,
    FIXTURE_SIGNATURE,
  );
});

test("manifest requires a signature on every platform entry", () => {
  const result = buildUpdaterManifest({
    version: "1.0.0-rc.1",
    artifactUrlRoot: URL_ROOT,
    platforms: [
      { target: "darwin-aarch64", file: "Candice.app.tar.gz", signature: "" },
    ],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("no signature")), result.errors.join("; "));
});

test("artifact URL root outside the candice-v* tag namespace is refused", () => {
  const result = buildUpdaterManifest({
    version: "1.0.0-rc.1",
    artifactUrlRoot: "https://example.com/releases/download/v9.9.9",
    platforms: [
      { target: "darwin-aarch64", file: "Candice.app.tar.gz", signature: FIXTURE_SIGNATURE },
    ],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("candice-v*")), result.errors.join("; "));
});

test("non-https artifact URL root is refused", () => {
  const result = buildUpdaterManifest({
    version: "1.0.0-rc.1",
    artifactUrlRoot: "http://github.com/trevorotts1/999-setup/releases/download/candice-v1.0.0",
    platforms: [
      { target: "darwin-aarch64", file: "Candice.app.tar.gz", signature: FIXTURE_SIGNATURE },
    ],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("https")));
});

test("duplicate platform targets are refused", () => {
  const result = buildUpdaterManifest({
    version: "1.0.0-rc.1",
    artifactUrlRoot: URL_ROOT,
    platforms: [
      { target: "darwin-aarch64", file: "a.tar.gz", signature: FIXTURE_SIGNATURE },
      { target: "darwin-aarch64", file: "b.tar.gz", signature: FIXTURE_SIGNATURE },
    ],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("duplicate")));
});

test("CLI emits the manifest and requires an existing signature file", () => {
  const root = mkdtempSync(join(tmpdir(), "candice-manifest-"));
  const artifact = join(root, "Candice.app.tar.gz");
  const sig = `${artifact}.sig`;
  const out = join(root, "latest.json");
  writeFileSync(artifact, "artifact bytes");
  writeFileSync(sig, `${FIXTURE_SIGNATURE}\n`);
  const script = resolve(import.meta.dirname, "../build-updater-manifest.mjs");
  const run = spawnSync(
    process.execPath,
    [
      script,
      "--version", "1.0.0-rc.1",
      "--artifact-url-root", URL_ROOT,
      "--platform", "darwin-aarch64", "--artifact", artifact,
      "--out", out,
    ],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const manifest = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(manifest.version, "1.0.0-rc.1");
  assert.equal(manifest.platforms["darwin-aarch64"].signature, FIXTURE_SIGNATURE);
  rmSync(root, { recursive: true, force: true });
});

test("CLI refuses when the signature file is missing", () => {
  const root = mkdtempSync(join(tmpdir(), "candice-manifest-"));
  const artifact = join(root, "Candice.app.tar.gz");
  const out = join(root, "latest.json");
  writeFileSync(artifact, "artifact bytes");
  const script = resolve(import.meta.dirname, "../build-updater-manifest.mjs");
  const run = spawnSync(
    process.execPath,
    [
      script,
      "--version", "1.0.0-rc.1",
      "--artifact-url-root", URL_ROOT,
      "--platform", "darwin-aarch64", "--artifact", artifact,
      "--out", out,
    ],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 2, run.stdout + run.stderr);
  assert.ok(run.stderr.includes("signature not found"));
  rmSync(root, { recursive: true, force: true });
});
