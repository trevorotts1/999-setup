/**
 * WS-49 — full-journey regression: bootstrap install -> health -> update ->
 * rollback on one hermetic root (spec 21/22 end-to-end, E.1 WS-49).
 *
 * Drives the real shipped engines in sequence over a temp root:
 *   1. fresh bootstrap correctly refuses without a release-authorized app,
 *   2. the independently installable skill/plugin tree is then exercised,
 *   3. simulated update: a newer skill tree is installed through the atomic
 *      engine, old tree lands in the backup root outside the config root,
 *   4. simulated failure: rollback restores the previous tree,
 *   5. uninstall removes the whole root (no install artifact left).
 *
 * WS-32 (the upgrade orchestrator) is not built yet — the regression proves
 * the update mechanics its orchestration will call, using the shipped engines.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { freshRoot, uninstall, load, run, ATOMIC } from "./helpers.mjs";

test("full journey: bootstrap blocks app bypass -> update -> rollback -> uninstall", async () => {
  const root = freshRoot("ws49-journey-");
  try {
    // 1. Bootstrap must stop before creating an incomplete state when no
    // release-authorized application candidate exists.
    const { installAll, installSkills, installPlugin, SKILL_PINS, PLUGIN_PINS } = await load("scripts/candice-bootstrap/install.mjs");
    const r = await installAll({ root, platform: "darwin", offline: true, mode: "test-fixture" });
    assert.equal(r.ok, false, r.message);
    assert.equal(r.results.app.blocked, true);
    assert.equal(existsSync(join(root, "state", "bootstrap-state.json")), false, "blocked bootstrap writes no state");

    // The app block does not weaken the independently testable skill/plugin
    // update mechanics below.
    assert.equal(installSkills(root, SKILL_PINS, { noAtomic: true }).ok, true);
    assert.equal(installPlugin(root, PLUGIN_PINS, { noAtomic: true }).ok, true);
    assert.equal(existsSync(join(root, "skills", "kaizen", "SKILL.md")), true);
    assert.equal(existsSync(join(root, "plugin", "candice-integration", ".claude-plugin", "plugin.json")), true);

    // 2. Update: replace one skill through the real atomic engine.
    const to = join(root, "skills", "kaizen");
    const staged = join(root, "state", "staging", "kaizen-v2");
    mkdirSync(staged, { recursive: true });
    writeFileSync(join(staged, "SKILL.md"), "# kaizen v2\n");
    writeFileSync(join(staged, "VERSION"), "1.2.0\n");
    writeFileSync(join(staged, ".candice-install-ok"), "ok\n");
    const up = run([ATOMIC, "install", "--from", staged, "--to", to]);
    assert.equal(up.code, 0, up.out);
    assert.equal(readFileSync(join(to, "VERSION"), "utf8"), "1.2.0\n");
    const b = readdirSync(join(root, "skills", ".candice-backups")).filter(
      (n) => n.startsWith("kaizen.") && n.endsWith(".backup"),
    );
    assert.equal(b.length, 1, "update backed up the old tree");

    // 3. Rollback the failed update.
    const rb = run([ATOMIC, "rollback", "--to", to]);
    assert.equal(rb.code, 0, rb.out);
    assert.equal(readFileSync(join(to, "VERSION"), "utf8"), "1.1.0\n", "rollback restored pinned version");

    // 4. Uninstall removes the entire root.
    uninstall(root);
    assert.equal(existsSync(root), false, "uninstall removed the install root");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
