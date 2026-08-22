import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { bootstrapRoot, readState, STATE_SCHEMA } from "../../candice-bootstrap/state.mjs";
import { skillsDir, pluginDir, appBundlePath, assetsDir } from "../../candice-bootstrap/paths.mjs";
import { SKILL_PINS, PLUGIN_PINS, APP_PINS, installSkills, installPlugin, installAll } from "../../candice-bootstrap/install.mjs";
import { healthCheck } from "../../candice-bootstrap/health.mjs";
import { enumerate, planRepairs, repair, applyRepairs, INTEGRATION_PINS } from "../repair.mjs";

function freshRoot() {
  return mkdtempSync(join(tmpdir(), "candice-upgrade-"));
}

function makeAppFixture(root) {
  const app = join(root, "fixture.app");
  mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
  writeFileSync(join(app, "Contents", "MacOS", "candice-companion"), "#!/bin/sh\n");
  return app;
}

/** Install a complete darwin tree via the WS-31 engine (the upgrade baseline). */
async function fullInstall(root) {
  const app = makeAppFixture(root);
  const r = await installAll({ root, platform: "darwin", offline: true, noAtomic: true, appSource: app });
  assert.equal(r.ok, true, r.message);
  return r;
}

function writeVersion(dir, version) {
  writeFileSync(join(dir, "VERSION"), `${version}\n`);
}

test("bootstrapRoot is shared with the WS-31 lane (same install root)", () => {
  const env = { HOME: "/Users/alice", CANDICE_BOOTSTRAP_ROOT: undefined };
  const r1 = bootstrapRoot({ ...env, CANDICE_BOOTSTRAP_ROOT: "/tmp/shared-root" }, "darwin");
  assert.equal(r1, "/tmp/shared-root");
  const r2 = bootstrapRoot(env, "darwin");
  assert.equal(r2, "/Users/alice/Library/Application Support/BlackCEO/999");
});

test("enumerate: full healthy darwin tree -> every pinned component present and current", async () => {
  const root = freshRoot();
  await fullInstall(root);
  const items = await enumerate(root, "darwin");
  const byId = Object.fromEntries(items.map((i) => [`${i.kind}:${i.id}`, i]));

  for (const [name, version] of Object.entries(SKILL_PINS)) {
    assert.equal(byId[`skill:${name}`].kind, "skill");
    assert.equal(byId[`skill:${name}`].present, true, name);
    assert.equal(byId[`skill:${name}`].installed, version, name);
  }
  assert.equal(byId["plugin:candice-integration"].present, true);
  for (const [name] of Object.entries(INTEGRATION_PINS)) {
    assert.equal(byId[`integration:${name}`].present, true, name);
  }
  assert.equal(byId["app:candice-companion"].present, true);
  assert.equal(byId["asset:stt-model"].present, true);
  assert.equal(byId["asset:tts-model"].present, true);
  assert.equal(byId["asset:tts-voice"].present, true);
  rmSync(root, { recursive: true, force: true });
});

test("enumerate: fresh-empty root -> everything missing (repair-required)", () => {
  const root = freshRoot();
  const items = enumerate(root, "darwin");
  assert.equal(items.length, 13); // 5 skills + plugin + 3 integrations + app + 3 assets
  for (const it of items) {
    assert.equal(it.installed, null, `${it.kind} ${it.id} should be null`);
    assert.equal(it.present, false);
  }
  rmSync(root, { recursive: true, force: true });
});

test("enumerate: stale skill VERSION and missing integration detected", async () => {
  const root = freshRoot();
  await fullInstall(root);
  writeVersion(join(skillsDir(root), "kaizen"), "0.9.0");
  rmSync(join(pluginDir(root), "integrations", "bro"), { recursive: true, force: true });

  const items = enumerate(root, "darwin");
  const byId = Object.fromEntries(items.map((i) => [`${i.kind}:${i.id}`, i]));
  assert.equal(byId["skill:kaizen"].installed, "0.9.0");
  assert.equal(byId["integration:bro"].installed, null);
  rmSync(root, { recursive: true, force: true });
});

test("planRepairs: missing -> install, stale -> upgrade, newer -> ahead, equal -> current", async () => {
  const root = freshRoot();
  await fullInstall(root);
  writeVersion(join(skillsDir(root), "kaizen"), "0.9.0");
  rmSync(join(pluginDir(root), "integrations", "eli5"), { recursive: true, force: true });
  writeVersion(join(skillsDir(root), "bro"), "9.9.9");
  rmSync(join(skillsDir(root), "spec-protocol"), { recursive: true, force: true });

  const { repairs, skips } = planRepairs(enumerate(root, "darwin"));
  const repairIds = repairs.map((r) => `${r.kind}:${r.id}`);
  const skipIds = skips.map((s) => `${s.kind}:${s.id}`);

  assert.ok(repairIds.includes("skill:spec-protocol"), "missing skill must repair");
  assert.ok(repairIds.includes("skill:kaizen"), "stale skill must upgrade");
  assert.ok(repairIds.includes("integration:eli5"), "missing integration must repair");
  assert.ok(skipIds.includes("skill:bro"), "ahead component must be skipped, never downgraded");
  assert.ok(skipIds.includes("plugin:candice-integration"));
  rmSync(root, { recursive: true, force: true });
});

