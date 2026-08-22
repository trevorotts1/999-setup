import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  PLUGIN_NAME,
  PLUGIN_ID,
  PLUGIN_MARKETPLACE,
  discoverConfigRoots,
  register,
  verify,
  deregister,
  registerAll,
  verifyAll,
  deregisterAll,
  listPlugins,
  candiceRecords,
  marketplaceRecord,
} from "../register-plugin.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_PLUGIN = join(here, "..", "..", "..", "plugins", "candice-integration");
const VERSION = "1.0.0";

/**
 * Hermetic fixture: a temp bootstrap root with the real candice-integration
 * plugin tree copied in, plus a temp Claude config root. Every CLI call in
 * this suite targets the temp config root via CLAUDE_CONFIG_DIR — the live
 * ~/.claude is never read or written.
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "candice-register-"));
  const installPath = join(root, "plugin", "candice-integration");
  const configRoot = join(root, "config");
  mkdirSync(dirname(installPath), { recursive: true });
  cpSync(REPO_PLUGIN, installPath, { recursive: true });
  return { root, installPath, configRoot };
}

/** A tiny second plugin so deregistration-scope tests have a survivor. */
function otherPluginFixture(configRoot) {
  const mp = mkdtempSync(join(tmpdir(), "candice-other-mp-"));
  const pluginDir = join(mp, "plugins", "other-fixture");
  mkdirSync(join(mp, ".claude-plugin"), { recursive: true });
  mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(mp, ".claude-plugin", "marketplace.json"),
    `${JSON.stringify({
      name: "other-fixture-mp",
      owner: { name: "Test" },
      plugins: [{ name: "other-fixture", source: "./plugins/other-fixture", version: "1.0.0", description: "survivor" }],
    }, null, 2)}\n`,
  );
  writeFileSync(
    join(pluginDir, ".claude-plugin", "plugin.json"),
    `${JSON.stringify({ name: "other-fixture", version: "1.0.0", description: "survivor" }, null, 2)}\n`,
  );
  const env = { CLAUDE_CONFIG_DIR: configRoot };
  const list = (args) => spawnSync("claude", args, { encoding: "utf8", env: { ...process.env, ...env }, timeout: 120000 });
  const add = list(["plugin", "marketplace", "add", mp, "--scope", "user"]);
  assert.equal(add.status, 0, `other marketplace add failed: ${add.stderr || add.stdout}`);
  const inst = list(["plugin", "install", "other-fixture@other-fixture-mp", "--scope", "user"]);
  assert.equal(inst.status, 0, `other plugin install failed: ${inst.stderr || inst.stdout}`);
  return mp;
}

test("discoverConfigRoots: CLAUDE_CONFIG_DIR wins; explicit configRoot override wins; empty env fails closed", () => {
  const roots = discoverConfigRoots({ HOME: "/tmp/home", CLAUDE_CONFIG_DIR: "/tmp/cfg" });
  assert.deepEqual(roots.map((r) => r.root), ["/tmp/cfg"]);
  const overridden = discoverConfigRoots({ HOME: "/tmp/home" }, { configRoot: "/tmp/explicit" });
  assert.deepEqual(overridden.map((r) => r.root), ["/tmp/explicit"]);
  const none = discoverConfigRoots({});
  assert.deepEqual(none, []);
});

