#!/usr/bin/env node
/**
 * Candice fresh-install bootstrap — install engine (WS-31).
 *
 * Owned glob: `scripts/candice-bootstrap/**` (PROJECT-MANIFEST 9.2 WR-017;
 * task-graph snapshot WS-31 owned_paths).
 *
 * Implements E.1 WS-31 and Master Spec section 22 fresh-install path:
 *   1. current bundled skills,
 *   2. Candice integration plugin,
 *   3. Candice Companion desktop app,
 *   4. pinned local STT/TTS assets,
 *   5. launch/bridge command,
 *   6. version/checksum metadata.
 *
 * "No source compile on the customer machine": skills/plugin are copied from
 * the repo checkout (spec-21 first hop); app and speech assets are installed
 * from the repo checkout. Speech assets use the checksum-verified WS-33
 * gate (download.mjs -> verify.mjs -> atomic-install.mjs). App installation
 * is unavailable until a future candidate is independently release-authorized
 * — never accept a caller-selected bundle (fail closed, WS-33 doctrine).
 *
 * Plain `claude` is never touched: no settings.json / .claude.json edits
 * (spec 22 "keep plain claude untouched"). Visibility into the shared Claude
 * config root is the 9.4 integration owner's AGENT_INSTALL/orchestrator
 * write; this lane proposes only.
 *
 * No commit, no push (builder contract).
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bootstrapRoot, readState, writeState } from "./state.mjs";
import {
  skillsDir,
  pluginDir,
  appBundlePath,
  assetsDir,
} from "./paths.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Version pins mirror the WS-33 registry (0.2.0 stamp 2026-08-21, see CHECKPOINT). */
export const SKILL_PINS = {
  "nine-router-setup": "1.17.0",
  "spec-protocol": "1.17.0",
  kaizen: "1.1.0",
  eli5: "1.1.0",
  bro: "1.1.0",
};
export const PLUGIN_PINS = { "candice-integration": "1.0.0" };
// There is deliberately no app pin until a release-authorized candidate has
// passed the release gate.  A historical version string is not install
// authority.
export const APP_PINS = {};

/** WS-33 subprocess paths — this lane calls them, never re-implements them. */
export const UPDATER_DIR = join(__dirname, "..", "candice-updater");
export const CHECKSUMS_DIR = join(UPDATER_DIR, "checksums");
export const ROLLBACK_DIR = join(UPDATER_DIR, "rollback");
export const ATOMIC_INSTALL = join(ROLLBACK_DIR, "atomic-install.mjs");
export const DOWNLOAD_GATE = join(ROLLBACK_DIR, "download.mjs");
export const VERIFY = join(CHECKSUMS_DIR, "verify.mjs");
export const REGISTRY = join(CHECKSUMS_DIR, "components.mjs");

export function repoPaths() {
  const repo = join(__dirname, "..", "..");
  return {
    repo,
    skills: join(repo, ".claude", "skills"),
    plugin: join(repo, "plugins", "candice-integration"),
  };
}

function result(ok, message, extra = {}) {
  return { ok, message, ...extra };
}

function runNode(args, timeoutMs) {
  return spawnSync("node", args, { encoding: "utf8", timeout: timeoutMs });
}

/** Run the WS-33 atomic install engine (stage -> backup old -> atomic rename -> marker verify). */
export function runAtomic(staged, target, opts = {}) {
  const engine = opts.atomicInstall || ATOMIC_INSTALL;
  const r = runNode([engine, "install", "--from", staged, "--to", target, "--backup-dir", join(target, "..", ".candice-backups")], 120000);
  if (r.error) return result(false, `atomic-install spawn failed: ${r.error.message}`);
  if (r.status !== 0) {
    return result(false, `atomic-install failed (exit ${r.status}): ${(r.stderr || r.stdout || "").trim()}`);
  }
  return result(true, (r.stdout || "").trim());
}

/** Non-atomic tree replace (offline/CI test mode; the atomic engine is exercised by its own suite). */
function replaceTree(staged, target) {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  cpSync(staged, target, { recursive: true });
}

export function skillSourceExists(name) {
  const { skills } = repoPaths();
  return existsSync(join(skills, name, "SKILL.md"));
}

