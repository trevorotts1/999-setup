#!/usr/bin/env node
/**
 * Candice existing-user upgrade — repair engine (WS-32).
 *
 * Owned glob: `scripts/candice-upgrade/**` (PROJECT-MANIFEST 9.2 WR-017;
 * task-graph snapshot WS-32 owned_paths).
 *
 * Master Spec section 21, "Existing user flow", steps 3-6: after the old
 * Spec Protocol self-updates, "on the next supported skill invocation, the
 * new Spec Protocol/Candice bootstrap checks:
 *   - Candice plugin present/version,
 *   - Candice desktop app present/version,
 *   - speech assets present/version,
 *   - Kaizen/ELI5/Bro integration versions.
 * Missing/stale Candice components are installed/repaired. ... The user does
 * not manually copy files around."
 *
 * This lane composes the WS-31 install engine (skills/plugin/app/assets from
 * the repo checkout + release payloads) and the WS-33 engine (download gate,
 * atomic install + rollback, downgrade gate) — it never re-implements
 * checksumming, atomicity, or payload records. Detection is
 * `scripts/candice-upgrade/detect.mjs`; this module is the repair action.
 *
 * Guarantees (spec 21 updater contract):
 *   - never downgrades an installed component (WS-33 gate semantics),
 *   - never touches ~/.claude settings.json / .claude.json (plain `claude`
 *     untouched), never changes model/provider routing, never changes plain
 *     `claude` into a routed launcher (spec 22 keep-plain-claude rules),
 *   - installs atomically with rollback (WS-33 atomic-install engine),
 *   - back up replaced trees outside Claude config roots (.candice-backups
 *     sibling of each target, engine-owned),
 *   - downloads only operator-controlled payloads with SHA-256 verification
 *     (WS-33 download gate); a payload with no verifiable record is SKIPPED
 *     and reported, never invented (fail closed),
 *   - after successful repair, subsequent invocations are the fast
 *     health/version check only (spec 21 step 7).
 *
 * No commit, no push (builder contract).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bootstrapRoot, readState, writeState } from "../candice-bootstrap/state.mjs";
import { skillsDir, pluginDir, appBundlePath, assetsDir } from "../candice-bootstrap/paths.mjs";
import {
  SKILL_PINS,
  PLUGIN_PINS,
  APP_PINS,
  installSkills,
  installPlugin,
  installApp,
  installAssets,
  launchCommand,
} from "../candice-bootstrap/install.mjs";
import { healthCheck } from "../candice-bootstrap/health.mjs";
import { detect, compareVersions, PUBLISHED_VERSION_URL } from "./detect.mjs";

/** Integration components under the plugin tree (spec 21 step 3d; WS-37/38/39 own the implementations). */
export const INTEGRATION_PINS = {
  kaizen: "1.1.0",
  eli5: "1.1.0",
  bro: "1.1.0",
};

export const STATE_JOURNAL = "upgrade-journal.jsonl";

function result(ok, message, extra = {}) {
  return { ok, message, ...extra };
}

function pinnedVersion(it) {
  if (it.kind === "skill") return SKILL_PINS[it.id];
  if (it.kind === "plugin") return PLUGIN_PINS[it.id];
  if (it.kind === "integration") return INTEGRATION_PINS[it.id];
  if (it.kind === "app") return APP_PINS[it.id];
  if (it.kind === "asset") return it.version || "";
  return "0";
}

/**
 * Enumeration of installed state per pinned component, from the filesystem.
 * version "null" = absent or unreadable (treated as repair-required, never
 * as current).
 */
