#!/usr/bin/env node
/**
 * Candice fresh-install bootstrap — persistent state (WS-31).
 *
 * Owned glob: `scripts/candice-bootstrap/**` (PROJECT-MANIFEST 9.2 WR-017;
 * task-graph snapshot WS-31 owned_paths).
 *
 * The bootstrap writes one JSON state document so repeat invocations are
 * idempotent and so the fast health/version check (spec 21 step 7) does not
 * re-run installs. State lives INSIDE the installed tree root
 * (<root>/state/bootstrap-state.json), which the atomic installer (WS-33)
 * moves as one unit — a partially installed tree is never reported as
 * complete.
 *
 * The state doc is not a competing project-memory store (spec 9): it records
 * component/version facts only — never question/answer content, never
 * conversation data, never secrets.
 */
import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";

export const STATE_FILENAME = "bootstrap-state.json";
export const STATE_SCHEMA = "candice.bootstrap.state/v1";

/**
 * Paths for the bootstrap's install root (the 999 app-data parent that owns
 * skills/plugin/app/assets — see README).
 *
 * macOS:   ~/Library/Application Support/BlackCEO/999
 * Windows: %LOCALAPPDATA%\BlackCEO\999
 *
 * Falls back to a deterministic relative path when HOME/USERPROFILE is
 * absent (sandboxed tests); callers may override with CANDICE_BOOTSTRAP_ROOT
 * (used by the test suite to keep installs off the live home dir).
 */
export function bootstrapRoot(env = process.env, platform = process.platform) {
  const override = env.CANDICE_BOOTSTRAP_ROOT;
  if (override && override.length > 0) return override;
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA;
    if (localAppData && localAppData.length > 0) {
      return join(localAppData, "BlackCEO", "999");
    }
    const home = env.USERPROFILE;
    if (home && home.length > 0) return join(home, "AppData", "Local", "BlackCEO", "999");
    return join(".candice-bootstrap", "state");
  }
  const home = env.HOME;
  if (home && home.length > 0) return join(home, "Library", "Application Support", "BlackCEO", "999");
  return join(".candice-bootstrap", "state");
}

/** The installed-tree state file (inside the install root). */
export function stateFilePath(root) {
  return join(root, "state", STATE_FILENAME);
}

/**
 * @typedef {{
 *   schema: string,
 *   installedAt: string,
 *   platform: string,
 *   components: Record<string, { id: string, version: string, kind: string, status: string }>,
 *   assets: Record<string, { id: string, version: string, file: string, sha256: string, status: string }>,
 *   launch: Record<string, string>,
 * }} BootstrapState
 */

function emptyStateObj(platform) {
  return {
    schema: STATE_SCHEMA,
    installedAt: new Date().toISOString(),
    platform,
    components: {},
    assets: {},
    launch: {},
  };
}

/** Read state; returns an empty state when absent or unreadable (fresh install). */
export function readState(root, platform = process.platform) {
  const file = stateFilePath(root);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return emptyStateObj(platform);
  }
  if (parsed && typeof parsed === "object" && parsed.schema === STATE_SCHEMA) {
    return parsed;
  }
  return emptyStateObj(platform);
}

/** Write state atomically (write-temp + rename) at the FIX-013 permission
 * posture: state dir 0700, state document 0600 (Unix). The permission probe
 * fails closed otherwise, so the write must produce the posture, not hope
 * for a tight umask. Returns boolean; never throws. */
export function writeState(root, state) {
  const file = stateFilePath(root);
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, file);
    if (process.platform !== "win32") {
      chmodSync(file, 0o600);
      chmodSync(dirname(file), 0o700);
    }
    return true;
  } catch {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
    return false;
  }
}

/** true when the recorded component set matches the given pinned versions. */
export function stateMatches(state, pins) {
  if (!state || !state.components) return false;
  for (const [id, version] of Object.entries(pins)) {
    const rec = state.components[id];
    if (!rec || rec.version !== version || rec.status !== "installed") return false;
  }
  return true;
}
