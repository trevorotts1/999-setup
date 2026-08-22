#!/usr/bin/env node
/**
 * Candice plugin registration adapter (FIX-018 layer 3).
 *
 * Owned glob: `scripts/candice-bootstrap/**` (PROJECT-MANIFEST 9.2 WR-017).
 *
 * The single authoritative adapter for registering the candice-integration
 * plugin into the shared Claude config root(s): `register`, `verify`,
 * `deregister` (per-root) plus `registerAll`/`verifyAll`/`deregisterAll`
 * (every discovered shared root).
 *
 * Presence of `.claude-plugin/plugin.json` in the installed tree is NOT
 * registration. Registration is a record the Claude Code CLI itself
 * maintains, and the mechanism below is the only one this lane uses.
 *
 * Mechanism — proven live 2026-08-22 on the operator box with Claude Code
 * CLI 2.1.227 against a temporary CLAUDE_CONFIG_DIR, never a guessed layout:
 *
 *   1. A local directory marketplace is staged next to the installed plugin
 *      tree: `<pluginDir>/../.claude-plugin/marketplace.json` with
 *      `source: "./candice-integration"`.
 *   2. `claude plugin marketplace add <dir> --scope user` registers the
 *      marketplace; `claude plugin install candice-integration@candice-marketplace
 *      --scope user` installs the plugin. Re-install of an already-installed
 *      plugin is a no-op (exit 0, "already installed").
 *   3. `claude plugin list --json` is the verification surface: one record
 *      carrying id, version, scope, enabled, installPath, mcpServers.
 *   4. `claude plugin uninstall <id> --scope user -y` removes a record;
 *      `claude plugin marketplace remove candice-marketplace --scope user`
 *      removes the marketplace record.
 *
 * Why the CLI and never a direct registry write: a hand-written
 * `installed_plugins.json` entry without the matching `settings.json`
 * `enabledPlugins` record is listed by `claude plugin list --json` as
 * `enabled: false` (probe-verified 2026-08-22) — installed but never loaded.
 * The CLI's own mechanism is the only path that produces an enabled,
 * loaded registration, and the CLI owns every settings.json /
 * .claude.json write. This adapter never edits either file itself and
 * never touches routing configuration.
 *
 * Rules (repo rule 10 + spec 22):
 *   - one config root; no separate CLAUDE_CONFIG_DIR for claude-nine; the
 *     same versioned plugin registration is visible to plain `claude` and
 *     `claude-nine` where their configuration is intentionally shared,
 *   - exactly one effective registration, no duplicate/phantom plugin,
 *   - registration repair is idempotent; a broken existing registration
 *     (phantom, disabled, stale, wrong scope) is deregistered and
 *     re-registered,
 *   - deregister removes only candice-integration entries and the
 *     candice marketplace; every other plugin, startup file, and skill is
 *     untouched,
 *   - fail closed: missing CLI, nonzero exit, missing/duplicate/disabled
 *     record, version mismatch, or missing MCP server is a FAIL — never OK.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

export const PLUGIN_NAME = "candice-integration";
export const PLUGIN_MARKETPLACE = "candice-marketplace";
export const PLUGIN_ID = `${PLUGIN_NAME}@${PLUGIN_MARKETPLACE}`;

function result(ok, message, extra = {}) {
  return { ok, message, ...extra };
}

/**
 * Discover the shared Claude config root(s) for this environment.
 * Plain `claude` uses `~/.claude` (or `$CLAUDE_CONFIG_DIR` when set).
 * `claude-nine` reuses the same root (repo rule 10) unless an explicit
 * `CLAUDE_NINE_CONFIG_DIR` points at a second, intentionally shared root.
 * Returns deduplicated [{label, root}] — never a guessed layout.
 */
export function discoverConfigRoots(env = process.env, opts = {}) {
  const roots = [];
  // An explicit config root (hermetic tests / developer installs under a
  // temporary root) overrides every discovery path.
  if (opts.configRoot && opts.configRoot.length > 0) {
    roots.push({ label: "claude", root: opts.configRoot });
    return roots;
  }
  const home = env.HOME || env.USERPROFILE;
  const claudeConfigDir = env.CLAUDE_CONFIG_DIR;
  const primary = claudeConfigDir && claudeConfigDir.length > 0 ? claudeConfigDir : home ? join(home, ".claude") : null;
  if (primary) roots.push({ label: "claude", root: primary });
  const nine = env.CLAUDE_NINE_CONFIG_DIR;
  if (nine && nine.length > 0 && nine !== primary) {
    roots.push({ label: "claude-nine", root: nine });
  }
  return roots;
}