/** Install bundled skills from the repo checkout into <root>/skills (whole-tree copy). */
export function installSkills(root, pins = SKILL_PINS, opts = {}) {
  const { skills } = repoPaths();
  const targetBase = skillsDir(root);
  const stagedBase = join(root, "state", "staging", "skills");
  const installed = {};
  const names = Object.keys(pins);
  for (const name of names) {
    const src = join(skills, name);
    if (!existsSync(src) || !existsSync(join(src, "SKILL.md"))) {
      return result(false, `skill source missing in repo: ${name}`, { name });
    }
    const staged = join(stagedBase, name);
    const target = join(targetBase, name);
    try {
      rmSync(staged, { recursive: true, force: true });
      mkdirSync(dirname(staged), { recursive: true });
      cpSync(src, staged, { recursive: true });
      writeFileSync(join(staged, ".candice-install-ok"), `skill ${name} ${pins[name]}\n`);
    } catch (e) {
      return result(false, `skill stage failed: ${name}: ${e.message}`, { name });
    }
    if (opts.noAtomic) {
      replaceTree(staged, target);
    } else {
      const r = runAtomic(staged, target, opts);
      if (!r.ok) return result(false, `skill install failed: ${name}: ${r.message}`);
    }
    installed[name] = { id: name, version: pins[name], kind: "skill", status: "installed" };
  }
  return result(true, `skills installed: ${names.join(", ")}`, { installed });
}

/** Install the candice-integration plugin from the repo checkout into <root>/plugin/candice-integration. */
export function installPlugin(root, pins = PLUGIN_PINS, opts = {}) {
  const { plugin } = repoPaths();
  const name = "candice-integration";
  const version = pins[name];
  if (!existsSync(join(plugin, ".claude-plugin", "plugin.json"))) {
    return result(false, "plugin source missing in repo (no .claude-plugin/plugin.json)");
  }
  const staged = join(root, "state", "staging", "plugin", name);
  const target = pluginDir(root);
  try {
    rmSync(staged, { recursive: true, force: true });
    mkdirSync(dirname(staged), { recursive: true });
    cpSync(plugin, staged, { recursive: true });
    writeFileSync(join(staged, ".candice-install-ok"), `plugin ${name} ${version}\n`);
  } catch (e) {
    return result(false, `plugin stage failed: ${e.message}`);
  }
  if (opts.noAtomic) {
    replaceTree(staged, target);
  } else {
    const r = runAtomic(staged, target, opts);
    if (!r.ok) return r;
  }
  return result(true, `plugin installed: ${name}@${version}`, {
    installed: { [name]: { id: name, version, kind: "plugin", status: "installed" } },
  });
}

/**
 * Refuse app installation until an independently release-authorized payload
 * path exists.  In particular, this function must never trust a local
 * caller-supplied `.app`; it has no immutable manifest, hash/signature, or
 * release-authority proof.
 */
export function installApp(root, platform, opts = {}) {
  void root;
  void platform;
  void opts;
  return result(false, "no release-authorized Candice app candidate is available; refusing app installation", { blocked: true });
}

/** Load the WS-33 component registry module (source of truth for payloads). */
export async function loadRegistry() {
  try {
    const mod = await import(pathToFileURL(REGISTRY).href);
    return mod;
  } catch {
    return null;
  }
}

/**
 * Install pinned STT/TTS assets.
 * mode "download": each payload goes through the WS-33 download gate
 *   (sha256 + size verified against the registry before the file lands).
 * mode "record":   no download; writes the registry's verified sha256 as a
 *   record marker (offline/CI mode — the registry hashes were live-verified
 *   2026-08-21 by the WS-33 lane).
 * A leg with no registry record is SKIPPED (fail closed).
 */
export async function installAssets(root, platform, opts = {}) {
  const mode = opts.mode || (opts.offline ? "record" : "download");
  const registry = await loadRegistry();
  if (!registry || !registry.resolveComponent) {
    return result(false, "WS-33 registry unreadable — refusing asset install (fail closed)");
  }
  const installed = {};
  const skipped = [];
  const sttDir = assetsDir(root, "stt");
  const ttsDir = assetsDir(root, "tts");
  mkdirSync(sttDir, { recursive: true });
  mkdirSync(ttsDir, { recursive: true });

  const legs = [];
  if (platform === "win32") {
    legs.push(["stt-runtime", "stt-assets", "whisper-1.9.2", "win32", sttDir]);
  }
  legs.push(["stt-model", "stt-assets", "whisper-1.9.2", "darwin", sttDir]);
  legs.push(["tts-model", "tts-assets", "kokoro-model-files-v1.1", "any", ttsDir]);
  legs.push(["tts-voice", "tts-assets", "kokoro-model-files-v1.1", "voicepack", ttsDir]);

  for (const [key, id, version, plat, dir] of legs) {
    const rec = registry.resolveComponent(id, version, plat);
    if (!rec || !rec.payload || !rec.payload.sha256) {
      skipped.push(`${key} (no verified registry record for ${id}@${version}@${plat})`);
      continue;
    }
    const file = rec.payload.file;
    const target = join(dir, file);
    if (mode === "record") {
      try {
        writeFileSync(join(dir, `.record-${file}`), `sha256=${rec.payload.sha256}\nsizeBytes=${rec.payload.sizeBytes}\n`);
      } catch (e) {
        skipped.push(`${key} (record write failed: ${e.message})`);
        continue;
      }
    } else {
      const dl = await runDownloadGate(id, version, plat, target);
      if (!dl.ok) {
        skipped.push(`${key} (${dl.message})`);
        continue;
      }
    }
    installed[key] = { id, version, file, sha256: rec.payload.sha256, status: mode === "record" ? "recorded" : "installed" };
  }

  const skipNote = skipped.length ? `; skipped: ${skipped.join("; ")}` : "";
  return result(true, `assets: ${Object.keys(installed).length} verified${skipNote}`, { installed, skipped });
}

