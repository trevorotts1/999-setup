/**
 * FIX-018 hermetic fault-injection suite (QC lane, G06).
 *
 * Owned glob: `scripts/candice-bootstrap/**` (PROJECT-MANIFEST 9.2 WR-017).
 *
 * Every test is hermetic: temp roots, temp Claude config roots, a stub
 * `claude` CLI that emulates the plugin registry commands against the temp
 * config root. The live `~/.claude` is never read or written here.
 *
 * Coverage matrix:
 *   1. mode enum: missing/unknown/valid parse; legacy no-mode programmatic
 *      callers keep the blocked-app shape; explicit invalid mode is a hard
 *      failure; non-release without explicit root refused at the CLI,
 *   2. health schema parser: unknown/unclassified/missing/misclassified
 *      legs rejected; ok = conjunction of required legs only,
 *   3. release resolver: absent/forged/placeholder/wrong-platform/incomplete
 *      records fail closed against a fake authority + temp manifest,
 *   4. probe fail-closed: missing executable = FAIL never UNKNOWN; missing
 *      seams FAIL; injected probes drive health legs,
 *   5. registration repair: removed registration detected and re-registered
 *      by applyRepairs; unrelated plugin records survive,
 *   6. release transaction: app failure rolls the whole repair back,
 *   7. uninstall: Candice-only material removed; plain-claude config and
 *      unrelated skills in the config root survive; no journal leftover,
 *   8. full cycle: developer install -> health probe -> breakage -> repair
 *      probe -> uninstall -> probe.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  chmodSync,
  cpSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import { parseMode, MODES, INTERNAL_SIGNED_FIXTURE } from "../modes.mjs";
import {
  HEALTH_SCHEMA,
  KNOWN_LEGS,
  legClasses,
  validateReport,
  reportOk,
  firstFailingRequiredLeg,
  emptyReport,
  LEG_OK,
  LEG_FAIL,
  LEG_UNKNOWN,
} from "../health-schema.mjs";
import { installAll, SKILL_PINS, PLUGIN_PINS, snapshotTarget } from "../install.mjs";
import { healthCheck } from "../health.mjs";
import { uninstall } from "../uninstall.mjs";
import { launchProbe, bridgeProbe, capabilityProbe, permissionProbe, runProbeCommand } from "../probes/index.mjs";
import { resolveAppRecord, PLACEHOLDER_SHA256, MANIFEST_SCHEMA, APP_ID } from "../release-resolver.mjs";
import { register, verify, listPlugins, candiceRecords } from "../register-plugin.mjs";
import { applyRepairs } from "../../candice-upgrade/repair.mjs";
import { pluginDir, skillsDir, appBundlePath } from "../paths.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP_CLI = join(here, "..", "bootstrap.mjs");
const LIFECYCLE_CLI = join(here, "..", "lifecycle.mjs");
const REPO_PLUGIN = join(here, "..", "..", "..", "plugins", "candice-integration");

function freshRoot(prefix) {
  return mkdtempSync(join(tmpdir(), prefix || "candice-fix018-"));
}

/**
 * Stub `claude` CLI: emulates the plugin registry surface against the temp
 * config root (installed_plugins.json + known_marketplaces.json under
 * <config>/plugins/), mirroring the shapes the register-plugin adapter
 * expects from the real CLI (probe-verified 2026-08-22).
 */
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
    const id = args[2]; // candice-integration@candice-marketplace
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

/** Copy the real plugin tree into a temp root (same layout installPlugin produces). */
function stagePlugin(root) {
  const target = pluginDir(root);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(REPO_PLUGIN, target, { recursive: true });
  return target;
}

/** A real app fixture (tiny shell executable) with internally signed provenance. */
function makeAppFixture(root) {
  // Artifact lives OUTSIDE the app target dir: installApp copies it to the
  // recorded executablePath (same-file copies are rejected).
  const exe = join(root, "fixture", "candice-companion");
  mkdirSync(dirname(exe), { recursive: true });
  writeFileSync(exe, "#!/bin/sh\nexit 0\n");
  chmodSync(exe, 0o755);
  const sha = createHash("sha256").update(readFileSync(exe)).digest("hex");
  return {
    signedBy: INTERNAL_SIGNED_FIXTURE,
    artifactPath: exe,
    sha256: sha,
    sizeBytes: readFileSync(exe).length,
    executablePath: join("app", "Candice Companion.app", "Contents", "MacOS", "candice-companion"),
    version: "0.0.1-fixture",
  };
}

