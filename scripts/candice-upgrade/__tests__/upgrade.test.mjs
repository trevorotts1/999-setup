import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { bootstrapRoot, stateFilePath } from "../../candice-bootstrap/state.mjs";
import { skillsDir, pluginDir, appBundlePath, assetsDir } from "../../candice-bootstrap/paths.mjs";
import { SKILL_PINS } from "../../candice-bootstrap/install.mjs";
import { enumerate, planRepairs, repair, applyRepairs } from "../repair.mjs";

function freshRoot() { return mkdtempSync(join(tmpdir(), "candice-upgrade-")); }

function makeAppFixture(root) {
  const app = appBundlePath(root);
  mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
  writeFileSync(join(app, "Contents", "MacOS", "candice-companion"), "#!/bin/sh\n");
  return app;
}

test("bootstrapRoot is shared with the bootstrap lane", () => {
  assert.equal(bootstrapRoot({ CANDICE_BOOTSTRAP_ROOT: "/tmp/shared-root" }, "darwin"), "/tmp/shared-root");
});

test("enumerate marks a missing app as blocked, not repairable/current", () => {
  const root = freshRoot();
  const app = enumerate(root, "darwin").find((item) => item.kind === "app");
  assert.equal(app.present, false);
  assert.equal(app.installed, null);
  assert.equal(app.pinned, null);
  assert.equal(app.blocked, true);
  assert.match(app.note, /release-authorized/);
  rmSync(root, { recursive: true, force: true });
});

test("enumerate treats a caller-created local app as untrusted", () => {
  const root = freshRoot();
  makeAppFixture(root);
  const app = enumerate(root, "darwin").find((item) => item.kind === "app");
  assert.equal(app.present, true);
  assert.equal(app.installed, null);
  assert.equal(app.blocked, true);
  assert.match(app.note, /untrusted/);
  rmSync(root, { recursive: true, force: true });
});

test("planRepairs excludes the quarantined app and records an explicit block", () => {
  const root = freshRoot();
  const { repairs, skips } = planRepairs(enumerate(root, "darwin"));
  assert.equal(repairs.some((item) => item.kind === "app"), false);
  assert.equal(skips.find((item) => item.kind === "app").action, "blocked");
  assert.equal(repairs.some((item) => item.id === "spec-protocol"), true);
  rmSync(root, { recursive: true, force: true });
});

test("applyRepairs refuses a supplied app and never copies it", async () => {
  const root = freshRoot();
  const r = await applyRepairs(root, "darwin", [
    { kind: "skill", id: "spec-protocol" },
    { kind: "app", id: "candice-companion" },
  ], { offline: true, noAtomic: true, appSource: "/tmp/untrusted.app" });
  assert.equal(r.failed.length, 0);
  assert.equal(r.blocked.length, 1);
  assert.equal(r.done.find((item) => item.id === "spec-protocol").version, SKILL_PINS["spec-protocol"]);
  assert.equal(existsSync(appBundlePath(root)), false);
  rmSync(root, { recursive: true, force: true });
});

test("repair blocks before creating skills, plugin, assets, app, or state", async () => {
  const root = freshRoot();
  const r = await repair({ root, platform: "darwin", offline: true, noAtomic: true });
  assert.equal(r.ok, false);
  assert.equal(r.repair.blocked.length, 1);
  assert.equal(existsSync(skillsDir(root)), false);
  assert.equal(existsSync(pluginDir(root)), false);
  assert.equal(existsSync(assetsDir(root, "stt")), false);
  assert.equal(existsSync(appBundlePath(root)), false);
  assert.equal(existsSync(stateFilePath(root)), false);
  rmSync(root, { recursive: true, force: true });
});

test("repair blocks an existing arbitrary app and writes no partial state", async () => {
  const root = freshRoot();
  makeAppFixture(root);
  const r = await repair({ root, platform: "darwin", offline: true, noAtomic: true });
  assert.equal(r.ok, false);
  assert.match(r.message, /untrusted/);
  assert.equal(existsSync(stateFilePath(root)), false);
  assert.equal(existsSync(skillsDir(root)), false);
  rmSync(root, { recursive: true, force: true });
});

test("repair simulation reports the release block and writes nothing", async () => {
  const root = freshRoot();
  const r = await repair({ root, platform: "darwin", offline: true, simulate: true });
  assert.equal(r.ok, false);
  assert.equal(r.repair.blocked[0].id, "candice-companion");
  assert.equal(existsSync(stateFilePath(root)), false);
  rmSync(root, { recursive: true, force: true });
});
