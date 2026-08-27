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
 * This lane composes the WS-31 install engine (skills/plugin from the repo
 * checkout; assets from verified records) and the WS-33 engine (download gate,
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
 *   - after a fully authorized successful repair, subsequent invocations are the fast
 *     health/version check only (spec 21 step 7).
 *
 * No commit, no push (builder contract).
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { bootstrapRoot, readState, writeState } from "../candice-bootstrap/state.mjs";
import { skillsDir, pluginDir, appBundlePath, assetsDir } from "../candice-bootstrap/paths.mjs";
import {
  SKILL_PINS,
  PLUGIN_PINS,
  installSkills,
  installPlugin,
  installApp,
  installAssets,
  launchCommand,
  snapshotTarget,
} from "../candice-bootstrap/install.mjs";
import { registerAll, verifyAll, deregisterAll } from "../candice-bootstrap/register-plugin.mjs";
import { parseMode } from "../candice-bootstrap/modes.mjs";
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
  if (it.kind === "app") return null;
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
      // A discovered local bundle has no release-authority provenance. Do not
      // infer its version or treat it as current/reparable.
      installed: null,
      pinned: null,
      present: existsSync(exe),
      blocked: true,
      note: existsSync(exe)
        ? "local app bundle is untrusted; no release-authorized candidate exists"
        : "no release-authorized Candice app candidate exists",
    });
  } else if (platform === "win32") {
    out.push({ kind: "app", id: "candice-companion", installed: null, pinned: null, present: false, blocked: true, note: "no release-authorized Candice app candidate exists" });
  } else {
    out.push({ kind: "app", id: "candice-companion", installed: null, pinned: null, present: false, blocked: true, note: `no release-authorized Candice app candidate exists (${platform})` });
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
    if (it.blocked) {
      skips.push({ ...it, action: "blocked" });
      continue;
    }
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
    return true;
  } catch {
    return false;
  }
}

/**
 * Apply a repair plan against the installed tree.
 * Skills/plugin/integrations come from the repo checkout (spec 21 first hop)
 * through the WS-33 atomic engine; assets go through the WS-33 download gate
 * with SHA-256 verification. App repair is blocked until a future candidate
 * has release authority — never invented (fail closed).
 *
 * FIX-018 mode semantics:
 *   - no mode (legacy callers)          -> best-effort, legacy shapes;
 *     plugin registration is NOT touched (the live config root is never
 *     a silent repair target for mode-less callers),
 *   - release mode                      -> transactional: every target is
 *     snapshotted before mutation, any failure rolls every leg back and
 *     deregisters a half-registered plugin; asset skips are hard failures.
 *     A release rollback aborts the transaction — no later leg re-mutates
 *     after the rollback; the prior known-good state stands,
 *   - non-release modes with an explicit configRoot -> hermetic registration
 *     repair against that root only (never the live ~/.claude).
 */
