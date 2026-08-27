import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";

import {
  validateBuildPosture,
  readUpdaterPubkey,
  signUpdaterArtifacts,
} from "../updater-sign.mjs";

const PLACEHOLDER = "RELEASE_OWNER_MUST_REPLACE_WITH_BASE64_PUBLIC_KEY";

// E2E fixture keypair (generated with minisign 0.7.9, password "q10-test").
// The secret key is test-only fixture material — never a production secret.
const FIXTURE_PUBKEY_B64 =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDc0M0U0NTk5QjJDNzNEMjEKUldRaFBjZXltVVUrZEFVQllpSlM1VHJ6MUdqNEJUa2NobWtVNnVWTlkzd0lBamVRL0ZZUWxGYy8=";
const FIXTURE_SK_TEXT = `untrusted comment: rsign encrypted secret key
RWRTY0Iyd2+skqTVuuEN0Vxq2ztfdLxwE/YXEWzfS/DHEj0kciAAABAAAAAAAAAAAAIAAAAA6uAgBH0DMUW3vqdJQ/qdgcG2lEaMHkZxHt8OciOOGPOi5hMe+uq46HCfUXi1N9crVUKVRzVGhsPdUJqsHBOFirDw8DGa1CVthY1gnXH+gp/b+ZIeRhzou2AJf2Cz6OlS8UlwRLav5o8=`;
// A second keypair (password "testpass") used only for negative-match tests.
const OTHER_PUBKEY_B64 =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDFCOTg0RjA5QzRCNUUxMEEKUldRSzRiWEVDVStZRzlmbEtyS29pZmFWMEVkMTM0WXVBUS9HR1d4RU9UVmhlODJZZ0lQQTNJeGw=";

const HELPER = resolve(
  import.meta.dirname,
  "../release-config-guard/target/debug/updater-sign-helper",
);

function smokeConf(overrides = {}) {
  return {
    bundle: { createUpdaterArtifacts: false },
    plugins: { updater: { pubkey: FIXTURE_PUBKEY_B64 } },
    ...overrides,
  };
}

function releaseConf(overrides = {}) {
  return {
    bundle: { createUpdaterArtifacts: "v1Compatible" },
    plugins: { updater: { pubkey: FIXTURE_PUBKEY_B64 } },
    ...overrides,
  };
}

function tempArtifact(contents = "candice updater artifact bytes") {
  const root = mkdtempSync(join(tmpdir(), "candice-updater-sign-test-"));
  const artifact = join(root, "Candice.app.tar.gz");
  writeFileSync(artifact, contents);
  return { root, artifact };
}

// ---------------------------------------------------------------------------
// validateBuildPosture
// ---------------------------------------------------------------------------

test("smoke posture: real pubkey + disabled updater artifacts is honest", () => {
  const result = validateBuildPosture(smokeConf(), "smoke");
  assert.equal(result.ok, true, result.errors.join("; "));
});

test("smoke posture: enabled updater artifacts is rejected", () => {
  const result = validateBuildPosture(smokeConf({ bundle: { createUpdaterArtifacts: true } }), "smoke");
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("smoke")));
});

test("smoke posture: placeholder pubkey is rejected", () => {
  const result = validateBuildPosture(
    smokeConf({ plugins: { updater: { pubkey: PLACEHOLDER } } }),
    "smoke",
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("placeholder")));
});

test("release posture: real pubkey + enabled updater artifacts is honest", () => {
  const result = validateBuildPosture(releaseConf(), "release");
  assert.equal(result.ok, true, result.errors.join("; "));
});

test("release posture: disabled updater artifacts is rejected", () => {
  const result = validateBuildPosture(releaseConf({ bundle: { createUpdaterArtifacts: false } }), "release");
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("release")));
});

test("release posture: placeholder pubkey is rejected", () => {
  const result = validateBuildPosture(
    releaseConf({ plugins: { updater: { pubkey: PLACEHOLDER } } }),
    "release",
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("placeholder")));
});

// ---------------------------------------------------------------------------
// readUpdaterPubkey (release-only reader)
// ---------------------------------------------------------------------------

test("readUpdaterPubkey refuses a smoke config (nothing to sign)", () => {
  const root = mkdtempSync(join(tmpdir(), "candice-updater-sign-test-"));
  const confPath = join(root, "tauri.conf.json");
  writeFileSync(confPath, JSON.stringify(smokeConf()));
  const result = readUpdaterPubkey(confPath);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("createUpdaterArtifacts")));
  rmSync(root, { recursive: true, force: true });
});

