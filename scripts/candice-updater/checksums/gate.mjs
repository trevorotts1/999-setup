#!/usr/bin/env node
/**
 * Candice updater version gate (WS-33).
 *
 * The downgrade-rejection primitive (spec 21: "reject downgrades unless
 * explicitly supported"). The upgrade journey (WS-32) calls this before
 * touching any installed tree:
 *
 *   node gate.mjs --candidate <version> --installed <version> [--allow-downgrade]
 *
 * Exit codes:
 *   0  candidate acceptable (newer OR equal, or --allow-downgrade given)
 *   1  DOWNGRADE REJECTED — candidate older than installed, no override
 *   2  usage error
 */
import { compareVersions } from "./components.mjs";

const args = process.argv.slice(2);
const readArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const hasFlag = (name) => args.includes(name);

const candidate = readArg("--candidate");
const installed = readArg("--installed");

if (!candidate || !installed) {
  console.error("usage: node gate.mjs --candidate <version> --installed <version> [--allow-downgrade]");
  process.exit(2);
}

const cmp = compareVersions(candidate, installed);
if (cmp < 0 && !hasFlag("--allow-downgrade")) {
  console.error(`DOWNGRADE REJECTED candidate ${candidate} < installed ${installed}`);
  process.exit(1);
}

console.log(`OK candidate ${candidate} accepted (installed ${installed})`);
process.exit(0);
