import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  bootstrapRoot,
  readState,
  writeState,
  stateMatches,
  STATE_SCHEMA,
  stateFilePath,
} from "../state.mjs";
import {
  skillsDir,
  pluginDir,
  appBundlePath,
  assetsDir,
  sttBinaryPath,
  modelPath,
  ttsModelPath,
} from "../paths.mjs";
import {
  installAll,
  installSkills,
  installPlugin,
  installApp,
  installAssets,
  launchCommand,
  repoPaths,
  skillSourceExists,
  SKILL_PINS,
  PLUGIN_PINS,
} from "../install.mjs";
import { healthCheck } from "../health.mjs";

const BOOTSTRAP_CLI = fileURLToPath(new URL("../bootstrap.mjs", import.meta.url));

/** Hermetic root per test. */
function freshRoot() {
  const root = mkdtempSync(join(tmpdir(), "candice-bootstrap-"));
  return root;
}

test("bootstrapRoot derives from HOME / LOCALAPPDATA, never a hardcoded user", () => {
  const mac = bootstrapRoot({ HOME: "/Users/alice" }, "darwin");
  assert.equal(mac, "/Users/alice/Library/Application Support/BlackCEO/999");
  const win = bootstrapRoot({ LOCALAPPDATA: "C:\\Users\\alice\\AppData\\Local" }, "win32");
  assert.equal(win.replace(/\\/g, "/"), "C:/Users/alice/AppData/Local/BlackCEO/999");
  const fallback = bootstrapRoot({}, "darwin");
  assert.equal(fallback, ".candice-bootstrap/state");
});

test("bootstrapRoot honors CANDICE_BOOTSTRAP_ROOT override", () => {
  assert.equal(bootstrapRoot({ CANDICE_BOOTSTRAP_ROOT: "/tmp/x" }, "darwin"), "/tmp/x");
});

test("state round-trip: write -> read matches; schema stamped", () => {
  const root = freshRoot();
  const s = { schema: STATE_SCHEMA, installedAt: new Date().toISOString(), platform: "darwin", components: {}, assets: {}, launch: {} };
  assert.equal(writeState(root, s), true);
  const back = readState(root, "darwin");
  assert.equal(back.schema, STATE_SCHEMA);
  assert.equal(back.platform, "darwin");
  // Corrupt/absent -> empty state, never throws
  assert.equal(readState(root, "win32").schema, STATE_SCHEMA);
  rmSync(root, { recursive: true, force: true });
});

test("stateMatches detects full vs partial component sets", () => {
  const state = {
    schema: STATE_SCHEMA,
    platform: "darwin",
    components: {
      "nine-router-setup": { status: "installed", version: "1.17.0" },
      "spec-protocol": { status: "installed", version: "1.17.3" },
      kaizen: { status: "installed", version: "1.1.0" },
      eli5: { status: "installed", version: "1.1.0" },
      bro: { status: "installed", version: "1.1.0" },
    },
    assets: {},
    launch: {},
  };
  assert.equal(stateMatches(state, SKILL_PINS), true);
  assert.equal(stateMatches(state, { ...SKILL_PINS, kaizen: "9.9.9" }), false);
});

test("paths resolve inside the bootstrap root", () => {
  const root = "/tmp/br";
  assert.equal(skillsDir(root), join(root, "skills"));
  assert.equal(pluginDir(root), join(root, "plugin", "candice-integration"));
  assert.equal(appBundlePath(root), join(root, "app", "Candice Companion.app"));
  assert.equal(assetsDir(root, "stt"), join(root, "assets", "stt"));
  assert.equal(ttsModelPath(root, "voices-v1.0.bin"), join(root, "assets", "tts", "voices-v1.0.bin"));
});

test("skillSourceExists: all five bundled skills present in the repo checkout", () => {
  for (const name of Object.keys(SKILL_PINS)) {
    assert.equal(skillSourceExists(name), true, `missing skill source: ${name}`);
  }
});

test("installSkills stages and installs all five skill trees atomically-equivalent", () => {
  const root = freshRoot();
  const r = installSkills(root, SKILL_PINS, { noAtomic: true });
  assert.equal(r.ok, true, r.message);
  assert.equal(Object.keys(r.installed).length, 5);
  for (const name of Object.keys(SKILL_PINS)) {
    assert.equal(existsSync(join(skillsDir(root), name, "SKILL.md")), true, name);
    assert.equal(existsSync(join(skillsDir(root), name, "VERSION")), true, name);
    const v = readFileSync(join(skillsDir(root), name, "VERSION"), "utf8").trim();
    assert.equal(v, SKILL_PINS[name], `${name} version mismatch`);
  }
  rmSync(root, { recursive: true, force: true });
});