/** Run the Claude Code CLI against one config root. Returns {ok,status,error,stdout,stderr}; never throws. */
export function runClaude(args, opts = {}) {
  const env = { ...process.env, ...(opts.env || {}) };
  if (opts.configRoot) env.CLAUDE_CONFIG_DIR = opts.configRoot;
  const r = spawnSync(opts.claudeBin || "claude", args, {
    encoding: "utf8",
    env,
    timeout: opts.timeoutMs || 120000,
  });
  return {
    ok: !r.error && r.status === 0,
    status: r.status,
    error: r.error,
    stdout: (r.stdout || "").trim(),
    stderr: (r.stderr || "").trim(),
  };
}

/** `claude plugin list --json` — the registration verification surface. */
export function listPlugins(root, opts = {}) {
  const r = runClaude(["plugin", "list", "--json"], { ...opts, configRoot: root });
  if (!r.ok) {
    return result(false, `plugin list failed (exit ${r.status ?? "spawn"}): ${r.error?.message || r.stderr || r.stdout}`);
  }
  try {
    const parsed = JSON.parse(r.stdout);
    if (!Array.isArray(parsed)) {
      return result(false, "plugin list --json returned a non-array payload");
    }
    return result(true, "plugin list ok", { records: parsed });
  } catch {
    return result(false, `plugin list --json unparseable: ${r.stdout.slice(0, 200)}`);
  }
}

/** Every installed record whose id belongs to candice-integration (any marketplace). */
export function candiceRecords(records) {
  return (records || []).filter((p) => p && typeof p.id === "string" && p.id.startsWith(`${PLUGIN_NAME}@`));
}

/** The candice marketplace record from <config>/plugins/known_marketplaces.json, or null. */
export function marketplaceRecord(root) {
  const file = join(root, "plugins", "known_marketplaces.json");
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return (parsed && typeof parsed === "object" && parsed[PLUGIN_MARKETPLACE]) || null;
  } catch {
    return null;
  }
}

/**
 * Stage the local-directory marketplace manifest next to the installed
 * plugin tree: `<installPath>/../.claude-plugin/marketplace.json` with
 * `source: "./candice-integration"`. Idempotent — safe to rewrite on every
 * register. This lane never edits an existing marketplace manifest that is
 * not the candice one.
 */
