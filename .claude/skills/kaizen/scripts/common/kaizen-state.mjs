#!/usr/bin/env node
// Kaizen Loop state helper.
// Deterministic, no network, no secrets. Writes are atomic:
// temp file -> JSON.parse validation -> rename -> keep .bak.
//
// Root resolution: search Downloads only, depth <= 3, case-insensitive.
// Count every "OpenClaw Master Files" folder (Kaizen subfolder NOT
// required to count). Exactly one -> "<match>/Kaizen", else
// "<Downloads>/Kaizen". Mirrors resolve-kaizen-root.sh and
// Resolve-KaizenRoot.ps1 (all three agree).

import { execFileSync } from "node:child_process";
import {
  openSync, closeSync, readdirSync, readFileSync, writeFileSync,
  renameSync, existsSync, mkdirSync, statSync, rmSync,
} from "node:fs";
import { homedir, hostname } from "node:os";
import crypto from "node:crypto";
import { join, resolve } from "node:path";

const HOME = homedir();
const DOWNLOADS = process.env.KAIZEN_DOWNLOADS || realDownloads() || join(HOME, "Downloads");
const FALLBACK_ROOT = join(DOWNLOADS, "Kaizen");
const LOCK_NAME = ".cycle-lock.json";
const STALE_MS = 6 * 60 * 60 * 1000; // 6 hours
const STATE_FILE = "STATE.json";
const LOCAL_STATE_FILE = "LOCAL_STATE.json";
const REGISTRY_FILE = "REGISTRY.json";
const LEGACY_REGISTRY_FILE = "registry.json";
const SCHEMA_VERSION = 1;

const UPDATE_FIELDS = new Set([
  "status", "name", "memory_dir", "target_type", "target_remote",
  "target_url", "last_cycle_id",
]);

function usage() {
  console.log(`usage: kaizen-state.mjs <command> [args]

commands:
  locate                         print the Kaizen memory root (decision rule)
  locate-root                    alias of locate
  locate-loop <id-or-name>       resolve a loop via REGISTRY.json, print its dir
                                 (exit 1 with machine-readable JSON if not found)
  registry-add <loop-id> [--name <friendly>] [--memory-dir <dir>]
                                 add or merge-update a registry entry
  registry-update <loop-id> --field k=v [--field k2=v2 ...]
                                 update allowed fields only (status, name,
                                 memory_dir, target_type, target_remote,
                                 target_url, last_cycle_id); always sets
                                 updated_at; preserves everything else
  registry-list                  JSON array of registry entries sorted by name
  status <id-or-name>            loop status (state, lock, last cycle, approval)
  is-locked <id-or-name>         JSON {locked, stale, cycle_id, started_at, held_by}; exit 0
  lock <loop-id> [--cycle <cycle-id>] [--session <name>]
                                 take the cycle lock atomically; prints the
                                 random token on stdout (only place it exists)
  unlock <loop-id> --token <t>   release the lock (token must match)
         unlock <loop-id> [--force --stale|--broken]
                                 emergency release; --force is REJECTED unless
                                 the lock is stale (>6h, --stale) or unparseable
                                 (--broken)
  bump-cycle <loop-id>           increment STATE.json cycle counter/last cycle
  validate <loop-id>             validate STATE.json and LOCAL_STATE.json shapes
  init-dispatch                  print the memory-initializer command

lock behavior: if the lock is held and fresh, "lock" exits 1 and prints
{ok:false, skipped:true, reason:"lock_held", held_by_cycle_id} on stdout.
Duplicate scheduled runs MUST detect the skip by parsing stdout and exit 0
themselves. Callers that check "is-locked" first and see locked:true must
record a skip and exit 0 without calling "lock".`);
}

function fail(msg, code = 1) {
  console.error(`kaizen-state: ${msg}`);
  process.exit(code);
}

function jsonError(msg) {
  console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
  process.exit(1);
}

