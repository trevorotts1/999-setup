import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { applyReleaseConfigOverlay } from "../apply-release-config.mjs";

const PLACEHOLDER = "RELEASE_OWNER_MUST_REPLACE_WITH_BASE64_PUBLIC_KEY";

function baseConf() {
  return {
    version: "1.0.0-rc.1",
    bundle: {
      active: true,
      targets: ["app", "dmg", "nsis"],
      createUpdaterArtifacts: "v1Compatible",
      macOS: {
        minimumSystemVersion: "12.0",
        hardenedRuntime: true,
        signingIdentity: null,
        providerShortName: null,
        entitlements: "scripts/package-macos/entitlements.plist",
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
        pubkey: PLACEHOLDER,
        endpoints: [
          "https://github.com/trevorotts1/999-setup/releases/download/{{current_version}}/{{target}}-{{arch}}-{{current_version}}.json",
        ],
        windows: { installMode: "passive" },
      },
    },
  };
}

test("no credentials: overlay keeps null identities, reports unsigned, and rejects on the placeholder pubkey", () => {
  const result = applyReleaseConfigOverlay(baseConf(), {});
  assert.equal(result.ok, false);
  assert.deepEqual(result.state, { macos: "UNSIGNED", windows: "UNSIGNED", updater: "UNSIGNED" });
  assert.equal(result.conf === undefined, true);
  assert.ok(result.errors.some((e) => e.includes("placeholder")));
  // identities remain null — nothing is claimed without credentials
  assert.equal(baseConf().bundle.macOS.signingIdentity, null);
});

test("full credentials: all three surfaces signed, timestamp defaulted, placeholder replaced", () => {
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
  assert.equal(conf.plugins.updater.pubkey, PLACEHOLDER);
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
  assert.equal(result.ok, false); // updater placeholder still present
  assert.deepEqual(result.state, { macos: "SIGNED", windows: "UNSIGNED", updater: "UNSIGNED" });
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

test("CLI: overlay to a temp path with no credentials exits 1 on placeholder pubkey, posture UNSIGNED-UNSIGNED-UNSIGNED, no secret echo", () => {
  const root = mkdtempSync(join(tmpdir(), "candice-apply-release-"));
  const inputConf = join(root, "tauri.conf.json");
  const outputConf = join(root, "out", "tauri.release.json");
  writeFileSync(inputConf, JSON.stringify(baseConf(), null, 2));
  const script = join(import.meta.dirname, "..", "apply-release-config.mjs");
  const run = spawnSync(process.execPath, [script, "--input", inputConf, "--output", outputConf], {
    encoding: "utf8",
    env: { ...process.env },
  });
  assert.equal(run.status, 1, run.stdout + run.stderr); // placeholder pubkey -> not releaseable
  assert.ok(run.stderr.includes("UNSIGNED-UNSIGNED-UNSIGNED"));
  assert.ok(run.stderr.includes("placeholder"));
  const out = JSON.parse(readFileSync(outputConf, "utf8"));
  assert.equal(out.bundle.macOS.signingIdentity, null);
  assert.equal(out.bundle.windows.certificateThumbprint, null);
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
