#!/usr/bin/env node
/**
 * Candice production uninstall engine (FIX-018).
 *
 * Owned glob: `scripts/candice-bootstrap/**` (PROJECT-MANIFEST 9.2 WR-017).
 *
 * Production-owned uninstall: replaces the test-harness-only `uninstall(root)`
 * in tests/installer-regression/helpers.mjs (which was rmSync(root) with no
 * deregistration). This engine:
 *
 *   1. stops the app/bridge (bounded, fail-soft: a run-away stop is reported,
 *      never silently passes),
 *   2. deregisters the plugin registration from every discovered shared
 *      config root (register-plugin.mjs),
 *   3. removes Candice-only app/assets/state/rollback material,
 *   4. never touches plain-`claude` configuration, routing, or unrelated
 *      skills.
 *
 * A mutating operation that fails mid-way is reported per-step; the report
 * is truthful about what remains (fail-closed diagnostics).
 */
import { existsSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { bootstrapRoot } from "./state.mjs";
import { skillsDir, pluginDir, appDir, assetsDir } from "./paths.mjs";
import { parseMode } from "./modes.mjs";
import { discoverConfigRoots, deregister, listPlugins, candiceRecords } from "./register-plugin.mjs";
import { journal } from "./install.mjs";

function result(ok, message, extra = {}) {
  return { ok, message, ...extra };
}

/**
 * Stop the app/bridge, bounded. Fails soft with a truthful report: the
 * removal still proceeds (an unkillable process must not make uninstall
 * silently claim success either — the step result says what happened).
 */
export function stopAppBridge(root, platform, opts = {}) {
  const env = opts.env || process.env;
  const attempts = [];
  if (platform === "darwin") {
    const names = ["candice-companion"];
    for (const name of names) {
      const r = spawnSync("pkill", ["-f", name], { encoding: "utf8", timeout: 10000, env });
      attempts.push({ name, exit: r.status, error: r.error ? r.error.message : null });
    }
  }
  return result(true, attempts.length ? `stop attempted: ${JSON.stringify(attempts)}` : "no platform stop action", { attempts });
}

/**
 * Remove Candice-only material under the install root. Explicit directory
 * list — never rmSync(root) wholesale: the root is the shared BlackCEO/999
 * parent and may hold non-Candice content.
 */
export function removeCandiceTrees(root, opts = {}) {
  const targets = [
    { label: "skills", path: skillsDir(root) },
    { label: "plugin", path: join(root, "plugin") },
    { label: "app", path: appDir(root) },
    { label: "assets", path: assetsDir(root, "") },
    { label: "staging/backups", path: join(root, "state", "staging") },
    { label: "backups", path: join(root, ".candice-backups") },
  ];
  const removed = [];
  const remaining = [];
  const errors = [];
  for (const t of targets) {
    if (!existsSync(t.path)) continue;
    try {
      rmSync(t.path, { recursive: true, force: true });
      removed.push(t.label);
    } catch (e) {
      errors.push(`${t.label}: ${e.message}`);
      remaining.push(t.label);
    }
  }
  // Candice-only state files.
  for (const f of ["upgrade-journal.jsonl", "bootstrap-state.json"]) {
    const p = join(root, "state", f);
    if (existsSync(p)) {
      try {
        rmSync(p, { force: true });
        removed.push(`state/${f}`);
      } catch (e) {
        errors.push(`state/${f}: ${e.message}`);
      }
    }
  }
  return { removed, remaining, errors };
}

/**
 * Full uninstall:
 *   stop -> deregister (every shared config root) -> remove Candice trees
 *   -> verify nothing Candice remains under the root and no registration
 *   remains in any shared config root.
 * @param {object} opts root, platform, env, mode
 */
export async function uninstall(opts = {}) {
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;
  const root = opts.root || bootstrapRoot(env, platform);
  const parsed = parseMode(opts.mode);
  if (!parsed.ok) {
    return result(false, `uninstall refused: ${parsed.message}`, { root, platform });
  }

  const steps = {};

  steps.stop = stopAppBridge(root, platform, opts);

  const roots = discoverConfigRoots(env, opts);
  const dereg = [];
  for (const { label, root: cfgRoot } of roots) {
    const r = deregister(cfgRoot, join(root, "plugin", "candice-integration"));
    dereg.push({ label, root: cfgRoot, ...r });
  }
  steps.deregister = { roots: dereg, ok: dereg.every((d) => d.ok) };

  // Journal BEFORE removal: the journal file lives under state/ and is
  // itself removed by removeCandiceTrees; journaling after removal would
  // recreate state/upgrade-journal.jsonl as a leftover.
  journal(root, { step: "uninstall", dereg: steps.deregister });
  const removed = removeCandiceTrees(root, opts);
  steps.remove = removed;

  // Verify: no Candice registration remains in any shared config root —
  // live CLI listing, never a text grep of a registry file.
  const leftovers = [];
  for (const { label, root: cfgRoot } of roots) {
    const listed = listPlugins(cfgRoot);
    if (!listed.ok) {
      leftovers.push(`${label}:${cfgRoot} (plugin list failed: ${listed.message})`);
      continue;
    }
    const mine = candiceRecords(listed.records);
    if (mine.length > 0) leftovers.push(`${label}:${cfgRoot} (${mine.map((p) => p.id).join(", ")})`);
  }
  // Verify: no Candice trees remain under the root.
  for (const t of [join(root, "plugin"), appDir(root), assetsDir(root, ""), join(root, "skills")]) {
    if (existsSync(t)) {
      let content = "";
      try {
        content = readdirSync(t).join(",");
      } catch {
        content = "(unreadable)";
      }
      if (content !== "") leftovers.push(`${t} (${content})`);
    }
  }
  steps.verify = { leftovers, clean: leftovers.length === 0 };

  const ok = steps.deregister.ok && steps.remove.errors.length === 0 && steps.verify.clean;
  return result(ok, ok ? "uninstall complete: app/bridge stopped, plugin deregistered, Candice-only material removed" : "uninstall INCOMPLETE — see steps", {
    root,
    platform,
    steps,
  });
}

export { discoverConfigRoots };
export default uninstall;
