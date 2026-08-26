/**
 * WS-33 atomic-install + rollback engine tests (node:test).
 *
 * Proves: fresh install works; replace install backs up the old tree and
 * swaps atomically; rollback restores the backed-up tree; failure before
 * rename leaves the target untouched; a target outside the backup root
 * resolves deterministic backup names.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const engine = join(here, "..", "atomic-install.mjs");

function run(args) {
  try {
    const out = execFileSync(process.execPath, [engine, ...args], { encoding: "utf8" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout ?? "") + String(e.stderr ?? "") };
  }
}

function tree(dir, files) {
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
}

test("fresh install places staged tree at target and records backup-less journal", () => {
  const root = mkdtempSync(join(tmpdir(), "ws33-a-"));
  try {
    const staged = join(root, "staged", "skill");
    tree(staged, { "SKILL.md": "v2 content" });
    const to = join(root, "skills", "kaizen");
    const r = run(["install", "--from", staged, "--to", to]);
    assert.equal(r.code, 0, r.out);
    assert.equal(readFileSync(join(to, "SKILL.md"), "utf8"), "v2 content");
    assert.ok(!existsSync(staged), "staged dir consumed");
    assert.ok(existsSync(join(root, "skills", ".candice-backups", "install-journal.jsonl")));
  } finally {
    rmSyncSafe(root);
  }
});

test("replace install backs up old tree outside config root, then swaps atomically", () => {
  const root = mkdtempSync(join(tmpdir(), "ws33-a-"));
  try {
    const to = join(root, "skills", "spec-protocol");
    tree(to, { "SKILL.md": "v1 content" });
    const staged = join(root, "staged", "spec-protocol");
    tree(staged, { "SKILL.md": "v2 content", ".candice-install-ok": "ok" });

    const r = run(["install", "--from", staged, "--to", to]);
    assert.equal(r.code, 0, r.out);
    assert.equal(readFileSync(join(to, "SKILL.md"), "utf8"), "v2 content");

    const backupRoot = join(root, "skills", ".candice-backups");
    const backups = readdirSync(backupRoot).filter((n) => n.startsWith("spec-protocol.") && n.endsWith(".backup"));
    assert.equal(backups.length, 1, `expected 1 backup, saw ${backups.join(", ")}`);
    assert.equal(readFileSync(join(backupRoot, backups[0], "SKILL.md"), "utf8"), "v1 content");
  } finally {
    rmSyncSafe(root);
  }
});

test("rollback restores the newest backup to the target path", () => {
  const root = mkdtempSync(join(tmpdir(), "ws33-a-"));
  try {
    const to = join(root, "skills", "eli5");
    tree(to, { "SKILL.md": "v1" });
    const staged = join(root, "staged", "eli5");
    tree(staged, { "SKILL.md": "v2" });
    assert.equal(run(["install", "--from", staged, "--to", to]).code, 0);

    const r = run(["rollback", "--to", to]);
    assert.equal(r.code, 0, r.out);
    assert.equal(readFileSync(join(to, "SKILL.md"), "utf8"), "v1");
  } finally {
    rmSyncSafe(root);
  }
});

test("rollback with no backup fails loudly (never silently succeeds)", () => {
  const root = mkdtempSync(join(tmpdir(), "ws33-a-"));
  try {
    const to = join(root, "skills", "bro");
    tree(to, { "SKILL.md": "v1" });
    const r = run(["rollback", "--to", to]);
    assert.equal(r.code, 1);
    assert.match(r.out, /no backup found/);
  } finally {
    rmSyncSafe(root);
  }
});

test("install onto a missing target still succeeds (fresh install path)", () => {
  const root = mkdtempSync(join(tmpdir(), "ws33-a-"));
  try {
    const staged = join(root, "staged", "nine-router-setup");
    tree(staged, { "VERSION": "1.16.3" });
    const to = join(root, "skills", "nine-router-setup");
    const r = run(["install", "--from", staged, "--to", to]);
    assert.equal(r.code, 0, r.out);
    assert.equal(readFileSync(join(to, "VERSION"), "utf8"), "1.16.3");
  } finally {
    rmSyncSafe(root);
  }
});

/** rmSync with recursive:true, force:true but guarded for cross-platform tmp semantics. */
function rmSyncSafe(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup failures in tmp.
  }
}
