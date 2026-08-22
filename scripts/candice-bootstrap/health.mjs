#!/usr/bin/env node
/**
 * Candice fresh-install bootstrap — fast health/version check (WS-31).
 *
 * Owned glob: `scripts/candice-bootstrap/**` (PROJECT-MANIFEST 9.2 WR-017).
 *
 * Spec 21 step 7: "After successful bootstrap, normal future invocations
 * perform a fast health/version check only." This module compares the
 * installed tree against the version pins and reports, per component:
 *   - present + version match      -> ok
 *   - present + version mismatch   -> stale (needs the upgrade lane, WS-32)
 *   - absent                       -> missing (needs the bootstrap re-run)
 *
 * Never downloads, never writes, never contacts the network.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bootstrapRoot, readState } from "./state.mjs";
import { skillsDir, pluginDir, appBundlePath, assetsDir } from "./paths.mjs";
import { SKILL_PINS, PLUGIN_PINS } from "./install.mjs";

/**
 * @typedef {{
 *   name: string, present: boolean, version?: string|null,
 *   expected: string, ok: boolean, detail?: string
 * }} ComponentHealth
 */

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

/** Health check the installed candice-integration plugin tree. */
export function checkPlugin(root, version) {
  const target = pluginDir(root);
  const present = existsSync(join(target, ".claude-plugin", "plugin.json"));
  return { name: "candice-integration", present, version, expected: version, ok: present };
}

/** Health check the companion app for the current platform. */
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
      detail: "no release-authorized Candice app candidate is available",
    };
  }
  if (platform === "win32") {
    return {
      name: "candice-companion",
      present: false,
      version: null,
      expected: "release-authorized candidate",
      ok: false,
      detail: "no release-authorized Candice app candidate is available",
    };
  }
  return { name: "candice-companion", present: false, ok: false, detail: `unsupported platform ${platform}` };
}

/** Health check pinned STT/TTS assets; a file OR its verified record marker counts present. */
export function checkAssets(root, platform, state) {
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
    const present = existsSync(join(c.dir, c.file)) || existsSync(join(c.dir, `.record-${c.file}`));
    const rec = state && state.assets && Object.values(state.assets).find((a) => a.file === c.file);
    out.push({
      name: c.name,
      present,
      ok: present,
      ...(present ? {} : { detail: rec && rec.status === "recorded" ? `recorded in state (sha256 verified) — payload not downloaded` : "absent" }),
    });
  }
  return out;
}

/**
 * Fast health/version check across every bundled component.
 * @param {object} opts root, platform, env
 * @returns {{ok:boolean,root:string,platform:string,components:ComponentHealth[],assets:object[],missing:string[],stateComponentMatch:boolean,note:string}}
 */
export function healthCheck(opts = {}) {
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;
  const root = opts.root || bootstrapRoot(env, platform);
  const state = readState(root, platform);

  const components = [];
  for (const [name, version] of Object.entries(SKILL_PINS)) components.push(checkSkill(root, name, version));
  components.push(checkPlugin(root, PLUGIN_PINS["candice-integration"]));
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

export default healthCheck;