function atomicWriteJson(filePath, value) {
  const dir = join(filePath, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  // Validation: the temp file must parse back before it may replace anything.
  const parsed = JSON.parse(readFileSync(tmp, "utf8"));
  if (existsSync(filePath)) renameSync(filePath, `${filePath}.bak`);
  renameSync(tmp, filePath);
  return parsed;
}

function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (err) {
    return { __invalid: true, path: filePath, error: String(err) };
  }
}

// --- root resolution: OpenClaw Master Files decision rule -----------------
// Search Downloads only, depth <= 3, case-insensitive. Count matches
// regardless of whether a Kaizen subfolder exists inside. Exactly one ->
// "<match>/Kaizen"; zero or more than one -> "<Downloads>/Kaizen".
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
        continue; // do not descend into the master folder
      }
      walk(full, depth + 1);
    }
  };
  if (existsSync(DOWNLOADS)) walk(DOWNLOADS, 1);
  const unique = [...new Set(candidates)];
  if (unique.length === 1) return join(unique[0], "Kaizen");
  return FALLBACK_ROOT;
}

// --- registry -----------------------------------------------------------------
function registryPath() {
  return join(locateRoot(), REGISTRY_FILE);
}

function legacyRegistryPath() {
  return join(locateRoot(), LEGACY_REGISTRY_FILE);
}

// Registry shape: {schema_version:1, loops:[{loop_id, name, memory_dir,
// status, target_type, target_remote, target_url, last_cycle_id,
// updated_at, ...any legacy fields preserved}]}
function loadRegistry() {
  const rp = registryPath();
  const reg = readJson(rp);
  if (reg && !reg.__invalid) return { reg, rp };
  return { reg: null, rp };
}

function migrateLegacyRegistry() {
  const rp = registryPath();
  const lp = legacyRegistryPath();
  // On case-insensitive filesystems (default macOS APFS) existsSync(rp)
  // also matches "registry.json", so the canonical check must compare
  // device+inode, not the name string.
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
    if (!sameFile) return; // canonical really present: ignore lowercase
  } else if (!existsSync(lp)) {
    return;
  }
  const legacy = readJson(lp);
  let loops = [];
  if (legacy && !legacy.__invalid && typeof legacy === "object" && !Array.isArray(legacy)) {
    const isSchema = Array.isArray(legacy.loops);
    if (isSchema) {
      loops = legacy.loops.filter((x) => x && typeof x === "object");
    } else {
      // legacy map format: {loop_id: {entry}}
      loops = Object.keys(legacy)
        .filter((k) => !k.startsWith("__") && legacy[k] && typeof legacy[k] === "object")
        .map((k) => ({ ...legacy[k], loop_id: k }));
    }
  }
  const now = new Date().toISOString();
  const migrated = {
    schema_version: SCHEMA_VERSION,
    loops: loops.map((e) => ({
      loop_id: typeof e.loop_id === "string" ? e.loop_id : `legacy-${loops.indexOf(e)}`,
      name: typeof e.name === "string" ? e.name : String(e.loop_id || "loop"),
      memory_dir: typeof e.memory_dir === "string" ? e.memory_dir : null,
      status: typeof e.status === "string" ? e.status : "active",
      target_type: typeof e.target_type === "string" ? e.target_type : (typeof e.target === "string" ? e.target : null),
      target_remote: typeof e.target_remote === "string" ? e.target_remote : null,
      target_url: typeof e.target_url === "string" ? e.target_url : null,
      last_cycle_id: typeof e.last_cycle_id === "string" ? e.last_cycle_id : null,
      updated_at: typeof e.updated_at === "string" ? e.updated_at : now,
      ...e, // unknown fields preserved, never discarded
    })),
  };
  // Validate the migrated backup parses before replacing anything.
  const migratedRaw = `${JSON.stringify(migrated, null, 2)}\n`;
  JSON.parse(migratedRaw);
  const tmp = `${rp}.tmp-migrate-${process.pid}`;
  writeFileSync(tmp, migratedRaw, "utf8");
  JSON.parse(readFileSync(tmp, "utf8"));
  // Order matters on case-insensitive filesystems (macOS APFS): the
  // lowercase name must be moved aside first, or the rename onto
  // "REGISTRY.json" would silently replace it.
  renameSync(lp, `${lp}.bak-migrated`);
  renameSync(tmp, rp);
  return migrated;
}

