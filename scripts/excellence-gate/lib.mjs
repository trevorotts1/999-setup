/**
 * FIX-024 excellence-gate shared library.
 *
 * Owned path: scripts/excellence-gate/** (FIX-024 machinery lane).
 * No code deliverables for FIX-024 itself: these scripts are the machinery
 * that the FIX-024 run will execute; they never edit src/, control files,
 * or release scripts.
 *
 * Pure Node ESM, no dependencies. Exit codes: 0 OK; 1 gate/state failure;
 * 2 usage/input error; 3 tooling failure.
 */
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** True only when the calling script was run directly, not imported (matches scripts/candice-release/status.mjs). */
export function isMainModule(importMetaUrl) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(importMetaUrl));
  } catch {
    return false;
  }
}

export const REPO_ROOT = () => resolve(__dirname, "..", "..");
export const GATES_PATH = () => join(__dirname, "gates.json");

export function loadGates() {
  try {
    const parsed = JSON.parse(readFileSync(GATES_PATH(), "utf8"));
    if (parsed.$schema !== "candice/excellence-gates@1" || !Array.isArray(parsed.gates)) {
      throw new Error("gates.json schema or gates array missing");
    }
    return parsed;
  } catch (e) {
    throw new Error(`gates.json unreadable: ${e.message}`);
  }
}

/** 40-char full git object id, never all-zeroes. */
export function isSha(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/i.test(value) && !/^0{40}$/i.test(value);
}

export function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) && !/^0{64}$/.test(value);
}

export function isSemverTag(value) {
  return typeof value === "string" && /^v\d+\.\d+\.\d+$/.test(value);
}

export function git(root, args) {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

export function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

export function readReport(path, repoRoot) {
  const p = resolve(repoRoot, path);
  if (!existsSync(p)) {
    return { ok: false, error: `report missing: ${p}`, report: null, path: p };
  }
  try {
    const report = JSON.parse(readFileSync(p, "utf8"));
    if (report.schema !== "candice/completion-report@1") {
      return { ok: false, error: `report schema is ${report.schema ?? "MISSING"}, expected candice/completion-report@1`, report, path: p };
    }
    return { ok: true, error: null, report, path: p };
  } catch (e) {
    return { ok: false, error: `report unreadable: ${e.message}`, report: null, path: p };
  }
}