// ---------------------------------------------------------------------------
// 1. Mode enum matrix
// ---------------------------------------------------------------------------

test("mode enum: missing/unknown fail closed; the three modes parse", () => {
  assert.equal(parseMode(undefined).ok, false);
  assert.equal(parseMode("").ok, false);
  assert.equal(parseMode("banana").ok, false);
  assert.equal(parseMode("RELEASE").ok, false, "case-sensitive enum");
  for (const m of MODES) {
    const p = parseMode(m);
    assert.equal(p.ok, true, m);
    assert.equal(p.mode, m);
  }
  assert.match(parseMode("banana").message, /before any write/);
});

test("installAll no-mode keeps the legacy blocked-app shape (cross-lane regression contract)", async () => {
  const root = freshRoot();
  const r = await installAll({ root, platform: "darwin", offline: true, noAtomic: true });
  assert.equal(r.ok, false);
  assert.equal(r.results.app.blocked, true);
  assert.equal(r.results.app.modeRequired, true);
  assert.match(r.results.app.message, /mode/);
  assert.match(r.results.app.message, /release-authorized/);
  assert.equal(existsSync(join(root, "state")), false, "no write on blocked install");
  rmSync(root, { recursive: true, force: true });
});

test("installAll explicit invalid mode is a hard modeRequired failure before any write", async () => {
  const root = freshRoot();
  const r = await installAll({ root, platform: "darwin", mode: "banana", offline: true, noAtomic: true });
  assert.equal(r.ok, false);
  assert.equal(r.results.app.modeRequired, true);
  assert.equal(r.results.app.blocked, undefined, "explicit invalid mode is a refusal, not a legacy block");
  assert.equal(existsSync(join(root, "state")), false);
  rmSync(root, { recursive: true, force: true });
});

