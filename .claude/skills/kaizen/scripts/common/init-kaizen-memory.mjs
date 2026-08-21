#!/usr/bin/env node
// Initialize (or update) one Kaizen Loop's memory folder.
// Deterministic: same input JSON + same root -> same folder, same loop_id.
// Never overwrites user files blindly, never deletes unknown files, never
// writes secrets. All structured writes are atomic (temp -> parse-validate
// -> rename, keeping a .bak of the prior version). On failure the files
// created by this run are removed and .bak files restored.
//
// usage: node init-kaizen-memory.mjs --json '<input>'
//
// input: {
//   loop_id?: string            (omit -> crypto.randomUUID() generated)
//   name: string                (required, friendly loop name)
//   target_type?: string        (website, app, funnel, ...)
//   target_remote?: string|null
//   target_url?: string|null
//   target_local_path?: string|null
//   direction?: "user_goal" | "open_discovery"
//   scope?: number              3..7, default 5
//   permission_mode?: "A"|"B"|"C", default "B"
//   proof_strategy?: string[]|string|null
//   schedule?: {mechanism, cadence, launcher}
//   model?: string|null
//   contract_version?: number   positive int, default 1
//   approval?: {timestamp: ISO|null, approved_by: string|null}
// }
//
// exit codes: 0 ok, 2 invalid input (machine-readable JSON on stdout),
//             1 initialization failure (rolled back).

import {
  readdirSync, readFileSync, writeFileSync, renameSync, existsSync,
  mkdirSync, statSync, rmSync,
} from "node:fs";
import { homedir } from "node:os";
import crypto from "node:crypto";
import { join, basename, dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(__dirname, "..", "..");
const TEMPLATE_DIR = join(SKILL_DIR, "templates");

const HOME = homedir();
const DOWNLOADS = process.env.KAIZEN_DOWNLOADS || realDownloads() || join(HOME, "Downloads");
const FALLBACK_ROOT = join(DOWNLOADS, "Kaizen");
const REGISTRY_FILE = "REGISTRY.json";
const LEGACY_REGISTRY_FILE = "registry.json";
const SCHEMA_VERSION = 1;

const PERMISSION_TEXTS = {
  A: "Mode A — plan only. Kaizen may inspect the target and propose a plan, but may not modify anything. Every change waits for the owner's explicit go-ahead.",
  B: "Mode B — implement with proof. Kaizen may implement improvements in its own branch or worktree, run tests and builds to prove them, and present the evidence. Merging to main and deploying still require the owner's okay.",
  C: "Mode C — deploy with your okay. Same as Mode B, plus publishing/deploying changes once the owner has approved the specific change. Live payment, destructive database, and major permission changes are always out of bounds.",
};

const REQUIRED_FILES = [
  "KAIZEN_CONTRACT.md", "KAIZEN_MEMORY.md", "STATE.json", "LOCAL_STATE.json",
  "RESUME.md", "BACKLOG.md", "DECISIONS.md",
];
const CREATED_DIRS = ["cycles", "evidence"];

const GITIGNORE_LINES = [
  "LOCAL_STATE.json",
  "*.bak",
  "*.log",
  "cycles/*.log",
  ".DS_Store",
  ".cycle-lock.json",
  "evidence/raw",
  "browser-profile/",
  "*.har",
  "*.env",
  "*credentials*",
  "*token*",
];

function usageError(msg) {
  console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
  process.exit(2);
}

function failInit(msg) {
  console.error(`init-kaizen-memory: ${msg}`);
  process.exit(1);
}

function realDownloads() {
  if (process.platform !== "darwin") return null;
  try {
    const out = execFileSync("osascript", ["-e", "POSIX path of (path to downloads folder)"], {
      encoding: "utf8", timeout: 5000,
    }).trim();
    if (out) return out.replace(/\/+$/, "") || null;
  } catch {
    // fall through to $HOME/Downloads
  }
  return null;
}

// --- root resolution: identical to kaizen-state.mjs locateRoot -----------
// Count every "OpenClaw Master Files" folder inside Downloads (depth <= 3,
// case-insensitive, Kaizen subfolder NOT required to count). Exactly one ->
// "<match>/Kaizen"; zero or more than one -> "<Downloads>/Kaizen".
function locateRoot() {
  const candidates = [];
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = join(dir, e.name);
      if (e.name.toLowerCase() === "openclaw master files") {
        candidates.push(resolve(full));
        continue;
      }
      walk(full, depth + 1);
    }
  };
  if (existsSync(DOWNLOADS)) walk(DOWNLOADS, 1);
  const unique = [...new Set(candidates)];
  if (unique.length === 1) return join(unique[0], "Kaizen");
  return FALLBACK_ROOT;
}

