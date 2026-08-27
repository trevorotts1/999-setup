/**
 * FIX-018 Layer 5 — repair transaction boundary suite (WS-32).
 *
 * Owned glob: `scripts/candice-upgrade/**` (PROJECT-MANIFEST 9.2 WR-017).
 *
 * Every test is hermetic: temp roots, temp Claude config roots, a stub
 * `claude` CLI, and injected seams at every transaction boundary. The live
 * `~/.claude` is never read or written here.
 *
 * Coverage (EXECUTION-PLAN lines 100-110):
 *   1. successful release repair: apply -> re-probe -> state write ->
 *      journal commit marker; state and registration land,
 *   2. re-probe failure rolls the whole transaction back (detect broken
 *      install -> targeted re-stage -> re-prove -> refuse to commit),
 *   3. state-write failure in release fails the run and rolls back,
 *   4. commit-marker write failure in release fails the run, restores the
 *      prior state document, and rolls the trees back,
 *   5. release rollback aborts: no later leg re-mutates (early stop),
 *   6. uninstall leaves no orphan registration (phantom records from other
 *      marketplaces removed; unrelated plugins survive),
 *   7. CLI passthrough: upgrade.mjs repair accepts --mode; lifecycle repair
 *      forwards --mode.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  chmodSync,
  cpSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { readState, STATE_SCHEMA, stateFilePath } from "../../candice-bootstrap/state.mjs";
import { skillsDir, pluginDir, assetsDir, appBundlePath } from "../../candice-bootstrap/paths.mjs";
import { PLUGIN_PINS } from "../../candice-bootstrap/install.mjs";
import { listPlugins, candiceRecords, register } from "../../candice-bootstrap/register-plugin.mjs";
import { healthCheck } from "../../candice-bootstrap/health.mjs";
import { uninstall } from "../../candice-bootstrap/uninstall.mjs";
import { enumerate, repair, applyRepairs, STATE_JOURNAL } from "../repair.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_PLUGIN = join(here, "..", "..", "..", "plugins", "candice-integration");
const LIFECYCLE_CLI = join(here, "..", "..", "candice-bootstrap", "lifecycle.mjs");
const UPGRADE_CLI = join(here, "..", "upgrade.mjs");

function freshRoot() {
  return mkdtempSync(join(tmpdir(), "candice-repair-l5-"));
}

/** Stub `claude` CLI emulating the plugin registry surface (mirrors the register-plugin contract). */
function writeClaudeStub(configRoot) {
  const stub = join(configRoot, "..", "claude-stub.mjs");
  writeFileSync(
    stub,
    `#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
const cfg = process.env.CLAUDE_CONFIG_DIR;
const pluginsDir = join(cfg, "plugins");
const registryFile = join(pluginsDir, "installed_plugins.json");
const mpFile = join(pluginsDir, "known_marketplaces.json");
const read = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } };
const write = (f, doc) => { mkdirSync(join(f, ".."), { recursive: true }); writeFileSync(f, JSON.stringify(doc, null, 2) + "\\n"); };
const args = process.argv.slice(2);
const cmd = args[0] || "";
if (cmd === "plugin") {
  if (args[1] === "list" && args[2] === "--json") {
    const reg = read(registryFile);
    const records = reg && reg.plugins ? Object.values(reg.plugins).flat() : [];
    console.log(JSON.stringify(records));
    process.exit(0);
  }
  if (args[1] === "install") {
    const id = args[2];
    const mps = read(mpFile);
    const mp = mps && mps["candice-marketplace"];
    if (!mp || !mp.source || !mp.source.path) { console.error("marketplace not registered"); process.exit(1); }
    const manifest = JSON.parse(readFileSync(join(mp.source.path, ".claude-plugin", "marketplace.json"), "utf8"));
    const p = manifest.plugins[0];
    const installPath = resolve(mp.source.path, p.source);
    if (!existsSync(join(installPath, ".claude-plugin", "plugin.json"))) { console.error("plugin tree missing"); process.exit(1); }
    const reg = read(registryFile) || { version: 2, plugins: {} };
    reg.plugins[id] = [{
      id, name: p.name, marketplace: "candice-marketplace", scope: "user", enabled: true,
      version: p.version, installPath, installedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      mcpServers: { candice: { command: "node" } },
    }];
    write(registryFile, reg);
    console.log("installed " + id);
    process.exit(0);
  }
  if (args[1] === "uninstall") {
    const id = args[2];
    const reg = read(registryFile) || { version: 2, plugins: {} };
    if (reg.plugins[id]) delete reg.plugins[id];
    write(registryFile, reg);
    console.log("uninstalled " + id);
    process.exit(0);
  }
  if (args[1] === "marketplace" && args[2] === "add") {
    const dir = args[3];
    const mps = read(mpFile) || {};
    mps["candice-marketplace"] = { name: "candice-marketplace", source: { type: "local", path: dir } };
    write(mpFile, mps);
    console.log("marketplace added");
    process.exit(0);
  }
  if (args[1] === "marketplace" && args[2] === "remove") {
    const mps = read(mpFile) || {};
    delete mps["candice-marketplace"];
    write(mpFile, mps);
    console.log("marketplace removed");
    process.exit(0);
  }
  console.error("stub: unknown plugin command " + args.join(" "));
  process.exit(1);
}
console.error("stub: unknown command " + args.join(" "));
process.exit(1);
`,
  );
  chmodSync(stub, 0o755);
  return stub;
}