function writeRegistry(reg) {
  const rp = registryPath();
  return atomicWriteJson(rp, reg);
}

function saveRegistry(reg) {
  return atomicWriteJson(registryPath(), reg);
}

function registryEntryById(id) {
  const { reg } = loadRegistry();
  if (!reg || !Array.isArray(reg.loops)) return null;
  return reg.loops.find((e) => e && e.loop_id === id) || null;
}

function findLoopDir(entry, root) {
  if (!entry) return null;
  if (typeof entry.memory_dir === "string" && entry.memory_dir) {
    const d = join(root, entry.memory_dir);
    if (existsSync(d) && statSync(d).isDirectory()) return d;
  }
  // Legacy fallback: <root>/<loop-id> with a matching STATE.json loop_id.
  const legacy = join(root, entry.loop_id);
  if (existsSync(legacy) && statSync(legacy).isDirectory()) {
    const state = readJson(join(legacy, STATE_FILE));
    if (state && !state.__invalid && state.loop_id === entry.loop_id) {
      console.error(`kaizen-state: loop ${entry.loop_id} not found at registry memory_dir; using legacy folder ${legacy}`);
      return legacy;
    }
  }
  return null;
}

function resolveLoop(idOrName) {
  migrateLegacyRegistry();
  const root = locateRoot();
  const { reg } = loadRegistry();
  const loops = reg && Array.isArray(reg.loops) ? reg.loops : [];

  // 1. exact loop_id match
  const byId = loops.filter((e) => e && e.loop_id === idOrName);
  if (byId.length === 1) {
    const dir = findLoopDir(byId[0], root);
    return { entry: byId[0], dir, root, ambiguous: [] };
  }
  if (byId.length > 1) return { entry: null, dir: null, root, ambiguous: byId };

  // 2. unique case-insensitive name match
  const byName = loops.filter(
    (e) => e && typeof e.name === "string" && e.name.toLowerCase() === idOrName.toLowerCase(),
  );
  if (byName.length === 1) {
    const dir = findLoopDir(byName[0], root);
    return { entry: byName[0], dir, root, ambiguous: [] };
  }
  if (byName.length > 1) return { entry: null, dir: null, root, ambiguous: byName };

  // 3. legacy: no registry entry, but <root>/<id> exists with matching
  //    STATE.json loop_id.
  const legacyDir = join(root, idOrName);
  if (existsSync(legacyDir) && statSync(legacyDir).isDirectory()) {
    const state = readJson(join(legacyDir, STATE_FILE));
    if (state && !state.__invalid && state.loop_id === idOrName) {
      console.error(`kaizen-state: loop ${idOrName} is not in REGISTRY.json; using legacy folder ${legacyDir}`);
      return {
        entry: null, dir: legacyDir, root, ambiguous: [], legacy: true,
      };
    }
  }
  return { entry: null, dir: null, root, ambiguous: [], candidates: loops };
}

function cmdLocateLoop(idOrName) {
  if (!idOrName) jsonError("locate-loop requires a loop id or name");
  const { entry, dir, ambiguous, candidates } = resolveLoop(idOrName);
  if (ambiguous.length > 1) {
    const names = ambiguous
      .map((e) => e.loop_id)
      .sort()
      .map((e) => `  - ${e}`);
    jsonError(`ambiguous loop name "${idOrName}" matches ${ambiguous.length} loops:\n${names.join("\n")}`);
  }
  if (dir) {
    console.log(dir);
    return;
  }
  const candNames = (candidates || [])
    .map((e) => e.loop_id)
    .sort();
  jsonError(`loop "${idOrName}" not found in REGISTRY.json${candNames.length ? ` (candidates: ${candNames.join(", ")})` : ""}`);
}

// --- lock ------------------------------------------------------------------
function lockPathFor(root) {
  return join(root, LOCK_NAME);
}

