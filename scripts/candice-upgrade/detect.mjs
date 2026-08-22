#!/usr/bin/env node
/**
 * Candice existing-user upgrade — update detection (WS-32).
 *
 * Owned glob: `scripts/candice-upgrade/**` (PROJECT-MANIFEST 9.2 WR-017;
 * task-graph snapshot WS-32 owned_paths).
 *
 * Master Spec section 21, "Existing user flow", steps 1-2:
 *   1. Old Spec Protocol sees that the published Spec Protocol version is
 *      newer.
 *   2. Existing `self-update.sh` replaces the Spec Protocol skill tree.
 *
 * This module implements step 1 in the same vocabulary as the existing
 * spec-protocol version check (tools/check-update.sh): read the INSTALLED
 * Spec Protocol version from the configured Claude config roots (primary
 * ~/.claude/skills/spec-protocol/VERSION, second root ~/.claude-nine/skills/
 * when it is a genuinely separate config root), compare against the PUBLISHED
 * version at raw.githubusercontent.com/trevorotts1/999-setup/main/.claude/
 * skills/spec-protocol/VERSION.
 *
 * Exit codes (CLI):
 *   0  current — nothing to do (fast path: subsequent invocations run the
 *      health check only, spec 21 step 7)
 *   1  UPDATE AVAILABLE — at least one config root's spec-protocol is older
 *      than the published version (or an unreadable installed VERSION
 *      treated as 0.0.0 per self-update.sh precedent)
 *   2  UNDETERMINED — the published version could not be read from the
 *      operator-controlled channel (network failure, non-2xx, unparseable
 *      page). NEVER report "current" out of a failed instrument.
 *
 * Never downloads payloads, never writes to any installed tree, never
 * contacts anything other than the operator-controlled published VERSION.
 * Shell-agnostic Node (fetch) — the same detector serves macOS and Windows
 * callers (spec 0.3 Windows parity; no Bash-only path).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const PUBLISHED_VERSION_URL =
  "https://raw.githubusercontent.com/trevorotts1/999-setup/main/.claude/skills/spec-protocol/VERSION";

export const SKILL_NAME = "spec-protocol";

export const IS_VERSION_RE = /^[0-9.]+$/;

/** Numeric field-by-field compare (matches self-update.sh newer_than semantics). */
export function compareVersions(a, b) {
  const av = String(a || "0").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const bv = String(b || "0").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(av.length, bv.length);
  for (let i = 0; i < len; i += 1) {
    const x = av[i] ?? 0;
    const y = bv[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/**
 * Installed config roots that may hold a spec-protocol skill tree.
 * Second config root (~/.claude-nine) only counts when it carries its own
 * .claude.json — mirrors tools/check-update.sh HAS_NINE_ROOT.
 */
export function installedRoots(env = process.env) {
  const roots = [];
  const home = env.HOME;
  if (home && home.length > 0) {
    roots.push(join(home, ".claude", "skills", SKILL_NAME));
    const nineJson = join(home, ".claude-nine", ".claude.json");
    try {
      if (existsSync(nineJson)) {
        roots.push(join(home, ".claude-nine", "skills", SKILL_NAME));
      }
    } catch {
      /* stat failure -> not a real root */
    }
  }
  return roots;
}

/** Test/config override: CANDICE_UPGRADE_SKILLS_ROOT points at a fixture root. */
export function configuredRoots(env = process.env) {
  const explicit = env.CANDICE_UPGRADE_SKILLS_ROOT;
  if (explicit && explicit.length > 0) return [explicit];
  return installedRoots(env);
}

/**
 * Read an installed version from a skill tree. Returns null when the tree is
 * absent, the VERSION file is unreadable, or the value is not a version
 * string (a tree that predates the version mechanism reads as UNKNOWN, and
 * the upgrade treats it as stale — self-update.sh precedent).
 */
export function readInstalledVersion(skillDir) {
  let v;
  try {
    v = readFileSync(join(skillDir, "VERSION"), "utf8").replace(/\s+/g, "");
  } catch {
    return null;
  }
  if (!IS_VERSION_RE.test(v)) return null;
  return v;
}

/**
 * Test/config override: CANDICE_UPGRADE_PUBLISHED_URL points the detector at
 * a pinned local channel fixture (FIX-021 hermetic contract) instead of the
 * live operator channel. Never set by the release path.
 */
export function publishedUrl(env = process.env) {
  const explicit = env.CANDICE_UPGRADE_PUBLISHED_URL;
  if (explicit && explicit.length > 0) return explicit;
  return PUBLISHED_VERSION_URL;
}

/** Fetch the published spec-protocol VERSION over the operator-controlled channel. */
export async function fetchPublishedVersion(fetchImpl = globalThis.fetch, url = publishedUrl()) {
  let res;
  try {
    res = await fetchImpl(url);
  } catch (e) {
    return { ok: false, reason: `fetch error: ${e.message}` };
  }
  if (!res.ok) {
    return { ok: false, reason: `HTTP ${res.status} from ${url}` };
  }
  const text = await res.text();
  const v = text.replace(/\s+/g, "");
  if (!IS_VERSION_RE.test(v)) {
    return { ok: false, reason: `published page is not a version: ${v.slice(0, 40)}` };
  }
  return { ok: true, version: v };
}

/**
 * Compare installed roots against the published version.
 * @param {object} opts roots (skill dirs), fetchImpl, url, env
 * @returns {{ok:boolean,status:"current"|"update"|"undetermined",
 *   installed:Record<string,string|null>,published:string|null,reason?:string,recommended?:string}}
 */
export async function detect(opts = {}) {
  const env = opts.env || process.env;
  const roots = opts.roots || configuredRoots(env);
  const installed = {};
  for (const dir of roots) {
    installed[dir] = readInstalledVersion(dir);
  }
  const pub = await fetchPublishedVersion(opts.fetchImpl, opts.url);
  if (!pub.ok) {
    return { ok: false, status: "undetermined", installed, published: null, reason: pub.reason };
  }
  let update = false;
  for (const v of Object.values(installed)) {
    if (v === null || compareVersions(pub.version, v) > 0) {
      update = true;
      break;
    }
  }
  return {
    ok: !update,
    status: update ? "update" : "current",
    installed,
    published: pub.version,
    ...(update ? { recommended: "self-update spec-protocol (tools/self-update.sh), then run candice-upgrade" } : {}),
  };
}