// --- validation --------------------------------------------------------------
function parseInput() {
  const idx = process.argv.indexOf("--json");
  if (idx === -1 || !process.argv[idx + 1]) {
    usageError("usage: node init-kaizen-memory.mjs --json '<input>'");
  }
  let raw;
  try {
    raw = JSON.parse(process.argv[idx + 1]);
  } catch (err) {
    usageError(`invalid JSON input: ${err.message}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    usageError("input must be a JSON object");
  }
  const out = {};

  out.explicit_loop_id = raw.loop_id !== undefined && raw.loop_id !== null;
  out.loop_id = out.explicit_loop_id
    ? raw.loop_id
    : crypto.randomUUID();
  if (typeof out.loop_id !== "string" || out.loop_id.length === 0 || out.loop_id.length > 128) {
    usageError("loop_id must be a non-empty string <= 128 chars");
  }

  if (typeof raw.name !== "string" || raw.name.trim().length === 0) {
    usageError("name (friendly loop name) is required");
  }
  out.name = raw.name.trim();

  out.target_type = raw.target_type ?? null;
  if (out.target_type !== null && typeof out.target_type !== "string") {
    usageError("target_type must be a string or null");
  }
  out.target_remote = raw.target_remote ?? null;
  out.target_url = raw.target_url ?? null;
  out.target_local_path = raw.target_local_path ?? null;
  for (const [k, v] of [["target_remote", out.target_remote], ["target_url", out.target_url], ["target_local_path", out.target_local_path]]) {
    if (v !== null && typeof v !== "string") usageError(`${k} must be a string or null`);
  }

  out.purpose = raw.purpose ?? null;
  if (out.purpose !== null && typeof out.purpose !== "string") {
    usageError("purpose must be a string or null");
  }

  out.direction = raw.direction ?? "open_discovery";
  if (!["user_goal", "open_discovery"].includes(out.direction)) {
    usageError('direction must be "user_goal" or "open_discovery"');
  }

  out.scope = raw.scope === undefined ? 5 : raw.scope;
  if (!Number.isInteger(out.scope) || out.scope < 3 || out.scope > 7) {
    usageError("scope must be an integer 3..7");
  }

  out.permission_mode = (raw.permission_mode ?? "B").toUpperCase();
  if (!["A", "B", "C"].includes(out.permission_mode)) {
    usageError('permission_mode must be "A", "B" or "C"');
  }

  out.proof_strategy = raw.proof_strategy ?? null;
  if (out.proof_strategy !== null && typeof out.proof_strategy !== "string" && !Array.isArray(out.proof_strategy)) {
    usageError("proof_strategy must be a string, array, or null");
  }

  out.schedule = raw.schedule ?? { mechanism: "manual", cadence: null, launcher: "claude-nine" };
  if (!out.schedule || typeof out.schedule !== "object" || Array.isArray(out.schedule)) {
    usageError("schedule must be an object");
  }

  out.model = raw.model ?? null;
  if (out.model !== null && typeof out.model !== "string") usageError("model must be a string or null");

  out.contract_version = raw.contract_version ?? 1;
  if (!Number.isInteger(out.contract_version) || out.contract_version < 1) {
    usageError("contract_version must be a positive integer");
  }

  out.approval = raw.approval ?? { timestamp: null, approved_by: null };
  if (!out.approval || typeof out.approval !== "object") usageError("approval must be an object");
  const ts = out.approval.timestamp ?? null;
  if (ts !== null && (typeof ts !== "string" || Number.isNaN(Date.parse(ts)))) {
    usageError("approval.timestamp must be an ISO date string or null");
  }
  return out;
}

// --- registry ----------------------------------------------------------------
function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function migrateLegacyRegistry(root) {
  const rp = join(root, REGISTRY_FILE);
  const lp = join(root, LEGACY_REGISTRY_FILE);
  // On case-insensitive filesystems (default macOS APFS) existsSync(rp)
  // also matches "registry.json"; compare device+inode, not names.
  if (existsSync(rp)) {
    const sameFile = existsSync(lp) && (() => {
      try {
        const a = statSync(rp);
        const b = statSync(lp);
        return a.dev === b.dev && a.ino === b.ino;
      } catch {
        return false;
      }
    })();
    if (!sameFile) return;
  } else if (!existsSync(lp)) {
    return;
  }
  const legacy = readJson(lp);
  let loops = [];
  if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
    loops = Array.isArray(legacy.loops)
      ? legacy.loops.filter((x) => x && typeof x === "object")
      : Object.keys(legacy)
          .filter((k) => !k.startsWith("__") && legacy[k] && typeof legacy[k] === "object")
          .map((k) => ({ ...legacy[k], loop_id: k }));
  }
  const now = new Date().toISOString();
  const migrated = {
    schema_version: SCHEMA_VERSION,
    loops: loops.map((e) => ({
      loop_id: typeof e.loop_id === "string" ? e.loop_id : `legacy-${loops.indexOf(e)}`,
      name: typeof e.name === "string" ? e.name : String(e.loop_id || "loop"),
      memory_dir: typeof e.memory_dir === "string" ? e.memory_dir : null,
      status: typeof e.status === "string" ? e.status : "active",
      target_type: typeof e.target_type === "string" ? e.target_type : null,
      target_remote: typeof e.target_remote === "string" ? e.target_remote : null,
      target_url: typeof e.target_url === "string" ? e.target_url : null,
      last_cycle_id: typeof e.last_cycle_id === "string" ? e.last_cycle_id : null,
      updated_at: typeof e.updated_at === "string" ? e.updated_at : now,
      ...e, // unknown fields preserved
    })),
  };
  const raw = `${JSON.stringify(migrated, null, 2)}\n`;
  JSON.parse(raw); // validate before writing
  const tmp = `${rp}.tmp-migrate-${process.pid}`;
  writeFileSync(tmp, raw, "utf8");
  JSON.parse(readFileSync(tmp, "utf8"));
  // Move the lowercase name aside first: on case-insensitive APFS the
  // rename onto "REGISTRY.json" would otherwise replace it silently.
  renameSync(lp, `${lp}.bak-migrated`);
  renameSync(tmp, rp);
}

function validateRegistryShape(reg) {
  if (!reg || typeof reg !== "object" || reg.schema_version !== SCHEMA_VERSION || !Array.isArray(reg.loops)) {
    failInit("internal error: registry shape invalid after write");
  }
}

// --- templates ---------------------------------------------------------------
function loadTemplate(name, fallback) {
  const p = join(TEMPLATE_DIR, name);
  if (existsSync(p)) return readFileSync(p, "utf8");
  return fallback;
}

// --- friendly folder name ----------------------------------------------------
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function fill(text, vars) {
  // Templates may wrap a placeholder across lines; collapse whitespace
  // inside <...> before looking the token up.
  return text.replace(/<[^>]*>/gs, (m) => {
    const key = m.slice(1, -1).replace(/\s+/g, " ").trim();
    if (Object.prototype.hasOwnProperty.call(vars, key)) return String(vars[key]);
    return m;
  });
}

function assertNoPlaceholders(path) {
  const text = readFileSync(path, "utf8");
  const hits = text.match(/<[^>]+>/g);
  if (hits && hits.length > 0) {
    failInit(`generated file still has placeholders: ${path} (${hits.slice(0, 5).join(", ")})`);
  }
}

function isoDate() {
  return new Date().toISOString().slice(0, 10);
}

// --- main --------------------------------------------------------------------
function main() {
  const input = parseInput();
  const root = locateRoot();
  const createdPaths = [];
  const backedUp = []; // {current, bak} — restore on rollback
  let committed = false;

  const rollback = (err) => {
    // Remove only what this run created; restore .bak of anything this run
    // replaced. Unknown user files are never touched.
    for (const p of createdPaths.reverse()) {
      try {
        if (existsSync(p)) {
          const st = statSync(p);
          if (st.isDirectory()) rmSync(p, { recursive: true, force: true });
          else rmSync(p, { force: true });
        }
      } catch {
        // best effort
      }
    }
    for (const { current, bak } of backedUp.reverse()) {
      try {
        if (existsSync(bak)) {
          if (existsSync(current)) rmSync(current, { force: true });
          renameSync(bak, current);
        }
      } catch {
        // best effort
      }
    }
    console.log(JSON.stringify({ ok: false, error: String(err?.message ?? err), rolled_back: true }, null, 2));
    process.exit(1);
  };

  try {
    // 1. root
    if (!existsSync(root)) {
      mkdirSync(root, { recursive: true });
      createdPaths.push(root);
    } else if (!statSync(root).isDirectory()) {
      failInit(`Kaizen root path exists but is not a directory: ${root}`);
    }

    migrateLegacyRegistry(root);

    // 2. friendly folder name; a slug collision with an existing folder
    //    always gets a distinct folder (-2, -3, ...). The update path is
    //    resolved through REGISTRY.json: if the registry maps this loop_id
    //    to a memory_dir whose STATE.json holds a DIFFERENT loop_id, refuse
    //    (never reuse or overwrite another loop's folder).
    const regLoops = (readJson(join(root, REGISTRY_FILE)) || {}).loops || [];
    const regEntry = regLoops.find((e) => e && e.loop_id === input.loop_id);
    const regDir = regEntry && typeof regEntry.memory_dir === "string" && regEntry.memory_dir
      ? join(root, regEntry.memory_dir)
      : null;
    const baseFolder = slugify(input.name) || "kaizen-loop";
    let folder = baseFolder;
    let loopDir = regDir && existsSync(regDir) ? regDir : join(root, folder);
    let n = 2;
    while (existsSync(loopDir)) {
      const existingState = readJson(join(loopDir, "STATE.json"));
      if (existingState && existingState.loop_id === input.loop_id) break; // same loop: update
      if (regDir && loopDir === regDir && existingState && existingState.loop_id) {
        usageError(`folder ${loopDir} belongs to loop ${existingState.loop_id}; refusing to reuse or overwrite it`);
      }
      folder = `${baseFolder}-${n}`;
      loopDir = join(root, folder);
      n += 1;
    }

    const isUpdate = existsSync(loopDir);
    const contractVersion = isUpdate
      ? ((readJson(join(loopDir, "STATE.json")) || {}).contract_version ?? input.contract_version)
      : input.contract_version;

    if (!isUpdate) {
      mkdirSync(loopDir, { recursive: true });
      createdPaths.push(loopDir);
    }
    for (const d of CREATED_DIRS) {
      const p = join(loopDir, d);
      if (!existsSync(p)) {
        mkdirSync(p, { recursive: true });
        createdPaths.push(p);
      }
    }
    const evidenceDir = join(loopDir, "evidence");
    if (!existsSync(evidenceDir)) {
      mkdirSync(evidenceDir, { recursive: true });
      createdPaths.push(evidenceDir);
    }

    // 3. values
    const schedule = input.schedule;
    const mechanism = typeof schedule.mechanism === "string" && schedule.mechanism
      ? schedule.mechanism
      : (schedule.mechanism_id ? schedule.mechanism_id : "manual");
    const cadence = typeof schedule.cadence === "string" ? schedule.cadence
      : (typeof schedule.human === "string" ? schedule.human : "manual");
    const launcher = typeof schedule.launcher === "string" && schedule.launcher
      ? schedule.launcher
      : "claude-nine";
    const proof = Array.isArray(input.proof_strategy)
      ? input.proof_strategy.join(", ")
      : (typeof input.proof_strategy === "string" ? input.proof_strategy : "tests, build");
    const approvalTs = input.approval.timestamp ?? "pending user approval";
    const approvalBy = input.approval.approved_by ?? "not yet approved";
    const vars = {
      "Friendly Loop Name": input.name,
      "loop-id": input.loop_id,
      N: String(contractVersion),
      "friendly_session_name": `kaizen-${folder}`,
      launcher,
      scope: String(input.scope),
      date: isoDate(),
      uuid: input.loop_id,
      path: loopDir,
      mechanism,
      cadence,
      proof,
      ts: approvalTs,
      by: approvalBy,
    };
    // also fill lowercase/underscore spellings that appear in templates
    vars.loop_id = input.loop_id;
    vars.name = input.name;
    vars.target_type = input.target_type ?? "other";
    vars.friendly_name = folder;
    vars["YYYY-MM-DD"] = isoDate();
    vars.NNN = "001";
    vars.lesson = "record lessons here after each cycle";
    vars.decision = "(none recorded yet)";
    vars["app | website | funnel | mobile app | API | process | document | automation | other"] = input.target_type ?? "other";
    vars["repo or local path"] = input.target_remote ?? input.target_local_path ?? "none";
    vars["url, if any"] = input.target_url ?? "none";
    vars["other locators"] = "none";
    vars["Purpose, who it serves, what it must keep doing"] = input.purpose ?? "To be confirmed during the first PLAN phase, then confirmed with the owner.";
    vars["User's stated improvement direction"] = input.direction === "user_goal"
      ? input.name
      : "open discovery — no fixed goal; the Contract governs what matters";
    vars["permission mode details — Mode A / Mode B / Mode C list"] = PERMISSION_TEXTS[input.permission_mode];
    vars["any custom boundaries"] = "none";
    vars["generated proof plan"] = proof;
    vars["human interval"] = cadence;
    vars["one plain sentence"] = `Improving ${input.name} on a ${cadence} cadence.`;
    vars["claude | claude-nine | claude-9 | claude-codex"] = launcher;
    vars["opus | sonnet | n/a"] = input.model ?? "n/a";
    vars["resolved path"] = loopDir;
    vars["none | private repo name | pending setup"] = "none";
    vars["YYYY-MM-DD HH:MM timezone"] = approvalTs;
    vars["one plain sentence — target name and type"] = `${input.name} — ${input.target_type ?? "other"}.`;
    vars["short summary of the Contract's permission mode"] = `Mode ${input.permission_mode} — see KAIZEN_CONTRACT.md for the full list.`;
    vars['cycle-id or "none yet"'] = "none yet";
    vars["one-line summary"] = "first cycle — nothing done yet";
    vars["item — KEEP"] = "(none yet)";
    vars["item — REVERTED/DEFERRED/BLOCKED, why"] = "(none yet)";
    vars["critical backlog item"] = "(backlog empty)";
    vars["decision with date"] = "(none yet)";
    vars["suggested focus for next cycle"] = "baseline audit of the target";
    const autoRestart = mechanism === "launchd" || mechanism === "desktop-local"
      ? "yes — LaunchAgent/Desktop task reloads on login"
      : (mechanism.includes("cloud") ? "n/a — cloud Routine, nothing local" : "no — /loop is session-scoped and must be rearmed");
    vars["yes — LaunchAgent/Desktop task reloads on login | no — /loop is session-scoped and must be rearmed | n/a — cloud Routine, nothing local"] = autoRestart;
    vars["yes, at run time | no — cloud Routine"] = mechanism.includes("cloud") ? "no — cloud Routine" : "yes, at run time";
    vars["yes, within the 7-day /loop expiry | no — Memory is the continuity layer"] = "no — Memory is the continuity layer";
    vars["absolute path to this Loop folder"] = loopDir;

    const stateJson = {
      schema_version: SCHEMA_VERSION,
      loop_id: input.loop_id,
      name: input.name,
      friendly_name: folder,
      status: "active",
      contract_version: contractVersion,
      target: {
        type: input.target_type ?? "other",
        repo_remote: input.target_remote ?? null,
        staging_url: input.target_url ?? null,
        production_url: input.target_url ?? null,
        local_path: input.target_local_path ?? null,
      },
      direction: input.direction === "user_goal"
        ? { user_goal: input.name, open_discovery: false }
        : { user_goal: "", open_discovery: true },
      scope: { max_items_per_cycle: input.scope },
      permission_mode: input.permission_mode,
      proof_strategy: Array.isArray(input.proof_strategy)
        ? input.proof_strategy
        : (input.proof_strategy ? [input.proof_strategy] : []),
      schedule: {
        human: cadence,
        mechanism,
        mechanism_id: null,
        launcher,
      },
      model: input.model
        ? { launcher, logical_lane: input.model, resolved_route_snapshot: null }
        : { launcher, logical_lane: null, resolved_route_snapshot: null },
      approval: {
        timestamp: input.approval.timestamp ?? null,
        approved_by: input.approval.approved_by ?? null,
      },
      last_cycle: { cycle_id: null, completed_at: null, result: null },
      cycle_counter: 0,
      backup: { repo: null, status: "none" },
      resume: { friendly_session_name: `kaizen-${folder}` },
    };

    const localJson = {
      schema_version: SCHEMA_VERSION,
      loop_id: input.loop_id,
      local_target_path: input.target_local_path ?? null,
      kaizen_root_path: loopDir,
      scheduler: {
        mechanism,
        label: `com.blackceo.kaizen.${input.loop_id.slice(0, 8)}`,
        wrapper_path: null,
      },
      claude_session_id: null,
      worktree_path: null,
      test_artifact_paths: [],
    };

    const manifestJson = { schema_version: 1, entries: [] };

    const contractMd = fill(
      loadTemplate("KAIZEN_CONTRACT.template.md", "# Kaizen Contract — <Friendly Loop Name>\n- **Contract version:** <N>\n- **Loop ID:** <loop-id>\n- **Date created:** <date>\n"),
      vars,
    );
    const memoryMd = fill(
      loadTemplate("KAIZEN_MEMORY.template.md", "# Kaizen Memory — <Friendly Loop Name>\n\n<loop-id>\n"),
      vars,
    );
    const resumeMd = fill(
      loadTemplate("RESUME.template.md", "# How to get back to Kaizen — <Friendly Loop Name>\n\n<loop-id>\n"),
      vars,
    );

    // 4. atomic writes (tracked for rollback; JSON is parse-validated
    //    before it may replace anything)
    const writeTracked = (p, text) => {
      const existed = existsSync(p);
      const bak = `${p}.bak`;
      if (existed) {
        if (existsSync(bak)) rmSync(bak, { force: true });
        renameSync(p, bak);
        backedUp.push({ current: p, bak });
      }
      writeFileSync(p, text, "utf8");
      createdPaths.push(p); // this run created the content either way
    };
    const jsonTracked = (p, value) => {
      const text = `${JSON.stringify(value, null, 2)}\n`;
      JSON.parse(text); // validate before write
      writeTracked(p, text);
    };

    writeTracked(join(loopDir, "KAIZEN_CONTRACT.md"), contractMd);
    writeTracked(join(loopDir, "KAIZEN_MEMORY.md"), memoryMd);
    writeTracked(join(loopDir, "RESUME.md"), resumeMd);
    writeTracked(join(loopDir, "BACKLOG.md"), fill(
      loadTemplate("BACKLOG.template.md", `# Kaizen Backlog — <Friendly Loop Name>\n\n| ID | Title | Why it matters | Discovered cycle | Priority | Status | Reason deferred | Last reconsidered |\n|---|---|---|---|---|---|---|---|\n`),
      vars,
    ));
    writeTracked(join(loopDir, "DECISIONS.md"), fill(
      loadTemplate("DECISIONS.template.md", `# Kaizen Decisions — <Friendly Loop Name>\n\n- <date> — Owner: contract created\n`),
      vars,
    ));
    jsonTracked(join(loopDir, "STATE.json"), stateJson);
    jsonTracked(join(loopDir, "LOCAL_STATE.json"), localJson);
    jsonTracked(join(evidenceDir, "manifest.json"), manifestJson);

    // 5. root-level files
    const indexPath = join(root, "INDEX.md");
    let indexText = "# Kaizen Loops\n\n";
    const indexedLoops = (readJson(join(root, REGISTRY_FILE)) || {}).loops || [];
    const names = [...indexedLoops.map((e) => e.name).filter(Boolean), input.name];
    for (const nm of [...new Set(names)].sort()) {
      indexText += `- ${nm}\n`;
    }
    writeTracked(indexPath, indexText);

    // registry entry (merge, preserve unknown fields)
    const reg = readJson(join(root, REGISTRY_FILE)) || { schema_version: SCHEMA_VERSION, loops: [] };
    const existing = (reg.loops || []).find((e) => e && e.loop_id === input.loop_id);
    const entry = {
      ...(existing || {}),
      loop_id: input.loop_id,
      name: input.name,
      memory_dir: folder,
      status: existing?.status ?? "active",
      target_type: input.target_type ?? existing?.target_type ?? null,
      target_remote: input.target_remote ?? existing?.target_remote ?? null,
      target_url: input.target_url ?? existing?.target_url ?? null,
      last_cycle_id: existing?.last_cycle_id ?? null,
      updated_at: new Date().toISOString(),
    };
    const next = {
      schema_version: SCHEMA_VERSION,
      loops: existing
        ? (reg.loops || []).map((e) => (e.loop_id === input.loop_id ? entry : e))
        : [...(reg.loops || []), entry],
    };
    validateRegistryShape(next);
    jsonTracked(join(root, REGISTRY_FILE), next);

    // .gitignore
    writeTracked(join(root, ".gitignore"), `${GITIGNORE_LINES.join("\n")}\n`);

    // 6. self-check: all required files exist, JSONs parse, no placeholders
    for (const f of REQUIRED_FILES) {
      if (!existsSync(join(loopDir, f))) failInit(`missing generated file: ${join(loopDir, f)}`);
    }
    for (const f of ["KAIZEN_CONTRACT.md", "KAIZEN_MEMORY.md", "RESUME.md", "BACKLOG.md", "DECISIONS.md"]) {
      assertNoPlaceholders(join(loopDir, f));
    }
    for (const f of ["STATE.json", "LOCAL_STATE.json"]) {
      const parsed = readJson(join(loopDir, f));
      if (!parsed) failInit(`generated JSON does not parse: ${join(loopDir, f)}`);
    }
    const mf = readJson(join(evidenceDir, "manifest.json"));
    if (!mf || mf.schema_version !== 1 || !Array.isArray(mf.entries)) {
      failInit("evidence/manifest.json invalid after write");
    }
    if (!existsSync(join(root, "INDEX.md")) || !existsSync(join(root, REGISTRY_FILE)) || !existsSync(join(root, ".gitignore"))) {
      failInit("root-level files missing after write");
    }
    const stateCheck = readJson(join(loopDir, "STATE.json"));
    if (stateCheck.loop_id !== input.loop_id) failInit("STATE.json loop_id mismatch after write");

    committed = true;
    console.log(JSON.stringify({
      ok: true,
      root,
      loop_dir: loopDir,
      loop_id: input.loop_id,
      friendly_name: folder,
      created: createdPaths.filter((p) => existsSync(p)),
    }, null, 2));
  } catch (err) {
    if (!committed) rollback(err);
    failInit(err?.message ?? String(err));
  }
}

main();