function isStale(lock) {
  if (!lock || typeof lock.started_at !== "string") return true;
  const t = Date.parse(lock.started_at);
  if (Number.isNaN(t)) return true;
  return Date.now() - t > STALE_MS;
}

function cmdIsLocked(idOrName) {
  const { dir } = resolveLoop(idOrName);
  if (!dir) jsonError(`loop "${idOrName}" not found`);
  const lp = lockPathFor(dir);
  if (!existsSync(lp)) {
    console.log(JSON.stringify({ locked: false, stale: false, cycle_id: null, started_at: null, held_by: null }));
    return;
  }
  const lock = readJson(lp);
  if (!lock || lock.__invalid) {
    console.log(JSON.stringify({
      locked: false, stale: true, broken: true, cycle_id: null, started_at: null, held_by: null,
    }));
    return;
  }
  const stale = isStale(lock);
  console.log(JSON.stringify({
    locked: !stale,
    stale,
    cycle_id: lock.cycle_id ?? null,
    started_at: lock.started_at ?? null,
    held_by: { pid: lock.pid ?? null, hostname: lock.hostname ?? null, session: lock.session ?? null },
  }));
}

function cycleIdFromState(dir) {
  const state = readJson(join(dir, STATE_FILE));
  if (state && !state.__invalid) {
    if (typeof state.cycle_counter === "number") return `cycle-${String(state.cycle_counter).padStart(3, "0")}`;
    if (state.last_cycle && typeof state.last_cycle.cycle_id === "string") return state.last_cycle.cycle_id;
    if (state.last_cycle && typeof state.last_cycle.id === "string") return state.last_cycle.id;
  }
  return `cycle-000`;
}

function cmdLock(idOrName) {
  const { dir } = resolveLoop(idOrName);
  if (!dir) jsonError(`loop "${idOrName}" not found`);
  const root = dir;
  const lp = lockPathFor(root);
  const idx = process.argv.indexOf("lock") + 1;
  const args = process.argv.slice(idx + 1);
  let cycle = null;
  let session = "scheduled";
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--cycle" && args[i + 1]) cycle = args[++i];
    else if (args[i] === "--session" && args[i + 1]) session = args[++i];
  }
  if (!cycle) cycle = cycleIdFromState(root);

  // Atomic exclusive creation: no check-then-write race.
  let fd;
  try {
    fd = openSync(lp, "wx");
  } catch (err) {
    if (err.code !== "EEXIST") fail(`cannot create lock: ${err.message}`);
    const held = readJson(lp);
    if (!held || held.__invalid) {
      // Unparseable lock: keep it, tell the caller to recover with --broken.
      console.log(JSON.stringify({
        ok: false, skipped: true, reason: "lock_broken",
        held_by_cycle_id: null, lock: lp,
      }));
      process.exit(1);
    }
    if (!isStale(held)) {
      console.log(JSON.stringify({
        ok: false, skipped: true, reason: "lock_held",
        held_by_cycle_id: held.cycle_id ?? null, started_at: held.started_at ?? null, lock: lp,
      }));
      process.exit(1);
    }
    // Stale lock: preserve as evidence, then take the lock.
    const ts = Date.now();
    renameSync(lp, `${lp}.stale-${ts}`);
    console.error(`kaizen-state: stale lock recovered: cycle=${held.cycle_id ?? "?"} started_at=${held.started_at ?? "?"} pid=${held.pid ?? "?"} -> ${lp}.stale-${ts}`);
    try {
      fd = openSync(lp, "wx");
    } catch (err2) {
      if (err2.code === "EEXIST") {
        console.log(JSON.stringify({ ok: false, skipped: true, reason: "lock_held", held_by_cycle_id: held.cycle_id ?? null }));
        process.exit(1);
      }
      fail(`cannot create lock: ${err2.message}`);
    }
  }

  const state = readJson(join(root, STATE_FILE));
  const lock = {
    loop_id: idOrName,
    cycle_id: cycle,
    token: crypto.randomBytes(16).toString("hex"),
    started_at: new Date().toISOString(),
    hostname: hostname(),
    pid: process.pid,
    session,
    stale_policy: "6h",
    contract_version: state && !state.__invalid && typeof state.contract_version === "number" ? state.contract_version : null,
  };
  writeFileSync(fd, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  closeSync(fd);
  // The token exists only here, on stdout, and in the (gitignored) lock file.
  console.log(JSON.stringify({ ok: true, token: lock.token, lock: lp, cycle_id: cycle }));
}

