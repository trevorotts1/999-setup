/**
 * WS-49 installer/updater regression suite — shared harness.
 *
 * Owned glob: `tests/installer-regression/**` (PROJECT-MANIFEST 9.2 WR-021;
 * task-graph snapshot WS-49 owned_paths).
 *
 * The suite is an INDEPENDENT regression lane over the real engines owned by
 * WS-31/WS-33 (bootstrap + updater CLIs) and the packaging surfaces owned by
 * WS-23/WS-29. It never re-implements checksumming, atomicity, or payload
 * records — it drives the shipped CLIs and modules through their documented
 * contracts (spec 21) and asserts the outcomes.
 *
 * All fixtures are hermetic (mkdtemp under the OS temp dir); nothing here
 * touches the live home directory or the live config roots.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, "..", "..");

export const BOOTSTRAP = join(REPO, "scripts", "candice-bootstrap");
export const UPDATER = join(REPO, "scripts", "candice-updater");
export const ATOMIC = join(UPDATER, "rollback", "atomic-install.mjs");
export const DOWNLOAD = join(UPDATER, "rollback", "download.mjs");
export const VERIFY = join(UPDATER, "checksums", "verify.mjs");
export const GATE = join(UPDATER, "checksums", "gate.mjs");
export const REGISTRY = join(UPDATER, "checksums", "components.mjs");

/** Run a Node script (the real updater CLIs) and capture exit code + output. */
export function run(args) {
  try {
    const out = execFileSync(process.execPath, args, { encoding: "utf8" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout ?? "") + String(e.stderr ?? "") };
  }
}

/** Dynamic-import a repo module by repo-relative path (ESM). */
export function load(rel) {
  return import(pathToFileURL(join(REPO, rel)).href);
}

/** Fresh hermetic root per test. */
export function freshRoot(prefix = "ws49-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Write a file tree under dir (values: string content or nested object). */
export function tree(dir, files) {
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    if (typeof content === "string") {
      writeFileSync(join(dir, name), content);
    } else if (content && typeof content === "object") {
      tree(join(dir, name), content);
    }
  }
}

/**
 * Uninstall contract under regression (E.1 WS-29/WS-49, spec 20/21/22):
 *   - macOS: the whole install root (`~/Library/Application Support/BlackCEO/999`
 *     by default) is removed — skills, plugin, app, assets, state, staging,
 *     backups — nothing of the install is left behind.
 *   - Windows: the NSIS default uninstall section performs the equivalent
 *     root removal (`RmDir /r "$LOCALAPPDATA\${BUNDLEID}"`, enforced by the
 *     WS-29 hooks file — asserted in uninstall-cleanup.test.mjs).
 * A shared uninstall ENGINE does not yet exist in the updater scripts (the
 * bootstrap lane's glob has none; WS-32 upgrade lane not built) — this
 * harness implements the documented cross-platform contract so the regression
 * suite can prove cleanup semantics today. Finding recorded in CHECKPOINT-WS49.md.
 */
export function uninstall(root) {
  rmSync(root, { recursive: true, force: true });
}
