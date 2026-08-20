#!/usr/bin/env node
// Kaizen Loop state helper.
// Deterministic, no network, no secrets. Writes are atomic:
// temp file -> JSON.parse validation -> rename -> keep .bak.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const HOME = homedir();
const DOWNLOADS = process.env.KAIZEN_DOWNLOADS || join(HOME, "Downloads");
const FALLBACK_ROOT = join(DOWNLOADS, "Kaizen");
const LOCK_NAME = ".cycle-lock.json";
const STALE_MS = 6 * 60 * 60 * 1000; // 6 hours
const STATE_FILE = "STATE.json";
const LOCAL_STATE_FILE = "LOCAL_STATE.json";
const REGISTRY_FILE = "registry.json";

function usage() {
  console.log(`usage: kaizen-state.mjs <command> [args]

commands:
  locate                        print the Kaizen memory root (decision rule)
  status <loop-id>              print loop status (state, lock, last cycle)
  lock <loop-id>                take the cycle lock (fails if held and fresh)
  unlock <loop-id> [--force]    release the cycle lock
  registry-add <loop-id>        add/update the root-level registry entry
  registry-list                 list the registry
  bump-cycle <loop-id>          increment STATE.json last_cycle and cycle counter
  validate <loop-id>            validate STATE.json and LOCAL_STATE.json shapes`);
}

function fail(msg) {
  console.error(`kaizen-state: ${msg}`);
  process.exit(1);
}

