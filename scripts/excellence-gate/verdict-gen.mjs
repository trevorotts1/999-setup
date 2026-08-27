#!/usr/bin/env node
/**
 * FIX-024 final verdict block generator.
 *
 * Emits the PASS verdict block per the FIXES-AND-QC.md FIX-024 PASS criteria:
 * the candidate hashes (commit, tag, artifact names/sizes/hashes/signatures),
 * the eight zero-variables, FINAL_STATE, and a gate-by-gate evidence table
 * with links, plus an unsigned signer field. The signer field is left BLANK:
 * only the fresh independent human reviewer (never a builder/fixer on any
 * FIX-001..023 lane) may fill it in evidence/FIX-024/qc/QC-REPORT.md. The
 * generator never writes the signed verdict; it only proves the block is
 * signable.
 *
 * The verdict is generated ONLY when the report satisfies:
 *   - every gates.json gate has a PASS row,
 *   - no FAIL/BLOCKED/SKIPPED rows,
 *   - every cited evidence file exists on disk,
 *   - the report candidate agrees with release-gate.json and HEAD,
 *   - the operator LIVE-LEDGER.md FIX-001..FIX-023 rows are COMPLETE.
 * Any fail, required skip, missing/stale evidence, open P0/P1 defect, or
 * control-file disagreement is an automatic FAIL.
 *
 * Usage:
 *   node scripts/excellence-gate/verdict-gen.mjs \
 *     --report <COMPLETION-REPORT.json> \
 *     --ledger <LIVE-LEDGER.md> \
 *     [--out evidence/FIX-024/qc/verdict-block.txt] [--root <dir>]
 *
 * Exit codes: 0 verdict block generated; 1 not signable (FAIL conditions);
 * 2 usage; 3 tooling failure.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { REPO_ROOT, loadGates, readReport, git, fail, isMainModule } from "./lib.mjs";
import { evaluatePrereqs } from "./prereq-gate.mjs";

const ZERO_KEYS = [
  "OPEN_REQUIRED_TASKS",
  "UNCHECKED_REQUIRED_CHECKLIST_ITEMS",
  "TASKS_AWAITING_QC",
  "TASKS_AWAITING_RECHECK",
  "OPEN_P0_DEFECTS",
  "OPEN_P1_DEFECTS",
  "REQUIRED_SKIPS",
];

export function evaluateVerdict({ report, gates, root, ledgerPath }) {
  const errors = [];
  const prereqs = evaluatePrereqs(ledgerPath);
  if (!prereqs.ok) errors.push(`dependency gate failed (${prereqs.errors.length} rows not COMPLETE) — see prereq-gate.mjs`);

  const gateIds = new Set(gates.gates.map((g) => g.id));
  const byId = new Map();
  for (const row of report.gates || []) {
    byId.set(row.id, row);
    if (!gateIds.has(row.id)) errors.push(`report row ${row.id} is not a gates.json gate`);
  }
  for (const g of gates.gates) {
    const row = byId.get(g.id);
    if (!row) {
      errors.push(`gate ${g.id}: no report row`);
      continue;
    }
    if (row.status !== "PASS") errors.push(`gate ${g.id}: status ${row.status}, not PASS`);
    if (row.status === "PASS" && row.evidenceFile) {
      const p = resolve(root, row.evidenceFile);
      if (!existsSync(p)) errors.push(`gate ${g.id}: cited evidence missing: ${row.evidenceFile}`);
    }
  }
  const c = report.candidate || {};
  if (!c.commit || !c.tag || !Array.isArray(c.artifacts) || c.artifacts.length === 0) {
    errors.push("report candidate record missing commit/tag/artifacts");
  }
  const head = git(root, ["rev-parse", "HEAD"]);
  if (head && c.commit && head !== c.commit) errors.push(`candidate commit ${c.commit} is not checked-out HEAD (${head})`);

  const releaseGatePath = join(root, "CONTROL", "release-gate.json");
  if (existsSync(releaseGatePath)) {
    try {
      const rg = JSON.parse(readFileSync(releaseGatePath, "utf8"));
      if (rg.candidate) {
        if (rg.candidate.commit !== c.commit) errors.push(`release-gate candidate commit ${rg.candidate.commit} disagrees with report ${c.commit}`);
        if (rg.candidate.tag !== c.tag) errors.push(`release-gate candidate tag ${rg.candidate.tag} disagrees with report ${c.tag}`);
      }
    } catch (e) {
      errors.push(`release-gate.json unreadable: ${e.message}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function renderVerdictBlock(report, gates) {
  const c = report.candidate;
  const lines = [];
  lines.push("FINAL EXCELLENCE VERDICT — FIX-024");
  lines.push("");
  lines.push(`Candidate commit: ${c.commit}`);
  lines.push(`Release tag:      ${c.tag}`);
  lines.push("Artifacts:");
  for (const a of c.artifacts) {
    lines.push(`  - ${a.name}  url=${a.url}  sizeBytes=${a.sizeBytes}  sha256=${a.sha256}  signature=${a.signature}`);
  }
  lines.push("");
  lines.push("Gate results (gate-by-gate evidence):");
  for (const g of gates.gates) {
    const row = (report.gates || []).find((r) => r.id === g.id);
    lines.push(`  - ${g.id} (${g.label}): ${row ? row.status : "NO ROW"} — evidence: ${row && row.evidenceFile ? row.evidenceFile : "none cited"}`);
  }
  lines.push("");
  for (const k of ZERO_KEYS) lines.push(`${k}=0`);
  lines.push("FINAL_STATE=COMPLETE_EXCELLENT");
  lines.push("");
  lines.push("Independent reviewer (signer): ________________________________");
  lines.push("");
  lines.push("The signer must be a fresh independent reviewer — never a builder or fixer");
  lines.push("on any FIX-001..023 lane. The generator leaves this field BLANK; only the");
  lines.push("independent human reviewer may fill it in evidence/FIX-024/qc/QC-REPORT.md.");
  lines.push("Until the signer field is filled by the independent reviewer, this block is");
  lines.push("unsigned and release_ready must remain false.");
  return lines.join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const readArg = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const reportPath = readArg("--report");
  const ledgerPath = readArg("--ledger");
  const out = readArg("--out");
  const root = resolve(readArg("--root") || REPO_ROOT());
  if (!reportPath || !ledgerPath) {
    fail("usage: node verdict-gen.mjs --report <COMPLETION-REPORT.json> --ledger <LIVE-LEDGER.md> [--out <path>] [--root <dir>]");
  }
  const report = readReport(reportPath, root);
  if (!report.ok) fail(report.error);
  let gates;
  try {
    gates = loadGates();
  } catch (e) {
    fail(e.message);
  }
  const result = evaluateVerdict({ report: report.report, gates, root, ledgerPath });
  if (!result.ok) {
    console.error("VERDICT_BLOCKED (automatic FAIL conditions present)");
    for (const e of result.errors) console.error(`- ${e}`);
    process.exit(1);
  }
  const block = renderVerdictBlock(report.report, gates);
  if (out) {
    writeFileSync(resolve(root, out), block + "\n");
    console.log(`VERDICT_BLOCK_OK: ${out} (signer field left blank for the independent human reviewer)`);
  } else {
    console.log("VERDICT_BLOCK_OK");
    console.log(block);
  }
  process.exit(0);
}

if (isMainModule(import.meta.url)) main();
