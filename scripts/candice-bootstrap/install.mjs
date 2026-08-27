#!/usr/bin/env node
/**
 * Candice fresh-install bootstrap — install engine (WS-31, FIX-018).
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
 * FIX-018 mode enum (modes.mjs) gates every invocation BEFORE the first
 * filesystem write:
 *   - `test-fixture` — hermetic tests only; explicit temporary root
 *     required; always prints `NOT_RELEASE_INSTALL`,
 *   - `developer` — repo-checkout install under an explicit test root; the
 *     app leg is allowed only from an internally signed fixture; always
 *     prints `NOT_RELEASE_INSTALL`,
 *   - `release` — production path; a missing/unknown mode or any missing
 *     required leg is a hard failure that rolls back the transaction,
 *     never a `skipped` leg with `ok: true`.
 *
 * In release mode the app record comes ONLY from release-authority output
 * (`scripts/candice-release/status.mjs` + `CONTROL/bundled-components.json`
 * via release-resolver.mjs). A caller-supplied path or custom manifest is
 * rejected. Asset legs resolve by exact (platform, arch) record — never a
 * hardcoded platform — and hashes are re-verified after install, not only
 * on download.
 *
 * Plain `claude` is never touched: no settings.json / .claude.json edits
 * (spec 22 "keep plain claude untouched"). Plugin registration writes only
 * the plugin registry record via register-plugin.mjs.
 *
 * No commit, no push (builder contract).
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  appendFileSync,
  createReadStream,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bootstrapRoot, readState, writeState, STATE_SCHEMA } from "./state.mjs";
import { skillsDir, pluginDir, appBundlePath, appDir, assetsDir } from "./paths.mjs";
import { parseMode, isNonRelease, INTERNAL_SIGNED_FIXTURE } from "./modes.mjs";
import { resolveAppRecord } from "./release-resolver.mjs";
import { registerAll, verifyAll, deregisterAll } from "./register-plugin.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The skills this bootstrap bundles. The SET is pinned here deliberately --
 * adding a skill to the installer is a decision, not something a stray
 * directory under `.claude/skills/` should be able to make.
 */
export const BUNDLED_SKILLS = Object.freeze([
  "nine-router-setup",
  "spec-protocol",
  "kaizen",
  "eli5",
  "bro",
]);

/**
 * Read a bundled skill's own VERSION file.
 *
 * Never throws: an unreadable VERSION yields null, which `checkSkill`
 * reports as a mismatch rather than crashing the installer.
 */
function readBundledSkillVersion(name) {
  try {
    return readFileSync(join(__dirname, "..", "..", ".claude", "skills", name, "VERSION"), "utf8").trim() || null;
  } catch {
    return null;
  }
}

/**
 * Version pins, DERIVED from each skill's own VERSION file rather than
 * copied into a literal here.
 *
 * They used to be hand-maintained, and they drifted: the table said
 * spec-protocol 1.17.0 while the skill in the repository was 1.17.3. Because
 * `installSkills` copies the skill tree verbatim -- VERSION file included --
 * and `checkSkill` compares the installed VERSION against this pin, the
 * mismatch failed the skill-tree health leg on EVERY release install and
 * rolled the whole thing back. A stale number in a table was enough to make
 * the product uninstallable, silently, with no error naming the cause.
 *
 * Deriving costs nothing that mattered. The pin's real job is "the installed
 * copy matches what this repository intends", which is exactly what this
 * still checks: a partial copy, a corrupted tree, or a stale skill left by an
 * earlier install all still mismatch and still fail the leg. What can no
 * longer happen is the source of truth disagreeing with itself.
 *
 * The set is asserted against the registry document by
 * `__tests__/bootstrap.test.mjs`, so adding a skill here without recording it
 * in CONTROL/bundled-components.json fails the suite.
 */
export const SKILL_PINS = Object.freeze(
  Object.fromEntries(BUNDLED_SKILLS.map((name) => [name, readBundledSkillVersion(name)])),
);
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

/** Transaction journal (seeded from the WS-32 upgrade journal). */
export const STATE_JOURNAL = "upgrade-journal.jsonl";

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

function sha256File(path) {
  return new Promise((res, rej) => {
    const h = createHash("sha256");
    const s = createReadStream(path);
    s.on("data", (d) => h.update(d));
    s.on("end", () => res(h.digest("hex")));
    s.on("error", rej);
  });
}