test("readUpdaterPubkey refuses a placeholder pubkey", () => {
  const root = mkdtempSync(join(tmpdir(), "candice-updater-sign-test-"));
  const confPath = join(root, "tauri.conf.json");
  writeFileSync(
    confPath,
    JSON.stringify(releaseConf({ plugins: { updater: { pubkey: PLACEHOLDER } } })),
  );
  const result = readUpdaterPubkey(confPath);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("placeholder")));
  rmSync(root, { recursive: true, force: true });
});

test("readUpdaterPubkey accepts a release config", () => {
  const root = mkdtempSync(join(tmpdir(), "candice-updater-sign-test-"));
  const confPath = join(root, "tauri.conf.json");
  writeFileSync(confPath, JSON.stringify(releaseConf()));
  const result = readUpdaterPubkey(confPath);
  assert.equal(result.ok, true, result.errors.join("; "));
  assert.equal(result.pubkey, FIXTURE_PUBKEY_B64);
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// signUpdaterArtifacts — E2E through the updater-sign-helper binary
// ---------------------------------------------------------------------------

test("signed artifact verifies end-to-end against the configured pubkey", () => {
  const { root, artifact } = tempArtifact();
  const result = signUpdaterArtifacts({
    signingKey: FIXTURE_SK_TEXT,
    signingKeyPassword: "q10-test",
    pubkeyB64: FIXTURE_PUBKEY_B64,
    artifacts: [artifact],
    signatureHelper: HELPER,
    verifyHelper: HELPER,
  });
  assert.equal(result.ok, true, result.errors.join("; "));
  assert.equal(result.signatures.length, 1);
  assert.ok(existsSync(result.signatures[0].path));
  // the produced .sig is base64 of minisign signature text (Tauri format)
  const sig = readFileSync(result.signatures[0].path, "utf8").trim();
  assert.ok(/^[A-Za-z0-9+/=]+$/.test(sig), "signature must be base64");
  rmSync(root, { recursive: true, force: true });
});

test("signature made with a different key is rejected by the hard match gate", () => {
  // Config pubkey is FIXTURE_PUBKEY_B64; sign with the OTHER keypair. The
  // verify step must refuse — tauri-bundler only warns on mismatch, the
  // script must fail hard.
  const OTHER_SK_TEXT = `untrusted comment: rsign encrypted secret key
RWRTY0Iy+jkHADHmBvR2Qg+CzN5A0mmvNfLZA3EGergNYkGb3f8AABAAAAAAAAAAAAIAAAAAP+GC7UxsiJC4YSZ/qLDUMfNsH8dl+QDeYMQMvs9+jugjCaVD0043XTm908mz9GT+XzC3zdnnL8BLURadCmCAGqbCk6YthMWjZJZHfau/aHq2ZOL/USIMxD6coG/yq2muhVffRgmgb4Q=`;
  const { root, artifact } = tempArtifact();
  const result = signUpdaterArtifacts({
    signingKey: OTHER_SK_TEXT,
    signingKeyPassword: "testpass",
    pubkeyB64: FIXTURE_PUBKEY_B64,
    artifacts: [artifact],
    signatureHelper: HELPER,
    verifyHelper: HELPER,
  });
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => e.includes("match") || e.includes("verif")),
    result.errors.join("; "),
  );
  rmSync(root, { recursive: true, force: true });
});

test("missing signing key fails hard (never an unsigned fallback)", () => {
  const { root, artifact } = tempArtifact();
  const result = signUpdaterArtifacts({
    signingKey: "",
    signingKeyPassword: "",
    pubkeyB64: FIXTURE_PUBKEY_B64,
    artifacts: [artifact],
    signatureHelper: HELPER,
    verifyHelper: HELPER,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("TAURI_SIGNING_PRIVATE_KEY")));
  rmSync(root, { recursive: true, force: true });
});

test("missing artifact fails hard", () => {
  const root = mkdtempSync(join(tmpdir(), "candice-updater-sign-test-"));
  const result = signUpdaterArtifacts({
    signingKey: FIXTURE_SK_TEXT,
    signingKeyPassword: "q10-test",
    pubkeyB64: FIXTURE_PUBKEY_B64,
    artifacts: [join(root, "missing.tar.gz")],
    signatureHelper: HELPER,
    verifyHelper: HELPER,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("missing")));
  rmSync(root, { recursive: true, force: true });
});