function cmdUnlock(idOrName) {
  const { dir } = resolveLoop(idOrName);
  if (!dir) jsonError(`loop "${idOrName}" not found`);
  const lp = lockPathFor(dir);
  if (!existsSync(lp)) {
    console.log(JSON.stringify({ ok: true, note: "no lock present" }));
    return;
  }
  const lock = readJson(lp);
  if (!lock || lock.__invalid) {
    // Broken lock file: recoverable only via --broken.
    const idx = process.argv.indexOf("--broken");
    if (idx === -1) {
      jsonError(`lock file ${lp} is unparseable; unlock requires --force --broken`);
    }
    renameSync(lp, `${lp}.broken-${Date.now()}`);
    console.log(JSON.stringify({ ok: true, note: "broken lock cleared", was: lp }));
    return;
  }

  const tokenIdx = process.argv.indexOf("--token");
  const token = tokenIdx !== -1 ? process.argv[tokenIdx + 1] : null;
  const forceIdx = process.argv.indexOf("--force");
  const staleFlag = process.argv.includes("--stale");
  const brokenFlag = process.argv.includes("--broken");

  if (token) {
    if (lock.token !== token) {
      jsonError("token mismatch");
    }
    renameSync(lp, `${lp}.released`);
    console.log(JSON.stringify({ ok: true, note: "lock released", was: lp }));
    return;
  }

  if (forceIdx !== -1) {
    // --force present: only allowed with --stale or --broken.
    if (!staleFlag && !brokenFlag) {
      jsonError("--force requires --stale (lock older than 6h) or --broken (unparseable lock)");
    }
    if (staleFlag && !isStale(lock)) {
      jsonError(`--force --stale rejected: lock is fresh (started ${lock.started_at})`);
    }
    if (staleFlag && isStale(lock)) {
      console.error(`kaizen-state: stale lock summary: cycle=${lock.cycle_id ?? "?"} started_at=${lock.started_at} pid=${lock.pid ?? "?"} host=${lock.hostname ?? "?"}`);
      renameSync(lp, `${lp}.stale-${Date.now()}`);
      console.log(JSON.stringify({ ok: true, note: "stale lock cleared", stale_lock_recovered: true }));
      return;
    }
    jsonError("--force --broken requires an unparseable lock file");
  }

  if (isStale(lock)) {
    console.error(`kaizen-state: stale lock summary: cycle=${lock.cycle_id ?? "?"} started_at=${lock.started_at} pid=${lock.pid ?? "?"} host=${lock.hostname ?? "?"}`);
    renameSync(lp, `${lp}.stale-${Date.now()}`);
    console.log(JSON.stringify({ ok: true, note: "stale lock cleared", stale_lock_recovered: true }));
    return;
  }

  jsonError(`lock held by another process (pid ${lock.pid}, since ${lock.started_at}); unlock with --token <token> or, only for a stale or broken lock, --force --stale / --force --broken`);
}

