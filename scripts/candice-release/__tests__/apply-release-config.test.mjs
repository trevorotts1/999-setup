import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { applyReleaseConfigOverlay } from "../apply-release-config.mjs";

const PLACEHOLDER = "RELEASE_OWNER_MUST_REPLACE_WITH_BASE64_PUBLIC_KEY";
// Committed-shape pubkey: a real minisign pubkey (base64 of the minisign text
// box) whose private key was discarded — exactly what the committed
// apps/candice-companion/tauri.conf.json carries (Q-10).
const COMMITTED_PUBKEY =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDc0M0U0NTk5QjJDNzNEMjEKUldRaFBjZXltVVUrZEFVQllpSlM1VHJ6MUdqNEJUa2NobWtVNnVWTlkzd0lBamVRL0ZZUWxGYy8=";

function baseConf() {
  return {
    version: "1.0.0-rc.1",
    bundle: {
      active: true,
      targets: ["app", "dmg", "nsis"],
      createUpdaterArtifacts: false,
      macOS: {
        minimumSystemVersion: "12.0",
        hardenedRuntime: true,
        signingIdentity: null,
        providerShortName: null,
        entitlements: "../scripts/package-macos/entitlements.plist",
      },
      windows: {
        digestAlgorithm: "sha256",
        certificateThumbprint: null,
        timestampUrl: "http://timestamp.digicert.com",
        nsis: { installerHooks: "../scripts/package-windows/installerHooks.nsh" },
        webviewInstallMode: { type: "downloadBootstrapper" },
      },
    },
    plugins: {
      updater: {
        pubkey: COMMITTED_PUBKEY,
        endpoints: [
          "https://github.com/trevorotts1/999-setup/releases/download/candice-v{{current_version}}/latest.json",
        ],
        windows: { installMode: "passive" },
      },
    },
  };
}

test("updater endpoint resolves inside the enforced candice-v* tag namespace (FIX-022 wiringfix)", () => {
  const conf = baseConf();
  const endpoint = conf.plugins.updater.endpoints[0];
  // Tauri substitutes the raw `version` string into {{current_version}}
  // (never a v-prefix), so the literal candice-v prefix in the template is
  // what lands the request on the release-authority tag namespace.
  const resolved = endpoint.replaceAll("{{current_version}}", conf.version);
  assert.ok(resolved.includes(`/download/candice-v${conf.version}/latest.json`), resolved);
  const tag = resolved.match(/download\/([^/]+)\//)?.[1];
  assert.ok(/^candice-v\d/.test(tag), `resolved tag segment ${tag} is outside the enforced candice-v* namespace`);
  assert.equal(resolved.split("/").pop(), "latest.json");
});

test("no credentials: overlay keeps null identities, reports unsigned, and the committed real pubkey is not an error (Q-10 smoke posture)", () => {
  const conf = baseConf();
  const result = applyReleaseConfigOverlay(conf, {});
  assert.equal(result.ok, true);
  assert.deepEqual(result.state, { macos: "UNSIGNED", windows: "UNSIGNED", updater: "UNSIGNED" });
  // committed pubkey is real; a no-credential overlay keeps it and keeps
  // createUpdaterArtifacts disabled — honest smoke posture, no error.
  assert.equal(conf.plugins.updater.pubkey, COMMITTED_PUBKEY);
  assert.equal(conf.bundle.createUpdaterArtifacts, false);
  // identities remain null — nothing is claimed without credentials
  assert.equal(baseConf().bundle.macOS.signingIdentity, null);
});

test("placeholder pubkey in the input config is rejected in any credential state (Q-10)", () => {
  const conf = baseConf();
  conf.plugins.updater.pubkey = PLACEHOLDER;
  const result = applyReleaseConfigOverlay(conf, {});
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("placeholder")));
});