test("register -> verify passes; re-register is a no-op with exactly one effective registration", () => {
  const f = fixture();
  const opts = { env: { CLAUDE_CONFIG_DIR: f.configRoot } };

  const r1 = register(f.configRoot, f.installPath, VERSION, opts);
  assert.equal(r1.ok, true, r1.message);
  assert.equal(r1.changed, true);
  const v1 = verify(f.configRoot, f.installPath, VERSION, opts);
  assert.equal(v1.ok, true, v1.message);
  assert.equal(v1.count, 1);

  // Idempotent re-register: no-op, still exactly one record.
  const r2 = register(f.configRoot, f.installPath, VERSION, opts);
  assert.equal(r2.ok, true, r2.message);
  assert.equal(r2.changed, false);
  const listed = listPlugins(f.configRoot, opts);
  assert.equal(listed.ok, true, listed.message);
  assert.equal(candiceRecords(listed.records).length, 1);

  // The record is enabled and carries the MCP server (loaded, not merely present).
  const rec = candiceRecords(listed.records)[0];
  assert.equal(rec.enabled, true);
  assert.equal(rec.scope, "user");
  assert.equal(rec.version, VERSION);
  assert.ok(rec.mcpServers && rec.mcpServers.candice);

  rmSync(f.root, { recursive: true, force: true });
});

test("deregister removes the one registration and leaves an unrelated plugin untouched", () => {
  const f = fixture();
  const opts = { env: { CLAUDE_CONFIG_DIR: f.configRoot } };
  assert.equal(register(f.configRoot, f.installPath, VERSION, opts).ok, true);
  otherPluginFixture(f.configRoot);

  const d = deregister(f.configRoot, f.installPath, opts);
  assert.equal(d.ok, true, d.message);
  assert.equal(d.changed, true);

  const listed = listPlugins(f.configRoot, opts);
  assert.equal(listed.ok, true, listed.message);
  assert.equal(candiceRecords(listed.records).length, 0, "no candice records may remain");
  assert.equal(listed.records.some((p) => p.id.startsWith("other-fixture@")), true, "unrelated plugin must survive");
  assert.equal(marketplaceRecord(f.configRoot), null, "candice marketplace record must be removed");

  // Idempotent: second deregister is a clean no-op success.
  const d2 = deregister(f.configRoot, f.installPath, opts);
  assert.equal(d2.ok, true, d2.message);
  assert.equal(d2.changed, false);

  rmSync(f.root, { recursive: true, force: true });
});

test("register repairs a broken legacy registration (phantom record pointing elsewhere)", () => {
  const f = fixture();
  const opts = { env: { CLAUDE_CONFIG_DIR: f.configRoot } };
  // Simulate the old direct-registry-write state: a record the CLI never
  // enabled, pointing at a stale path. This must be repaired, not tolerated.
  mkdirSync(join(f.configRoot, "plugins"), { recursive: true });
  writeFileSync(
    join(f.configRoot, "plugins", "installed_plugins.json"),
    `${JSON.stringify({ version: 2, plugins: { [PLUGIN_ID]: [{ scope: "user", installPath: "/stale/path", version: "0.0.1" }] } }, null, 2)}\n`,
  );

  const r = register(f.configRoot, f.installPath, VERSION, opts);
  assert.equal(r.ok, true, r.message);
  const v = verify(f.configRoot, f.installPath, VERSION, opts);
  assert.equal(v.ok, true, v.message);
  const listed = listPlugins(f.configRoot, opts);
  const rec = candiceRecords(listed.records)[0];
  assert.equal(rec.enabled, true, "repaired registration must be enabled");
  assert.equal(rec.version, VERSION);

  rmSync(f.root, { recursive: true, force: true });
});

test("verify fails closed: missing registration, duplicate/phantom, disabled record", () => {
  const f = fixture();
  const opts = { env: { CLAUDE_CONFIG_DIR: f.configRoot } };

  // Missing registration.
  const none = verify(f.configRoot, f.installPath, VERSION, opts);
  assert.equal(none.ok, false);
  assert.equal(none.count, 0);

  // Duplicate/phantom: two records for the same id.
  mkdirSync(join(f.configRoot, "plugins"), { recursive: true });
  writeFileSync(
    join(f.configRoot, "plugins", "installed_plugins.json"),
    `${JSON.stringify({ version: 2, plugins: { [PLUGIN_ID]: [{ scope: "user", installPath: f.installPath, version: VERSION }, { scope: "user", installPath: "/phantom", version: VERSION }] } }, null, 2)}\n`,
  );
  const dup = verify(f.configRoot, f.installPath, VERSION, opts);
  assert.equal(dup.ok, false);
  assert.equal(dup.count, 2);

  // Disabled: registry record present but never enabled by the CLI
  // (probe-verified: installed but never loaded).
  writeFileSync(
    join(f.configRoot, "plugins", "installed_plugins.json"),
    `${JSON.stringify({ version: 2, plugins: { [PLUGIN_ID]: [{ scope: "user", installPath: f.installPath, version: VERSION }] } }, null, 2)}\n`,
  );
  const disabled = verify(f.configRoot, f.installPath, VERSION, opts);
  assert.equal(disabled.ok, false);
  assert.match(disabled.message, /disabled|never loaded/);

  rmSync(f.root, { recursive: true, force: true });
});

