import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
  appDir,
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
  APP_PINS,
} from "../install.mjs";
import { healthCheck } from "../health.mjs";

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
      "spec-protocol": { status: "installed", version: "1.17.0" },
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

test("installApp darwin: staged .app bundle lands at <root>/app/Candice Companion.app", () => {
  const root = freshRoot();
  const app = join(root, "fixture.app");
  mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
  writeFileSync(join(app, "Contents", "MacOS", "candice-companion"), "#!/bin/sh\n");
  const r = installApp(root, "darwin", { appSource: app, noAtomic: true });
  assert.equal(r.ok, true, r.message);
  assert.equal(existsSync(join(appBundlePath(root), "Contents", "MacOS", "candice-companion")), true);
  assert.equal(r.installed["candice-companion"].version, "0.2.0");
  rmSync(root, { recursive: true, force: true });
});

test("installApp darwin refuses when no bundle staged (fail closed)", () => {
  const root = freshRoot();
  const r = installApp(root, "darwin", { noAtomic: true });
  assert.equal(r.ok, false);
  assert.equal(r.skipped, true);
  rmSync(root, { recursive: true, force: true });
});

test("installApp win32: records the NSIS placement, never fakes an app tree", () => {
  const root = freshRoot();
  const r = installApp(root, "win32", { noAtomic: true });
  assert.equal(r.ok, false);
  assert.equal(r.skipped, true);
  assert.match(r.message, /NSIS/);
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

test("installAll end-to-end (darwin, offline, no-atomic): state carries components+assets+launch", async () => {
  const root = freshRoot();
  const app = join(root, "fixture.app");
  mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
  writeFileSync(join(app, "Contents", "MacOS", "candice-companion"), "#!/bin/sh\n");

  const r = await installAll({ root, platform: "darwin", offline: true, noAtomic: true, appSource: app });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.results.skills.ok, true);
  assert.equal(r.results.plugin.ok, true);
  assert.equal(r.results.app.ok, true);
  assert.equal(r.results.assets.ok, true);

  const state = readState(root, "darwin");
  assert.equal(state.schema, STATE_SCHEMA);
  assert.equal(Object.keys(state.components).length, 7); // 5 skills + plugin + app
  assert.equal(state.components["spec-protocol"].version, "1.17.0");
  assert.equal(state.components["candice-integration"].version, "1.0.0");
  assert.equal(state.components["candice-companion"].version, "0.2.0");
  assert.equal(Object.keys(state.assets).length, 3);
  assert.equal(state.launch.ok, true);
  assert.match(state.launch.command, /Candice Companion\.app\/Contents\/MacOS\/candice-companion$/);
  rmSync(root, { recursive: true, force: true });
});

test("installAll is idempotent: second run over the same root reports ok", async () => {
  const root = freshRoot();
  const app = join(root, "fixture.app");
  mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
  writeFileSync(join(app, "Contents", "MacOS", "candice-companion"), "#!/bin/sh\n");
  const opts = { root, platform: "darwin", offline: true, noAtomic: true, appSource: app };
  const r1 = await installAll(opts);
  const r2 = await installAll(opts);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true, r2.message);
  rmSync(root, { recursive: true, force: true });
});

test("installAll win32: app skipped with NSIS note, rest installs, state honest", async () => {
  const root = freshRoot();
  const r = await installAll({ root, platform: "win32", offline: true, noAtomic: true });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.results.app.skipped, true);
  assert.equal(r.results.app.ok, false);
  assert.equal(r.skipped.includes("app"), true);
  const state = readState(root, "win32");
  assert.equal(Object.keys(state.components).length, 6); // skills + plugin (app absent -> 6, not 7)
  rmSync(root, { recursive: true, force: true });
});

test("healthCheck after full darwin install: all ok; before install: reports missing", async () => {
  const root = freshRoot();
  // Before: everything missing.
  const before = healthCheck({ root, platform: "darwin" });
  assert.equal(before.ok, false);
  assert.ok(before.missing.length >= 5);

  const app = join(root, "fixture.app");
  mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
  writeFileSync(join(app, "Contents", "MacOS", "candice-companion"), "#!/bin/sh\n");
  await installAll({ root, platform: "darwin", offline: true, noAtomic: true, appSource: app });

  const after = healthCheck({ root, platform: "darwin" });
  assert.equal(after.ok, true, JSON.stringify(after.components));
  assert.equal(after.stateComponentMatch, true);
  rmSync(root, { recursive: true, force: true });
});

test("healthCheck catches stale skill versions", async () => {
  const root = freshRoot();
  const app = join(root, "fixture.app");
  mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
  writeFileSync(join(app, "Contents", "MacOS", "candice-companion"), "#!/bin/sh\n");
  await installAll({ root, platform: "darwin", offline: true, noAtomic: true, appSource: app });
  // Corrupt one skill's VERSION to simulate staleness.
  writeFileSync(join(skillsDir(root), "bro", "VERSION"), "0.0.1\n");
  const h = healthCheck({ root, platform: "darwin" });
  assert.equal(h.ok, false);
  const bro = h.components.find((c) => c.name === "bro");
  assert.equal(bro.ok, false);
  assert.match(bro.detail, /stale/);
  rmSync(root, { recursive: true, force: true });
});
