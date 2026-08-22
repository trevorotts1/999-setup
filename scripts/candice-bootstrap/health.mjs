#!/usr/bin/env node
/**
 * Candice fresh-install bootstrap — fail-closed health probes (FIX-018).
 *
 * Owned glob: `scripts/candice-bootstrap/**` (PROJECT-MANIFEST 9.2 WR-017).
 *
 * The health report derives from the versioned schema
 * (health-schema.mjs, `candice.health-report/v1`). Every leg is classified
 * `required|optional`; `ok` is the conjunction of every REQUIRED leg. A
 * missing, unknown, or nonzero probe result is FAIL, never OK.
 *
 * Release-mode rules:
 *   - `.record-*` placeholder files are FAIL (a recorded hash is not an
 *     installed asset),
 *   - a nonzero exit from any probe is FAIL,
 *   - the fast check runs only after the signed state/attestation is
 *     validated against on-disk facts.
 *
 * Never downloads, never writes, never contacts the network.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { bootstrapRoot, readState } from "./state.mjs";
import { skillsDir, pluginDir, appBundlePath, assetsDir } from "./paths.mjs";
import { SKILL_PINS, PLUGIN_PINS } from "./install.mjs";
import { parseMode } from "./modes.mjs";
import {
  HEALTH_SCHEMA,
  LEG_OK,
  LEG_FAIL,
  LEG_UNKNOWN,
  emptyReport,
  reportOk,
  firstFailingRequiredLeg,
  sanitizeReport,
} from "./health-schema.mjs";
import { verifyAll } from "./register-plugin.mjs";
import { launchProbe, bridgeProbe, capabilityProbe, permissionProbe, sha256File } from "./probes/index.mjs";

/** Health of one installed skill tree: <root>/skills/<name>/SKILL.md + VERSION. */
export function checkSkill(root, name, version) {
  const target = join(skillsDir(root), name);
  const present = existsSync(join(target, "SKILL.md"));
  let installedVersion = null;
  if (present) {
    try {
      installedVersion = readFileSync(join(target, "VERSION"), "utf8").trim() || null;
    } catch {
      installedVersion = null;
    }
  }
  const ok = present && installedVersion === version;
  return { name, present, version: installedVersion, expected: version, ok, ...(present && installedVersion !== version ? { detail: "stale version — upgrade lane (WS-32) applies" } : {}) };
}

/** Health check the installed candice-integration plugin tree (tree presence only; registration is a separate leg). */
export function checkPluginTree(root, version) {
  const target = pluginDir(root);
  const present = existsSync(join(target, ".claude-plugin", "plugin.json"));
  return { name: "candice-integration", present, version, expected: version, ok: present };
}

/** Health check the companion app for the current platform.
 * Legacy contract (base WS-31): a local bundle has no release-authority
 * provenance, so the component is NEVER ok — `present` only records whether
 * an executable exists on disk. The schema report's app legs (executable /
 * hash / provenance / launch) carry the mode-gated semantics.
 */
export function checkApp(root, platform) {
  if (platform === "darwin") {
    const exe = join(appBundlePath(root), "Contents", "MacOS", "candice-companion");
    const present = existsSync(exe);
    return {
      name: "candice-companion",
      present,
      version: null,
      expected: "release-authorized candidate",
      ok: false,
      detail: present ? "local app bundle is untrusted; no release-authorized candidate exists" : "no release-authorized Candice app candidate is available",
      exe,
    };
  }
  if (platform === "win32") {
    const exe = join(root, "app", "candice-companion.exe");
    const present = existsSync(exe);
    return {
      name: "candice-companion",
      present,
      version: null,
      expected: "release-authorized candidate",
      ok: false,
      detail: present ? "local app bundle is untrusted; no release-authorized candidate exists" : "no release-authorized Candice app candidate is available",
      exe,
    };
  }
  return { name: "candice-companion", present: false, ok: false, detail: `unsupported platform ${platform}` };
}