export function enumerate(root, platform, opts = {}) {
  const base = opts.pluginBase || pluginDir(root);
  const integrationsBase = opts.integrationsBase || join(base, "integrations");
  const out = [];

  for (const [name, version] of Object.entries(SKILL_PINS)) {
    const dir = join(skillsDir(root), name);
    const has = existsSync(join(dir, "SKILL.md"));
    let installed = null;
    if (has) {
      try {
        installed = readFileSync(join(dir, "VERSION"), "utf8").replace(/\s+/g, "");
      } catch {
        installed = null;
      }
    }
    out.push({ kind: "skill", id: name, installed, pinned: version, present: has });
  }

  const pluginHas = existsSync(join(base, ".claude-plugin", "plugin.json"));
  out.push({
    kind: "plugin",
    id: "candice-integration",
    installed: pluginHas ? PLUGIN_PINS["candice-integration"] : null,
    pinned: PLUGIN_PINS["candice-integration"],
    present: pluginHas,
  });

  for (const [name, version] of Object.entries(INTEGRATION_PINS)) {
    const dir = join(integrationsBase, name);
    const has = existsSync(join(dir, "README.md"));
    out.push({ kind: "integration", id: name, installed: has ? version : null, pinned: version, present: has });
  }

  if (platform === "darwin") {
    const exe = join(appBundlePath(root), "Contents", "MacOS", "candice-companion");
    out.push({
      kind: "app",
      id: "candice-companion",
      installed: existsSync(exe) ? APP_PINS["candice-companion"] : null,
      pinned: APP_PINS["candice-companion"],
      present: existsSync(exe),
    });
  } else if (platform === "win32") {
    // Windows app placement is the NSIS installer's write (WS-29). Report
    // the pinned expectation and let the release/installer owner own
    // placement; never fake an app tree.
    out.push({ kind: "app", id: "candice-companion", installed: null, pinned: APP_PINS["candice-companion"], present: false, note: "NSIS installer owns placement (WS-29)" });
  } else {
    out.push({ kind: "app", id: "candice-companion", installed: null, pinned: APP_PINS["candice-companion"], present: false, note: `unsupported platform ${platform}` });
  }

  // Assets: the pinned speech assets (spec 21 step 3c). A file OR its
  // verified record marker counts present (WS-31 health semantics).
  const sttDir = assetsDir(root, "stt");
  const ttsDir = assetsDir(root, "tts");
  const candidates = [
    { id: "stt-model", version: "whisper-1.9.2", dir: sttDir, file: "ggml-tiny.en-q5_1.bin" },
    { id: "tts-model", version: "kokoro-model-files-v1.1", dir: ttsDir, file: "kokoro-v1.0.fp16.onnx" },
    { id: "tts-voice", version: "kokoro-model-files-v1.1", dir: ttsDir, file: "voices-v1.0.bin" },
  ];
  if (platform === "win32") {
    candidates.push({ id: "stt-runtime", version: "whisper-1.9.2", dir: sttDir, file: "whisper-bin-x64.zip" });
  }
  for (const c of candidates) {
    const present = existsSync(join(c.dir, c.file)) || existsSync(join(c.dir, `.record-${c.file}`));
    out.push({ kind: "asset", id: c.id, installed: present ? c.version : null, pinned: c.version, present, file: c.file, version: c.version });
  }

  return out;
}

/**
 * Decision per enumerated component: repair when missing/stale; never
 * downgrade. A component newer than the pin is "ahead" and untouched.
 */
export function planRepairs(items) {
  const repairs = [];
  const skips = [];
  for (const it of items) {
    if (it.installed === null) {
      repairs.push({ ...it, action: "install" });
      continue;
    }
    const cmp = compareVersions(pinnedVersion(it), it.installed);
    if (cmp > 0) {
      repairs.push({ ...it, action: "upgrade" });
      continue;
    }
    skips.push({ ...it, action: cmp < 0 ? "ahead" : "current" });
  }
  return { repairs, skips };
}

function journal(root, entry) {
  const file = join(root, "state", STATE_JOURNAL);
  try {
    mkdirSync(join(root, "state"), { recursive: true });
    appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);
  } catch {
    /* journal failure is non-fatal; the state doc is the authority */
  }
}

/**
 * Apply a repair plan against the installed tree.
 * Skills/plugin/integrations come from the repo checkout (spec 21 first hop)
 * through the WS-33 atomic engine; app + assets go through the WS-33
 * download gate with SHA-256 verification. Any leg whose payload has no
 * verifiable record is SKIPPED and reported — never invented (fail closed).
 */