/** Run the WS-33 download gate (sha256 + size + source allow-list enforced inside). */
export async function runDownloadGate(id, version, plat, out) {
  const r = runNode([DOWNLOAD_GATE, "--id", id, "--version", version, "--platform", plat, "--out", out], 300000);
  if (r.error) return result(false, `download gate spawn failed: ${r.error.message}`);
  if (r.status !== 0) {
    return result(false, `download gate failed (exit ${r.status}): ${(r.stderr || r.stdout || "").trim()}`);
  }
  return result(true, (r.stdout || "").trim());
}

/** Launch/bridge command record (E.1 leg 5). */
export function launchCommand(root, platform) {
  if (platform === "darwin") {
    const exe = join(appBundlePath(root), "Contents", "MacOS", "candice-companion");
    return { ok: existsSync(exe), path: exe };
  }
  return { ok: false, path: "candice-companion.exe (placed by NSIS installer, WS-29)" };
}

/**
 * Run the full fresh-install bootstrap.
 * @param {object} opts root, platform, env, offline/mode, noAtomic
 * @returns {Promise<{ok:boolean,message:string,root:string,platform:string,skipped:string[],results:object,state?:object}>}
 */
export async function installAll(opts = {}) {
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;
  const root = opts.root || bootstrapRoot(env, platform);
  const results = {};

  // Stop before creating any installed tree or bootstrap-state record.  A
  // successful bootstrap without an authorized app would falsely imply a
  // releasable installation.
  const appR = installApp(root, platform, opts);
  results.app = appR;
  if (!appR.ok) return finish(root, platform, results, false, `app install blocked: ${appR.message}`);

  const skillsR = installSkills(root, SKILL_PINS, opts);
  results.skills = skillsR;
  if (!skillsR.ok) return finish(root, platform, results, false, `skills failed: ${skillsR.message}`);

  const pluginR = installPlugin(root, PLUGIN_PINS, opts);
  results.plugin = pluginR;
  if (!pluginR.ok) return finish(root, platform, results, false, `plugin failed: ${pluginR.message}`);

  const assetsR = await installAssets(root, platform, opts);
  results.assets = assetsR;
  if (!assetsR.ok) return finish(root, platform, results, false, `assets failed: ${assetsR.message}`);

  // E.1 leg 6 — version/checksum metadata persisted as the installed-tree state.
  const state = readState(root, platform);
  state.components = Object.assign({}, state.components, skillsR.installed || {}, pluginR.installed || {}, appR.installed || {});
  state.assets = Object.assign({}, state.assets, assetsR.installed || {});
  const cmd = launchCommand(root, platform);
  state.launch = { command: cmd.path, ok: cmd.ok };
  const wrote = writeState(root, state);

  const skipped = [];
  if (appR.skipped) skipped.push("app");
  if (assetsR.skipped && assetsR.skipped.length) skipped.push(`assets: ${assetsR.skipped.join("; ")}`);
  const message = skipped.length
    ? `bootstrap completed${wrote ? "" : " (state write failed)"}; unverifiable legs skipped: ${skipped.join(" | ")}`
    : `bootstrap completed${wrote ? "" : " (state write failed)"}: skills, plugin, app, assets, launch metadata`;

  return finish(root, platform, results, true, message, skipped, { state });
}

function finish(root, platform, results, ok, message, skipped = [], extra = {}) {
  return { ok, message, level: ok ? "info" : "error", root, platform, skipped, results, ...extra };
}

export { bootstrapRoot };
