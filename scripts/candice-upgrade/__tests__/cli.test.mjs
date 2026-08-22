import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, "..", "upgrade.mjs");
function runCli(args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}
function freshRoot() { return mkdtempSync(join(tmpdir(), "candice-upgrade-cli-")); }

test("check is never a false current result", () => {
  const r = runCli(["check"]);
  assert.ok([0, 1, 2].includes(r.status));
  if (r.status === 0) assert.match(r.stdout, /OK current/);
  if (r.status === 1) assert.match(r.stdout, /UPDATE AVAILABLE/);
  if (r.status === 2) assert.match(r.stderr, /UNDETERMINED/);
});

test("repair exits nonzero for a quarantined app and writes no partial tree", () => {
  const root = freshRoot();
  const r = runCli(["repair", "--offline", "--root", root]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /repair blocked.*release-authorized/i);
  assert.equal(existsSync(join(root, "skills")), false);
  assert.equal(existsSync(join(root, "state", "bootstrap-state.json")), false);
  rmSync(root, { recursive: true, force: true });
});

test("repair --simulate reports the same release block and writes nothing", () => {
  const root = freshRoot();
  const r = runCli(["repair", "--offline", "--root", root, "--simulate"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /repair blocked/);
  assert.equal(existsSync(join(root, "state")), false);
  rmSync(root, { recursive: true, force: true });
});

test("health reports the unavailable application", () => {
  const root = freshRoot();
  const r = runCli(["--health", "--root", root]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /MISS candice-companion.*release-authorized/);
  rmSync(root, { recursive: true, force: true });
});

test("usage error exits 2", () => {
  const r = runCli(["bogus-command"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/);
});
