#!/usr/bin/env node
/**
 * Candice fresh-install bootstrap — CLI entry (WS-31).
 *
 * Owned glob: `scripts/candice-bootstrap/**` (PROJECT-MANIFEST 9.2 WR-017).
 *
 * Commands:
 *   bootstrap   full fresh-install bootstrap (skills, plugin, app, assets,
 *               launch + state metadata). Options:
 *                 --offline   record-only asset metadata (no downloads;
 *                             registry hashes were live-verified by WS-33)
 *                 --root <dir> install root override (tests)
 *   health      fast health/version check (spec 21 step 7); exit 0 all ok,
 *               1 any component missing/stale
 *   check       alias of --health
 *
 * Exit codes: 0 OK; 1 install/health failure; 2 usage.
 */
import { bootstrapRoot } from "./state.mjs";
import { installAll } from "./install.mjs";
import { healthCheck } from "./health.mjs";

const args = process.argv.slice(2);
const command = args[0] || "install";
const readArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const hasFlag = (name) => args.includes(name);

function usage() {
  console.error("usage: node bootstrap.mjs install|--health [--offline] [--root <dir>] [--app-source <prebuilt.app>]");
  process.exit(2);
}

async function main() {
  const root = readArg("--root");
  const opts = {
    offline: hasFlag("--offline"),
    root,
    appSource: readArg("--app-source"),
  };

  if (command === "install") {
    const r = await installAll(opts);
    if (!r.ok) {
      console.error(`FAIL ${r.message}`);
      process.exit(1);
    }
    console.log(`OK ${r.message}`);
    console.log(`  root: ${r.root}`);
    for (const [leg, res] of Object.entries(r.results)) {
      if (res && typeof res.message === "string") console.log(`  ${leg}: ${res.message}`);
    }
    process.exit(0);
  }

  if (command === "--health" || command === "--report" || command === "report") {
    const h = healthCheck(opts);
    for (const c of h.components) {
      console.log(`  ${c.ok ? "OK " : "MISS"} ${c.name}${c.version ? ` (${c.version})` : ""}${c.detail ? ` — ${c.detail}` : ""}`);
    }
    for (const a of h.assets) {
      console.log(`  ${a.ok ? "OK " : "MISS"} ${a.name}${a.detail ? ` — ${a.detail}` : ""}`);
    }
    console.log(h.ok ? `OK all bundled components healthy at ${h.root}` : `FAIL missing: ${h.missing.join(", ")}`);
    process.exit(h.ok ? 0 : 1);
  }

  usage();
}

main().catch((e) => {
  console.error(`FAIL ${e.message}`);
  process.exit(1);
});
