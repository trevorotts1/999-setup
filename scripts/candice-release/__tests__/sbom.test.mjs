import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { npmComponents, npmIdentity, spdxId, generateSbom } from "../sbom.mjs";

const scriptDir = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

// Q-08 fixture: scoped package identity recovered from a lockfileVersion 3
// entry (no `name` field — the installed path is the only name source).
const FIXTURE_LOCK = {
  lockfileVersion: 3,
  packages: {
    "": {
      name: "fixture-app",
      version: "1.0.0",
      license: "MIT",
      dependencies: { "@tauri-apps/api": "2.11.1", "@acme/ui": "3.0.0" },
    },
    "node_modules/@tauri-apps/api": {
      version: "2.11.1",
      resolved: "https://registry.npmjs.org/@tauri-apps/api/-/api-2.11.1.tgz",
      integrity: "sha512-M2FPuYND2m+wh5hfW9ZpSdxMPdEJovPBWwoHJmwUpysTYNHaOkVFN419m/K0LIgjb/7KU2vBgsUepJWugQCvAA==",
      license: "Apache-2.0 OR MIT",
    },
    // Q-08 second fixture: two scopes sharing the same leaf name/version.
    // Both must appear, each with its exact scoped name@version.
    "node_modules/@acme/ui": {
      version: "3.0.0",
      resolved: "https://registry.npmjs.org/@acme/ui/-/ui-3.0.0.tgz",
      integrity: "sha512-M2FPuYND2m+wh5hfW9ZpSdxMPdEJovPBWwoHJmwUpysTYNHaOkVFN419m/K0LIgjb/7KU2vBgsUepJWugQCvAA==",
      license: "MIT",
    },
    "node_modules/@zinc/ui": {
      version: "3.0.0",
      resolved: "https://registry.npmjs.org/@zinc/ui/-/ui-3.0.0.tgz",
      integrity: "sha512-M2FPuYND2m+wh5hfW9ZpSdxMPdEJovPBWwoHJmwUpysTYNHaOkVFN419m/K0LIgjb/7KU2vBgsUepJWugQCvAA==",
      license: "MIT",
    },
    "node_modules/@scope/pkg-with-name": {
      name: "@scope/pkg-with-name",
      version: "1.2.3",
      license: "ISC",
    },
  },
};

function packageJson() {
  return { name: "fixture-app", version: "1.0.0", license: "MIT" };
}

test("npmIdentity keeps scoped name intact from lockfile path", () => {
  const id = npmIdentity("node_modules/@tauri-apps/api", FIXTURE_LOCK.packages["node_modules/@tauri-apps/api"], packageJson());
  assert.equal(id.name, "@tauri-apps/api");
  assert.equal(id.version, "2.11.1");
});

test("npmIdentity prefers explicit entry name over path", () => {
  const id = npmIdentity("node_modules/@scope/pkg-with-name", FIXTURE_LOCK.packages["node_modules/@scope/pkg-with-name"], packageJson());
  assert.equal(id.name, "@scope/pkg-with-name");
  assert.equal(id.version, "1.2.3");
});

test("npmComponents asserts exact name@version for every lock entry (Q-08)", () => {
  const components = npmComponents(packageJson(), FIXTURE_LOCK);
  const byKey = new Map(components.map(({ key, component }) => [key, component]));
  const expected = {
    "fixture-app@1.0.0": "fixture-app",
    "@tauri-apps/api@2.11.1": "@tauri-apps/api",
    "@acme/ui@3.0.0": "@acme/ui",
    "@zinc/ui@3.0.0": "@zinc/ui",
    "@scope/pkg-with-name@1.2.3": "@scope/pkg-with-name",
  };
  for (const [key, name] of Object.entries(expected)) {
    const component = byKey.get(key);
    assert.ok(component, `missing lock entry in SBOM: ${key}`);
    assert.equal(component.name, name, `corrupted name for ${key}`);
    assert.equal(component.versionInfo, key.split("@").slice(-1)[0], `wrong version for ${key}`);
  }
  // Exact name@version for EVERY fixture lock entry — none lost, none renamed.
  const fixtureKeys = new Set();
  for (const [path, entry] of Object.entries(FIXTURE_LOCK.packages)) {
    if (path === "" && entry.name) fixtureKeys.add(`${entry.name}@${entry.version}`);
    if (path.startsWith("node_modules/")) {
      const parts = path.split("/");
      const name = entry.name || (parts[1].startsWith("@") ? `${parts[1]}/${parts[2]}` : parts[1]);
      fixtureKeys.add(`${name}@${entry.version}`);
    }
  }
  assert.deepEqual(new Set(byKey.keys()), fixtureKeys, "SBOM npm component set must equal lock entries exactly");
  // No unscoped leaf-name leakage: the old basename() bug produced bare `api`.
  assert.ok(!byKey.has("api@2.11.1"), "scoped name must not degrade to bare leaf");
  assert.ok(!byKey.has("ui@3.0.0"), "shared leaf name must not collapse two scopes");
});

