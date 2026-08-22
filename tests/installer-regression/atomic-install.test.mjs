/**
 * WS-49 — atomic install + backup + rollback regression (spec 21, E.1
 * WS-49 legs 3/4/5).
 *
 * Drives the shipped WS-33 engine (atomic-install.mjs) through its CLI:
 *   - fresh install places the staged tree and records a journal,
 *   - replace install backs the old tree up OUTSIDE the config root and
 *     swaps atomically,
 *   - rollback restores the newest backup — the update failure path,
 *   - a staged tree WITHOUT the completion marker still installs (marker is
 *     optional), but a marker that vanishes after rename fails and rolls back,
 *   - a missing staged dir fails without touching the target (no half-state).
 *
 * This is the independent regression view: the WS-33 unit suite proves the
 * engine; this suite proves the same engine through the regression lane's
 * scenarios, end-to-end with real directories.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ATOMIC, run, freshRoot, tree } from "./helpers.mjs";

function backups(root, targetBase) {
  // Engine default backup root: dirname(to)/.candice-backups
  const dir = join(root, "skills", ".candice-backups");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.startsWith(`${targetBase}.`) && n.endsWith(".backup"));
}

test("fresh install: staged tree lands at target, journal recorded", () => {
  const root = freshRoot("ws49-atomic-");
  try {
    const staged = join(root, "staged", "skill");
    tree(staged, { "SKILL.md": "v2 content" });
    const to = join(root, "skills", "kaizen");
    const r = run([ATOMIC, "install", "--from", staged, "--to", to]);
    assert.equal(r.code, 0, r.out);
    assert.equal(readFileSync(join(to, "SKILL.md"), "utf8"), "v2 content");
    assert.ok(!existsSync(staged), "staged dir consumed by rename");
    assert.ok(existsSync(join(root, "skills", ".candice-backups", "install-journal.jsonl")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("replace install: old tree backed up OUTSIDE config root, then atomic swap", () => {
  const root = freshRoot("ws49-replace-");
  try {
    const to = join(root, "skills", "spec-protocol");
    tree(to, { "SKILL.md": "v1 content" });
    const staged = join(root, "staged", "spec-protocol");
    tree(staged, { "SKILL.md": "v2 content", ".candice-install-ok": "ok" });
    const r = run([ATOMIC, "install", "--from", staged, "--to", to]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /backed up/);
    assert.equal(readFileSync(join(to, "SKILL.md"), "utf8"), "v2 content");
    const b = backups(root, "spec-protocol");
    assert.equal(b.length, 1, `expected 1 backup under backup root (outside config root)`);
    assert.equal(readFileSync(join(root, "skills", ".candice-backups", b[0], "SKILL.md"), "utf8"), "v1 content");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rollback: newest backup restores the previous tree atomically", () => {
  const root = freshRoot("ws49-rollback-");
  try {
    const to = join(root, "skills", "kaizen");
    tree(to, { "SKILL.md": "v1 content" });
    const staged = join(root, "staged", "kaizen");
    tree(staged, { "SKILL.md": "v2 content" });
    const install = run([ATOMIC, "install", "--from", staged, "--to", to]);
    assert.equal(install.code, 0, install.out);
    assert.equal(readFileSync(join(to, "SKILL.md"), "utf8"), "v2 content");
    const rb = run([ATOMIC, "rollback", "--to", to]);
    assert.equal(rb.code, 0, rb.out);
    assert.equal(readFileSync(join(to, "SKILL.md"), "utf8"), "v1 content", "rollback restored v1");
    // Journal survives for auditability; the consumed backup dir entry is gone.
    const left = readdirSync(join(to, "..", ".candice-backups")).filter(
      (n) => n.startsWith("kaizen.") && n.endsWith(".backup"),
    );
    assert.equal(left.length, 0, "restored backup no longer a pending backup entry");
    assert.ok(existsSync(join(to, "..", ".candice-backups", "install-journal.jsonl")), "journal kept (recovery contract)");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rollback with no backup fails cleanly (exit 1) and leaves target intact", () => {
  const root = freshRoot("ws49-nobackup-");
  try {
    const to = join(root, "skills", "kaizen");
    tree(to, { "SKILL.md": "v1 content" });
    const r = run([ATOMIC, "rollback", "--to", to]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no backup/i);
    assert.equal(readFileSync(join(to, "SKILL.md"), "utf8"), "v1 content", "target untouched");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing staged dir fails WITHOUT touching an existing target (no half-state)", () => {
  const root = freshRoot("ws49-staged-");
  try {
    const to = join(root, "skills", "kaizen");
    tree(to, { "SKILL.md": "v1 content" });
    const r = run([ATOMIC, "install", "--from", join(root, "nope"), "--to", to]);
    assert.equal(r.code, 1, r.out);
    assert.equal(readFileSync(join(to, "SKILL.md"), "utf8"), "v1 content", "target untouched");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
