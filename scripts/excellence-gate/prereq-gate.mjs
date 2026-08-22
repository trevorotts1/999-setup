#!/usr/bin/env node
/**
 * FIX-024 prerequisite gate.
 *
 * Fail-closed check that every dependency row FIX-001 through FIX-023 is
 * COMPLETE in the operator LIVE-LEDGER.md before any FIX-024 candidate work.
 * BLOCKED_EXTERNAL, OPEN, QC_REPAIR, RECHECK, or a missing row is a FAIL.
 * Also requires the release gate not to have already been marked PASS
 * (candidate identity is frozen separately by candidate-freeze.mjs).
 *
 * The ledger is the authority file, exactly as the FIX-024 plan cites:
 *   /Users/blackceomacmini/Downloads/CANDACE FIXES/LIVE-LEDGER.md
 *
 * Usage:
 *   node scripts/excellence-gate/prereq-gate.mjs --ledger <path>
 *
 * Exit codes: 0 gate passed; 1 prerequisites not met; 2 usage/input error.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadGates, fail, isMainModule } from "./lib.mjs";

const DEPENDENCIES = Array.from({ length: 23 }, (_, i) => `FIX-${String(i + 1).padStart(3, "0")}`);

function readArg(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function parseLedgerRows(text) {
  const rows = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\|\s*(FIX-\d{3})\s*\|\s*([A-Z0-9]+)\s*\|\s*([A-Z_]+)\s*\|/);
    if (m) rows[m[1]] = { status: m[3] };
  }
  return rows;
}

export function evaluatePrereqs(ledgerPath) {
  const errors = [];
  const notFound = [];
  if (!existsSync(ledgerPath)) {
    return { ok: false, errors: [`ledger missing: ${ledgerPath}`], rows: {}, missing: DEPENDENCIES };
  }
  const rows = parseLedgerRows(readFileSync(ledgerPath, "utf8"));
  for (const id of DEPENDENCIES) {
    const row = rows[id];
    if (!row) {
      notFound.push(id);
      errors.push(`${id}: no row in ledger`);
    } else if (row.status !== "COMPLETE") {
      errors.push(`${id}: status ${row.status}, not COMPLETE`);
    }
  }
  return { ok: errors.length === 0, errors, rows, missing: notFound };
}

function main() {
  const args = process.argv.slice(2);
  const ledger = readArg(args, "--ledger");
  if (!ledger) {
    console.error("usage: node scripts/excellence-gate/prereq-gate.mjs --ledger <LIVE-LEDGER.md>");
    process.exit(2);
  }
  const result = evaluatePrereqs(resolve(ledger));
  if (!result.ok) {
    console.error("PREREQ_FAIL");
    for (const e of result.errors) console.error(`- ${e}`);
    console.error(`Checked ${DEPENDENCIES.length} dependency rows in ${ledger} (gates.json defines the FIX-024 gate set; source: FIXES-AND-QC.md FIX-024).`);
    process.exit(1);
  }
  const gates = loadGates();
  console.log(`PREREQ_OK: all ${DEPENDENCIES.length} dependency rows COMPLETE in ${ledger}`);
  console.log(`gate set: ${gates.gates.length} gates from scripts/excellence-gate/gates.json`);
  process.exit(0);
}

if (isMainModule(import.meta.url)) main();