test("no verify helper: signing refuses to proceed without proof", () => {
  const { root, artifact } = tempArtifact();
  const result = signUpdaterArtifacts({
    signingKey: FIXTURE_SK_TEXT,
    signingKeyPassword: "q10-test",
    pubkeyB64: FIXTURE_PUBKEY_B64,
    artifacts: [artifact],
    signatureHelper: HELPER,
    verifyHelper: null,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("verif")));
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// CLI smoke: secret never printed
// ---------------------------------------------------------------------------

test("CLI signs without echoing the secret key", () => {
  const { root, artifact } = tempArtifact();
  const confPath = join(root, "tauri.conf.json");
  writeFileSync(confPath, JSON.stringify(releaseConf()));
  const script = resolve(import.meta.dirname, "../updater-sign.mjs");
  const run = spawnSync(
    process.execPath,
    [
      script,
      "--pubkey-file", confPath,
      "--artifact", artifact,
      "--signature-helper", HELPER,
      "--verify-helper", HELPER,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        TAURI_SIGNING_PRIVATE_KEY: FIXTURE_SK_TEXT,
        TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "q10-test",
      },
    },
  );
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.ok(!run.stdout.includes(FIXTURE_SK_TEXT));
  assert.ok(!run.stderr.includes(FIXTURE_SK_TEXT));
  assert.ok(!run.stdout.includes("q10-test"));
  assert.ok(!run.stderr.includes("q10-test"));
  assert.ok(existsSync(`${artifact}.sig`));
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// CLI --posture gate (Q-10 CI smoke matrix: validate without signing)
// ---------------------------------------------------------------------------

test("CLI --posture smoke accepts the committed honest smoke config", () => {
  const root = mkdtempSync(join(tmpdir(), "candice-updater-sign-test-"));
  const confPath = join(root, "tauri.conf.json");
  writeFileSync(confPath, JSON.stringify(smokeConf()));
  const script = resolve(import.meta.dirname, "../updater-sign.mjs");
  const run = spawnSync(
    process.execPath,
    [script, "--posture", "smoke", "--config", confPath],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.ok(run.stdout.includes("smoke OK"));
  rmSync(root, { recursive: true, force: true });
});

test("CLI --posture smoke rejects enabled updater artifacts", () => {
  const root = mkdtempSync(join(tmpdir(), "candice-updater-sign-test-"));
  const confPath = join(root, "tauri.conf.json");
  writeFileSync(
    confPath,
    JSON.stringify(smokeConf({ bundle: { createUpdaterArtifacts: "v1Compatible" } })),
  );
  const script = resolve(import.meta.dirname, "../updater-sign.mjs");
  const run = spawnSync(
    process.execPath,
    [script, "--posture", "smoke", "--config", confPath],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.ok(run.stderr.includes("must not enable"));
  rmSync(root, { recursive: true, force: true });
});

test("CLI --posture smoke rejects a placeholder pubkey", () => {
  const root = mkdtempSync(join(tmpdir(), "candice-updater-sign-test-"));
  const confPath = join(root, "tauri.conf.json");
  writeFileSync(
    confPath,
    JSON.stringify(smokeConf({ plugins: { updater: { pubkey: PLACEHOLDER } } })),
  );
  const script = resolve(import.meta.dirname, "../updater-sign.mjs");
  const run = spawnSync(
    process.execPath,
    [script, "--posture", "smoke", "--config", confPath],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.ok(run.stderr.includes("placeholder"));
  rmSync(root, { recursive: true, force: true });
});

test("CLI --posture release accepts an enabled release config", () => {
  const root = mkdtempSync(join(tmpdir(), "candice-updater-sign-test-"));
  const confPath = join(root, "tauri.conf.json");
  writeFileSync(confPath, JSON.stringify(releaseConf()));
  const script = resolve(import.meta.dirname, "../updater-sign.mjs");
  const run = spawnSync(
    process.execPath,
    [script, "--posture", "release", "--config", confPath],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.ok(run.stdout.includes("release OK"));
  rmSync(root, { recursive: true, force: true });
});

test("CLI --posture release rejects a smoke config", () => {
  const root = mkdtempSync(join(tmpdir(), "candice-updater-sign-test-"));
  const confPath = join(root, "tauri.conf.json");
  writeFileSync(confPath, JSON.stringify(smokeConf()));
  const script = resolve(import.meta.dirname, "../updater-sign.mjs");
  const run = spawnSync(
    process.execPath,
    [script, "--posture", "release", "--config", confPath],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.ok(run.stderr.includes("must enable"));
  rmSync(root, { recursive: true, force: true });
});

test("CLI --posture unknown mode fails", () => {
  const root = mkdtempSync(join(tmpdir(), "candice-updater-sign-test-"));
  const confPath = join(root, "tauri.conf.json");
  writeFileSync(confPath, JSON.stringify(smokeConf()));
  const script = resolve(import.meta.dirname, "../updater-sign.mjs");
  const run = spawnSync(
    process.execPath,
    [script, "--posture", "banana", "--config", confPath],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.ok(run.stderr.includes("unknown posture"));
  rmSync(root, { recursive: true, force: true });
});