/** Append one journal line; a journal write failure is itself a transaction failure in release mode. */
export function journal(root, entry) {
  const file = join(root, "state", STATE_JOURNAL);
  try {
    mkdirSync(join(root, "state"), { recursive: true });
    appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Snapshot a target tree before mutation so a failing transaction can
 * restore the prior known-good state. Returns a restore function.
 */
export function snapshotTarget(root, target, label) {
  const pre = join(root, "state", "staging", "pre", `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  if (existsSync(target)) {
    mkdirSync(dirname(pre), { recursive: true });
    cpSync(target, pre, { recursive: true });
    return () => {
      rmSync(target, { recursive: true, force: true });
      mkdirSync(dirname(target), { recursive: true });
      cpSync(pre, target, { recursive: true });
      rmSync(pre, { recursive: true, force: true });
    };
  }
  return () => {
    rmSync(target, { recursive: true, force: true });
    if (existsSync(pre)) rmSync(pre, { recursive: true, force: true });
  };
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
    if (opts.companionReady === true) {
      const mcpPath = join(staged, ".mcp.json");
      const mcp = JSON.parse(readFileSync(mcpPath, "utf8"));
      if (!mcp.mcpServers?.candice?.command) {
        return result(false, "plugin stage failed: candice MCP server missing");
      }
      mcp.mcpServers.candice.env = {
        ...(mcp.mcpServers.candice.env || {}),
        CANDICE_COMPANION_READY: "1",
      };
      writeFileSync(mcpPath, `${JSON.stringify(mcp, null, 2)}\n`);
    }
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
 * App installation (FIX-018 mode-aware).
 *
 *   - missing/unknown mode            -> hard failure before any write,
 *   - `release`                       -> record comes ONLY from
 *     release-authority output (release-resolver.mjs); missing/forged/
 *     placeholder records fail closed and roll the transaction back,
 *   - `developer`                     -> app install allowed ONLY from an
 *     internally signed fixture record (opts.appFixture, sha256 verified);
 *     a caller-selected path is never trusted,
 *   - `test-fixture`                  -> always blocked: no app candidate
 *     is ever invented for a fixture run.
 *
 * Never trusts a local caller-supplied `.app` without an immutable
 * manifest, hash/signature, or release-authority proof.
 */
export async function installApp(root, platform, opts = {}) {
  const parsed = parseMode(opts.mode);
  if (!parsed.ok) return result(false, `app install refused: ${parsed.message}`, { modeRequired: true });
  const mode = parsed.mode;

  if (mode === "release") {
    const resolved = resolveAppRecord({
      platform,
      arch: opts.arch,
      ...(opts.manifestPath ? { manifestPath: opts.manifestPath } : {}),
      ...(opts.repoRoot ? { repoRoot: opts.repoRoot } : {}),
      ...(opts.statusScript ? { statusScript: opts.statusScript } : {}),
      ...(opts.authority ? { authority: opts.authority } : {}),
    });
    if (!resolved.ok) {
      // UNAVAILABLE, not corrupt. There is no release-authorized app
      // candidate for this platform yet -- the authority refused, or the
      // manifest carries no record. That is a statement about what has been
      // published, NOT about the integrity of something we were handed, and
      // the two must not be conflated: `installAll` continues past an
      // unavailable app so the skills, plugin and assets still land, but
      // aborts on anything that smells like tampering (see the sha256, size
      // and path-escape checks below, which stay fatal on purpose).
      // PROPAGATE the resolver's judgement; do not assert one here. Only
      // genuine absence (unsupported platform, authority refused, no record,
      // no record for this platform/arch) carries `unavailable`. A record
      // that exists but is malformed -- placeholder checksum, non-https
      // source, missing signature -- does NOT, and still aborts the install
      // below, because that is evidence of tampering rather than of nothing
      // having been published yet.
      const absent = resolved.unavailable === true;
      return result(false, `app install refused: ${resolved.message}`, {
        blocked: true,
        ...(absent ? { unavailable: true, skipped: true } : {}),
      });
    }
    const rec = resolved.record;
    // Expected executable path is root-relative; never allow escapes.
    const exeTarget = resolve(root, rec.executablePath);
    if (!exeTarget.startsWith(resolve(root) + "/") && exeTarget !== resolve(root)) {
      return result(false, `app record executablePath escapes the install root: ${rec.executablePath}`);
    }
    let artifactPath = opts.artifactPath;
    if (!artifactPath) {
      // Release payloads arrive through the operator-controlled channel.
      try {
        const res = await fetch(rec.sourceUrl, { redirect: "follow" });
        if (!res.ok) return result(false, `app artifact download failed: HTTP ${res.status} from ${rec.sourceUrl}`);
        const buf = Buffer.from(await res.arrayBuffer());
        artifactPath = join(root, "state", "staging", "app-artifact");
        mkdirSync(dirname(artifactPath), { recursive: true });
        writeFileSync(artifactPath, buf);
      } catch (e) {
        return result(false, `app artifact download failed: ${e.message}`);
      }
    }
    if (!existsSync(artifactPath)) return result(false, "app artifact missing after staging");
    const actual = await sha256File(artifactPath);
    if (actual !== rec.sha256) {
      return result(false, `app artifact sha256 mismatch: got ${actual}, expected ${rec.sha256}`);
    }
    const size = statSync(artifactPath).size;
    if (size !== rec.sizeBytes) {
      return result(false, `app artifact size mismatch: got ${size}, expected ${rec.sizeBytes}`);
    }
    // Signing/notarization posture is recorded from the authority, never
    // re-verified locally: codesign/notarization evidence is FIX-022-owned.
    mkdirSync(dirname(exeTarget), { recursive: true });
    cpSync(artifactPath, exeTarget);
    return result(true, `app installed from release-authorized record ${rec.version}`, {
      installed: { "candice-companion": { id: "candice-companion", version: rec.version, kind: "app", status: "installed" } },
      provenance: {
        record: {
          id: "candice-companion",
          version: rec.version,
          sourceUrl: rec.sourceUrl,
          sha256: rec.sha256,
          sizeBytes: rec.sizeBytes,
          signature: rec.signature,
          notarization: rec.notarization,
          executablePath: rec.executablePath,
          platform: rec.platform,
          arch: rec.arch,
        },
      },
    });
  }

  if (mode === "developer") {
    const fixture = opts.appFixture;
    if (!fixture) {
      return result(false, "no release-authorized Candice app candidate is available; refusing app installation", { blocked: true, unavailable: true, skipped: true });
    }
    if (fixture.signedBy !== INTERNAL_SIGNED_FIXTURE) {
      return result(false, "developer app fixture is not internally signed (signedBy must be scripts/candice-release/status.mjs)", { blocked: true });
    }
    if (!fixture.artifactPath || !fixture.sha256 || !fixture.executablePath) {
      return result(false, "developer app fixture record incomplete (artifactPath/sha256/executablePath required)", { blocked: true });
    }
    if (!existsSync(fixture.artifactPath)) {
      return result(false, `developer app fixture artifact missing: ${fixture.artifactPath}`);
    }
    const actual = await sha256File(fixture.artifactPath);
    if (actual !== fixture.sha256) {
      return result(false, `developer app fixture sha256 mismatch: got ${actual}, expected ${fixture.sha256}`);
    }
    const exeTarget = resolve(root, fixture.executablePath);
    if (!exeTarget.startsWith(resolve(root) + "/")) {
      return result(false, `developer app fixture executablePath escapes the install root: ${fixture.executablePath}`);
    }
    mkdirSync(dirname(exeTarget), { recursive: true });
    cpSync(fixture.artifactPath, exeTarget);
    return result(true, `app installed from internally signed fixture (NOT_RELEASE_INSTALL)`, {
      installed: { "candice-companion": { id: "candice-companion", version: fixture.version || "fixture", kind: "app", status: "installed" } },
      provenance: {
        record: {
          id: "candice-companion",
          version: fixture.version || "fixture",
          sourceUrl: "internal-fixture",
          sha256: fixture.sha256,
          sizeBytes: fixture.sizeBytes || null,
          signature: "internal-fixture",
          notarization: "none",
          executablePath: fixture.executablePath,
          platform,
          arch: opts.arch || "fixture",
        },
      },
    });
  }

  // test-fixture (or any other validated future non-release mode):
  // never invent an app candidate.
  return result(false, "no release-authorized Candice app candidate is available; refusing app installation", { blocked: true, unavailable: true, skipped: true });
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
 * Install pinned STT/TTS assets, resolved by EXACT (platform, arch) record —
 * never a hardcoded platform (FIX-018: the old darwin-on-win32 bug).
 *
 * mode "download": each payload goes through the WS-33 download gate
 *   (sha256 + size verified against the registry before the file lands)
 *   AND is re-hashed after install (hash-after-install, not only on
 *   download).
 * mode "record":   no download; writes the registry's verified sha256 as a
 *   record marker (offline/CI mode — the registry hashes were live-verified
 *   2026-08-21 by the WS-33 lane).
 *
 * A leg with no registry record:
 *   - release mode: hard failure (the whole transaction rolls back),
 *   - non-release modes: SKIPPED (fail closed, reported, never ok:true in
 *     the release report).
 */
export async function installAssets(root, platform, opts = {}) {
  const mode = opts.mode || (opts.offline ? "record" : "download");
  const release = opts.release === true;
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

  // Exact (platform, arch) legs — the manifest key is the platform string.
  const legs = [];
  if (platform === "win32") {
    legs.push(["stt-runtime", "stt-assets", "whisper-1.9.2", "win32", sttDir]);
  }
  legs.push(["stt-model", "stt-assets", "whisper-1.9.2", platform, sttDir]);
  legs.push(["tts-model", "tts-assets", "kokoro-model-files-v1.1", "any", ttsDir]);
  legs.push(["tts-voice", "tts-assets", "kokoro-model-files-v1.1", "voicepack", ttsDir]);

  for (const [key, id, version, plat, dir] of legs) {
    const rec = registry.resolveComponent(id, version, plat);
    if (!rec || !rec.payload || !rec.payload.sha256) {
      if (release) {
        return result(false, `asset leg ${key}: no verified registry record for ${id}@${version}@${plat} — release mode hard failure (fail closed)`);
      }
      skipped.push(`${key} (no verified registry record for ${id}@${version}@${plat})`);
      continue;
    }
    const file = rec.payload.file;
    const target = join(dir, file);
    if (mode === "record") {
      try {
        writeFileSync(join(dir, `.record-${file}`), `sha256=${rec.payload.sha256}\nsizeBytes=${rec.payload.sizeBytes}\n`);
      } catch (e) {
        if (release) return result(false, `asset leg ${key}: record write failed: ${e.message} — release mode hard failure`);
        skipped.push(`${key} (record write failed: ${e.message})`);
        continue;
      }
    } else {
      const dl = await runDownloadGate(id, version, plat, target);
      if (!dl.ok) {
        if (release) return result(false, `asset leg ${key}: ${dl.message} — release mode hard failure`);
        skipped.push(`${key} (${dl.message})`);
        continue;
      }
      // Re-verify after install (hash-after-install, not only on download).
      try {
        const actual = await sha256File(target);
        if (actual !== rec.payload.sha256) {
          if (release) return result(false, `asset leg ${key}: post-install sha256 mismatch — release mode hard failure`);
          skipped.push(`${key} (post-install sha256 mismatch)`);
          continue;
        }
        if (rec.payload.sizeBytes > 0 && statSync(target).size !== rec.payload.sizeBytes) {
          if (release) return result(false, `asset leg ${key}: post-install size mismatch — release mode hard failure`);
          skipped.push(`${key} (post-install size mismatch)`);
          continue;
        }
      } catch (e) {
        if (release) return result(false, `asset leg ${key}: post-install verify failed: ${e.message} — release mode hard failure`);
        skipped.push(`${key} (post-install verify failed: ${e.message})`);
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
  if (platform === "win32") {
    // A real path, not prose. This used to return the sentence
    // "candice-companion.exe (placed by NSIS installer, WS-29)", which was
    // then written into `state.launch.command` as though it were a command.
    // Two things read that field -- the `launch-command` health leg
    // (existsSync) and the bridge probe (which spawns it) -- so on the first
    // Windows install that actually carries an app payload, the leg would
    // have failed against a path that is an English sentence and the probe
    // would have tried to execute one.
    //
    // It is latent today only because no Windows app payload is published,
    // and because an unavailable app makes both legs tolerated. That is a
    // reason to fix it now rather than to leave it: the day the payload
    // lands is the day it stops being latent, on the platform with no
    // machine here to catch it.
    //
    // This is the SAME path `checkApp` probes in health.mjs
    // (join(root, "app", "candice-companion.exe")); the two disagreeing was
    // the underlying defect.
    const exe = join(appDir(root), "candice-companion.exe");
    return { ok: existsSync(exe), path: exe };
  }
  return { ok: false, path: "candice-companion" };
}

/**
 * Run the full fresh-install bootstrap (mode-gated, journaled, rollback-capable).
 * @param {object} opts root, platform, env, offline/mode, noAtomic, release, arch,
 *                   authority, appFixture, artifactPath
 * @returns {Promise<{ok:boolean,message:string,root:string,platform:string,mode:string,notReleaseInstall:boolean,skipped:string[],results:object,state?:object,rollback?:object}>}
 */
export async function installAll(opts = {}) {
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;
  const root = opts.root || bootstrapRoot(env, platform);
  const results = {};
  const restores = [];
  const rollback = (reason) => {
    const errors = [];
    for (const restore of restores.slice().reverse()) {
      try {
        restore();
      } catch (e) {
        errors.push(e.message);
      }
    }
    if (errors.length) journal(root, { step: "rollback", reason, errors });
    return { ok: false, restored: errors.length === 0, errors };
  };

  // Mode gate BEFORE any filesystem write (plan gate 2 / acceptance 1).
  const parsed = parseMode(opts.mode);
  if (!parsed.ok) {
    if (opts.mode === undefined) {
      // Legacy programmatic callers (cross-lane regression suites) omit
      // `mode`. They receive the legacy blocked-app result — the same shape
      // the pre-FIX-018 engines returned — plus the mode contract named in
      // the message. Nothing is written.
      const msg =
        "no release-authorized Candice app candidate is available; refusing app installation " +
        `(mode gate: install requires an explicit --mode ${["test-fixture", "developer", "release"].join("|")})`;
      results.app = result(false, msg, { blocked: true, modeRequired: true });
      return finish(root, platform, results, false, msg, [], { mode: parsed.mode, notReleaseInstall: false });
    }
    // Explicit invalid mode string: fail closed through the app leg so the
    // failure names the mode contract; nothing is written (installApp
    // validates before writing).
    const appR = await installApp(root, platform, { ...opts, mode: opts.mode });
    results.app = appR;
    return finish(root, platform, results, false, `install blocked: ${appR.message}`, [], { mode: parsed.mode, notReleaseInstall: false });
  }
  const mode = parsed.mode;
  const release = mode === "release";
  if (mode === "test-fixture" && !opts.root) {
    return finish(root, platform, results, false, "test-fixture mode requires an explicit --root (temporary root)", [], { mode, notReleaseInstall: true });
  }
  journal(root, { step: "installAll.begin", mode, platform, release });

  // App first (plan: keep the existing ordering; mode validation precedes it).
  // Snapshot BEFORE the install so a failing transaction restores the
  // prior known-good app tree (release transactions never leak a new app).
  restores.push(snapshotTarget(root, appDir(root), "app"));
  const appR = await installApp(root, platform, { ...opts, mode });
  results.app = appR;
  // An app that has not been PUBLISHED yet must not cancel the parts that
  // have. This used to abort the whole install: the app leg runs first, so
  // a missing app record meant the skills, the plugin and the assets were
  // all refused too, and `install` reported failure having written nothing.
  // Installing from the repository therefore installed NOTHING rather than
  // everything -- which is the exact complaint this answers.
  //
  // The distinction is availability versus integrity, and it is not a
  // softening of the gate. `unavailable` is set ONLY where the resolver
  // says no authorized candidate exists. Every check that could indicate
  // tampering -- sha256 mismatch, size mismatch, an executablePath that
  // escapes the root, a failed download -- returns WITHOUT that flag and
  // still aborts here, exactly as before.
  // Scoped to RELEASE deliberately. Release is the mode a client actually
  // installs the repository with, and it is the one where "the app has not
  // been published yet" is a normal, expected state. The non-release modes
  // keep their original fail-closed property -- with no authority they write
  // nothing at all -- because there the absence of a candidate means the
  // caller has not supplied one, not that none exists in the world.
  const appUnavailable = release && !appR.ok && appR.unavailable === true;
  if (!appR.ok && !appUnavailable) {
    journal(root, { step: "installAll.fail", leg: "app", reason: appR.message });
    return finish(root, platform, results, false, `app install failed: ${appR.message}${isNonRelease(mode) ? " — NOT_RELEASE_INSTALL" : ""}`, [], { mode, notReleaseInstall: isNonRelease(mode) });
  }
  if (appUnavailable) {
    journal(root, { step: "app.unavailable", reason: appR.message });
  }
  if (appR.provenance) journal(root, { step: "app.installed", provenance: appR.provenance.record });

  restores.push(snapshotTarget(root, skillsDir(root), "skills"));
  const skillsR = installSkills(root, SKILL_PINS, opts);
  results.skills = skillsR;
  if (!skillsR.ok) {
    const rb = rollback(`skills failed: ${skillsR.message}`);
    return finish(root, platform, results, false, `skills failed: ${skillsR.message}; rollback ${rb.restored ? "restored" : "INCOMPLETE"}`, [], { mode, notReleaseInstall: isNonRelease(mode), rollback: rb });
  }
  journal(root, { step: "skills.installed", count: Object.keys(skillsR.installed || {}).length });

  restores.push(snapshotTarget(root, pluginDir(root), "plugin"));
  // The app leg has already passed. Mark only this provisioned installed copy
  // ready; the repo source remains fail-soft when installed without the app.
  // `companionReady` is a CLAIM about the installed app, so it tracks the
  // app leg rather than being hardcoded true. With no app installed the
  // plugin stays in its fail-soft terminal mode, which it already supports
  // -- the MCP server simply never advertises a companion it cannot reach.
  const pluginR = installPlugin(root, PLUGIN_PINS, { ...opts, companionReady: appR.ok === true });
  results.plugin = pluginR;
  if (!pluginR.ok) {
    const rb = rollback(`plugin failed: ${pluginR.message}`);
    return finish(root, platform, results, false, `plugin failed: ${pluginR.message}; rollback ${rb.restored ? "restored" : "INCOMPLETE"}`, [], { mode, notReleaseInstall: isNonRelease(mode), rollback: rb });
  }
  journal(root, { step: "plugin.installed" });

  // Plugin registration in the shared Claude config root(s) + verification
  // (plan layer 3: registration after atomic install, idempotent, verify
  // exactly one effective registration). Release mode targets the live
  // discovered root (or an injected configRoot for hermetic release tests).
  // Non-release modes must NEVER touch the live config root: an explicit
  // configRoot is required there, and its absence is a hard failure —
  // discovery would otherwise target the live ~/.claude.
  const regOpts = opts.configRoot && opts.configRoot.length > 0 ? { configRoot: opts.configRoot } : {};
  if (opts.claudeBin) regOpts.claudeBin = opts.claudeBin;
  if (!release && !regOpts.configRoot) {
    const rb = rollback("non-release plugin registration refused: no explicit configRoot (live config root is never a fixture target)");
    return finish(root, platform, results, false, "non-release install requires an explicit configRoot for plugin registration; live config root never targeted", [], { mode, notReleaseInstall: isNonRelease(mode), rollback: rb });
  }
  const regR = registerAll(env, pluginDir(root), PLUGIN_PINS["candice-integration"], regOpts);
  results.pluginRegistration = regR;
  if (!regR.ok) {
    await deregisterAll(env, pluginDir(root), regOpts);
    const rb = rollback(`plugin registration failed: ${regR.message}`);
    return finish(root, platform, results, false, `plugin registration failed: ${regR.message}; rollback ${rb.restored ? "restored" : "INCOMPLETE"}`, [], { mode, notReleaseInstall: isNonRelease(mode), rollback: rb });
  }
  const verR = verifyAll(env, pluginDir(root), PLUGIN_PINS["candice-integration"], regOpts);
  results.pluginVerify = verR;
  if (!verR.ok) {
    await deregisterAll(env, pluginDir(root), regOpts);
    const rb = rollback(`plugin verification failed: ${verR.message}`);
    return finish(root, platform, results, false, `plugin verification failed: ${verR.message}; rollback ${rb.restored ? "restored" : "INCOMPLETE"}`, [], { mode, notReleaseInstall: isNonRelease(mode), rollback: rb });
  }
  journal(root, { step: "plugin.registered", roots: (regR.done || []).map((d) => d.root) });

  // installAssets has its own mode enum (download|record): offline means
  // record-only metadata — never a download attempt in an offline run.
  const assetsR = await installAssets(root, platform, { ...opts, mode: opts.offline ? "record" : "download", release });
  results.assets = assetsR;
  if (!assetsR.ok) {
    await deregisterAll(env, pluginDir(root), regOpts);
    const rb = rollback(`assets failed: ${assetsR.message}`);
    return finish(root, platform, results, false, `assets failed: ${assetsR.message}; rollback ${rb.restored ? "restored" : "INCOMPLETE"}`, [], { mode, notReleaseInstall: isNonRelease(mode), rollback: rb });
  }
  journal(root, { step: "assets.installed", count: Object.keys(assetsR.installed || {}).length, skipped: assetsR.skipped || [] });

  // E.1 leg 6 — version/checksum metadata persisted as the installed-tree state.
  const state = readState(root, platform);
  state.components = Object.assign({}, state.components, skillsR.installed || {}, pluginR.installed || {}, appR.installed || {});
  state.assets = Object.assign({}, state.assets, assetsR.installed || {});
  if (appR.provenance) state.appProvenance = appR.provenance;
  const cmd = launchCommand(root, platform);
  state.launch = { command: cmd.path, ok: cmd.ok };
  const wrote = writeState(root, state);
  if (!wrote && release) {
    await deregisterAll(env, pluginDir(root), regOpts);
    const rb = rollback("state write failed");
    return finish(root, platform, results, false, "state write failed; rollback " + (rb.restored ? "restored" : "INCOMPLETE"), [], { mode, notReleaseInstall: false, rollback: rb });
  }
  journal(root, { step: "installAll.commit", stateWrote: wrote });

  const skipped = [];
  if (appR.skipped) skipped.push("app");
  if (assetsR.skipped && assetsR.skipped.length) skipped.push(`assets: ${assetsR.skipped.join("; ")}`);

  if (release) {
    // Every required leg is mandatory and fails closed: probe BEFORE success.
    const { healthCheck } = await import("./health.mjs");
    const health = await healthCheck({ root, platform, env, mode: "release", release: true, configRoot: opts.configRoot });
    results.health = health;
    if (!health.ok) {
      // When the app was never published, the legs that probe THROUGH the
      // app cannot pass, and failing the install on them would put us back
      // where we started: nothing installed because one component does not
      // exist yet. These, and ONLY these, are tolerated -- and only when
      // the app leg reported itself unavailable rather than broken.
      //
      // Every other required leg still gates. A plugin that did not
      // register, a skill tree that did not land, an asset whose hash does
      // not match: all still roll the whole install back, exactly as before.
      // Exactly the legs that cannot pass without an installed app, and no
      // others. Each one either inspects the app binary (app-*,
      // launch-command) or spawns it (bridge-ipc).
      //
      // stt-runtime-capability and tts-runtime-capability were in this list
      // and have been REMOVED: `capabilityProbe` spawns the plugin's MCP
      // SERVER and checks it declares the governed ask_user tool. It never
      // touches the app binary, and both legs pass with no app installed.
      // Forgiving them here would have meant a genuinely broken MCP server
      // going unreported whenever the app happened to be unpublished --
      // which is every install today.
      const APP_DEPENDENT_LEGS = new Set([
        "app-provenance",
        "app-hash",
        "app-executable",
        "app-launch",
        "bridge-ipc",
        "launch-command",
      ]);
      const failedRequired = Object.values(health.legs || {})
        .filter((leg) => leg.classification === "required" && leg.status !== "PASS")
        .map((leg) => leg.leg);
      const blocking = appUnavailable
        ? failedRequired.filter((leg) => !APP_DEPENDENT_LEGS.has(leg))
        : failedRequired;
      if (blocking.length > 0) {
        await deregisterAll(env, pluginDir(root), regOpts);
        const rb = rollback(`release health probes failed: ${blocking.join(", ")}`);
        return finish(root, platform, results, false, `release install failed health probes: ${blocking.join(", ")}; rollback ${rb.restored ? "restored" : "INCOMPLETE"}`, skipped, { mode, notReleaseInstall: false, rollback: rb, state });
      }
      journal(root, { step: "health.appLegsTolerated", legs: failedRequired, reason: "no published app candidate" });
    }
  }

  const message = `bootstrap completed${wrote ? "" : " (state write failed)"}${isNonRelease(mode) ? " — NOT_RELEASE_INSTALL" : ""}${appUnavailable ? " — APP NOT INSTALLED (no published Candice release for this platform yet); skills, plugin and assets are installed and the plugin runs in terminal-answer mode" : ""}${skipped.length ? `; unverifiable legs skipped: ${skipped.join(" | ")}` : ""}`;
  return finish(root, platform, results, true, message, skipped, { mode, notReleaseInstall: isNonRelease(mode), state });
}

function finish(root, platform, results, ok, message, skipped = [], extra = {}) {
  return { ok, message, level: ok ? "info" : "error", root, platform, skipped, results, ...extra };
}

export { bootstrapRoot, STATE_SCHEMA };
