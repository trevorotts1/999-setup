/**
 * WS-49 — uninstall cleanup regression (spec 21/22 "install/update/uninstall
 * cleanup", E.1 WS-49 leg 6).
 *
 * The uninstall contract under regression:
 *   - macOS: removing the install root removes every install artifact —
 *     skills, plugin, app bundle, assets, state, staging, backups — nothing
 *     of the install remains (the helper implements the documented contract;
 *     see helpers.mjs for the finding note).
 *   - Windows: the NSIS default uninstall section owns `RmDir /r
 *     "$LOCALAPPDATA\${BUNDLEID}"`; the WS-29 hooks file declares pre/post
 *     uninstall hooks and the policy audit requires the hook macros — both
 *     are asserted statically here (the NSIS runtime itself runs only on
 *     Windows; the harness asserts the shipped hooks contract cross-platform).
 *   - Stale temp/state files inside the root (crash leftovers) are removed
 *     with it — cleanup is total, never partial.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { join } from "node:path";
import { freshRoot, tree, uninstall, REPO } from "./helpers.mjs";

test("macOS uninstall removes the entire install root: skills/plugin/app/assets/state/backups", () => {
  const root = freshRoot("ws49-uninstall-");
  try {
    tree(join(root, "skills", "kaizen"), { "SKILL.md": "# k\n" });
    tree(join(root, "plugin", "candice-integration"), { ".claude-plugin": { "plugin.json": "{}" } });
    tree(join(root, "app", "Candice Companion.app", "Contents", "MacOS"), { "candice-companion": "bin" });
    tree(join(root, "assets", "stt"), { "ggml-tiny.en-q5_1.bin": "model" });
    tree(join(root, "assets", "tts"), { "kokoro-v1.0.fp16.onnx": "model" });
    tree(join(root, "state"), { "bootstrap-state.json": "{}" });
    tree(join(root, "state", "staging"), { "skills": { "kaizen": { "SKILL.md": "x" } } });
    tree(join(root, ".candice-backups"), { "kaizen.2026-08-21T00-00-00-000Z.backup": { "SKILL.md": "old" } });
    // A stale crash leftover (temp audio) must go too.
    mkdirSync(join(root, "tmp"), { recursive: true });
    writeFileSync(join(root, "tmp", "crash-123.wav"), "noise");

    uninstall(root);
    assert.equal(existsSync(root), false, "install root removed");
    assert.ok(!existsSync(join(root, "skills")), "skills removed");
    assert.ok(!existsSync(join(root, "plugin")), "plugin removed");
    assert.ok(!existsSync(join(root, "app")), "app removed");
    assert.ok(!existsSync(join(root, "assets")), "assets removed");
    assert.ok(!existsSync(join(root, "state")), "state removed");
    assert.ok(!existsSync(join(root, ".candice-backups")), "backups removed");
    assert.ok(!existsSync(join(root, "tmp")), "stale temp removed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("windows uninstall surface: WS-29 hooks define pre/post uninstall macros and full-root removal note", () => {
  const hooks = join(REPO, "apps", "candice-companion", "scripts", "package-windows", "installerHooks.nsh");
  const src = readFileSync(hooks, "utf8");
  assert.match(src, /!macro NSIS_HOOK_PREUNINSTALL/, "pre-uninstall hook macro defined");
  assert.match(src, /!macro NSIS_HOOK_POSTUNINSTALL/, "post-uninstall hook macro defined");
  assert.match(src, /RmDir \/r "\$LOCALAPPDATA\\\$\{BUNDLEID\}"/, "default section removes the whole install root");
  // The WS-29 policy audit (nsis-policy-audit.mjs) requires all four hook
  // macros — regression that the file stays compliant.
  const audit = join(REPO, "apps", "candice-companion", "scripts", "package-windows", "nsis-policy-audit.mjs");
  const auditSrc = readFileSync(audit, "utf8");
  assert.match(auditSrc, /NSIS_HOOK_PREUNINSTALL/);
  assert.match(auditSrc, /NSIS_HOOK_POSTUNINSTALL/);
});

test("uninstall removes state and backups even when other artifacts already absent", () => {
  const root = freshRoot("ws49-uninstall2-");
  try {
    tree(join(root, "state"), { "bootstrap-state.json": "{}" });
    tree(join(root, ".candice-backups"), { "x.2026-08-21T00-00-00-000Z.backup": { "SKILL.md": "old" } });
    uninstall(root);
    assert.ok(!existsSync(root), "root gone despite partial install");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