export async function applyRepairs(root, platform, repairs, opts = {}) {
  const done = [];
  const skipped = [];
  const failed = [];
  const blocked = [];
  const parsed = parseMode(opts.mode);
  const release = parsed.ok && parsed.mode === "release";
  // Registration target policy: release uses live discovery (or the injected
  // configRoot for hermetic release tests); other modes require an explicit
  // configRoot; mode-less legacy callers never register.
  const registrationAllowed = parsed.ok && (release || (opts.configRoot && opts.configRoot.length > 0));
  const env = opts.env || process.env;
  const regOpts = opts.configRoot && opts.configRoot.length > 0 ? { configRoot: opts.configRoot } : {};
  if (opts.claudeBin) regOpts.claudeBin = opts.claudeBin;
  const restores = [];
  // True only when THIS transaction registered the plugin. Rollback must
  // deregister what it registered, never destroy a registration that
  // pre-existed the transaction (prior known-good state includes it).
  const registered = { active: false, verifyPre: null };
  // FIX-018: a release rollback aborts the transaction. Once `hard()`
  // restored the prior known-good state, every later leg block is skipped —
  // nothing re-mutates after a rollback (no partial second attempt).
  let aborted = false;

  const rollbackAll = (reason) => {
    const errors = [];
    // Deregister only what THIS transaction registered. A registration that
    // was already valid before the transaction is prior known-good state —
    // rollback leaves it intact.
    if (registered.active && registered.verifyPre === false) {
      const dr = deregisterAll(env, pluginDir(root), regOpts);
      if (!dr.ok) errors.push(`deregister: ${dr.message}`);
      registered.active = false;
    }
    for (const restore of restores.slice().reverse()) {
      try {
        restore();
      } catch (e) {
        errors.push(e.message);
      }
    }
    return errors;
  };

  const hard = (kind, ids, message) => {
    if (release) {
      const errors = rollbackAll(message);
      aborted = true;
      failed.push({ kind, ids, message: errors.length ? `${message}; rollback errors: ${errors.join("; ")}` : `${message}; transaction rolled back` });
      return true;
    }
    failed.push({ kind, ids, message });
    return false;
  };

  const skillRepairs = repairs.filter((r) => r.kind === "skill");
  const pluginRepairs = repairs.filter((r) => r.kind === "plugin");
  const integrationRepairs = repairs.filter((r) => r.kind === "integration");
  const appRepairs = repairs.filter((r) => r.kind === "app");
  const assetRepairs = repairs.filter((r) => r.kind === "asset");

  if (!aborted && skillRepairs.length > 0) {
    const pin = {};
    for (const r of skillRepairs) pin[r.id] = SKILL_PINS[r.id];
    restores.push(snapshotTarget(root, skillsDir(root), "skills-repair"));
    const r = installSkills(root, pin, opts);
    if (!r.ok) {
      hard("skill", Object.keys(pin), r.message);
    } else {
      for (const [id, rec] of Object.entries(r.installed || {})) {
        done.push({ kind: "skill", id, version: rec.version, action: "repaired" });
        journal(root, { id, kind: "skill", version: rec.version, action: "repaired" });
      }
    }
  }

  if (!aborted && (pluginRepairs.length > 0 || integrationRepairs.length > 0)) {
    // The plugin tree carries integrations/ (WS-37/38/39 implementations). A
    // missing integration inside a present plugin is repaired by re-installing
    // the plugin tree from the repo checkout — the deterministic bundle path
    // (spec 21 step 5).
    restores.push(snapshotTarget(root, pluginDir(root), "plugin-repair"));
    const r = installPlugin(root, PLUGIN_PINS, opts);
    if (!r.ok) {
      const ids = [...pluginRepairs.map((x) => x.id), ...integrationRepairs.map((x) => x.id)];
      hard("plugin", ids, r.message);
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

  // FIX-018: a removed plugin registration is repaired here — detect
  // (verifyAll) then fix (registerAll), never a silent skip in release.
  // This runs whenever registration is allowed, independent of whether the
  // plugin TREE needed repair (a broken registration is a broken install
  // even when the tree is intact).
  if (!aborted && registrationAllowed) {
    // Pre-transaction verification: if registration is ALREADY valid, a
    // later rollback must leave it in place (never deregister what this
    // transaction did not register).
    const v0 = verifyAll(env, pluginDir(root), PLUGIN_PINS["candice-integration"], regOpts);
    registered.verifyPre = v0.ok;
    if (!v0.ok) {
      const reg = registerAll(env, pluginDir(root), PLUGIN_PINS["candice-integration"], regOpts);
      if (!reg.ok) {
        hard("plugin-registration", ["candice-integration"], `registration repair failed: ${reg.message}`);
      } else {
        registered.active = true;
        done.push({ kind: "plugin-registration", id: "candice-integration", action: "repaired" });
        journal(root, { id: "candice-integration", kind: "plugin-registration", action: "repaired" });
      }
    }
  }

  if (!aborted && appRepairs.length > 0) {
    // installApp is mode-gated (FIX-018): a missing mode is itself a refusal.
    // Repair never invents a candidate, so absent a caller mode the app leg
    // runs in test-fixture semantics — always blocked, never copied.
    const r = await installApp(root, platform, { ...opts, mode: opts.mode || "test-fixture" });
    if (!r.ok) {
      if (r.blocked || r.modeRequired) {
        blocked.push({ kind: "app", id: "candice-companion", reason: r.message });
      } else if (r.skipped) {
        skipped.push({ kind: "app", id: "candice-companion", reason: r.message });
      } else {
        const rolled = release;
        hard("app", ["candice-companion"], r.message);
        if (rolled) blocked.push({ kind: "app", id: "candice-companion", reason: `release transaction rolled back: ${r.message}` });
      }
    } else {
      for (const [id, rec] of Object.entries(r.installed || {})) {
        done.push({ kind: "app", id, version: rec.version, action: "repaired" });
        journal(root, { id, kind: "app", version: rec.version, action: "repaired" });
      }
    }
  }

  if (!aborted && assetRepairs.length > 0) {
    restores.push(snapshotTarget(root, assetsDir(root, ""), "assets-repair"));
    // installAssets' mode enum is download|record — a repair mode string
    // ("release") must never fall through to the download path. Offline
    // repairs record registry-verified hashes as markers; online repairs go
    // through the WS-33 download gate.
    const r = await installAssets(root, platform, { ...opts, release, mode: opts.offline ? "record" : "download" });
    if (!r.ok) {
      hard("assets", [], r.message);
    } else {
      // Release mode: an asset skip (no verifiable record) is a hard
      // failure, never a partial success.
      if (release && r.skipped && r.skipped.length > 0) {
        hard("assets", [], `unverifiable asset legs in release mode: ${r.skipped.join("; ")}`);
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
  }

  // The live restore closures (snapshotTarget returns a function, not a
  // disk artifact for absent targets). repair() needs them for post-apply
  // rollbacks (re-probe / state-write / commit-marker failures) — a disk
  // scan of state/staging/pre cannot restore a target that did not exist
  // before the transaction.
  return { done, skipped, failed, blocked, release, aborted, restores };
}

/**
 * Roll back the whole repair transaction after applyRepairs has already
 * returned (FIX-018 re-probe / state-write / commit-marker failures):
 * deregister any half-registered plugin, then run the transaction's live
 * restore closures in reverse order (snapshotTarget returns a closure, not
 * a disk artifact for absent targets — a disk scan cannot restore a target
 * that did not exist before the transaction). Returns the list of rollback
 * errors (empty = prior known-good state restored).
 */
function releaseRollback(root, platform, env, regOpts, restores = []) {
  const errors = [];
  const dr = deregisterAll(env, pluginDir(root), regOpts);
  if (!dr.ok) errors.push(`deregister: ${dr.message}`);
  for (const restore of restores.slice().reverse()) {
    try {
      restore();
    } catch (e) {
      errors.push(e.message);
    }
  }
  return errors;
}

/**
 * Full repair run (spec 21 existing-user flow steps 3-6).
 * @param {object} opts root, platform, env, offline/mode, noAtomic, simulate
 * @returns {{ok, message, root, platform, plan, repair, state}}
 */
export async function repair(opts = {}) {
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;
  const root = opts.root || bootstrapRoot(env, platform);

  // Test seams (hermetic fault injection at every transaction boundary);
  // production callers never pass them.
  const jlog = opts.journal || journal;
  const hc = opts.healthCheck || healthCheck;
  const wstate = opts.writeState || writeState;

  const items = (opts.enumerate || enumerate)(root, platform, opts);
  const { repairs, skips } = planRepairs(items);
  const blocked = skips.filter((item) => item.action === "blocked");

  // Do not repair a subset and then call it a successful Candice repair. The
  // current application is quarantined, so every normal repair fails before
  // any component/state write until a release-authorized candidate exists.
  // RELEASE ONLY: legacy (mode-less) callers keep the base contract — the
  // app leg is reported as a blocked SKIP while skills/plugin/assets still
  // repair and the run succeeds (cross-lane upgrade-journey contract).
  const parsedMode = parseMode(opts.mode);
  const releaseRun = parsedMode.ok && parsedMode.mode === "release";
  if (releaseRun && blocked.length > 0) {
    return result(false, `repair blocked: ${blocked.map((item) => `${item.id} (${item.note})`).join("; ")}`, {
      root,
      platform,
      plan: { repairs, skips },
      repair: { done: [], skipped: [], failed: [], blocked },
    });
  }

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

  // The pre-transaction state document (commit-marker rollback restores it).
  const priorState = readState(root, platform);
  const applied = await applyRepairs(root, platform, repairs, opts);
  const release = applied.release;
  const regOpts = opts.configRoot && opts.configRoot.length > 0 ? { configRoot: opts.configRoot } : {};
  if (opts.claudeBin) regOpts.claudeBin = opts.claudeBin;

  // FIX-018: a release rollback is terminal. The prior known-good state was
  // restored by applyRepairs; nothing here may write state or journal a
  // commit on top of it. The run fails.
  if (release && applied.failed.length > 0) {
    jlog(root, {
      step: "repair.commit",
      ok: false,
      phase: "post-apply",
      reason: `release transaction rolled back: ${applied.failed.map((f) => f.message).join("; ")}`,
    });
    return result(false, `repair failed; transaction rolled back: ${applied.failed.map((f) => f.message).join("; ")}`, {
      root,
      platform,
      plan: { repairs, skips },
      repair: applied,
      state: readState(root, platform),
    });
  }

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

  // FIX-018 re-probe: after a fully authorized successful release repair,
  // the fail-closed health probe re-verifies the installed tree against the
  // PROSPECTIVE state document (the on-disk state is still the pre-repair
  // one until the atomic switch below). Any failing REQUIRED leg fails the
  // run and rolls the whole transaction back — a repair that stages but
  // cannot prove itself healthy is not committed.
  let health = null;
  if (release && applied.failed.length === 0) {
    health = await hc({
      root,
      platform,
      env,
      mode: "release",
      release: true,
      stateOverride: state,
      ...(opts.configRoot ? { configRoot: opts.configRoot } : {}),
      ...(opts.claudeBin ? { claudeBin: opts.claudeBin } : {}),
      ...(opts.probes ? { probes: opts.probes } : {}),
    });
    if (!health.ok) {
      const rollbackErrors = releaseRollback(root, platform, env, regOpts, applied.restores);
      jlog(root, {
        step: "repair.commit",
        ok: false,
        phase: "re-probe",
        reason: `post-repair health probe failed (${(health.missing || []).join(", ")}); transaction rolled back`,
      });
      return result(false, `post-repair health probe failed (${(health.missing || []).join(", ")}); transaction rolled back${rollbackErrors.length ? `; rollback errors: ${rollbackErrors.join("; ")}` : ""}`, {
        root,
        platform,
        plan: { repairs, skips },
        repair: applied,
        health,
        state: readState(root, platform),
      });
    }
  }

  // FIX-018: a state-write failure in release is a transaction failure —
  // the switch is atomic only when the state document lands.
  const wrote = wstate(root, state);
  if (!wrote && release) {
    const rollbackErrors = releaseRollback(root, platform, env, regOpts, applied.restores);
    jlog(root, {
      step: "repair.commit",
      ok: false,
      phase: "state-write",
      reason: `state write failed; transaction rolled back${rollbackErrors.length ? `; rollback errors: ${rollbackErrors.join("; ")}` : ""}`,
    });
    return result(false, `state write failed; transaction rolled back${rollbackErrors.length ? `; rollback errors: ${rollbackErrors.join("; ")}` : ""}`, {
      root,
      platform,
      plan: { repairs, skips },
      repair: applied,
      health,
      state: readState(root, platform),
    });
  }

  // FIX-018 journal commit marker: the transaction is committed only when
  // every step (apply, re-probe, state write) succeeded. A failed commit
  // marker write in release fails the run the same way a state-write
  // failure does.
  const commitOk = jlog(root, {
    step: "repair.commit",
    ok: true,
    repaired: applied.done.map((d) => `${d.kind}:${d.id}`),
    health: health ? { ok: true, missing: [] } : undefined,
  });
  if (!commitOk && release) {
    // Restore the state document too — it was already switched by the
    // state-write step above, and the transaction is not committed.
    if (wstate(root, priorState) === false) {
      // Journal the failure of the failure (best effort); the trees are
      // already restored below.
      jlog(root, {
        step: "repair.commit",
        ok: false,
        phase: "commit-marker",
        reason: "commit marker write failed and the prior state document could not be restored",
      });
    }
    const rollbackErrors = releaseRollback(root, platform, env, regOpts, applied.restores);
    jlog(root, {
      step: "repair.commit",
      ok: false,
      phase: "commit-marker",
      reason: `commit marker write failed; transaction rolled back${rollbackErrors.length ? `; rollback errors: ${rollbackErrors.join("; ")}` : ""}`,
    });
    return result(false, `commit marker write failed; transaction rolled back${rollbackErrors.length ? `; rollback errors: ${rollbackErrors.join("; ")}` : ""}`, {
      root,
      platform,
      plan: { repairs, skips },
      repair: applied,
      health,
      state: readState(root, platform),
    });
  }

  const repaired = applied.done;
  const message =
    repaired.length === 0 && applied.failed.length === 0
      ? "no repairs needed — all release-authorized Candice components current"
      : `repaired ${repaired.length} component(s)${applied.skipped.length ? `; skipped (unverifiable, fail closed): ${applied.skipped.map((s) => s.id).join(", ")}` : ""}${applied.failed.length ? `; FAILED: ${applied.failed.map((f) => `${f.kind} ${(f.ids || []).join(",")}`).join("; ")}` : ""}`;

  return result(applied.failed.length === 0, message, {
    root,
    platform,
    plan: { repairs, skips },
    repair: applied,
    ...(health ? { health } : {}),
    state,
  });
}

export { healthCheck, detect, compareVersions, PUBLISHED_VERSION_URL };