// --- status ------------------------------------------------------------------
function cmdStatus(idOrName) {
  const { entry, dir, legacy } = resolveLoop(idOrName);
  if (!dir) jsonError(`loop "${idOrName}" not found`);
  const root = dir;
  const state = readJson(join(root, STATE_FILE));
  const local = readJson(join(root, LOCAL_STATE_FILE));
  const lock = readJson(join(root, LOCK_NAME));
  const out = {
    root,
    exists: existsSync(root),
    registry_entry: entry || null,
    legacy,
    state: state ? "present" : "missing",
    local_state: local ? "present" : "missing",
    schema_version: state && !state.__invalid ? state.schema_version : null,
    target: state && !state.__invalid ? state.target : null,
    direction: state && !state.__invalid ? state.direction : null,
    last_cycle: state && !state.__invalid ? state.last_cycle : null,
    schedule: state && !state.__invalid ? state.schedule : null,
    approval: state && !state.__invalid ? state.approval ?? null : null,
    contract_version: state && !state.__invalid ? state.contract_version ?? null : null,
    lock: lock && !lock.__invalid
      ? {
          held: !isStale(lock),
          stale: isStale(lock),
          cycle_id: lock.cycle_id ?? null,
          started_at: lock.started_at ?? null,
          held_by: { pid: lock.pid ?? null, hostname: lock.hostname ?? null, session: lock.session ?? null },
        }
      : "none",
    invalid_files: [],
  };
  for (const [name, data] of [
    [STATE_FILE, state],
    [LOCAL_STATE_FILE, local],
    [LOCK_NAME, lock],
  ]) {
    if (data && data.__invalid) out.invalid_files.push(name);
  }
  console.log(JSON.stringify(out, null, 2));
}

// --- registry commands ------------------------------------------------------
function cmdRegistryAdd(idOrName) {
  if (!idOrName) jsonError("registry-add requires a loop id");
  const { reg, rp } = loadRegistry();
  const idx = process.argv.indexOf("registry-add") + 1;
  const args = process.argv.slice(idx + 1);
  let name = null;
  let memoryDir = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--name" && args[i + 1]) name = args[++i];
    else if (args[i] === "--memory-dir" && args[i + 1]) memoryDir = args[++i];
  }
  const root = locateRoot();
  const stateDir = join(root, idOrName);
  const state = readJson(join(stateDir, STATE_FILE));
  const now = new Date().toISOString();
  const base = {
    loop_id: idOrName,
    name: name ?? ((state && !state.__invalid && state.name) || idOrName),
    memory_dir: memoryDir ?? idOrName,
    status: "active",
    target_type: (state && !state.__invalid && state.target && state.target.type) || null,
    target_remote: (state && !state.__invalid && state.target && state.target.repo_remote) || null,
    target_url: (state && !state.__invalid && state.target && (state.target.production_url || state.target.staging_url)) || null,
    last_cycle_id: (state && !state.__invalid && state.last_cycle && (state.last_cycle.cycle_id || state.last_cycle.id)) || null,
    updated_at: now,
  };
  let loops = reg && Array.isArray(reg.loops) ? reg.loops.slice() : [];
  const existing = loops.findIndex((e) => e && e.loop_id === idOrName);
  if (existing === -1) {
    loops.push(base);
  } else {
    // merge: update known fields, preserve unknown fields, never discard.
    loops[existing] = { ...loops[existing], ...base };
  }
  saveRegistry({ schema_version: SCHEMA_VERSION, loops });
  console.log(JSON.stringify({ ok: true, registry: rp, entries: loops.length, loop_id: idOrName }));
}

function cmdRegistryUpdate(idOrName) {
  if (!idOrName) jsonError("registry-update requires a loop id");
  const { reg } = loadRegistry();
  const idx = process.argv.indexOf("registry-update") + 1;
  const args = process.argv.slice(idx + 1);
  const updates = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== "--field" || !args[i + 1]) jsonError("registry-update: expected --field k=v");
    const pair = args[++i];
    const eq = pair.indexOf("=");
    if (eq <= 0) jsonError(`registry-update: bad field "${pair}" (expected k=v)`);
    const k = pair.slice(0, eq);
    const v = pair.slice(eq + 1);
    if (!UPDATE_FIELDS.has(k)) jsonError(`registry-update: field "${k}" is not updatable (allowed: ${[...UPDATE_FIELDS].sort().join(", ")})`);
    updates[k] = v === "null" ? null : v;
  }
  const loops = reg && Array.isArray(reg.loops) ? reg.loops : [];
  const existing = loops.find((e) => e && e.loop_id === idOrName);
  if (!existing) jsonError(`loop "${idOrName}" not found in registry`);
  const merged = { ...existing, ...updates, updated_at: new Date().toISOString() };
  const next = loops.map((e) => (e.loop_id === idOrName ? merged : e));
  saveRegistry({ schema_version: SCHEMA_VERSION, loops: next });
  console.log(JSON.stringify({ ok: true, loop_id: idOrName, updated: Object.keys(updates) }));
}

