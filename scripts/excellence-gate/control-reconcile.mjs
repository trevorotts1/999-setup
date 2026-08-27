#!/usr/bin/env node
/**
 * FIX-024 control-file agreement check.
 *
 * Verifies that TODO.md, CHECKLIST.md, LEDGER.md, release metadata, and the
 * completion report agree with zero unexplained differences:
 *   - the three control markers share one lifecycle/open/complete triple,
 *   - that triple matches release-gate.json lifecycle + openFixIds length,
 *   - project_state.json repair_status agrees,
 *   - the report's candidate commit/tag agree with the release-gate
 *     candidate and resolve to the checked-out HEAD,
 *   - every gate row cited in the report has its evidence file on disk.
 *
 * The check never edits control files. Exit codes: 0 agreement; 1 disagreement;
 * 2 usage; 3 tooling failure.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { REPO_ROOT, readReport, git, fail, isMainModule } from "./lib.mjs";

function readJson(path, errors, label) {
  if (!existsSync(path)) {
    errors.push(`missing ${label}: ${path}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    errors.push(`invalid ${label}: ${e.message}`);
    return null;
  }
}

function markerOf(path, errors, label) {
  if (!existsSync(path)) {
    errors.push(`missing ${label}: ${path}`);
    return null;
  }
  const m = readFileSync(path, "utf8").match(
    /<!-- CANDICE_RELEASE_REPAIR_STATUS: lifecycle=([A-Z_]+) open=(\d+) complete=(\d+) -->/,
  );
  if (!m) {
    errors.push(`no release-repair marker in ${label}`);
    return null;
  }
  return { lifecycle: m[1], open: Number(m[2]), complete: Number(m[3]), label };
}

export function evaluateAgreement({ reportPath, root, ledgerPath }) {
  const errors = [];
  const controlDir = join(root, "CONTROL");
  const markers = [
    markerOf(join(controlDir, "TODO.md"), errors, "CONTROL/TODO.md"),
    markerOf(join(controlDir, "CHECKLIST.md"), errors, "CONTROL/CHECKLIST.md"),
    markerOf(join(controlDir, "LEDGER.md"), errors, "CONTROL/LEDGER.md"),
  ].filter(Boolean);
  const gate = readJson(join(controlDir, "release-gate.json"), errors, "CONTROL/release-gate.json");
  const project = readJson(join(controlDir, "project_state.json"), errors, "CONTROL/project_state.json");
  const report = readReport(reportPath, root);

  if (markers.length === 3) {
    const [a, b, c] = markers;
    if (a.lifecycle !== b.lifecycle || b.lifecycle !== c.lifecycle) {
      errors.push(`control marker lifecycles disagree: ${markers.map((m) => `${m.label}=${m.lifecycle}`).join(" ")}`);
    }
    if (a.open !== b.open || b.open !== c.open || a.complete !== b.complete || c.complete !== a.complete) {
      errors.push(`control marker counts disagree: ${markers.map((m) => `${m.label}=open:${m.open}/complete:${m.complete}`).join(" ")}`);
    }
    if (gate && (gate.lifecycle !== a.lifecycle || !Array.isArray(gate.openFixIds) || gate.openFixIds.length !== a.open)) {
      errors.push(`release-gate.json (${gate.lifecycle}, ${gate.openFixIds?.length ?? "?"} open) disagrees with markers (${a.lifecycle}, ${a.open} open)`);
    }
  }
  if (gate && project) {
    const repairStatus = project.candice?.repair_status;
    if (repairStatus && repairStatus !== gate.lifecycle) {
      errors.push(`project_state.json candice.repair_status ${repairStatus} disagrees with release-gate lifecycle ${gate.lifecycle}`);
    }
  }
  if (!report.ok) {
    errors.push(report.error);
  } else if (gate && gate.candidate) {
    const c = report.report.candidate || {};
    if (c.commit !== gate.candidate.commit) errors.push(`report candidate commit ${c.commit} disagrees with release-gate ${gate.candidate.commit}`);
    if (c.tag !== gate.candidate.tag) errors.push(`report candidate tag ${c.tag} disagrees with release-gate ${gate.candidate.tag}`);
    const head = git(root, ["rev-parse", "HEAD"]);
    if (head && c.commit && head !== c.commit) errors.push(`report candidate commit ${c.commit} is not checked-out HEAD (${head})`);
    for (const row of report.report.gates || []) {
      if (row.evidenceFile && !existsSync(resolve(root, row.evidenceFile))) {
        errors.push(`report gate ${row.id} evidence missing on disk: ${row.evidenceFile}`);
      }
    }
  }
  if (ledgerPath) {
    if (!existsSync(ledgerPath)) {
      errors.push(`LIVE-LEDGER.md missing: ${ledgerPath}`);
    } else {
      const ledgerText = readFileSync(ledgerPath, "utf8");
      for (const id of ["FIX-001", "FIX-002", "FIX-006", "FIX-007", "FIX-009", "FIX-011", "FIX-024"]) {
        if (!ledgerText.includes(id)) errors.push(`LIVE-LEDGER.md has no row for ${id}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

function main() {
  const args = process.argv.slice(2);
  const readArg = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const reportPath = readArg("--report");
  const ledgerPath = readArg("--ledger");
  const root = resolve(readArg("--root") || REPO_ROOT());
  if (!reportPath) {
    fail("usage: node control-reconcile.mjs --report <COMPLETION-REPORT.json> [--ledger <LIVE-LEDGER.md>] [--root <dir>]");
  }
  const result = evaluateAgreement({ reportPath, root, ledgerPath });
  if (!result.ok) {
    console.error("AGREEMENT_FAIL");
    for (const e of result.errors) console.error(`- ${e}`);
    process.exit(1);
  }
  console.log("AGREEMENT_OK: control files, release metadata, and report agree");
  process.exit(0);
}

if (isMainModule(import.meta.url)) main();
