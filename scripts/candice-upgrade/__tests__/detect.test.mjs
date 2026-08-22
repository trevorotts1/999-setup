import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  compareVersions,
  detect,
  readInstalledVersion,
  installedRoots,
  configuredRoots,
  PUBLISHED_VERSION_URL,
} from "../detect.mjs";

function freshDir() {
  return mkdtempSync(join(tmpdir(), "candice-upgrade-detect-"));
}

/** Minimal fetch stub serving a fixed published version. */
function stubFetch(version, { status = 200, body } = {}) {
  return async () => {
    if (status !== 200) {
      return { ok: false, status };
    }
    return {
      ok: true,
      status,
      text: async () => (body !== undefined ? body : `${version}\n`),
    };
  };
}

function writeVersion(root, version) {
  mkdirSync(join(root, "spec-protocol"), { recursive: true });
  writeFileSync(join(root, "spec-protocol", "VERSION"), `${version}\n`);
}

test("compareVersions: numeric field-by-field, never lexical", () => {
  assert.equal(compareVersions("1.10.0", "1.9.0"), 1);
  assert.equal(compareVersions("1.9.0", "1.10.0"), -1);
  assert.equal(compareVersions("1.16.3", "1.16.3"), 0);
  assert.equal(compareVersions("2.0.0", "1.99.99"), 1);
  assert.equal(compareVersions("1.0", "1.0.0"), 0);
  assert.equal(compareVersions("", "1.0.0"), -1);
  assert.equal(compareVersions("garbage", "1.0.0"), -1);
});

test("readInstalledVersion: reads clean values, null on absent/unreadable/non-version", () => {
  const root = mkdtempSync(join(tmpdir(), "candice-ver-"));
  assert.equal(readInstalledVersion(join(root, "missing")), null);

  writeVersion(root, "1.15.0");
  assert.equal(readInstalledVersion(join(root, "spec-protocol")), "1.15.0");

  writeVersion(root, " 1.16.3 \n");
  assert.equal(readInstalledVersion(join(root, "spec-protocol")), "1.16.3");

  writeVersion(root, "not-a-version");
  assert.equal(readInstalledVersion(join(root, "spec-protocol")), null);

  writeFileSync(join(root, "spec-protocol", "VERSION"), "");
  assert.equal(readInstalledVersion(join(root, "spec-protocol")), null);
  rmSync(root, { recursive: true, force: true });
});

test("installedRoots: primary root always; nine root only with its own .claude.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "candice-roots-"));
  const home = join(dir, "home");
  mkdirSync(join(home, ".claude", "skills"), { recursive: true });

  const env = { HOME: home };
  const without = installedRoots(env);
  assert.deepEqual(without, [join(home, ".claude", "skills", "spec-protocol")]);

  mkdirSync(join(home, ".claude-nine"), { recursive: true });
  writeFileSync(join(home, ".claude-nine", ".claude.json"), "{}");
  const withNine = installedRoots(env);
  assert.deepEqual(withNine, [
    join(home, ".claude", "skills", "spec-protocol"),
    join(home, ".claude-nine", "skills", "spec-protocol"),
  ]);
  rmSync(dir, { recursive: true, force: true });
});

test("configuredRoots: CANDICE_UPGRADE_SKILLS_ROOT overrides for tests", () => {
  const dir = mkdtempSync(join(tmpdir(), "candice-cfg-"));
  const roots = configuredRoots({ CANDICE_UPGRADE_SKILLS_ROOT: dir });
  assert.deepEqual(roots, [dir]);
  rmSync(dir, { recursive: true, force: true });
});

test("detect: update when installed older than published", async () => {
  const root = mkdtempSync(join(tmpdir(), "candice-detect-"));
  writeVersion(root, "1.15.0");
  const d = await detect({ roots: [join(root, "spec-protocol")], fetchImpl: stubFetch("1.16.3") });
  assert.equal(d.status, "update");
  assert.equal(d.ok, false);
  assert.equal(d.published, "1.16.3");
  assert.match(d.recommended, /self-update/);
  rmSync(root, { recursive: true, force: true });
});