function cmdRegistryList() {
  migrateLegacyRegistry();
  const { reg } = loadRegistry();
  const loops = reg && Array.isArray(reg.loops) ? reg.loops : [];
  const sorted = loops
    .slice()
    .sort((a, b) => String(a?.name ?? "").localeCompare(String(b?.name ?? "")));
  console.log(JSON.stringify(sorted, null, 2));
}

// --- bump-cycle ----------------------------------------------------------------
function cmdBumpCycle(idOrName) {
  const { dir } = resolveLoop(idOrName);
  if (!dir) jsonError(`loop "${idOrName}" not found`);
  const sp = join(dir, STATE_FILE);
  const state = readJson(sp);
  if (!state || state.__invalid) fail(`STATE.json missing or invalid at ${sp}`);
  const cur = Number.isInteger(state.cycle_counter) ? state.cycle_counter : 0;
  state.cycle_counter = cur + 1;
  state.last_cycle = {
    cycle_id: `cycle-${String(cur + 1).padStart(3, "0")}`,
    completed_at: new Date().toISOString(),
  };
  atomicWriteJson(sp, state);
  console.log(JSON.stringify({ ok: true, cycle: state.last_cycle.cycle_id }));
}

// --- validate --------------------------------------------------------------------
function cmdValidate(idOrName) {
  const { dir } = resolveLoop(idOrName);
  if (!dir) jsonError(`loop "${idOrName}" not found`);
  const root = dir;
  const problems = [];
  const state = readJson(join(root, STATE_FILE));
  const local = readJson(join(root, LOCAL_STATE_FILE));
  if (!state || state.__invalid) problems.push("STATE.json missing or invalid");
  else {
    if (state.schema_version !== 1) problems.push("STATE.json schema_version must be 1");
    for (const k of ["loop_id", "target", "direction", "scope", "permission_mode", "proof_strategy", "schedule", "model", "last_cycle", "backup"]) {
      if (state[k] === undefined) problems.push(`STATE.json missing "${k}"`);
    }
    const dirn = state.direction || {};
    if (!dirn.user_goal && !dirn.open_discovery) problems.push("direction must include user_goal and/or open_discovery");
    const scope = state.scope || {};
    const n = Number(scope.max_items_per_cycle);
    if (!Number.isInteger(n) || n < 3 || n > 7) problems.push("scope.max_items_per_cycle must be 3..7");
  }
  if (!local || local.__invalid) problems.push("LOCAL_STATE.json missing or invalid");
  if (problems.length === 0) {
    console.log(JSON.stringify({ ok: true, root }));
  } else {
    console.log(JSON.stringify({ ok: false, root, problems }, null, 2));
    process.exit(1);
  }
}

// --- init-dispatch ------------------------------------------------------------
function cmdInitDispatch() {
  console.log("node scripts/common/init-kaizen-memory.mjs --json '<init-input>'");
}

// --- main ------------------------------------------------------------------------
const cmd = process.argv[2];
const arg = process.argv[3];
switch (cmd) {
  case "locate":
  case "locate-root":
    console.log(locateRoot());
    break;
  case "locate-loop":
    cmdLocateLoop(arg);
    break;
  case "status":
    cmdStatus(arg);
    break;
  case "is-locked":
    cmdIsLocked(arg);
    break;
  case "lock":
    cmdLock(arg);
    break;
  case "unlock":
    cmdUnlock(arg);
    break;
  case "registry-add":
    cmdRegistryAdd(arg);
    break;
  case "registry-update":
    cmdRegistryUpdate(arg);
    break;
  case "registry-list":
    cmdRegistryList();
    break;
  case "bump-cycle":
    cmdBumpCycle(arg);
    break;
  case "validate":
    cmdValidate(arg);
    break;
  case "init-dispatch":
    cmdInitDispatch();
    break;
  default:
    usage();
    process.exit(2);
}