test("CLI exits 2 on missing/unknown mode and on non-release without --root", () => {
  const root = freshRoot();
  for (const args of [["install", "--root", root], ["install", "--root", root, "--mode", "banana"], ["install", "--mode", "test-fixture"]]) {
    const r = spawnSync(process.execPath, [BOOTSTRAP_CLI, ...args], { encoding: "utf8" });
    assert.equal(r.status, 2, `${args.join(" ")}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /mode/, args.join(" "));
  }
  rmSync(root, { recursive: true, force: true });
});

test("lifecycle CLI rejects missing mode with exit 2", () => {
  const root = freshRoot();
  const r = spawnSync(process.execPath, [LIFECYCLE_CLI, "install", "--root", root], { encoding: "utf8" });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /mode/);
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 2. Health schema parser
// ---------------------------------------------------------------------------

test("schema parser rejects unknown, unclassified, missing, and misclassified legs", () => {
  const good = emptyReport("darwin");
  for (const leg of KNOWN_LEGS) good.legs[leg].status = LEG_OK;
  const ok = validateReport(good);
  assert.equal(ok.ok, true, ok.errors.join("; "));
  assert.equal(reportOk(good), true);
  assert.equal(firstFailingRequiredLeg(good), null);

  const smuggled = structuredClone(good);
  smuggled.legs["sneaky-extra"] = { classification: "optional", status: LEG_OK };
  assert.equal(validateReport(smuggled).ok, false, "unknown leg must be rejected");
  assert.match(validateReport(smuggled).errors.join("; "), /unknown leg sneaky-extra/);

  const unclassified = structuredClone(good);
  unclassified.legs["skill-tree"].classification = undefined;
  assert.equal(validateReport(unclassified).ok, false);

  const missingLeg = structuredClone(good);
  delete missingLeg.legs["skill-tree"];
  assert.equal(validateReport(missingLeg).ok, false);
  assert.match(validateReport(missingLeg).errors.join("; "), /skill-tree missing/);

  const badStatus = structuredClone(good);
  badStatus.legs["skill-tree"].status = "MAYBE";
  assert.equal(validateReport(badStatus).ok, false);

  const wrongSchema = structuredClone(good);
  wrongSchema.schema = "candice.health-report/v99";
  assert.equal(validateReport(wrongSchema).ok, false);
});

test("ok is the conjunction of REQUIRED legs only; win32 adds asset-stt-runtime", () => {
  assert.equal(legClasses("darwin")["asset-stt-runtime"], "optional");
  assert.equal(legClasses("win32")["asset-stt-runtime"], "required");

  const r = emptyReport("darwin");
  for (const leg of KNOWN_LEGS) r.legs[leg].status = LEG_OK;
  // Optional leg fails; report still ok.
  r.legs["asset-stt-runtime"].status = LEG_FAIL;
  assert.equal(reportOk(r), true);
  assert.equal(firstFailingRequiredLeg(r), null);

  // A required leg fails; report fails.
  r.legs["skill-tree"].status = LEG_FAIL;
  assert.equal(reportOk(r), false);
  assert.equal(firstFailingRequiredLeg(r), "skill-tree");

  const w = emptyReport("win32");
  for (const leg of KNOWN_LEGS) w.legs[leg].status = LEG_OK;
  w.legs["asset-stt-runtime"].status = LEG_FAIL;
  assert.equal(reportOk(w), false, "win32 requires the STT runtime leg");
});

// ---------------------------------------------------------------------------
// 3. Release resolver fail-closed matrix
// ---------------------------------------------------------------------------

function fakeAuthority() {
  return { ok: true, message: "fake authority accepted", stdout: "accepted" };
}

function validAppRecord(overrides = {}) {
  return {
    platform: "darwin",
    arch: "arm64",
    version: "0.2.0",
    file: "candice-companion.dmg",
    sha256: "a".repeat(64),
    sizeBytes: 1024,
    sourceUrl: "https://releases.example.com/candice-companion-0.2.0.dmg",
    signature: "sig-base64",
    notarization: "stapled",
    executablePath: join("app", "Candice Companion.app", "Contents", "MacOS", "candice-companion"),
    ...overrides,
  };
}

function writeManifest(dir, entries) {
  const manifest = { schema: MANIFEST_SCHEMA, components: { [APP_ID]: entries } };
  const path = join(dir, "bundled-components.json");
  writeFileSync(path, JSON.stringify(manifest, null, 2));
  return path;
}

test("resolver: valid record resolves; every defect fails closed", () => {
  const dir = freshRoot();
  const ok = resolveAppRecord({
    platform: "darwin",
    arch: "arm64",
    authority: fakeAuthority(),
    manifestPath: writeManifest(dir, [validAppRecord()]),
    repoRoot: dir,
  });
  assert.equal(ok.ok, true, ok.message);
  assert.equal(ok.record.version, "0.2.0");
  assert.equal(ok.record.sha256, "a".repeat(64));

  const wrongSchemaPath = join(dir, "wrong-schema.json");
  writeFileSync(wrongSchemaPath, JSON.stringify({ schema: "nope", components: {} }));

  const cases = [
    ["authority refuses", resolveAppRecord({ platform: "darwin", arch: "arm64", authority: { ok: false, message: "refused" }, manifestPath: writeManifest(dir, [validAppRecord()]) })],
    ["no manifest", resolveAppRecord({ platform: "darwin", arch: "arm64", authority: fakeAuthority(), manifestPath: join(dir, "absent.json") })],
    ["wrong schema", resolveAppRecord({ platform: "darwin", arch: "arm64", authority: fakeAuthority(), manifestPath: wrongSchemaPath })],
    ["no records", resolveAppRecord({ platform: "darwin", arch: "arm64", authority: fakeAuthority(), manifestPath: writeManifest(dir, []) })],
    ["wrong platform", resolveAppRecord({ platform: "darwin", arch: "arm64", authority: fakeAuthority(), manifestPath: writeManifest(dir, [validAppRecord({ platform: "win32" })]) })],
    ["placeholder sha256", resolveAppRecord({ platform: "darwin", arch: "arm64", authority: fakeAuthority(), manifestPath: writeManifest(dir, [validAppRecord({ sha256: PLACEHOLDER_SHA256 })]) })],
    ["bad sha256 shape", resolveAppRecord({ platform: "darwin", arch: "arm64", authority: fakeAuthority(), manifestPath: writeManifest(dir, [validAppRecord({ sha256: "zzz" })]) })],
    ["zero size", resolveAppRecord({ platform: "darwin", arch: "arm64", authority: fakeAuthority(), manifestPath: writeManifest(dir, [validAppRecord({ sizeBytes: 0 })]) })],
    ["non-https source", resolveAppRecord({ platform: "darwin", arch: "arm64", authority: fakeAuthority(), manifestPath: writeManifest(dir, [validAppRecord({ sourceUrl: "http://x.example/a.dmg" })]) })],
    ["missing signature", resolveAppRecord({ platform: "darwin", arch: "arm64", authority: fakeAuthority(), manifestPath: writeManifest(dir, [validAppRecord({ signature: "" })]) })],
    ["missing notarization", resolveAppRecord({ platform: "darwin", arch: "arm64", authority: fakeAuthority(), manifestPath: writeManifest(dir, [validAppRecord({ notarization: "" })]) })],
    ["unsupported platform", resolveAppRecord({ platform: "linux", arch: "x64", authority: fakeAuthority(), manifestPath: writeManifest(dir, [validAppRecord()]) })],
  ];
  for (const [name, r] of cases) {
    assert.equal(r.ok, false, `${name}: ${r.message}`);
    assert.match(r.message, /refused|refusing|missing|no candice-companion|invalid|not a real checksum|unsupported|https/i, `${name}: ${r.message}`);
  }
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 4. Probe fail-closed semantics
// ---------------------------------------------------------------------------

test("probes fail closed: missing executable is FAIL, never UNKNOWN", async () => {
  const missing = await launchProbe(join(tmpdir(), "does-not-exist-xyz"));
  assert.equal(missing.status, "FAIL");
  assert.match(missing.detail, /missing/);

  const b = await bridgeProbe(join(tmpdir(), "no-plugin-here"));
  assert.equal(b.status, "FAIL");
  assert.match(b.detail, /bridge seam missing/);

  const c = await capabilityProbe(join(tmpdir(), "no-plugin-here"), "stt");
  assert.equal(c.status, "FAIL");
  assert.match(c.detail, /\.mcp\.json missing/);
});

test("bounded probe: nonzero exit is FAIL with output; timeout bound enforced", async () => {
  const r = await runProbeCommand(process.execPath, ["-e", "console.error('boom'); process.exit(3)"]);
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /exit 3/);
  assert.match(r.detail, /boom/);

  const hung = await runProbeCommand(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { timeoutMs: 500 });
  assert.equal(hung.status, "FAIL");
  assert.match(hung.detail, /timed out after 500ms/);
});

test("bridge seam: companion-ready-timeout leaves no live timer chain (host process exits naturally)", () => {
  // Regression for the FIX-011 seam poll-loop leak: after the 3000ms
  // companion-ready-timeout fired, the ensureSession poll chain kept
  // re-arming setTimeout(poll, 25) forever, so a FAILed bridge probe hung
  // the host process. A fail-closed probe must never keep the loop alive.
  const bridgePath = resolve(here, "../../../plugins/candice-integration/mcp/ask-user/local-companion-bridge.js");
  const script = `
    const { LocalCompanionBridge } = require(process.env.BRIDGE_PATH)
    const bridge = new LocalCompanionBridge({ launchCommand: process.execPath })
    ;(async () => {
      await bridge.start()
      const r = await bridge.ensureSession('session-a')
      await bridge.close()
      console.log(JSON.stringify(r))
      // No process.exit: the child must drain naturally. A leaked poll
      // timer chain keeps the loop alive and the parent's timeout kills us.
    })()
  `;
  const child = spawnSync(process.execPath, ["-e", script], {
    env: { ...process.env, BRIDGE_PATH: bridgePath },
    timeout: 15000,
    encoding: "utf8",
  });
  assert.equal(child.status, 0, `child must exit naturally after companion-ready-timeout; stderr: ${child.stderr}`);
  const r = JSON.parse(child.stdout.trim());
  assert.equal(r.ok, false);
  assert.equal(r.code, "companion-ready-timeout");
});

test("permissionProbe: 0700/0600 PASS; 0755 FAIL; missing state FAIL", () => {
  const root = freshRoot();
  assert.equal(permissionProbe(root).status, "FAIL", "missing state dir is a fact, not UNKNOWN");
  mkdirSync(join(root, "state"), { mode: 0o700 });
  writeFileSync(join(root, "state", "bootstrap-state.json"), "{}\n");
  chmodSync(join(root, "state", "bootstrap-state.json"), 0o600);
  assert.equal(permissionProbe(root).status, "PASS", permissionProbe(root).detail);
  chmodSync(join(root, "state"), 0o755);
  assert.equal(permissionProbe(root).status, "FAIL", "0755 state dir must fail");
  assert.match(permissionProbe(root).detail, /755/);
  rmSync(root, { recursive: true, force: true });
});

test("snapshotTarget restores a pre-existing tree and removes a newly created one", () => {
  const root = freshRoot();
  const target = join(root, "target");
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "sentinel"), "old\n");
  const restore = snapshotTarget(root, target, "t");
  writeFileSync(join(target, "sentinel"), "new\n");
  restore();
  assert.equal(readFileSync(join(target, "sentinel"), "utf8"), "old\n", "restore returns prior known-good state");

  const fresh = join(root, "fresh-target");
  const restore2 = snapshotTarget(root, fresh, "f");
  mkdirSync(fresh, { recursive: true });
  writeFileSync(join(fresh, "x"), "y\n");
  restore2();
  assert.equal(existsSync(fresh), false, "restore removes a target that did not pre-exist");
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 5. Registration repair via applyRepairs (stub CLI)
// ---------------------------------------------------------------------------

test("applyRepairs detects removed registration and re-registers; unrelated plugin survives", async () => {
  const root = freshRoot();
  const configRoot = join(root, "config");
  const claudeBin = writeClaudeStub(configRoot);
  const opts = { env: { CLAUDE_CONFIG_DIR: configRoot }, configRoot, claudeBin };

  stagePlugin(root);

  // Register once, then an unrelated plugin record is added to the registry.
  assert.equal(register(configRoot, pluginDir(root), PLUGIN_PINS["candice-integration"], opts).ok, true);
  const regFile = join(configRoot, "plugins", "installed_plugins.json");
  const reg = JSON.parse(readFileSync(regFile, "utf8"));
  reg.plugins["other-fixture@other-mp"] = [{ id: "other-fixture@other-mp", name: "other-fixture", scope: "user", enabled: true, version: "1.0.0", installPath: "/elsewhere" }];
  writeFileSync(regFile, JSON.stringify(reg, null, 2));

  // BREAKAGE: remove the candice registration only.
  delete reg.plugins["candice-integration@candice-marketplace"];
  writeFileSync(regFile, JSON.stringify(reg, null, 2));
  assert.equal(verify(configRoot, pluginDir(root), PLUGIN_PINS["candice-integration"], opts).ok, false, "breakage must be detected");

  // Repair: plugin leg present in plan -> registration repaired.
  const applied = await applyRepairs(root, "darwin", [{ kind: "plugin", id: "candice-integration" }], { ...opts, mode: "test-fixture", noAtomic: true, offline: true });
  assert.equal(applied.failed.length, 0, JSON.stringify(applied.failed));
  assert.ok(applied.done.some((d) => d.kind === "plugin-registration" && d.id === "candice-integration"), "registration repair recorded");

  const listed = listPlugins(configRoot, opts);
  const mine = candiceRecords(listed.records);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].enabled, true);
  assert.ok(listed.records.some((p) => p.id.startsWith("other-fixture@")), "unrelated plugin record survives the repair");
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 6. Release transaction rollback
// ---------------------------------------------------------------------------

test("release applyRepairs rolls the whole transaction back when the app leg fails", async () => {
  const root = freshRoot();
  const configRoot = join(root, "config");
  const claudeBin = writeClaudeStub(configRoot);
  // Release resolver refused: injected failing authority.
  const applied = await applyRepairs(
    root,
    "darwin",
    [
      { kind: "skill", id: "spec-protocol" },
      { kind: "app", id: "candice-companion" },
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
  assert.ok(applied.failed.length > 0, JSON.stringify(applied));
  assert.match(applied.failed[0].message, /transaction rolled back|refused/);
  assert.equal(existsSync(join(skillsDir(root), "spec-protocol")), false, "skill install must be rolled back when the app leg fails");
  assert.equal(existsSync(appBundlePath(root)), false, "app must not land");
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 7. Uninstall truthfulness
// ---------------------------------------------------------------------------

test("uninstall removes Candice-only material and preserves plain-claude config + config-root skills", async () => {
  const root = freshRoot();
  const configRoot = join(root, "config");
  const claudeBin = writeClaudeStub(configRoot);
  const opts = { env: { CLAUDE_CONFIG_DIR: configRoot }, configRoot, claudeBin };

  stagePlugin(root);
  assert.equal(register(configRoot, pluginDir(root), PLUGIN_PINS["candice-integration"], opts).ok, true);

  // Plain-claude material in the SHARED CONFIG ROOT that must survive: the
  // uninstall contract never touches the config root beyond the candice
  // plugin registry entries.
  writeFileSync(join(configRoot, "settings.json"), '{ "enabledPlugins": {} }\n');
  writeFileSync(join(configRoot, "CLAUDE.md"), "# plain claude\n");
  const unrelatedSkill = join(configRoot, "skills", "unrelated-client-skill");
  mkdirSync(unrelatedSkill, { recursive: true });
  writeFileSync(join(unrelatedSkill, "SKILL.md"), "# unrelated\n");

  // A journal exists pre-uninstall (like a real install run).
  mkdirSync(join(root, "state"), { recursive: true });
  writeFileSync(join(root, "state", "upgrade-journal.jsonl"), '{}\n');

  const r = await uninstall({ root, platform: "darwin", mode: "test-fixture", ...opts });
  assert.equal(r.ok, true, JSON.stringify(r.steps));
  assert.equal(existsSync(pluginDir(root)), false);
  assert.equal(existsSync(join(root, "plugin")), false);
  assert.equal(existsSync(appBundlePath(root)), false);
  assert.equal(existsSync(join(root, "assets")), false);
  assert.equal(existsSync(join(root, "state", "upgrade-journal.jsonl")), false, "no journal leftover after uninstall");

  assert.equal(existsSync(join(configRoot, "settings.json")), true, "plain-claude settings.json survives");
  assert.equal(existsSync(join(configRoot, "CLAUDE.md")), true, "plain-claude CLAUDE.md survives");
  assert.equal(existsSync(unrelatedSkill), true, "unrelated skill in the config root survives");

  const listed = listPlugins(configRoot, opts);
  assert.equal(candiceRecords(listed.records).length, 0, "no candice registration may remain");
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 8. Full cycle: developer install -> health probe -> breakage -> uninstall -> probe
// ---------------------------------------------------------------------------

test("full cycle: developer install with internally signed fixture -> health legs -> uninstall -> absent", async () => {
  const root = freshRoot();
  const configRoot = join(root, "config");
  const claudeBin = writeClaudeStub(configRoot);
  const appFixture = makeAppFixture(root);
  const common = {
    root,
    platform: "darwin",
    configRoot,
    claudeBin,
    env: { CLAUDE_CONFIG_DIR: configRoot, HOME: join(root, "fake-home") },
    noAtomic: true,
    offline: true,
  };

  const r = await installAll({ ...common, mode: "developer", appFixture });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.notReleaseInstall, true);
  assert.equal(r.results.pluginRegistration.ok, true, r.results.pluginRegistration.message);
  assert.equal(existsSync(appBundlePath(root)), true, "internally signed fixture app lands");

  // Health probe with stub CLI + injected probes for the seams we own.
  const h = await healthCheck({
    root,
    platform: "darwin",
    mode: "test-fixture",
    env: common.env,
    configRoot,
    claudeBin,
    probes: {
      launchProbe: async () => ({ status: "PASS", detail: "injected launch PASS" }),
      bridgeProbe: async () => ({ status: "PASS", detail: "injected bridge PASS" }),
      capabilityProbe: async () => ({ status: "PASS", detail: "injected capability PASS" }),
    },
  });
  assert.equal(h.schema, HEALTH_SCHEMA);
  assert.equal(h.legs["skill-tree"].status, "PASS");
  assert.equal(h.legs["plugin-loaded"].status, "PASS");
  assert.equal(h.legs["plugin-registered"].status, "PASS", h.legs["plugin-registered"].detail);
  assert.equal(h.legs["plugin-hooks"].status, "PASS");
  assert.equal(h.legs["plugin-mcp"].status, "PASS");
  assert.equal(h.legs["app-provenance"].status, "PASS", h.legs["app-provenance"].detail);
  assert.equal(h.legs["app-executable"].status, "PASS");
  assert.equal(h.legs["app-hash"].status, "PASS", h.legs["app-hash"].detail);
  assert.equal(h.legs["app-launch"].status, "PASS");
  assert.equal(h.legs["bridge-ipc"].status, "PASS");
  assert.equal(h.legs["stt-runtime-capability"].status, "PASS");
  assert.equal(h.legs["tts-runtime-capability"].status, "PASS");
  assert.equal(h.legs["permissions"].status, "PASS", h.legs["permissions"].detail);

  // BREAKAGE: delete the registration, probe must fail closed.
  const regFile = join(configRoot, "plugins", "installed_plugins.json");
  const reg = JSON.parse(readFileSync(regFile, "utf8"));
  delete reg.plugins["candice-integration@candice-marketplace"];
  writeFileSync(regFile, JSON.stringify(reg, null, 2));
  const broken = await healthCheck({
    root,
    platform: "darwin",
    mode: "test-fixture",
    env: common.env,
    configRoot,
    claudeBin,
    probes: {
      launchProbe: async () => ({ status: "PASS", detail: "injected" }),
      bridgeProbe: async () => ({ status: "PASS", detail: "injected" }),
      capabilityProbe: async () => ({ status: "PASS", detail: "injected" }),
    },
  });
  assert.equal(broken.legs["plugin-registered"].status, "FAIL", "removed registration must FAIL the probe");

  // Repair path: removed registration is detected by verify and re-registered.
  const repaired = await applyRepairs(root, "darwin", [{ kind: "plugin", id: "candice-integration" }], { ...common, mode: "test-fixture" });
  assert.equal(repaired.failed.length, 0, JSON.stringify(repaired.failed));
  assert.ok(repaired.done.some((d) => d.kind === "plugin-registration"), "cycle repair restores the registration");

  // Uninstall, then the probe must fail closed on every required leg.
  const u = await uninstall({ root, platform: "darwin", mode: "test-fixture", ...common });
  assert.equal(u.ok, true, JSON.stringify(u.steps));
  const after = await healthCheck({
    root,
    platform: "darwin",
    mode: "test-fixture",
    env: common.env,
    configRoot,
    claudeBin,
    probes: {
      launchProbe: async () => ({ status: "FAIL", detail: "injected missing exe" }),
      bridgeProbe: async () => ({ status: "FAIL", detail: "injected missing bridge" }),
      capabilityProbe: async () => ({ status: "FAIL", detail: "injected missing seam" }),
    },
  });
  assert.equal(after.ok, false);
  assert.equal(after.legs["skill-tree"].status, "FAIL");
  assert.equal(after.legs["plugin-registered"].status, "FAIL");
  assert.equal(after.legs["app-provenance"].status, "FAIL");
  rmSync(root, { recursive: true, force: true });
});