function writeMarketplaceManifest(installPath, version) {
  const marketplaceDir = dirname(installPath);
  const manifest = {
    name: PLUGIN_MARKETPLACE,
    owner: { name: "BlackCEO" },
    plugins: [
      {
        name: PLUGIN_NAME,
        source: "./candice-integration",
        version,
        description: "Candice — local visual and voice companion for BlackCEO Claude Code skills.",
      },
    ],
  };
  try {
    mkdirSync(join(marketplaceDir, ".claude-plugin"), { recursive: true });
    writeFileSync(join(marketplaceDir, ".claude-plugin", "marketplace.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    return result(true, "marketplace manifest staged", { marketplaceDir });
  } catch (e) {
    return result(false, `marketplace manifest write failed: ${e.message}`);
  }
}

/**
 * Register the plugin into one config root. Idempotent: an existing
 * correct registration is a no-op. A broken existing registration
 * (phantom, disabled, stale, wrong scope) is deregistered first. Uses only
 * the CLI's supported plugin mechanism; never edits settings.json /
 * .claude.json directly.
 */
export function register(root, installPath, version, opts = {}) {
  const cliOpts = { ...opts, configRoot: root };
  if (!installPath || !existsSync(join(installPath, ".claude-plugin", "plugin.json"))) {
    return result(false, "plugin tree missing .claude-plugin/plugin.json — refusing registration", { root });
  }

  const pre = listPlugins(root, cliOpts);
  if (!pre.ok) return result(false, pre.message, { root });
  const mine = candiceRecords(pre.records);

  if (mine.length === 1) {
    const rec = mine[0];
    const manifestOk = installedManifestMatches(installPath, version);
    if (!manifestOk.ok) {
      const dr = deregister(root, installPath, opts);
      if (!dr.ok) return result(false, `registration repair blocked: ${dr.message}`, { root });
      // fall through to fresh registration
    } else if (
      rec.scope === "user" &&
      rec.enabled === true &&
      rec.version === version &&
      rec.mcpServers &&
      rec.mcpServers.candice
    ) {
      return result(true, `already registered at ${installPath} (no-op)`, { changed: false, root });
    } else {
      const dr = deregister(root, installPath, opts);
      if (!dr.ok) {
        return result(false, `existing registration is broken and deregister failed: ${dr.message}`, { root });
      }
      // fall through to fresh registration
    }
  } else if (mine.length > 1) {
    const dr = deregister(root, installPath, opts);
    if (!dr.ok) return result(false, `phantom registrations found and deregister failed: ${dr.message}`, { root });
  }

  const wm = writeMarketplaceManifest(installPath, version);
  if (!wm.ok) return result(false, wm.message, { root });

  const known = marketplaceRecord(root);
  if (!known || (known.source && known.source.path && known.source.path !== wm.marketplaceDir)) {
    if (known) {
      const rm = runClaude(["plugin", "marketplace", "remove", PLUGIN_MARKETPLACE, "--scope", "user"], cliOpts);
      if (!rm.ok) {
        return result(false, `stale marketplace record could not be removed (exit ${rm.status ?? "spawn"}): ${rm.error?.message || rm.stderr || rm.stdout}`, { root });
      }
    }
    const add = runClaude(["plugin", "marketplace", "add", wm.marketplaceDir, "--scope", "user"], cliOpts);
    if (!add.ok) {
      return result(false, `marketplace add failed (exit ${add.status ?? "spawn"}): ${add.error?.message || add.stderr || add.stdout}`, { root });
    }
  }

  const inst = runClaude(["plugin", "install", PLUGIN_ID, "--scope", "user"], cliOpts);
  if (!inst.ok) {
    return result(false, `plugin install failed (exit ${inst.status ?? "spawn"}): ${inst.error?.message || inst.stderr || inst.stdout}`, { root });
  }

  const post = verify(root, installPath, version, opts);
  if (!post.ok) {
    const dr = deregister(root, installPath, opts);
    return result(
      false,
      `post-register verification failed: ${post.message}${dr.ok ? "; registration rolled back" : `; rollback also failed: ${dr.message}`}`,
      { root, changed: true },
    );
  }
  return result(true, post.message, { changed: true, root });
}

/** The installed tree's plugin.json parses with the expected name/version. */
function installedManifestMatches(installPath, version) {
  const manifest = join(installPath, ".claude-plugin", "plugin.json");
  if (!existsSync(manifest)) {
    return result(false, `registered plugin tree has no .claude-plugin/plugin.json at ${installPath}`);
  }
  try {
    const parsed = JSON.parse(readFileSync(manifest, "utf8"));
    if (parsed.name !== PLUGIN_NAME) {
      return result(false, `plugin.json name is ${parsed.name ?? "MISSING"}, expected ${PLUGIN_NAME}`);
    }
    if (parsed.version !== version) {
      return result(false, `plugin.json version is ${parsed.version ?? "MISSING"}, expected ${version}`);
    }
    return result(true, "installed manifest matches");
  } catch (e) {
    return result(false, `plugin.json unreadable: ${e.message}`);
  }
}

/**
 * Verify exactly one effective registration in this root: user-scoped,
 * enabled (loaded by the CLI), version-matched, pointing at a real
 * installed tree whose plugin.json parses, with the candice MCP server
 * present. Zero, duplicate, or phantom entries FAIL. Read-only.
 */
export function verify(root, installPath, version, opts = {}) {
  const listed = listPlugins(root, { ...opts, configRoot: root });
  if (!listed.ok) return result(false, listed.message, { root, count: null });
  const mine = candiceRecords(listed.records);
  if (mine.length === 0) {
    return result(false, `no ${PLUGIN_NAME} registration in ${root}`, { root, count: 0 });
  }
  if (mine.length > 1) {
    return result(false, `${mine.length} ${PLUGIN_NAME} registrations in ${root} — duplicate/phantom plugin`, { root, count: mine.length });
  }
  const rec = mine[0];
  if (rec.scope !== "user") {
    return result(false, `${PLUGIN_NAME} registered in wrong scope ${rec.scope}, expected user`, { root, count: 1 });
  }
  if (rec.enabled !== true) {
    return result(false, `${PLUGIN_NAME} registered but disabled in ${root} — installed but never loaded`, { root, count: 1 });
  }
  if (version && rec.version !== version) {
    return result(false, `${PLUGIN_NAME} version mismatch: registered ${rec.version}, expected ${version}`, { root, count: 1 });
  }
  if (!rec.mcpServers || !rec.mcpServers.candice) {
    return result(false, `${PLUGIN_NAME} registered without the candice MCP server`, { root, count: 1 });
  }
  const manifestOk = installedManifestMatches(installPath, version);
  if (!manifestOk.ok) return result(false, manifestOk.message, { root, count: 1 });
  return result(true, `one effective ${PLUGIN_NAME}@${version} registration at ${installPath} (enabled, MCP present)`, { root, count: 1 });
}

/**
 * Deregister the plugin from one config root. Uninstalls every
 * candice-integration record by its own id (phantoms from other
 * marketplaces included), removes the candice marketplace record, and
 * verifies zero candice records remain. Other plugins, marketplaces,
 * routing configuration, and unrelated skills are untouched.
 * Idempotent: no registration is a no-op success.
 */
export function deregister(root, installPath, opts = {}) {
  void installPath; // uninstall by record id, not by path — phantoms must go too
  const cliOpts = { ...opts, configRoot: root };

  let listed = listPlugins(root, cliOpts);
  if (!listed.ok) return result(false, `cannot inspect registrations: ${listed.message}`, { root });
  let mine = candiceRecords(listed.records);
  let removed = 0;
  let attempts = 0;
  while (mine.length > 0 && attempts < 3) {
    const id = mine[0].id;
    const rm = runClaude(["plugin", "uninstall", id, "--scope", "user", "-y"], cliOpts);
    if (!rm.ok) {
      return result(false, `plugin uninstall failed for ${id} (exit ${rm.status ?? "spawn"}): ${rm.error?.message || rm.stderr || rm.stdout}`, { root, removed });
    }
    removed += 1;
    attempts += 1;
    listed = listPlugins(root, cliOpts);
    if (!listed.ok) return result(false, `post-uninstall verification failed: ${listed.message}`, { root, removed });
    mine = candiceRecords(listed.records);
  }
  if (mine.length > 0) {
    return result(false, `deregister did not converge: ${mine.length} candice records remain`, { root, removed });
  }

  if (marketplaceRecord(root)) {
    const rm = runClaude(["plugin", "marketplace", "remove", PLUGIN_MARKETPLACE, "--scope", "user"], cliOpts);
    if (!rm.ok) {
      return result(false, `marketplace remove failed (exit ${rm.status ?? "spawn"}): ${rm.error?.message || rm.stderr || rm.stdout}`, { root, removed });
    }
  }

  const post = listPlugins(root, cliOpts);
  if (!post.ok) return result(false, `post-deregister verification failed: ${post.message}`, { root, removed });
  const remaining = candiceRecords(post.records);
  if (remaining.length !== 0) {
    return result(false, `${remaining.length} candice records remain after deregister`, { root, removed });
  }
  return result(true, removed > 0 ? `deregistered ${PLUGIN_NAME} from ${root}` : `no ${PLUGIN_NAME} registration in ${root} (nothing to remove)`, {
    changed: removed > 0,
    root,
    removed,
  });
}

/**
 * Register into every discovered shared config root. Fails closed when no
 * config root exists (a registration target must be real, never invented).
 */
export function registerAll(env, installPath, version, opts = {}) {
  const roots = discoverConfigRoots(env, opts);
  if (roots.length === 0) {
    return result(false, "no shared Claude config root discovered — refusing registration (fail closed)");
  }
  const done = [];
  for (const { label, root } of roots) {
    const r = register(root, installPath, version, opts);
    if (!r.ok) return result(false, `registration failed for ${label} (${root}): ${r.message}`, { done });
    done.push({ label, root, ...r });
  }
  return result(true, `registered in ${done.length} shared config root(s)`, { done });
}

/** Verify every discovered shared config root; all must pass. */
export function verifyAll(env, installPath, version, opts = {}) {
  const roots = discoverConfigRoots(env, opts);
  if (roots.length === 0) {
    return result(false, "no shared Claude config root discovered — registration unverifiable (fail closed)");
  }
  const done = [];
  for (const { label, root } of roots) {
    const r = verify(root, installPath, version, opts);
    if (!r.ok) return result(false, `registration invalid for ${label} (${root}): ${r.message}`, { done });
    done.push({ label, root, ...r });
  }
  return result(true, `verified ${done.length} shared config root(s)`, { done });
}

/** Deregister from every discovered shared config root. */
export function deregisterAll(env, installPath, opts = {}) {
  const roots = discoverConfigRoots(env, opts);
  const done = [];
  for (const { label, root } of roots) {
    const r = deregister(root, installPath, opts);
    if (!r.ok) return result(false, `deregistration failed for ${label} (${root}): ${r.message}`, { done });
    done.push({ label, root, ...r });
  }
  return result(true, `deregistered from ${done.length} shared config root(s)`, { done });
}
