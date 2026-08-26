/**
 * WS-49 — update detection regression (spec 21 flow, E.1 WS-49 leg 1).
 *
 * Proves the real, shipped primitives:
 *   - version comparison detects newer / equal / older candidates,
 *   - gate.mjs accepts newer + equal, rejects downgrade (exit 1) unless
 *     --allow-downgrade,
 *   - the WS-31 health check detects stale/missing components (the
 *     "next invocation checks" step of the existing-user flow),
 *   - repo-tree component pins are version-consistent with the trees.
 *
 * WS-32 (the upgrade orchestrator that acts on detection) is not built yet —
 * the detection layer itself is complete and is what this lane owns.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { GATE, run, load, freshRoot, tree } from "./helpers.mjs";

const reg = await load("scripts/candice-updater/checksums/components.mjs");

test("update detection: isNewer/isDowngrade decide correctly", () => {
  assert.equal(reg.isNewer("1.17.0", "1.16.3"), true);
  assert.equal(reg.isNewer("1.16.3", "1.16.3"), false);
  assert.equal(reg.isNewer("1.16.2", "1.16.3"), false);
  assert.equal(reg.isNewer("2.0.0", "1.9.9"), true);
  assert.equal(reg.isDowngrade("1.16.2", "1.16.3"), true);
  assert.equal(reg.isDowngrade("1.16.3", "1.16.3"), false);
  assert.equal(reg.isDowngrade("1.17.0", "1.16.3"), false);
  // Single-component and version-prefixed forms (skill pin shapes)
  assert.equal(reg.compareVersions("v1.0.1", "1.0.0"), 1);
  assert.equal(reg.compareVersions("1.0", "1.0.0"), 0);
});

test("version gate: newer accepted, equal accepted, downgrade rejected", () => {
  const ok = run([GATE, "--candidate", "1.17.0", "--installed", "1.16.3"]);
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /accepted/);
  const equal = run([GATE, "--candidate", "1.16.3", "--installed", "1.16.3"]);
  assert.equal(equal.code, 0, equal.out);
  const down = run([GATE, "--candidate", "1.16.2", "--installed", "1.16.3"]);
  assert.equal(down.code, 1, down.out);
  assert.match(down.out, /DOWNGRADE REJECTED/);
  const override = run([GATE, "--candidate", "1.16.2", "--installed", "1.16.3", "--allow-downgrade"]);
  assert.equal(override.code, 0, override.out);
});

test("health check reports stale version as stale (WS-31 checkSkill detail)", async () => {
  const root = freshRoot("ws49-detect-");
  try {
    // Install one skill at an OLDER version than pinned -> stale, not missing.
    tree(join(root, "skills", "kaizen"), { "SKILL.md": "# kaizen\n", VERSION: "0.9.0\n" });
    const { healthCheck } = await load("scripts/candice-bootstrap/health.mjs");
    const h = healthCheck({ root, platform: "darwin" });
    const kaizen = h.components.find((c) => c.name === "kaizen");
    assert.ok(kaizen, "kaizen row present");
    assert.equal(kaizen.present, true);
    assert.equal(kaizen.ok, false, "stale version must not be ok");
    assert.match(kaizen.detail || "", /stale/i);
    // The rest are missing -> overall health not ok (regression: never a false healthy)
    assert.equal(h.ok, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("health check: missing component reported in missing list", async () => {
  const root = freshRoot("health-miss-");
  try {
    const { healthCheck } = await load("scripts/candice-bootstrap/health.mjs");
    const h = healthCheck({ root, platform: "darwin" });
    assert.equal(h.ok, false);
    assert.ok(h.missing.length > 0);
    assert.ok(h.missing.includes("nine-router-setup"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("repo-tree pins are consistent with the actual tree VERSION files", () => {
  for (const [id, rec] of Object.entries(reg.REPO_TREE_COMPONENTS)) {
    if (!rec.repoPath) continue;
    const vFile = join(process.cwd(), rec.repoPath, "VERSION");
    if (!existsSync(vFile)) continue;
    const onDisk = readFileSync(vFile, "utf8").trim();
    assert.equal(onDisk, rec.version, `${id}: pin ${rec.version} vs tree ${onDisk}`);
  }
});