test("applyRepairs: missing components installed from repo checkout (offline record mode)", async () => {
  const root = freshRoot();
  const app = makeAppFixture(root);
  const r = await applyRepairs(root, "darwin", [
    { kind: "skill", id: "spec-protocol" },
    { kind: "skill", id: "kaizen" },
    { kind: "plugin", id: "candice-integration" },
    { kind: "app", id: "candice-companion" },
    { kind: "asset", id: "stt-model" },
    { kind: "asset", id: "tts-model" },
    { kind: "asset", id: "tts-voice" },
  ], { offline: true, noAtomic: true, appSource: app });

  assert.equal(r.failed.length, 0, JSON.stringify(r.failed));
  assert.ok(r.done.length >= 7);
  assert.equal(existsSync(join(skillsDir(root), "spec-protocol", "SKILL.md")), true);
  assert.equal(existsSync(join(pluginDir(root), ".claude-plugin", "plugin.json")), true);
  assert.equal(existsSync(join(appBundlePath(root), "Contents", "MacOS", "candice-companion")), true);
  assert.equal(existsSync(join(assetsDir(root, "tts"), ".record-kokoro-v1.0.fp16.onnx")), true);

  // Journal records every repaired component.
  const journal = readFileSync(join(root, "state", "upgrade-journal.jsonl"), "utf8");
  assert.match(journal, /"id":"spec-protocol"/);
  assert.match(journal, /"kind":"asset"/);
  rmSync(root, { recursive: true, force: true });
});

test("applyRepairs skips unverifiable app payload (fail closed, nothing invented)", async () => {
  const root = freshRoot();
  const r = await applyRepairs(root, "darwin", [{ kind: "app", id: "candice-companion" }], { offline: true, noAtomic: true });
  assert.equal(r.failed.length, 0);
  assert.equal(r.done.length, 0);
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0].kind, "app");
  rmSync(root, { recursive: true, force: true });
});

test("repair end-to-end: missing Candice -> repaired; health then reports ok (spec 21 steps 3-7)", async () => {
  const root = freshRoot();
  const app = makeAppFixture(root);

  const r = await repair({ root, platform: "darwin", offline: true, noAtomic: true, appSource: app });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.plan.repairs.length, 13); // 5 skills + plugin + 3 integrations + app + 3 assets
  assert.equal(r.repair.failed.length, 0, JSON.stringify(r.repair.failed));

  // Step 7: fast health/version check after successful bootstrap.
  const h = healthCheck({ root, platform: "darwin" });
  assert.equal(h.ok, true, JSON.stringify(h.components));
  rmSync(root, { recursive: true, force: true });
});

test("repair end-to-end: stale kaizen + missing bro integration repaired; state promoted", async () => {
  const root = freshRoot();
  await fullInstall(root);
  writeVersion(join(skillsDir(root), "kaizen"), "0.9.0");
  rmSync(join(pluginDir(root), "integrations", "bro"), { recursive: true, force: true });

  const r = await repair({ root, platform: "darwin", offline: true, noAtomic: true });
  assert.equal(r.ok, true, r.message);
  assert.equal(readFileSync(join(skillsDir(root), "kaizen", "VERSION"), "utf8").trim(), "1.1.0");
  assert.equal(existsSync(join(pluginDir(root), "integrations", "bro", "README.md")), true);

  const state = readState(root, "darwin");
  assert.equal(state.components.kaizen.version, "1.1.0");
  assert.equal(existsSync(join(root, "state", "upgrade-journal.jsonl")), true);
  rmSync(root, { recursive: true, force: true });
});

test("repair idempotent: second run repairs nothing", async () => {
  const root = freshRoot();
  const app = makeAppFixture(root);
  const opts = { root, platform: "darwin", offline: true, noAtomic: true, appSource: app };
  const r1 = await repair(opts);
  const r2 = await repair(opts);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true, r2.message);
  assert.equal(r2.repair.done.length, 0, "second run must repair nothing");
  assert.match(r2.message, /no repairs needed/);
  rmSync(root, { recursive: true, force: true });
});

test("repair simulate: plans but writes nothing", async () => {
  const root = freshRoot();
  const s = await repair({ root, platform: "darwin", offline: true, simulate: true });
  assert.equal(s.simulate, true);
  assert.equal(s.plan.repairs.length, 13); // 5 skills + plugin + 3 integrations + app + 3 assets
  assert.equal(existsSync(join(root, "skills")), false, "simulate must not write");
  rmSync(root, { recursive: true, force: true });
});

test("repair never downgrades: ahead component untouched", async () => {
  const root = freshRoot();
  await fullInstall(root);
  writeVersion(join(skillsDir(root), "eli5"), "2.0.0");
  const r = await repair({ root, platform: "darwin", offline: true, noAtomic: true });
  assert.equal(r.ok, true);
  assert.equal(readFileSync(join(skillsDir(root), "eli5", "VERSION"), "utf8").trim(), "2.0.0");
  rmSync(root, { recursive: true, force: true });
});

test("win32: app enumerated as NSIS-owner, never faked; other components repair", async () => {
  const root = freshRoot();
  const items = enumerate(root, "win32");
  const app = items.find((i) => i.id === "candice-companion");
  assert.equal(app.note, "NSIS installer owns placement (WS-29)");
  assert.equal(app.present, false);

  const r = await repair({ root, platform: "win32", offline: true, noAtomic: true });
  assert.equal(r.ok, true, r.message);
  const state = readState(root, "win32");
  assert.ok(!state.components["candice-companion"], "app must not be recorded as installed on win32");
  assert.equal(Object.keys(state.assets).length, 4); // stt-runtime included on win32
  rmSync(root, { recursive: true, force: true });
});

test("repair atomic mode (no noAtomic): skills installed through the real WS-33 atomic engine", async () => {
  const root = freshRoot();
  const r = await repair({ root, platform: "darwin", offline: true, appSource: makeAppFixture(root) });
  assert.equal(r.ok, true, r.message);
  assert.equal(existsSync(join(skillsDir(root), "spec-protocol", "SKILL.md")), true);
  const state = readState(root, "darwin");
  assert.equal(state.schema, STATE_SCHEMA);
  rmSync(root, { recursive: true, force: true });
});