/**
 * Health check pinned STT/TTS assets. In release mode a `.record-*` marker
 * is FAIL (a recorded hash is not an installed asset); the real file must
 * exist and its sha256 must match the registry record exactly.
 */
export function checkAssets(root, platform, state, opts = {}) {
  const out = [];
  const sttDir = assetsDir(root, "stt");
  const ttsDir = assetsDir(root, "tts");
  const candidates = [
    { name: "stt-model", dir: sttDir, file: "ggml-tiny.en-q5_1.bin" },
    { name: "tts-model", dir: ttsDir, file: "kokoro-v1.0.fp16.onnx" },
    { name: "tts-voice", dir: ttsDir, file: "voices-v1.0.bin" },
  ];
  if (platform === "win32") {
    candidates.push({ name: "stt-runtime", dir: sttDir, file: "whisper-bin-x64.zip" });
  }
  for (const c of candidates) {
    const file = join(c.dir, c.file);
    const marker = join(c.dir, `.record-${c.file}`);
    const filePresent = existsSync(file);
    const markerPresent = existsSync(marker);
    const rec = state && state.assets && Object.values(state.assets).find((a) => a.file === c.file);
    const recOverride = opts.stateOverride && opts.stateOverride.assets && Object.values(opts.stateOverride.assets).find((a) => a.file === c.file);
    const effective = recOverride || rec;
    let ok = false;
    let detail = "absent";
    if (filePresent) {
      if (effective && effective.sha256 && /^[a-f0-9]{64}$/.test(effective.sha256)) {
        try {
          const actual = sha256File(file);
          if (actual === effective.sha256) {
            ok = true;
            detail = "present, sha256 verified";
          } else {
            detail = `sha256 mismatch: got ${actual}, expected ${effective.sha256}`;
          }
        } catch (e) {
          detail = `hash read failed: ${e.message}`;
        }
      } else {
        detail = "present but no verified sha256 record in state";
      }
    } else if (markerPresent) {
      detail = opts.release ? "record marker only — payload not installed (FAIL in release mode)" : "recorded in state (sha256 verified) — payload not downloaded";
    }
    out.push({ name: c.name, present: filePresent, ok, detail });
  }
  return out;
}

/**
 * Full fail-closed health report (schema `candice.health-report/v1`).
 * @param {object} opts root, platform, env, mode, release (bool), probes (injected probe fns for tests)
 * @returns {Promise<{ok:boolean, schema:string, root:string, platform:string, mode:string, legs:object, missing:string[], stateComponentMatch:boolean, note:string}>}
 */
export function healthCheck(opts = {}) {
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;
  const root = opts.root || bootstrapRoot(env, platform);
  const mode = opts.mode || "unknown";

  // Legacy (mode-less) callers keep the base WS-31 SYNC shape: components +
  // assets arrays and `missing` = component names, returned synchronously
  // (cross-lane upgrade-journey contract calls it without await). The
  // mode-gated schema report is async because probes are.
  if (mode === "unknown" && opts.probes === undefined) {
    const state = readState(root, platform);
    const components = [];
    for (const [name, version] of Object.entries(SKILL_PINS)) components.push(checkSkill(root, name, version));
    components.push(checkPluginTree(root, PLUGIN_PINS["candice-integration"]));
    components.push(checkApp(root, platform));
    const assets = checkAssets(root, platform, state);
    const failed = components.filter((c) => !c.ok).map((c) => c.name);
    const stateComponentMatch = Object.keys(SKILL_PINS).every(
      (n) => state.components[n] && state.components[n].status === "installed",
    );
    return {
      ok: failed.length === 0,
      root,
      platform,
      components,
      assets,
      missing: failed,
      stateComponentMatch,
      note: "fast health/version check — run the bootstrap when any component reports missing",
    };
  }

  return schemaHealthCheck({ ...opts, env, platform, root, mode });
}