/** Copy the real plugin tree into a temp root (the layout installPlugin produces). */
function stagePlugin(root) {
  const target = pluginDir(root);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(REPO_PLUGIN, target, { recursive: true });
  return target;
}

/** Hermetic repair environment. */
function env(opts = {}) {
  const root = opts.root || freshRoot();
  const configRoot = join(root, "config");
  const claudeBin = writeClaudeStub(configRoot);
  return {
    root,
    configRoot,
    claudeBin,
    common: {
      root,
      platform: "darwin",
      mode: "release",
      configRoot,
      claudeBin,
      env: { CLAUDE_CONFIG_DIR: configRoot, HOME: join(root, "fake-home") },
      noAtomic: true,
      offline: true,
    },
  };
}

/** Enumerate without the quarantined app leg (the app leg is its own blocked boundary; these tests exercise the transaction). */
function withoutApp(root) {
  return enumerate(root, "darwin", {}).filter((item) => item.kind !== "app");
}

function journalText(root) {
  const file = join(root, "state", STATE_JOURNAL);
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

// ---------------------------------------------------------------------------
// 1. Successful release repair: apply -> re-probe -> state write -> commit marker
// ---------------------------------------------------------------------------

test("release repair commits only after re-probe passes; state, registration, and commit marker land", async () => {
  const t = env();
  const { root, configRoot, claudeBin, common } = t;
  try {
    const r = await repair({
      ...common,
      enumerate: withoutApp,
      // Seam: the re-probe is injected to PASS (real probes are exercised by
      // the bootstrap suite; this boundary proves the gating and the marker).
      healthCheck: async () => ({ ok: true, schema: "candice.health-report/v1", missing: [], legs: {} }),
    });
    assert.equal(r.ok, true, r.message);
    assert.ok(r.health, "a passing re-probe must be recorded on the result");
    assert.ok(r.repair.done.some((d) => d.kind === "skill"), "skills repaired");
    assert.ok(r.repair.done.some((d) => d.kind === "plugin-registration"), "registration repaired");

    const state = readState(root, "darwin");
    assert.equal(state.schema, STATE_SCHEMA);
    assert.equal(state.components["candice-integration"].status, "installed");

    const listed = listPlugins(configRoot, { claudeBin });
    const mine = candiceRecords(listed.records);
    assert.equal(mine.length, 1, "one effective registration after release repair");
    assert.equal(mine[0].enabled, true);

    const j = journalText(root);
    assert.match(j, /"step":"repair.commit","ok":true/, "commit marker with ok:true must be journaled");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 2. Re-probe failure: detect broken install -> targeted re-stage -> re-prove -> refuse to commit
// ---------------------------------------------------------------------------

test("a failing post-repair health probe rolls the whole transaction back (re-probe gate)", async () => {
  const t = env();
  const { root, configRoot, claudeBin, common } = t;
  try {
    // Real healthCheck: the asset legs FAIL in release (offline record-only
    // markers are not installed payloads) and the app legs FAIL (no app).
    // The injected probe seams cover the IPC legs we own; everything else is
    // the real fail-closed probe.
    const r = await repair({
      ...common,
      enumerate: withoutApp,
      probes: {
        launchProbe: async () => ({ status: "PASS", detail: "injected" }),
        bridgeProbe: async () => ({ status: "PASS", detail: "injected" }),
        capabilityProbe: async () => ({ status: "PASS", detail: "injected" }),
      },
      healthCheck,
    });
    assert.equal(r.ok, false);
    assert.match(r.message, /post-repair health probe failed/);
    assert.ok(r.health, "the failing report must be attached");
    assert.ok(r.health.missing.includes("asset-stt-model"), `asset legs must fail in release: ${r.health.missing.join(", ")}`);

    // Whole transaction rolled back: no partial tree, no registration, no state.
    assert.equal(existsSync(skillsDir(root)), false, "skill tree must be rolled back");
    assert.equal(existsSync(pluginDir(root)), false, "plugin tree must be rolled back");
    assert.equal(existsSync(stateFilePath(root)), false, "state document must not land");
    const listed = listPlugins(configRoot, { claudeBin });
    assert.equal(candiceRecords(listed.records).length, 0, "no registration may remain after rollback");

    const j = journalText(root);
    assert.match(j, /"phase":"re-probe"/, "the failed commit phase must be journaled");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 3. State-write failure
// ---------------------------------------------------------------------------

test("a state-write failure in release fails the run and rolls the transaction back", async () => {
  const t = env();
  const { root, configRoot, claudeBin, common } = t;
  try {
    const r = await repair({
      ...common,
      enumerate: withoutApp,
      healthCheck: async () => ({ ok: true, schema: "candice.health-report/v1", missing: [], legs: {} }),
      writeState: () => false,
    });
    assert.equal(r.ok, false);
    assert.match(r.message, /state write failed; transaction rolled back/);
    assert.equal(existsSync(skillsDir(root)), false, "skill tree must be rolled back");
    assert.equal(existsSync(pluginDir(root)), false, "plugin tree must be rolled back");
    const listed = listPlugins(configRoot, { claudeBin });
    assert.equal(candiceRecords(listed.records).length, 0);
    assert.match(journalText(root), /"phase":"state-write"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4. Commit-marker write failure restores the prior state document
// ---------------------------------------------------------------------------

test("a commit-marker write failure in release restores the prior state document and rolls back", async () => {
  const t = env();
  const { root, configRoot, claudeBin, common } = t;
  try {
    // Prior known-good state: a committed state document with a sentinel.
    mkdirSync(join(root, "state"), { recursive: true });
    writeFileSync(
      stateFilePath(root),
      `${JSON.stringify({
        schema: STATE_SCHEMA,
        installedAt: new Date().toISOString(),
        platform: "darwin",
        components: { "prior-sentinel": { id: "prior-sentinel", version: "9.9.9", kind: "skill", status: "installed" } },
        assets: {},
        launch: {},
      })}\n`,
    );

    const r = await repair({
      ...common,
      enumerate: withoutApp,
      healthCheck: async () => ({ ok: true, schema: "candice.health-report/v1", missing: [], legs: {} }),
      journal: () => false, // every commit-phase journal write fails
    });
    assert.equal(r.ok, false);
    assert.match(r.message, /commit marker write failed; transaction rolled back/);
    assert.equal(existsSync(skillsDir(root)), false, "skill tree must be rolled back");
    assert.equal(existsSync(pluginDir(root)), false, "plugin tree must be rolled back");
    const listed = listPlugins(configRoot, { claudeBin });
    assert.equal(candiceRecords(listed.records).length, 0);

    const state = readState(root, "darwin");
    assert.ok(state.components["prior-sentinel"], "prior known-good state document must be restored");
    assert.equal(state.components["spec-protocol"], undefined, "no repaired component may remain in the restored state");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5. Release rollback aborts: no later leg re-mutates
// ---------------------------------------------------------------------------

test("after a release rollback, later legs do not run (early stop)", async () => {
  const t = env();
  const { root, configRoot, claudeBin } = t;
  try {
    const applied = await applyRepairs(
      root,
      "darwin",
      [
        { kind: "skill", id: "spec-protocol" },
        { kind: "app", id: "candice-companion" },
        { kind: "asset", id: "stt-model" },
      ],
      {
        mode: "release",
        configRoot,
        claudeBin,
        env: { CLAUDE_CONFIG_DIR: configRoot },
        noAtomic: true,
        offline: true,
        authority: { ok: false, message: "release authority refused the candidate (hermetic test)" },
      },
    );
    assert.equal(applied.aborted, true, "a release rollback must mark the transaction aborted");
    assert.equal(applied.failed.length, 1, JSON.stringify(applied.failed));
    assert.match(applied.failed[0].message, /transaction rolled back/);
    assert.equal(existsSync(skillsDir(root)), false, "skill install must be rolled back");
    assert.equal(existsSync(join(assetsDir(root, "stt"), ".record-ggml-tiny.en-q5_1.bin")), false, "asset leg must not run after the rollback (early stop)");
    assert.equal(existsSync(assetsDir(root, "")), false, "no asset tree may exist");
    const listed = listPlugins(configRoot, { claudeBin });
    assert.equal(candiceRecords(listed.records).length, 0, "the transaction's registration must be deregistered");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 6. Uninstall: no orphan registration
// ---------------------------------------------------------------------------

test("uninstall removes phantom candice registrations from other marketplaces; unrelated plugins survive", async () => {
  const t = env();
  const { root, configRoot, claudeBin } = t;
  const opts = { env: { CLAUDE_CONFIG_DIR: configRoot }, configRoot, claudeBin };
  try {
    stagePlugin(root);
    assert.equal(register(configRoot, pluginDir(root), PLUGIN_PINS["candice-integration"], opts).ok, true);

    // Orphan: a phantom candice record from another marketplace + an unrelated plugin.
    const regFile = join(configRoot, "plugins", "installed_plugins.json");
    const reg = JSON.parse(readFileSync(regFile, "utf8"));
    reg.plugins["candice-integration@evil-mp"] = [{ id: "candice-integration@evil-mp", name: "candice-integration", scope: "user", enabled: true, version: "1.0.0", installPath: "/elsewhere" }];
    reg.plugins["other-fixture@other-mp"] = [{ id: "other-fixture@other-mp", name: "other-fixture", scope: "user", enabled: true, version: "1.0.0", installPath: "/elsewhere" }];
    writeFileSync(regFile, JSON.stringify(reg, null, 2));

    const r = await uninstall({ root, platform: "darwin", mode: "test-fixture", ...opts });
    assert.equal(r.ok, true, JSON.stringify(r.steps));
    const listed = listPlugins(configRoot, opts);
    assert.equal(candiceRecords(listed.records).length, 0, "no candice record may remain — phantoms included");
    assert.ok(listed.records.some((p) => p.id.startsWith("other-fixture@")), "unrelated plugin survives");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 7. CLI passthrough
// ---------------------------------------------------------------------------

test("upgrade.mjs release repair still fails closed on the quarantined app", () => {
  const root = freshRoot();
  try {
    const r = spawnSync(process.execPath, [UPGRADE_CLI, "repair", "--offline", "--root", root, "--mode", "release"], { encoding: "utf8" });
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /repair blocked/, "release semantics must fire the block before any write");
    assert.equal(existsSync(stateFilePath(root)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("lifecycle repair forwards --mode and --config-root to the repair engine", () => {
  const root = freshRoot();
  try {
    // Non-release lifecycle repair: the app leg is a blocked SKIP (never a
    // write); the repair engine still runs. Release mode is the block gate
    // and is covered by the upgrade.mjs test above.
    const r = spawnSync(process.execPath, [LIFECYCLE_CLI, "repair", "--root", root, "--offline", "--mode", "developer", "--config-root", join(root, "config")], { encoding: "utf8" });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /repaired/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