test("installSkills fails clean when a skill source is missing", () => {
  const root = freshRoot();
  const r = installSkills(root, { "does-not-exist": "1.0.0" }, { noAtomic: true });
  assert.equal(r.ok, false);
  assert.match(r.message, /missing in repo/);
  rmSync(root, { recursive: true, force: true });
});

test("installPlugin: plugin tree lands with manifest + hooks + wake handler", () => {
  const root = freshRoot();
  const r = installPlugin(root, PLUGIN_PINS, { noAtomic: true });
  assert.equal(r.ok, true, r.message);
  const p = pluginDir(root);
  assert.equal(existsSync(join(p, ".claude-plugin", "plugin.json")), true);
  assert.equal(existsSync(join(p, "hooks", "hooks.json")), true);
  assert.equal(existsSync(join(p, "bin", "wake-candice.sh")), true);
  rmSync(root, { recursive: true, force: true });
});

test("installPlugin: provisioned copy declares companion readiness", () => {
  const root = freshRoot();
  const r = installPlugin(root, PLUGIN_PINS, { noAtomic: true, companionReady: true });
  assert.equal(r.ok, true, r.message);
  const mcp = JSON.parse(readFileSync(join(pluginDir(root), ".mcp.json"), "utf8"));
  assert.equal(mcp.mcpServers.candice.env.CANDICE_COMPANION_READY, "1");
  rmSync(root, { recursive: true, force: true });
});

test("installApp refuses a caller-staged .app bundle until release authority exists", async () => {
  const root = freshRoot();
  const app = join(root, "fixture.app");
  mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
  writeFileSync(join(app, "Contents", "MacOS", "candice-companion"), "#!/bin/sh\n");
  const r = await installApp(root, "darwin", { mode: "test-fixture", appSource: app, noAtomic: true });
  assert.equal(r.ok, false);
  assert.equal(r.blocked, true);
  assert.match(r.message, /release-authorized/);
  assert.equal(existsSync(join(appBundlePath(root), "Contents", "MacOS", "candice-companion")), false);
  rmSync(root, { recursive: true, force: true });
});

test("installApp refuses when no mode is given (mode gate before any write)", async () => {
  const root = freshRoot();
  const r = await installApp(root, "darwin", { noAtomic: true });
  assert.equal(r.ok, false);
  assert.equal(r.modeRequired, true);
  assert.match(r.message, /mode/);
  rmSync(root, { recursive: true, force: true });
});

test("installApp darwin refuses when no release-authorized candidate exists (fail closed)", async () => {
  const root = freshRoot();
  const r = await installApp(root, "darwin", { mode: "test-fixture", noAtomic: true });
  assert.equal(r.ok, false);
  assert.equal(r.blocked, true);
  rmSync(root, { recursive: true, force: true });
});

test("installApp win32 refuses until a release-authorized candidate exists", async () => {
  const root = freshRoot();
  const r = await installApp(root, "win32", { mode: "test-fixture", noAtomic: true });
  assert.equal(r.ok, false);
  assert.equal(r.blocked, true);
  assert.match(r.message, /release-authorized/);
  rmSync(root, { recursive: true, force: true });
});

test("CLI rejects --app-source before any install, state write, or network-capable leg", () => {
  const root = freshRoot();
  const app = join(root, "unverified.app");
  mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
  writeFileSync(join(app, "Contents", "MacOS", "candice-companion"), "#!/bin/sh\n");
  const proc = spawnSync(process.execPath, [BOOTSTRAP_CLI, "install", "--offline", "--root", root, "--app-source", app], { encoding: "utf8" });
  assert.equal(proc.status, 2, proc.stderr);
  assert.match(proc.stderr, /usage:/);
  assert.equal(existsSync(appBundlePath(root)), false);
  assert.equal(existsSync(stateFilePath(root)), false);
  rmSync(root, { recursive: true, force: true });
});