test("register fails closed: missing CLI, nonzero CLI, missing plugin tree", () => {
  const f = fixture();
  const missingCli = register(f.configRoot, f.installPath, VERSION, { claudeBin: "claude-does-not-exist-xyz" });
  assert.equal(missingCli.ok, false);
  assert.match(missingCli.message, /marketplace|failed|ENOENT|spawn/i);

  // A CLI that always exits 1: registration refused, nothing claims success.
  const stub = join(f.root, "claude-stub");
  writeFileSync(stub, "#!/bin/sh\nexit 1\n");
  const r = register(f.configRoot, f.installPath, VERSION, { claudeBin: stub, env: { CLAUDE_CONFIG_DIR: f.configRoot } });
  assert.equal(r.ok, false);
  assert.match(r.message, /failed|refused/i);

  // No plugin tree: refuse before any CLI call.
  const bare = mkdtempSync(join(tmpdir(), "candice-register-bare-"));
  const cfg = join(bare, "config");
  const noTree = register(cfg, join(bare, "plugin", "candice-integration"), VERSION, { env: { CLAUDE_CONFIG_DIR: cfg } });
  assert.equal(noTree.ok, false);
  assert.match(noTree.message, /refusing registration/);
  rmSync(bare, { recursive: true, force: true });

  rmSync(f.root, { recursive: true, force: true });
});

test("registerAll/verifyAll/deregisterAll: no config root fails closed; explicit root scopes the target", () => {
  const f = fixture();
  const noRoots = registerAll({}, f.installPath, VERSION);
  assert.equal(noRoots.ok, false);
  assert.match(noRoots.message, /fail closed/);

  const all = registerAll({ HOME: "/nonexistent-home" }, f.installPath, VERSION, { configRoot: f.configRoot });
  assert.equal(all.ok, true, all.message);
  const v = verifyAll({ HOME: "/nonexistent-home" }, f.installPath, VERSION, { configRoot: f.configRoot });
  assert.equal(v.ok, true, v.message);
  const d = deregisterAll({ HOME: "/nonexistent-home" }, f.installPath, { configRoot: f.configRoot });
  assert.equal(d.ok, true, d.message);
  const listed = listPlugins(f.configRoot, { env: { CLAUDE_CONFIG_DIR: f.configRoot } });
  assert.equal(candiceRecords(listed.records).length, 0);

  rmSync(f.root, { recursive: true, force: true });
});

test("marketplace manifest staged by register has the exact candice source shape", () => {
  const f = fixture();
  const opts = { env: { CLAUDE_CONFIG_DIR: f.configRoot } };
  assert.equal(register(f.configRoot, f.installPath, VERSION, opts).ok, true);
  const manifest = join(dirname(f.installPath), ".claude-plugin", "marketplace.json");
  assert.equal(existsSync(manifest), true);
  const parsed = JSON.parse(readFileSync(manifest, "utf8"));
  assert.equal(parsed.name, PLUGIN_MARKETPLACE);
  assert.equal(parsed.plugins[0].name, PLUGIN_NAME);
  assert.equal(parsed.plugins[0].version, VERSION);
  rmSync(f.root, { recursive: true, force: true });
});