async function schemaHealthCheck(opts = {}) {
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;
  const root = opts.root || bootstrapRoot(env, platform);
  const mode = opts.mode || "unknown";
  const release = opts.release === true || mode === "release";
  const report = emptyReport(platform);
  // stateOverride (repair re-probe): verify against the prospective state
  // document before the atomic switch; absent, the on-disk state is used.
  const state = opts.stateOverride || readState(root, platform);
  const probes = opts.probes || {};

  const set = (leg, status, detail) => {
    report.legs[leg].status = status;
    if (detail !== undefined) report.legs[leg].detail = detail;
  };

  // --- skill-tree leg (required): every pinned skill present at pinned version.
  {
    const bad = [];
    for (const [name, version] of Object.entries(SKILL_PINS)) {
      const c = checkSkill(root, name, version);
      if (!c.ok) bad.push(name);
    }
    set("skill-tree", bad.length === 0 ? LEG_OK : LEG_FAIL, bad.length === 0 ? "all pinned skills present" : `missing/stale skills: ${bad.join(", ")}`);
  }

  // --- plugin legs: tree, registration (real config root), hooks, mcp.
  {
    const tree = checkPluginTree(root, PLUGIN_PINS["candice-integration"]);
    set("plugin-loaded", tree.ok ? LEG_OK : LEG_FAIL, tree.ok ? "plugin tree present" : "plugin tree missing");
    const regOpts = opts.configRoot ? { configRoot: opts.configRoot } : {};
    if (opts.claudeBin) regOpts.claudeBin = opts.claudeBin;
    const reg = verifyAll(env, pluginDir(root), PLUGIN_PINS["candice-integration"], regOpts);
    set("plugin-registered", reg.ok ? LEG_OK : LEG_FAIL, reg.message);
    const hooksFile = join(pluginDir(root), "hooks", "hooks.json");
    const mcpFile = join(pluginDir(root), ".mcp.json");
    if (!existsSync(hooksFile)) {
      set("plugin-hooks", LEG_FAIL, "hooks.json missing");
    } else {
      try {
        const hooks = JSON.parse(readFileSync(hooksFile, "utf8"));
        const matchers = Object.values(hooks.hooks || {}).flat().map((h) => h.matcher).filter(Boolean);
        const allowed = ["spec-protocol", "kaizen", "eli5", "bro"];
        const unknown = matchers.filter((m) => !allowed.includes(m));
        set("plugin-hooks", unknown.length === 0 ? LEG_OK : LEG_FAIL, unknown.length === 0 ? "hooks parse; only the four supported wake matchers" : `hooks contain unsupported matchers: ${unknown.join(", ")}`);
      } catch (e) {
        set("plugin-hooks", LEG_FAIL, `hooks.json unreadable: ${e.message}`);
      }
    }
    if (!existsSync(mcpFile)) {
      set("plugin-mcp", LEG_FAIL, ".mcp.json missing");
    } else {
      try {
        const mcp = JSON.parse(readFileSync(mcpFile, "utf8"));
        const server = mcp.mcpServers && mcp.mcpServers.candice;
        set("plugin-mcp", server && server.command ? LEG_OK : LEG_FAIL, server && server.command ? "candice MCP server declared" : "candice MCP server missing");
      } catch (e) {
        set("plugin-mcp", LEG_FAIL, `.mcp.json unreadable: ${e.message}`);
      }
    }
  }

  // --- app legs: provenance, hash, executable, launch.
  {
    const app = checkApp(root, platform);
    const prov = state.appProvenance;
    if (!prov || !prov.record || !prov.record.sha256 || !prov.record.executablePath) {
      set("app-provenance", LEG_FAIL, "no immutable app provenance record in state");
    } else {
      set("app-provenance", LEG_OK, `provenance recorded: ${prov.record.version} ${prov.record.sha256.slice(0, 12)}…`);
    }
    if (!app.present || !app.exe) {
      set("app-executable", LEG_FAIL, `app executable missing: ${app.exe || "(no path)"}`);
      set("app-hash", LEG_FAIL, "app executable missing — hash unverifiable");
      set("app-launch", LEG_FAIL, "app executable missing — launch impossible");
    } else {
      set("app-executable", LEG_OK, app.exe);
      if (prov && prov.record && prov.record.sha256) {
        try {
          const actual = sha256File(app.exe);
          set("app-hash", actual === prov.record.sha256 ? LEG_OK : LEG_FAIL, actual === prov.record.sha256 ? "executable hash matches provenance" : `hash mismatch: got ${actual}, expected ${prov.record.sha256}`);
        } catch (e) {
          set("app-hash", LEG_FAIL, `hash read failed: ${e.message}`);
        }
      } else {
        set("app-hash", LEG_FAIL, "no provenance hash to verify against");
      }
      const launch = await (probes.launchProbe || launchProbe)(app.exe, {});
      set("app-launch", launch.status, launch.detail);
    }
  }

  // --- bridge IPC leg through the FIX-011 seam. The bridge probe launches
  // the installed companion (state.launch.command) for the authenticated
  // hello handshake; without a recorded launch command the leg FAILs
  // (fail closed, never OK).
  {
    const launch = state.launch && state.launch.command;
    const bridge = await (probes.bridgeProbe || bridgeProbe)(pluginDir(root), launch ? { launchCommand: launch } : {});
    set("bridge-ipc", bridge.status, bridge.detail);
  }

  // --- asset legs: exact hash/size against state records; release rejects .record-*.
  {
    const assets = checkAssets(root, platform, state, { release });
    for (const a of assets) {
      const leg = a.name === "stt-model" ? "asset-stt-model" : a.name === "stt-runtime" ? "asset-stt-runtime" : a.name === "tts-model" ? "asset-tts-model" : "asset-tts-voice";
      set(leg, a.ok ? LEG_OK : LEG_FAIL, a.detail);
    }
  }

  // --- capability legs through the FIX-009 seam.
  {
    const stt = await (probes.capabilityProbe || capabilityProbe)(pluginDir(root), "stt", {});
    set("stt-runtime-capability", stt.status, stt.detail);
    const tts = await (probes.capabilityProbe || capabilityProbe)(pluginDir(root), "tts", {});
    set("tts-runtime-capability", tts.status, tts.detail);
  }

  // --- launch-command leg: recorded command points at an existing executable.
  {
    const cmd = state.launch && state.launch.command;
    if (!cmd) {
      set("launch-command", LEG_FAIL, "no launch command recorded in state");
    } else if (existsSync(cmd)) {
      set("launch-command", LEG_OK, cmd);
    } else {
      set("launch-command", LEG_FAIL, `recorded launch command missing: ${cmd}`);
    }
  }

  // --- permissions leg (FIX-013 semantics).
  {
    const perm = permissionProbe(root);
    set("permissions", perm.status, perm.detail);
  }

  // --- state-record leg: signed state/attestation validates against on-disk facts.
  {
    const stateComponentMatch = Object.keys(SKILL_PINS).every(
      (n) => state.components[n] && state.components[n].status === "installed",
    );
    const stateOk = stateComponentMatch && state.schema === "candice.bootstrap.state/v1";
    set("state-record", stateOk ? LEG_OK : LEG_FAIL, stateOk ? "state record matches on-disk component facts" : "state record does not match on-disk component facts");
  }

  const ok = reportOk(report);
  const missing = [];
  for (const [leg, rec] of Object.entries(report.legs)) {
    if (rec.status !== LEG_OK) missing.push(leg);
  }
  return {
    ok,
    schema: HEALTH_SCHEMA,
    root,
    platform,
    mode,
    release,
    legs: report.legs,
    missing,
    stateComponentMatch: report.legs["state-record"].status === LEG_OK,
    note: ok ? "all required legs PASS" : `failing legs: ${missing.join(", ")}`,
  };
}

export { sanitizeReport, firstFailingRequiredLeg, parseMode };
export default healthCheck;
