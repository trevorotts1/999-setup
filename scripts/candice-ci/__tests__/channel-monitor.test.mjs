import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const MONITOR = join(here, "..", "channel-monitor.mjs");

function freshDir() {
  return mkdtempSync(join(tmpdir(), "candice-ci-monitor-"));
}

/** Plant a spec-protocol skill dir at a version; returns the skill dir. */
function writeVersion(root, version) {
  const skillDir = join(root, "spec-protocol");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "VERSION"), `${version}\n`);
  return skillDir;
}

/**
 * Hermetic channel fixture as a `data:` URL. The monitor runs in a child
 * process; an in-process HTTP server would deadlock under spawnSync
 * (the parent event loop is blocked while the child's fetch waits), so the
 * channel seam is a data: URL the child fetches without any server.
 */
function channelUrl(version) {
  return `data:text/plain,${encodeURIComponent(`${version}\n`)}`;
}

function runMonitor(args, { env } = {}) {
  return spawnSync(process.execPath, [MONITOR, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...(env || {}) },
  });
}

test("exports as a module", async () => {
  // The monitor must be importable (it reuses the WS-32 detector) and must
  // not execute as a script when imported.
  const mod = await import("../channel-monitor.mjs");
  assert.ok(mod, "channel-monitor module imports");
});

test("exit 0 CURRENT when the installed root is at the published version", () => {
  const root = freshDir();
  const skillDir = writeVersion(root, "1.0.0");
  const r = runMonitor(["--url", channelUrl("1.0.0")], {
    env: { CANDICE_UPGRADE_SKILLS_ROOT: skillDir },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /CURRENT/);
  rmSync(root, { recursive: true, force: true });
});

test("exit 1 STALE when the installed root is older than published (--fail-on-stale)", () => {
  const root = freshDir();
  const skillDir = writeVersion(root, "1.0.0");
  const r = runMonitor(["--fail-on-stale", "--url", channelUrl("1.1.0")], {
    env: { CANDICE_UPGRADE_SKILLS_ROOT: skillDir },
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /STALE/);
  rmSync(root, { recursive: true, force: true });
});

test("exit 0 with STALE label when --fail-on-stale is absent (monitor records, gate ignores)", () => {
  const root = freshDir();
  const skillDir = writeVersion(root, "1.0.0");
  const r = runMonitor(["--url", channelUrl("1.1.0")], {
    env: { CANDICE_UPGRADE_SKILLS_ROOT: skillDir },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /STALE/);
  rmSync(root, { recursive: true, force: true });
});

test("exit 2 UNDETERMINED when the channel is unreachable (never a false current)", () => {
  const root = freshDir();
  const skillDir = writeVersion(root, "1.0.0");
  // Dead port on loopback: connection refused -> detector must report
  // undetermined, and the monitor must surface that as exit 2.
  const r = runMonitor(["--url", "http://127.0.0.1:1/VERSION"], {
    env: { CANDICE_UPGRADE_SKILLS_ROOT: skillDir },
  });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /UNDETERMINED/);
  rmSync(root, { recursive: true, force: true });
});

test("exit 2 UNDETERMINED when the channel serves a non-version page", () => {
  const root = freshDir();
  const skillDir = writeVersion(root, "1.0.0");
  const url = `data:text/html,${encodeURIComponent("<html>not a version</html>")}`;
  const r = runMonitor(["--url", url], { env: { CANDICE_UPGRADE_SKILLS_ROOT: skillDir } });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /UNDETERMINED/);
  rmSync(root, { recursive: true, force: true });
});

test("class control: dead instrument proves the detector never reports current", async () => {
  // Known-good control on the same instrument: a fetch stub that throws
  // must yield `undetermined`, never `current`. If this control came back
  // negative the detector contract itself would be broken.
  const { detect } = await import("../../candice-upgrade/detect.mjs");
  const d = await detect({ roots: [], fetchImpl: async () => { throw new Error("network dead"); } });
  assert.equal(d.status, "undetermined");
  assert.equal(d.ok, false);
});

test("--root records channel-monitor.json with the verdict", () => {
  const skillRoot = freshDir();
  const recordRoot = freshDir();
  const skillDir = writeVersion(skillRoot, "1.0.0");
  const r = runMonitor(["--root", recordRoot, "--url", channelUrl("1.1.0")], {
    env: { CANDICE_UPGRADE_SKILLS_ROOT: skillDir },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(existsSync(join(recordRoot, "channel-monitor.json")), true);
  const record = JSON.parse(readFileSync(join(recordRoot, "channel-monitor.json"), "utf8"));
  assert.equal(record.schema, "candice/ci/channel-monitor@1");
  assert.equal(record.status, "update");
  rmSync(skillRoot, { recursive: true, force: true });
  rmSync(recordRoot, { recursive: true, force: true });
});

test("unknown option exits 2 with usage", () => {
  const r = runMonitor(["--bogus"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/);
});

test("--url without a value exits 2 with usage", () => {
  const r = runMonitor(["--url"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/);
});