export async function applyRepairs(root, platform, repairs, opts = {}) {
  const done = [];
  const skipped = [];
  const failed = [];

  const skillRepairs = repairs.filter((r) => r.kind === "skill");
  const pluginRepairs = repairs.filter((r) => r.kind === "plugin");
  const integrationRepairs = repairs.filter((r) => r.kind === "integration");
  const appRepairs = repairs.filter((r) => r.kind === "app");
  const assetRepairs = repairs.filter((r) => r.kind === "asset");

  if (skillRepairs.length > 0) {
    const pin = {};
    for (const r of skillRepairs) pin[r.id] = SKILL_PINS[r.id];
    const r = installSkills(root, pin, opts);
    if (!r.ok) {
      failed.push({ kind: "skill", ids: Object.keys(pin), message: r.message });
    } else {
      for (const [id, rec] of Object.entries(r.installed || {})) {
        done.push({ kind: "skill", id, version: rec.version, action: "repaired" });
        journal(root, { id, kind: "skill", version: rec.version, action: "repaired" });
      }
    }
  }

  if (pluginRepairs.length > 0 || integrationRepairs.length > 0) {
    // The plugin tree carries integrations/ (WS-37/38/39 implementations). A
    // missing integration inside a present plugin is repaired by re-installing
    // the plugin tree from the repo checkout — the deterministic bundle path
    // (spec 21 step 5).
    const r = installPlugin(root, PLUGIN_PINS, opts);
    if (!r.ok) {
      const ids = [...pluginRepairs.map((x) => x.id), ...integrationRepairs.map((x) => x.id)];
      failed.push({ kind: "plugin", ids, message: r.message });
    } else {
      for (const [id, rec] of Object.entries(r.installed || {})) {
        done.push({ kind: "plugin", id, version: rec.version, action: "repaired" });
        journal(root, { id, kind: "plugin", version: rec.version, action: "repaired" });
      }
      for (const ir of integrationRepairs) {
        done.push({ kind: "integration", id: ir.id, version: INTEGRATION_PINS[ir.id], action: "repaired" });
        journal(root, { id: ir.id, kind: "integration", version: INTEGRATION_PINS[ir.id], action: "repaired" });
      }
    }
  }

  if (appRepairs.length > 0) {
    const r = await installApp(root, platform, opts);
    if (!r.ok) {
      if (r.skipped) {
        skipped.push({ kind: "app", id: "candice-companion", reason: r.message });
      } else {
        failed.push({ kind: "app", ids: ["candice-companion"], message: r.message });
      }
    } else {
      for (const [id, rec] of Object.entries(r.installed || {})) {
        done.push({ kind: "app", id, version: rec.version, action: "repaired" });
        journal(root, { id, kind: "app", version: rec.version, action: "repaired" });
      }
    }
  }

  if (assetRepairs.length > 0) {
    const r = await installAssets(root, platform, opts);
    if (!r.ok) {
      failed.push({ kind: "assets", ids: [], message: r.message });
    } else {
      for (const [key, rec] of Object.entries(r.installed || {})) {
        done.push({ kind: "asset", id: key, version: rec.version, file: rec.file || "", sha256: rec.sha256 || "", action: "repaired" });
        journal(root, { id: key, kind: "asset", version: rec.version, file: rec.file || "", sha256: rec.sha256 || "", action: "repaired" });
      }
      for (const sk of r.skipped || []) {
        skipped.push({ kind: "asset", id: "assets", reason: String(sk) });
      }
    }
  }

  return { done, skipped, failed };
}

/**
 * Full repair run (spec 21 existing-user flow steps 3-6).
 * @param {object} opts root, platform, env, offline/mode, noAtomic, appSource, simulate
 * @returns {{ok, message, root, platform, plan, repair, state}}
 */
export async function repair(opts = {}) {
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;
  const root = opts.root || bootstrapRoot(env, platform);

  const items = enumerate(root, platform, opts);
  const { repairs, skips } = planRepairs(items);

  if (opts.simulate) {
    return {
      ok: true,
      simulate: true,
      message: `simulate: ${repairs.length} repair(s) planned, ${skips.length} current/ahead`,
      root,
      platform,
      plan: { repairs, skips },
    };
  }

  const applied = await applyRepairs(root, platform, repairs, opts);

  // Persist the repaired state (version/checksum metadata, E.1 leg 6).
  const state = readState(root, platform);
  for (const d of applied.done) {
    if (d.kind === "skill" || d.kind === "plugin" || d.kind === "app") {
      state.components[d.id] = { id: d.id, version: d.version, kind: d.kind, status: "installed" };
    }
    if (d.kind === "asset") {
      state.assets[d.id] = { id: d.id, version: d.version, file: d.file || "", sha256: d.sha256 || "", status: "installed" };
    }
  }
  const cmd = launchCommand(root, platform);
  state.launch = { command: cmd.path, ok: cmd.ok };
  writeState(root, state);

  const repaired = applied.done;
  const message =
    repaired.length === 0 && applied.failed.length === 0
      ? "no repairs needed — all bundled Candice components current"
      : `repaired ${repaired.length} component(s)${applied.skipped.length ? `; skipped (unverifiable, fail closed): ${applied.skipped.map((s) => s.id).join(", ")}` : ""}${applied.failed.length ? `; FAILED: ${applied.failed.map((f) => `${f.kind} ${(f.ids || []).join(",")}`).join("; ")}` : ""}`;

  return result(applied.failed.length === 0, message, {
    root,
    platform,
    plan: { repairs, skips },
    repair: applied,
    state,
  });
}

export { healthCheck, detect, compareVersions, PUBLISHED_VERSION_URL };