test("detect: current when installed equals published", async () => {
  const root = mkdtempSync(join(tmpdir(), "candice-detect-"));
  writeVersion(root, "1.16.3");
  const d = await detect({ roots: [join(root, "spec-protocol")], fetchImpl: stubFetch("1.16.3") });
  assert.equal(d.status, "current");
  assert.equal(d.ok, true);
  rmSync(root, { recursive: true, force: true });
});

test("detect: current when installed is ahead of published", async () => {
  const root = mkdtempSync(join(tmpdir(), "candice-detect-"));
  writeVersion(root, "1.17.0");
  const d = await detect({ roots: [join(root, "spec-protocol")], fetchImpl: stubFetch("1.16.3") });
  assert.equal(d.status, "current");
  assert.equal(d.ok, true);
  rmSync(root, { recursive: true, force: true });
});

test("detect: tree with no readable VERSION is UNKNOWN -> update required (self-update precedent)", async () => {
  const root = mkdtempSync(join(tmpdir(), "candice-detect-"));
  mkdirSync(join(root, "spec-protocol"), { recursive: true });
  const d = await detect({ roots: [join(root, "spec-protocol")], fetchImpl: stubFetch("1.16.3") });
  assert.equal(d.status, "update");
  assert.equal(d.installed[join(root, "spec-protocol")], null);
  rmSync(root, { recursive: true, force: true });
});

test("detect: undetermined when published channel fails (never 'current' out of a failed instrument)", async () => {
  const root = mkdtempSync(join(tmpdir(), "candice-detect-"));
  writeVersion(root, "1.16.3");
  const networkFail = async () => {
    throw new Error("ENOTFOUND");
  };
  const d = await detect({ roots: [join(root, "spec-protocol")], fetchImpl: networkFail });
  assert.equal(d.status, "undetermined");
  assert.equal(d.ok, false);
  assert.match(d.reason, /ENOTFOUND/);
  rmSync(root, { recursive: true, force: true });
});

test("detect: undetermined when published page is not a version", async () => {
  const root = mkdtempSync(join(tmpdir(), "candice-detect-"));
  writeVersion(root, "1.16.3");
  const d = await detect({ roots: [join(root, "spec-protocol")], fetchImpl: stubFetch("", { body: "<html>404</html>" }) });
  assert.equal(d.status, "undetermined");
  assert.match(d.reason, /not a version/);
  rmSync(root, { recursive: true, force: true });
});

test("detect: undetermined on non-2xx HTTP status", async () => {
  const root = mkdtempSync(join(tmpdir(), "candice-detect-"));
  writeVersion(root, "1.16.3");
  const d = await detect({ roots: [join(root, "spec-protocol")], fetchImpl: stubFetch("", { status: 403 }) });
  assert.equal(d.status, "undetermined");
  assert.match(d.reason, /HTTP 403/);
  rmSync(root, { recursive: true, force: true });
});

test("detect: two-root — update when either root is stale", async () => {
  const root = mkdtempSync(join(tmpdir(), "candice-detect-"));
  const a = join(root, "a", "spec-protocol");
  const b = join(root, "b", "spec-protocol");
  writeVersion(join(root, "a"), "1.16.3");
  writeVersion(join(root, "b"), "1.15.0");
  const d = await detect({ roots: [a, b], fetchImpl: stubFetch("1.16.3") });
  assert.equal(d.status, "update");
  assert.equal(d.installed[a], "1.16.3");
  assert.equal(d.installed[b], "1.15.0");
  rmSync(root, { recursive: true, force: true });
});

test("detect: both roots current -> current", async () => {
  const root = mkdtempSync(join(tmpdir(), "candice-detect-"));
  const a = join(root, "a", "spec-protocol");
  const b = join(root, "b", "spec-protocol");
  writeVersion(join(root, "a"), "1.16.3");
  writeVersion(join(root, "b"), "1.16.3");
  const d = await detect({ roots: [a, b], fetchImpl: stubFetch("1.16.3") });
  assert.equal(d.status, "current");
  rmSync(root, { recursive: true, force: true });
});

test("published URL is the operator-controlled raw channel only", () => {
  assert.match(PUBLISHED_VERSION_URL, /^https:\/\/raw\.githubusercontent\.com\/trevorotts1\/999-setup\/main\//);
  assert.ok(!PUBLISHED_VERSION_URL.includes("blackceomacmini"));
});
