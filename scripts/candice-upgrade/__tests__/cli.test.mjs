import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, "..", "upgrade.mjs");

function runCli(args, opts = {}) {
  const r = spawnSync("node", [CLI, ...args], { encoding: "utf8", ...opts });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function freshRoot() {
  return mkdtempSync(join(tmpdir(), "candice-upgrade-cli-"));
}

test("check: exit 0 current against the live operator-controlled channel (no fixture)", () => {
  // Live read of the published spec-protocol VERSION (raw.githubusercontent).
  // The operator box has network; when the channel is unreachable the
  // detector must say UNDETERMINED (exit 2) — never 0, never 1 without proof.
  const r = runCli(["check"]);
  if (r.status === 2) {
    assert.match(r.stderr, /UNDETERMINED/);
    return;
  }
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /OK current/);
});

test("repair on an empty fixture root installs everything and exits 0", () => {
  const root = freshRoot();
  const r = runCli(["repair", "--offline", "--root", root]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /OK repaired/);
  assert.equal(existsSync(join(root, "skills", "spec-protocol", "SKILL.md")), true);
  assert.equal(existsSync(join(root, "plugin", "candice-integration", ".claude-plugin", "plugin.json")), true);
  assert.equal(existsSync(join(root, "state", "bootstrap-state.json")), true);
  rmSync(root, { recursive: true, force: true });
});

test("repair is idempotent: second run exits 0 with no repairs", () => {
  const root = freshRoot();
  const r1 = runCli(["repair", "--offline", "--root", root]);
  assert.equal(r1.status, 0);
  const r2 = runCli(["repair", "--offline", "--root", root]);
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  assert.match(r2.stdout, /no repairs needed/);
  rmSync(root, { recursive: true, force: true });
});

test("repair --simulate writes nothing and exits 0", () => {
  const root = freshRoot();
  const r = runCli(["repair", "--offline", "--root", root, "--simulate"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /simulate/);
  assert.equal(existsSync(join(root, "skills")), false);
  rmSync(root, { recursive: true, force: true });
});

test("health after repair: exit 1 while app payload is absent (fail closed, darwin)", () => {
  const root = freshRoot();
  const r1 = runCli(["repair", "--offline", "--root", root]);
  assert.equal(r1.status, 0);
  // The prebuilt app cannot be verified without a release payload, so the
  // fast health check reports the app missing — never a false healthy.
  const h = runCli(["--health", "--root", root]);
  assert.equal(h.status, 1);
  assert.match(h.stdout, /MISS candice-companion/);
  rmSync(root, { recursive: true, force: true });
});

test("usage error exits 2", () => {
  const r = runCli(["bogus-command"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/);
});