test("full credentials: all three surfaces signed, timestamp defaulted, pubkey replaced, updater artifacts re-enabled (Q-10 release intent)", () => {
  const conf = baseConf();
  const env = {
    APPLE_DEVELOPER_IDENTITY: "Developer ID Application: BlackCEO (TEAM123456)",
    CANDICE_WIN_CERT_THUMBPRINT: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    CANDICE_UPDATER_PUBKEY: "RWRp0V3qLp1m8sJkZfQx7yNw==",
  };
  const result = applyReleaseConfigOverlay(conf, env);
  assert.equal(result.ok, true);
  assert.deepEqual(result.state, { macos: "SIGNED", windows: "SIGNED", updater: "SIGNED" });
  assert.equal(conf.bundle.macOS.signingIdentity, "Developer ID Application: BlackCEO (TEAM123456)");
  assert.equal(conf.bundle.windows.certificateThumbprint, "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678");
  assert.equal(conf.bundle.windows.timestampUrl, "http://timestamp.digicert.com");
  assert.equal(conf.plugins.updater.pubkey, "RWRp0V3qLp1m8sJkZfQx7yNw==");
  assert.equal(conf.bundle.createUpdaterArtifacts, "v1Compatible");
});

test("malformed thumbprint rejected; valid overlay still applies the other surfaces", () => {
  const conf = baseConf();
  const env = {
    APPLE_DEVELOPER_IDENTITY: "Developer ID Application: BlackCEO (TEAM123456)",
    CANDICE_WIN_CERT_THUMBPRINT: "not-a-thumbprint",
    CANDICE_UPDATER_PUBKEY: "RWRp0V3qLp1m8sJkZfQx7yNw==",
  };
  const result = applyReleaseConfigOverlay(conf, env);
  assert.equal(result.ok, false);
  assert.equal(result.state.windows, "UNSIGNED");
  assert.ok(result.errors.some((e) => e.includes("40 hex")));
  assert.equal(conf.bundle.windows.certificateThumbprint, null);
  assert.equal(conf.bundle.macOS.signingIdentity, "Developer ID Application: BlackCEO (TEAM123456)");
});

test("placeholder pubkey value from env is rejected, not accepted as an identity", () => {
  const conf = baseConf();
  const env = { CANDICE_UPDATER_PUBKEY: PLACEHOLDER };
  const result = applyReleaseConfigOverlay(conf, env);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("placeholder")));
  // the env placeholder was refused; the committed real pubkey is untouched
  assert.equal(conf.plugins.updater.pubkey, COMMITTED_PUBKEY);
  assert.equal(conf.bundle.createUpdaterArtifacts, false);
});

test("whitespace in secret values is stripped without printing", () => {
  const conf = baseConf();
  const env = {
    APPLE_DEVELOPER_IDENTITY: "  Developer ID Application: BlackCEO (TEAM123456)\n",
    CANDICE_WIN_CERT_THUMBPRINT: "  a1b2c3d4e5f60718293a4b5c6d7e8f9012345678  ",
    CANDICE_UPDATER_PUBKEY: "\nRWRp0V3qLp1m8sJkZfQx7yNw==\n",
  };
  const result = applyReleaseConfigOverlay(conf, env);
  assert.equal(result.ok, true);
  assert.equal(conf.bundle.macOS.signingIdentity, "Developer ID Application: BlackCEO (TEAM123456)");
  assert.equal(conf.bundle.windows.certificateThumbprint, "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678");
  assert.equal(conf.plugins.updater.pubkey, "RWRp0V3qLp1m8sJkZfQx7yNw==");
});

test("macOS-only credentials: windows and updater stay unsigned; state reflects per-surface posture", () => {
  const conf = baseConf();
  const env = { APPLE_DEVELOPER_IDENTITY: "Developer ID Application: BlackCEO (TEAM123456)" };
  const result = applyReleaseConfigOverlay(conf, env);
  assert.equal(result.ok, true); // committed pubkey is real; smoke posture is honest
  assert.deepEqual(result.state, { macos: "SIGNED", windows: "UNSIGNED", updater: "UNSIGNED" });
  assert.equal(conf.bundle.createUpdaterArtifacts, false);
});

