#!/usr/bin/env node
/**
 * Candice fresh-install bootstrap — CLI entry (WS-31, FIX-018).
 *
 * Owned glob: `scripts/candice-bootstrap/**` (PROJECT-MANIFEST 9.2 WR-017).
 *
 * Commands:
 *   bootstrap   full fresh-install bootstrap (skills, plugin, app, assets,
 *               launch + state metadata). Options:
 *                 --mode test-fixture|developer|release   REQUIRED; unknown
 *                 or missing mode exits 2 before any write (FIX-018)
 *                 --offline   record-only asset metadata (no downloads;
 *                             registry hashes were live-verified by WS-33)
 *                 --root <dir> install root override (tests)
 *   health      fail-closed health report (schema candice.health-report/v1);
 *               exit 0 only when every required leg passes
 *   check       alias of --health
 *
 * Exit codes: 0 OK; 1 install/health failure; 2 usage (incl. mode gate).
 */
import { bootstrapRoot } from "./state.mjs";
import { installAll } from "./install.mjs";
import { healthCheck } from "./health.mjs";
import { parseMode } from "./modes.mjs";

const args = process.argv.slice(2);
const command = args[0] || "install";
const readArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const hasFlag = (name) => args.includes(name);

function usage() {
  console.error("usage: node bootstrap.mjs install|--health --mode test-fixture|developer|release [--offline] [--root <dir>]");
  process.exit(2);
}

async function main() {
  // The app may only arrive through a future release-authorized candidate.
  // In particular, do not accept a caller-selected local bundle: that would
  // bypass the updater's immutable manifest, hash/signature verification and
  // release-authority check.
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--offline" || arg === "--mode") {
      if (arg === "--mode" && args[i + 1] && !args[i + 1].startsWith("--")) i += 1;
      continue;
    }
    if (arg === "--root" && args[i + 1] && !args[i + 1].startsWith("--")) {
      i += 1;
      continue;
    }
    usage();
  }

  // Mode gate: production invocations demand a validated mode BEFORE any
  // filesystem write (FIX-018 acceptance 1). Health is read-only, but the
  // release semantics (reject .record-* markers) require the mode too.
  const rawMode = readArg("--mode");
  const parsed = parseMode(rawMode);
  if (!parsed.ok) {
    console.error(`FAIL ${parsed.message}`);
    usage();
  }
  const mode = parsed.mode;
  const root = readArg("--root");
  if (mode === "test-fixture" && !root) {
    console.error("FAIL test-fixture mode requires an explicit --root (temporary root)");
    process.exit(2);
  }
  const opts = {
    offline: hasFlag("--offline"),
    root,
    mode,
  };

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

  if (command === "--health" || command === "--report" || command === "report" || command === "health") {
    const h = await healthCheck(opts);
    for (const [leg, rec] of Object.entries(h.legs)) {
      console.log(`  ${rec.status.padEnd(7)} ${leg}${rec.detail ? ` — ${rec.detail}` : ""}`);
    }
    console.log(h.ok ? `OK all required legs healthy at ${h.root}` : `FAIL missing: ${h.missing.join(", ")}`);
    process.exit(h.ok ? 0 : 1);
  }

  usage();
}

main().catch((e) => {
  console.error(`FAIL ${e.message}`);
  process.exit(1);
});
