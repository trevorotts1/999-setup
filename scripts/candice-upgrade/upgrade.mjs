#!/usr/bin/env node
/**
 * Candice existing-user upgrade — CLI entry (WS-32).
 *
 * Owned glob: `scripts/candice-upgrade/**` (PROJECT-MANIFEST 9.2 WR-017;
 * task-graph snapshot WS-32 owned_paths).
 *
 * Commands:
 *   check     update detection (spec 21 step 1): installed spec-protocol
 *             vs published VERSION. Exit 0 current; 1 update available;
 *             2 undetermined (never "current" out of a failed instrument).
 *   repair    install/repair missing or stale Candice components on the
 *             next supported invocation (spec 21 steps 3-6): skills,
 *             plugin + integrations, app, speech assets, state metadata.
 *             Options:
 *               --offline     record-only asset metadata (no downloads;
 *                             registry hashes were live-verified by WS-33)
 *               --root <dir>  install root override (tests)
 *               --simulate    plan only, write nothing
 *   health    fast health/version check (spec 21 step 7); exit 0 all ok,
 *             1 any component missing/stale
 *
 * Exit codes: 0 OK; 1 repair/health failure or update available (check);
 * 2 usage or undetermined (check).
 */
import { bootstrapRoot } from "../candice-bootstrap/state.mjs";
import { healthCheck } from "../candice-bootstrap/health.mjs";
import { detect } from "./detect.mjs";
import { repair } from "./repair.mjs";

const args = process.argv.slice(2);
const command = args[0] || "check";
const readArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const hasFlag = (name) => args.includes(name);

function usage() {
  console.error("usage: node upgrade.mjs check|repair|--health [--offline] [--root <dir>] [--simulate]");
  process.exit(2);
}

async function main() {
  const opts = {
    offline: hasFlag("--offline"),
    root: readArg("--root"),
    simulate: hasFlag("--simulate"),
  };

  if (command === "check") {
    const d = await detect({});
    if (d.status === "undetermined") {
      console.error(`UNDETERMINED — published spec-protocol version unreadable: ${d.reason}`);
      process.exit(2);
    }
    for (const [dir, v] of Object.entries(d.installed)) {
      console.log(`  ${v === null ? "UNKNOWN" : v}  ${dir}`);
    }
    if (d.status === "update") {
      console.log(`UPDATE AVAILABLE published ${d.published} — self-update spec-protocol, then repair`);
      process.exit(1);
    }
    console.log(`OK current — installed spec-protocol is ${d.published} (published)`);
    process.exit(0);
  }

  if (command === "repair") {
    const r = await repair(opts);
    if (!r.ok) {
      console.error(`FAIL ${r.message}`);
      process.exit(1);
    }
    console.log(`OK ${r.message}`);
    console.log(`  root: ${r.root}`);
    for (const d of r.plan.repairs) console.log(`  repair ${d.kind} ${d.id} -> ${d.action}`);
    if (r.simulate) {
      console.log("  (simulate — nothing written)");
      process.exit(0);
    }
    process.exit(0);
  }

  if (command === "--health" || command === "health") {
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