test("CLI: refuses to write the tracked app-root tauri.conf.json as overlay output", () => {
  const root = mkdtempSync(join(tmpdir(), "candice-apply-release-"));
  const trackedConf = join(root, "tauri.conf.json");
  writeFileSync(trackedConf, JSON.stringify(baseConf(), null, 2));
  const inputConf = join(root, "tauri.conf.json");
  const script = join(import.meta.dirname, "..", "apply-release-config.mjs");
  // Input path resolves to the tracked default? No — the guard keys on the
  // script's DEFAULT_CONF_PATH. Simulate by passing --output equal to the
  // repo app-root config path: the script refuses regardless of input.
  const repoAppRoot = join(import.meta.dirname, "..", "..", "..", "apps", "candice-companion", "tauri.conf.json");
  const run = spawnSync(process.execPath, [script, "--input", inputConf, "--output", repoAppRoot], {
    encoding: "utf8",
  });
  assert.equal(run.status, 2);
  assert.ok(run.stderr.includes("never be overwritten"));
  rmSync(root, { recursive: true, force: true });
});

test("CLI: overlay to a temp path with no credentials exits 0 with honest smoke posture (committed real pubkey, artifacts disabled)", () => {
  const root = mkdtempSync(join(tmpdir(), "candice-apply-release-"));
  const inputConf = join(root, "tauri.conf.json");
  const outputConf = join(root, "out", "tauri.release.json");
  writeFileSync(inputConf, JSON.stringify(baseConf(), null, 2));
  const script = join(import.meta.dirname, "..", "apply-release-config.mjs");
  const run = spawnSync(process.execPath, [script, "--input", inputConf, "--output", outputConf], {
    encoding: "utf8",
    env: { ...process.env },
  });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.ok(run.stdout.includes("UNSIGNED-UNSIGNED-UNSIGNED"));
  const out = JSON.parse(readFileSync(outputConf, "utf8"));
  assert.equal(out.bundle.macOS.signingIdentity, null);
  assert.equal(out.bundle.windows.certificateThumbprint, null);
  assert.equal(out.bundle.createUpdaterArtifacts, false);
  assert.equal(out.plugins.updater.pubkey, COMMITTED_PUBKEY);
  rmSync(root, { recursive: true, force: true });
});

test("CLI: placeholder pubkey in input exits 1 regardless of credentials", () => {
  const root = mkdtempSync(join(tmpdir(), "candice-apply-release-"));
  const inputConf = join(root, "tauri.conf.json");
  const outputConf = join(root, "out", "tauri.release.json");
  const bad = baseConf();
  bad.plugins.updater.pubkey = PLACEHOLDER;
  writeFileSync(inputConf, JSON.stringify(bad, null, 2));
  const script = join(import.meta.dirname, "..", "apply-release-config.mjs");
  const run = spawnSync(process.execPath, [script, "--input", inputConf, "--output", outputConf], {
    encoding: "utf8",
    env: { ...process.env },
  });
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.ok(run.stderr.includes("placeholder"));
  rmSync(root, { recursive: true, force: true });
});

test("CLI: signed overlay exit 0, prints posture, never prints secret values", () => {
  const root = mkdtempSync(join(tmpdir(), "candice-apply-release-"));
  const inputConf = join(root, "tauri.conf.json");
  const outputConf = join(root, "out", "tauri.release.json");
  writeFileSync(inputConf, JSON.stringify(baseConf(), null, 2));
  const script = join(import.meta.dirname, "..", "apply-release-config.mjs");
  const thumbprint = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
  const identity = "Developer ID Application: BlackCEO (TEAM123456)";
  const pubkey = "RWRp0V3qLp1m8sJkZfQx7yNw==";
  const run = spawnSync(process.execPath, [script, "--input", inputConf, "--output", outputConf], {
    encoding: "utf8",
    env: {
      ...process.env,
      APPLE_DEVELOPER_IDENTITY: identity,
      CANDICE_WIN_CERT_THUMBPRINT: thumbprint,
      CANDICE_UPDATER_PUBKEY: pubkey,
    },
  });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.ok(run.stdout.includes("SIGNED-SIGNED-SIGNED"));
  assert.ok(!run.stdout.includes(thumbprint));
  assert.ok(!run.stdout.includes(pubkey));
  assert.ok(!run.stdout.includes(identity));
  rmSync(root, { recursive: true, force: true });
});