test("installAssets record mode: pinned STT/TTS assets recorded from the WS-33 registry", async () => {
  const root = freshRoot();
  const r = await installAssets(root, "darwin", { mode: "record" });
  assert.equal(r.ok, true, r.message);
  // stt-model, tts-model, tts-voice recorded; darwin stt-runtime not a leg.
  assert.equal(Object.keys(r.installed).length, 3);
  assert.equal(r.installed["stt-model"].file, "ggml-tiny.en-q5_1.bin");
  assert.match(r.installed["stt-model"].sha256, /^[0-9a-f]{64}$/);
  assert.equal(existsSync(join(assetsDir(root, "stt"), ".record-ggml-tiny.en-q5_1.bin")), true);
  rmSync(root, { recursive: true, force: true });
});

test("installAssets win32 record mode includes stt-runtime leg", async () => {
  const root = freshRoot();
  const r = await installAssets(root, "win32", { mode: "record" });
  assert.equal(r.ok, true, r.message);
  assert.equal(Object.keys(r.installed).length, 4);
  assert.equal(r.installed["stt-runtime"].file, "whisper-bin-x64.zip");
  rmSync(root, { recursive: true, force: true });
});

test("installAll blocks before writing skills, plugin, app, assets, or state without release authority", async () => {
  const root = freshRoot();
  const app = join(root, "fixture.app");
  mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
  writeFileSync(join(app, "Contents", "MacOS", "candice-companion"), "#!/bin/sh\n");

  const r = await installAll({ root, platform: "darwin", mode: "test-fixture", offline: true, noAtomic: true, appSource: app });
  assert.equal(r.ok, false);
  assert.equal(r.results.app.blocked, true);
  assert.equal(r.results.skills, undefined);
  assert.equal(r.results.plugin, undefined);
  assert.equal(r.results.assets, undefined);
  assert.equal(existsSync(skillsDir(root)), false);
  assert.equal(existsSync(pluginDir(root)), false);
  assert.equal(existsSync(appBundlePath(root)), false);
  assert.equal(existsSync(assetsDir(root, "stt")), false);
  assert.equal(existsSync(stateFilePath(root)), false);
  rmSync(root, { recursive: true, force: true });
});

test("installAll requires a mode before the first write", async () => {
  const root = freshRoot();
  const r = await installAll({ root, platform: "darwin", offline: true, noAtomic: true });
  assert.equal(r.ok, false);
  assert.match(r.message, /mode/);
  assert.equal(existsSync(stateFilePath(root)), false);
  assert.equal(existsSync(join(root, "state")), false);
  rmSync(root, { recursive: true, force: true });
});

test("installAll remains blocked on repeat invocations and leaves no bootstrap state", async () => {
  const root = freshRoot();
  const opts = { root, platform: "darwin", mode: "test-fixture", offline: true, noAtomic: true };
  const r1 = await installAll(opts);
  const r2 = await installAll(opts);
  assert.equal(r1.ok, false);
  assert.equal(r2.ok, false, r2.message);
  assert.equal(existsSync(stateFilePath(root)), false);
  rmSync(root, { recursive: true, force: true });
});

test("installAll win32 blocks before writing an incomplete bootstrap state", async () => {
  const root = freshRoot();
  const r = await installAll({ root, platform: "win32", mode: "test-fixture", offline: true, noAtomic: true });
  assert.equal(r.ok, false, r.message);
  assert.equal(r.results.app.blocked, true);
  assert.equal(r.results.app.ok, false);
  assert.equal(existsSync(stateFilePath(root)), false);
  rmSync(root, { recursive: true, force: true });
});

test("healthCheck reports the app unavailable before release authority exists", async () => {
  const root = freshRoot();
  const health = await healthCheck({ root, platform: "darwin", mode: "test-fixture" });
  assert.equal(health.ok, false);
  assert.equal(health.legs["app-provenance"].status, "FAIL");
  rmSync(root, { recursive: true, force: true });
});

test("healthCheck catches stale skill versions independently of the blocked app", async () => {
  const root = freshRoot();
  assert.equal(installSkills(root, SKILL_PINS, { noAtomic: true }).ok, true);
  assert.equal(installPlugin(root, PLUGIN_PINS, { noAtomic: true }).ok, true);
  // Corrupt one skill's VERSION to simulate staleness.
  writeFileSync(join(skillsDir(root), "bro", "VERSION"), "0.0.1\n");
  const h = await healthCheck({ root, platform: "darwin", mode: "test-fixture" });
  assert.equal(h.ok, false);
  assert.match(h.legs["skill-tree"].detail, /bro/);
  rmSync(root, { recursive: true, force: true });
});
