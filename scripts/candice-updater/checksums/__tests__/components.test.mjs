/**
 * WS-33 component-registry unit tests (node:test).
 *
 * Run: node --test scripts/candice-updater/checksums/__tests__/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMPONENTS,
  PUBLISHED_PAYLOADS,
  REPO_TREE_COMPONENTS,
  resolveComponent,
  compareVersions,
  isNewer,
  isDowngrade,
  platformKeys,
  RUNTIME_PINS,
} from "../components.mjs";
import { QUARANTINED_PAYLOADS } from "../quarantined-payloads.mjs";

test("all 9 component identities present (5 skills + plugin + app + speech/wave asset groups)", () => {
  const ids = Object.keys(COMPONENTS);
  assert.equal(ids.length, 9);
  for (const id of [
    "nine-router-setup",
    "spec-protocol",
    "kaizen",
    "eli5",
    "bro",
    "candice-integration",
    "candice-companion",
    "stt-assets",
    "tts-assets",
  ]) {
    assert.ok(COMPONENTS[id], `missing ${id}`);
  }
});

test("every published payload has a 64-hex sha256 and operator-controlled source", () => {
  const entries = Object.entries(PUBLISHED_PAYLOADS);
  assert.ok(entries.length >= 6, `expected >=6 active verified payloads, saw ${entries.length}`);
  for (const [key, entry] of entries) {
    assert.ok(entry.payload, `${key} missing payload`);
    assert.equal(entry.payload.sha256.length, 64, `${key} sha256 not 64-hex: "${entry.payload.sha256}"`);
    assert.match(entry.payload.sha256, /^[0-9a-f]{64}$/, `${key} sha256 not lowercase hex`);
    assert.ok(entry.payload.sourceUrl, `${key} missing sourceUrl`);
    assert.ok(entry.payload.file, `${key} missing file`);
    if (entry.payload.sha256 !== "0".repeat(64)) {
      assert.ok(entry.payload.sizeBytes > 0, `${key} sizeBytes must be recorded`);
    }
  }
});

test("REPO_TREE components carry version pins for the 6 non-application tree components", () => {
  assert.equal(Object.keys(REPO_TREE_COMPONENTS).length, 6);

  // Versions are READ from each tree's VERSION file rather than restated
  // here. Restating them is what let this test rot: it asserted
  // spec-protocol 1.17.0 while the skill had moved to 1.17.4, so the test
  // agreed with a stale table instead of with the repository -- which is
  // the drift it was presumably meant to catch.
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
  for (const [id, rec] of Object.entries(REPO_TREE_COMPONENTS)) {
    const versionFile = join(repoRoot, rec.repoPath, "VERSION");
    if (!existsSync(versionFile)) continue;
    assert.equal(
      rec.version,
      readFileSync(versionFile, "utf8").trim(),
      `${id}: pin disagrees with its own VERSION file`,
    );
  }

  // candice-integration has no VERSION file -- its version lives in
  // .claude-plugin/plugin.json -- so it keeps a declared value, and the loop
  // above skips it. Pin it explicitly so "no VERSION file" cannot quietly
  // become "no assertion".
  assert.equal(existsSync(join(repoRoot, "plugins", "candice-integration", "VERSION")), false);
  assert.equal(REPO_TREE_COMPONENTS["candice-integration"].version, "1.0.0");

  // The one that matters most: there is deliberately NO app pin. A version
  // string is not install authority, and the app is not a repo-tree install.
  assert.equal(REPO_TREE_COMPONENTS["candice-companion"], undefined);

  // CONTROL: the loop above skips any component without a VERSION file, so
  // prove it actually asserted something rather than skipping everything.
  const checked = Object.values(REPO_TREE_COMPONENTS).filter((rec) =>
    existsSync(join(repoRoot, rec.repoPath, "VERSION")),
  );
  assert.equal(checked.length, 5, "five skill trees must carry a VERSION file and be checked");
});

test("speech asset pins match WS-16/WS-19 verified records", () => {
  assert.equal(
    PUBLISHED_PAYLOADS["stt-assets@whisper-1.9.2@darwin"].payload.sha256,
    "c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b",
  );
  assert.equal(
    PUBLISHED_PAYLOADS["stt-assets@whisper-1.9.2@darwin"].payload.sizeBytes,
    32166155,
  );
  assert.equal(
    PUBLISHED_PAYLOADS["tts-assets@kokoro-model-files-v1.1@any"].payload.sha256,
    "f3a290d384fbb27966d462905c71a46cef9e5fd00516b40df32a0b4afe77ac96",
  );
  assert.equal(
    PUBLISHED_PAYLOADS["tts-assets@kokoro-model-files-v1.1@any"].payload.sizeBytes,
    163527961,
  );
  assert.equal(
    PUBLISHED_PAYLOADS["tts-assets@kokoro-model-files-v1.1@voicepack"].payload.sha256,
    "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
  );
});

test("whisper win32 runtime archives carry verified per-platform hashes", () => {
  assert.equal(
    PUBLISHED_PAYLOADS["stt-assets@whisper-1.9.2@win32"].payload.sha256,
    "49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a",
  );
  assert.equal(
    PUBLISHED_PAYLOADS["stt-assets@whisper-1.9.2@win32-x86"].payload.sha256,
    "de170719aebcb4794d695d449e179002db1fe03b862f21f5c34b2909a7cf8f22",
  );
});

test("unproven candice-companion 0.2.0 artifacts are quarantined, never updater-resolvable", () => {
  const mac = QUARANTINED_PAYLOADS["candice-companion@0.2.0@darwin"];
  assert.equal(mac.payload.sha256, "f24f4bcb9a267129c856e333c3bb79c687ec4dc11b47558b301f1f0cf6b0dbaf");
  assert.equal(mac.payload.sizeBytes, 2686932);
  assert.equal(mac.payload.file, "Candice Companion_0.2.0_aarch64.dmg");
  assert.equal(mac.status, "QUARANTINED");
  const win = QUARANTINED_PAYLOADS["candice-companion@0.2.0@win32"];
  assert.equal(win.payload.sha256, "0".repeat(64));
  assert.equal(win.payload.sizeBytes, 0);
  assert.equal(win.payload.file, "Candice Companion_0.2.0_x64-setup.exe");
  assert.equal(win.status, "QUARANTINED");
  assert.equal(resolveComponent("candice-companion", "0.2.0", "darwin"), undefined);
  assert.equal(resolveComponent("candice-companion", "0.2.0", "win32"), undefined);
});

test("no ad-hoc third-party URL anywhere in the registry", () => {
  const allUrls = JSON.stringify({ p: PUBLISHED_PAYLOADS, r: REPO_TREE_COMPONENTS });
  const suspects = allUrls.match(/https?:\/\/[^"]+/g) || [];
  assert.ok(suspects.length > 0);
  for (const u of suspects) {
    assert.ok(
      u.startsWith("https://github.com/") || u.startsWith("https://huggingface.co/"),
      `URL not operator-controlled: ${u}`,
    );
  }
});

test("resolveComponent honours platform fallback ('any')", () => {
  assert.equal(resolveComponent("candice-companion", "0.2.0", "darwin"), undefined);
  const win = resolveComponent("stt-assets", "whisper-1.9.2", "win32");
  assert.ok(win);
  assert.equal(win.payload.file, "whisper-bin-x64.zip");
  assert.equal(resolveComponent("kaizen", "1.0.1", "linux"), undefined);
  assert.equal(resolveComponent("candice-companion", "9.9.9", "darwin"), undefined);
});

test("platformKeys include shared 'any' for known platforms", () => {
  assert.deepEqual(platformKeys("darwin"), ["darwin", "any"]);
  assert.deepEqual(platformKeys("win32"), ["win32", "any"]);
  assert.deepEqual(platformKeys("linux"), ["linux"]);
});

test("compareVersions orders dot versions correctly", () => {
  assert.equal(compareVersions("1.16.3", "1.16.2"), 1);
  assert.equal(compareVersions("1.16.3", "1.16.3"), 0);
  assert.equal(compareVersions("1.0.0", "1.0.1"), -1);
  assert.equal(compareVersions("v1.0.1", "1.0.1"), 0);
  assert.equal(compareVersions("1.2", "1.2.0"), 0);
  assert.equal(compareVersions("whisper-1.9.2", "whisper-1.9.2"), 0);
});

test("isNewer / isDowngrade detect upgrade vs downgrade", () => {
  assert.ok(isNewer("1.16.3", "1.16.2"));
  assert.ok(!isNewer("1.16.2", "1.16.3"));
  assert.ok(isDowngrade("1.16.2", "1.16.3"));
  assert.ok(!isDowngrade("1.16.3", "1.16.3"));
  assert.ok(!isDowngrade("1.16.3", "1.16.2"));
});

test("runtime pins present", () => {
  assert.equal(RUNTIME_PINS.whisperCpp, "1.9.2");
  assert.equal(RUNTIME_PINS.kokoroOnnx, "0.6.1");
  assert.equal(RUNTIME_PINS.onnxruntime, "1.29.0");
});
