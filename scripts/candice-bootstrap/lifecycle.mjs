#!/usr/bin/env node
/**
 * Candice lifecycle CLI (FIX-018): install | health | repair | rollback | uninstall.
 *
 * Owned glob: `scripts/candice-bootstrap/**` (PROJECT-MANIFEST 9.2 WR-017).
 *
 * One cross-platform lifecycle CLI. Every mutating command requires an
 * explicit mode (--mode test-fixture|developer|release); a missing or
 * unknown mode exits nonzero before any filesystem write. Non-release
 * modes always print `NOT_RELEASE_INSTALL`.
 *
 *   install   full fresh-install bootstrap (install.mjs installAll)
 *   health    fail-closed health report (health.mjs healthCheck); exit 0
 *             only when every REQUIRED leg passes
 *   repair    delegates to the WS-32 repair engine (upgrade.mjs repair);
 *             invoked only when health is non-current (callers gate this)
 *   rollback  restores the newest atomic-install backup for a target
 *             (WS-33 atomic-install engine, never reimplemented)
 *   uninstall production uninstall (uninstall.mjs): stop, deregister,
 *             remove Candice-only material
 *
 * Exit codes: 0 OK; 1 failure; 2 usage (including missing/unknown mode).
 */
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { requireCliMode, enforceNonReleaseRoot } from "./modes.mjs";
import { installAll } from "./install.mjs";
import { healthCheck, sanitizeReport } from "./health.mjs";
import { uninstall } from "./uninstall.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ATOMIC_INSTALL = join(__dirname, "..", "candice-updater", "rollback", "atomic-install.mjs");
const UPGRADE_CLI = join(__dirname, "..", "candice-upgrade", "upgrade.mjs");

const args = process.argv.slice(2);
const command = args[0] || "install";
const readArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const hasFlag = (name) => args.includes(name);

function usage() {
  console.error("usage: node lifecycle.mjs install|health|repair|rollback|uninstall --mode test-fixture|developer|release [--root <dir>] [--offline] [--simulate] [rollback: --to <dir>]");
  process.exit(2);
}

async function main() {
  // --mode is mandatory for every command; validated before any write.
  const mode = requireCliMode(readArg("--mode"), `lifecycle ${command}`);
  const root = readArg("--root");
  enforceNonReleaseRoot(mode, root);
  const opts = { mode, root, offline: hasFlag("--offline"), simulate: hasFlag("--simulate") };

  if (command === "install") {
    const r = await installAll(opts);
    if (!r.ok) {
      console.error(`FAIL ${r.message}`);
      process.exit(1);
    }
    if (r.notReleaseInstall) console.log("NOT_RELEASE_INSTALL");
    console.log(`OK ${r.message}`);
    console.log(`  root: ${r.root}`);
    for (const [leg, res] of Object.entries(r.results)) {
      if (res && typeof res.message === "string") console.log(`  ${leg}: ${res.message}`);
    }
    process.exit(0);
  }

  if (command === "health") {
    const h = await healthCheck(opts);
    for (const [leg, rec] of Object.entries(h.legs)) {
      console.log(`  ${rec.status.padEnd(7)} ${leg}${rec.detail ? ` — ${rec.detail}` : ""}`);
    }
    console.log(h.ok ? `OK all required legs healthy at ${h.root}` : `FAIL missing: ${h.missing.join(", ")}`);
    process.exit(h.ok ? 0 : 1);
  }

  if (command === "repair") {
    // Delegates to the WS-32 repair engine; never reimplements repair.
    const r = spawnSync(process.execPath, [UPGRADE_CLI, "repair", "--root", opts.root || "", ...(opts.offline ? ["--offline"] : []), ...(opts.simulate ? ["--simulate"] : [])], { encoding: "utf8" });
    process.stdout.write(r.stdout || "");
    process.stderr.write(r.stderr || "");
    process.exit(r.status ?? 1);
  }

  if (command === "rollback") {
    const to = readArg("--to");
    if (!to) {
      console.error("FAIL rollback requires --to <target-dir>");
      process.exit(2);
    }
    const r = spawnSync(process.execPath, [ATOMIC_INSTALL, "rollback", "--to", to], { encoding: "utf8" });
    process.stdout.write(r.stdout || "");
    process.stderr.write(r.stderr || "");
    process.exit(r.status ?? 1);
  }

  if (command === "uninstall") {
    const r = await uninstall(opts);
    if (!r.ok) {
      console.error(`FAIL ${r.message}`);
      for (const [step, detail] of Object.entries(r.steps)) {
        console.error(`  step ${step}: ${JSON.stringify(detail).slice(0, 500)}`);
      }
      process.exit(1);
    }
    console.log(`OK ${r.message}`);
    process.exit(0);
  }

  usage();
}

main().catch((e) => {
  console.error(`FAIL ${e.message}`);
  process.exit(1);
});