test("spdxId is collision-safe for scoped names (Q-08)", () => {
  const taken = new Set();
  const a = spdxId("@acme/ui", "3.0.0", taken);
  const b = spdxId("acme-ui", "3.0.0", taken);
  assert.notEqual(a, b, `scoped and sanitized names collide: ${a}`);
  const c = spdxId("@zinc/ui", "3.0.0", taken);
  assert.notEqual(a, c, `two scopes sharing leaf collide: ${a}`);
  // Both ids remain valid SPDX id strings.
  for (const id of [a, b, c]) assert.match(id, /^SPDXRef-Package-[A-Za-z0-9.-]+$/);
  // Distinct ids must remain resolvable from generated document relationships.
  const again = spdxId("@acme/ui", "3.0.0", new Set());
  assert.equal(again, a, "same exact name@version must map to the same id");
});

test("generateSbom on real checkout: every scoped lock entry present with exact name (Q-08)", () => {
  const lockPath = join(repoRoot, "apps", "candice-companion", "package-lock.json");
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const sbom = generateSbom(repoRoot);
  const document = JSON.parse(sbom);
  const byExact = new Map();
  for (const pkg of document.packages) byExact.set(`${pkg.name}@${pkg.versionInfo}`, pkg);

  const missing = [];
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (path === "" && entry.name) {
      if (!byExact.has(`${entry.name}@${entry.version}`)) missing.push(`${entry.name}@${entry.version}`);
      continue;
    }
    if (!path.startsWith("node_modules/")) continue;
    const parts = path.split("/");
    const name = entry.name || (parts[1].startsWith("@") ? `${parts[1]}/${parts[2]}` : parts[1]);
    if (!byExact.has(`${name}@${entry.version}`)) missing.push(`${name}@${entry.version}`);
  }
  assert.deepEqual(missing, [], "every lock entry must appear in SBOM as exact name@version");

  // Scoped entries specifically (real tree has @esbuild/@rollup/@tauri-apps/...).
  const scoped = Object.entries(lock.packages).filter(([p]) => /^node_modules\/@/.test(p));
  assert.ok(scoped.length > 0, "control: real lock must contain scoped packages");
  const scopedMissing = [];
  for (const [path, entry] of scoped) {
    const parts = path.split("/");
    const name = entry.name || `${parts[1]}/${parts[2]}`;
    if (!byExact.has(`${name}@${entry.version}`)) scopedMissing.push(`${name}@${entry.version}`);
  }
  assert.deepEqual(scopedMissing, [], "every scoped lock entry must be present with its exact scoped name");
  assert.ok(!byExact.has("api@2.11.1"), "bare leaf name must not appear for @tauri-apps/api");

  // SPDX ids unique across all packages (collision-safe).
  const ids = document.packages.map((p) => p.SPDXID);
  assert.equal(new Set(ids).size, ids.length, "SPDX ids must be unique");
});

test("generateSbom determinism: two runs byte-identical (F23-05)", () => {
  const one = generateSbom(repoRoot);
  const two = generateSbom(repoRoot);
  assert.equal(one, two, "two runs on same checkout must be byte-identical");
});