function atomicWriteJson(filePath, value) {
  const dir = join(filePath, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}`;
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

// --- locate: OpenClaw Master Files decision rule ---------------------------
// Search Downloads only, depth <= 3, case-insensitive.
// Exactly one "OpenClaw Master Files" folder containing "Kaizen" -> that.
// Zero or more than one -> ~/Downloads/Kaizen.
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
        const kaizenInside = join(full, "Kaizen");
        if (existsSync(kaizenInside) && statSync(kaizenInside).isDirectory()) {
          candidates.push(resolve(kaizenInside));
        }
        continue; // do not descend into the master folder
      }
      walk(full, depth + 1);
    }
  };
  walk(DOWNLOADS, 1);
  const unique = [...new Set(candidates)];
  if (unique.length === 1) return unique[0];
  return FALLBACK_ROOT;
}

function loopRoot(loopId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(loopId)) {
    fail(`loop-id must match [A-Za-z0-9][A-Za-z0-9_-]{0,63}, got: ${loopId}`);
  }
  return join(locateRoot(), loopId);
}

// --- lock ------------------------------------------------------------------
function lockPath(root) {
  return join(root, LOCK_NAME);
}

function isStale(lock) {
  if (!lock || typeof lock.started_at !== "string") return true;
  const t = Date.parse(lock.started_at);
  if (Number.isNaN(t)) return true;
  return Date.now() - t > STALE_MS;
}

function cmdLock(loopId, force) {
  const root = loopRoot(loopId);
  const lp = lockPath(root);
  if (existsSync(lp)) {
    const lock = readJson(lp);
    if (!lock || lock.__invalid) {
      // Unreadable lock is treated as stale, but the broken file is preserved.
      renameSync(lp, `${lp}.broken-${process.pid}`);
    } else if (!isStale(lock) && !force) {
      fail(`cycle lock held by pid ${lock.pid} since ${lock.started_at} (use --force to override)`);
    }
  }
  const newLock = { pid: process.pid, started_at: new Date().toISOString(), loop_id: loopId };
  atomicWriteJson(lp, newLock);
  console.log(JSON.stringify({ ok: true, lock: lp }));
}

function cmdUnlock(loopId, force) {
  const root = loopRoot(loopId);
  const lp = lockPath(root);
  if (!existsSync(lp)) {
    console.log(JSON.stringify({ ok: true, note: "no lock present" }));
    return;
  }
  const lock = readJson(lp);
  if (lock && !lock.__invalid && !isStale(lock) && lock.pid !== process.pid && !force) {
    fail(`lock held by another process (pid ${lock.pid}); use --force only with care`);
  }
  renameSync(lp, `${lp}.released`);
  console.log(JSON.stringify({ ok: true, note: "lock released", was: lp }));
}

// --- status ------------------------------------------------------------------
function cmdStatus(loopId) {
  const root = loopRoot(loopId);
  const state = readJson(join(root, STATE_FILE));
  const local = readJson(join(root, LOCAL_STATE_FILE));
  const lock = readJson(join(root, LOCK_NAME));
  const out = {
    root,
    exists: existsSync(root),
    state: state ? "present" : "missing",
    local_state: local ? "present" : "missing",
    schema_version: state && !state.__invalid ? state.schema_version : null,
    target: state && !state.__invalid ? state.target : null,
    direction: state && !state.__invalid ? state.direction : null,
    last_cycle: state && !state.__invalid ? state.last_cycle : null,
    schedule: state && !state.__invalid ? state.schedule : null,
    lock: lock && !lock.__invalid
      ? { pid: lock.pid, started_at: lock.started_at, stale: isStale(lock) }
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

// --- registry ------------------------------------------------------------------
function registryPath() {
  return join(locateRoot(), REGISTRY_FILE);
}

function cmdRegistryAdd(loopId) {
  const root = loopRoot(loopId);
  const rp = registryPath();
  const reg = readJson(rp);
  const map = reg && !reg.__invalid && typeof reg === "object" ? reg : {};
  const state = readJson(join(root, STATE_FILE));
  map[loopId] = {
    loop_id: loopId,
    root,
    target: state && !state.__invalid ? state.target : null,
    updated_at: new Date().toISOString(),
  };
  atomicWriteJson(rp, map);
  console.log(JSON.stringify({ ok: true, registry: rp, entries: Object.keys(map).length }));
}

function cmdRegistryList() {
  const rp = registryPath();
  const reg = readJson(rp);
  if (!reg || reg.__invalid || typeof reg !== "object") {
    console.log(JSON.stringify({ registry: rp, entries: [] }));
    return;
  }
  const entries = Object.keys(reg)
    .filter((k) => !k.startsWith("__"))
    .sort()
    .map((k) => reg[k]);
  console.log(JSON.stringify({ registry: rp, entries }, null, 2));
}

// --- bump-cycle ----------------------------------------------------------------
function cmdBumpCycle(loopId) {
  const root = loopRoot(loopId);
  const sp = join(root, STATE_FILE);
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
function cmdValidate(loopId) {
  const root = loopRoot(loopId);
  const problems = [];
  const state = readJson(join(root, STATE_FILE));
  const local = readJson(join(root, LOCAL_STATE_FILE));
  if (!state || state.__invalid) problems.push("STATE.json missing or invalid");
  else {
    if (state.schema_version !== 1) problems.push("STATE.json schema_version must be 1");
    for (const k of ["loop_id", "target", "direction", "scope", "permission_mode", "proof_strategy", "schedule", "model", "last_cycle", "backup"]) {
      if (state[k] === undefined) problems.push(`STATE.json missing "${k}"`);
    }
    const dir = state.direction || {};
    if (!dir.user_goal && !dir.open_discovery) problems.push("direction must include user_goal and/or open_discovery");
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

// --- main ------------------------------------------------------------------------
const [cmd, arg, flag] = process.argv.slice(2);
switch (cmd) {
  case "locate":
    console.log(locateRoot());
    break;
  case "status":
    cmdStatus(arg);
    break;
  case "lock":
    cmdLock(arg, flag === "--force");
    break;
  case "unlock":
    cmdUnlock(arg, flag === "--force");
    break;
  case "registry-add":
    cmdRegistryAdd(arg);
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
  default:
    usage();
    process.exit(2);
}
