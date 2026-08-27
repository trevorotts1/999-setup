#!/usr/bin/env node
/**
 * FIX-024 machine-readable completion report generator.
 *
 * Builds COMPLETION-REPORT.json from the frozen candidate record plus one row
 * per executed gate. The generator only aggregates what the builder recorded;
 * it never fabricates a gate result and refuses a row whose cited evidence
 * files are missing (fail closed — a missing/stale evidence pointer is an
 * automatic FIX-024 FAIL).
 *
 * A --command row: the generator re-runs the exact command from gates.json
 * (verified against the real CLI parsers; see gates.json notes for the
 * interface corrections) and records exit code + unedited output. A --result
 * row records an already-executed result (human legs, packaged runs).
 *
 * Usage:
 *   node scripts/excellence-gate/report-gen.mjs \
 *     --freeze <candidate-freeze.json> \
 *     --gate unit --command \
 *     --gate unit --result '{"status":"PASS","evidenceFile":"evidence/FIX-024/builder/cargo-test.txt"}'
 *     ... \
 *     [--out evidence/FIX-024/builder/COMPLETION-REPORT.json] [--root <dir>]
 *
 * Gate statuses: PASS, FAIL, BLOCKED, SKIPPED. A required skip is BLOCKED,
 * never PASS. Exit codes: 0 report written; 1 generation refused; 2 usage.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { REPO_ROOT, loadGates, readReport, fail, isMainModule } from "./lib.mjs";

const KNOWN_STATUSES = new Set(["PASS", "FAIL", "BLOCKED", "SKIPPED"]);

function readArg(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function runCommand(cmd, root) {
  const parts = cmd.split(/\s+/);
  const [bin, ...rest] = parts;
  try {
    const r = execFileSync(bin, rest, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: "PASS", exitCode: 0, output: r };
  } catch (e) {
    return { status: "FAIL", exitCode: e.status ?? -1, output: `${e.stdout || ""}${e.stderr || ""}` };
  }
}

export function generateReport({ freeze, rows, gates, root }) {
  const errors = [];
  if (!freeze || !freeze.commit || !freeze.tag || !Array.isArray(freeze.artifacts)) {
    errors.push("frozen candidate record missing commit/tag/artifacts");
  }
  const gateIds = new Set(gates.gates.map((g) => g.id));
  const seen = new Set();
  for (const row of rows) {
    if (!gateIds.has(row.id)) {
      errors.push(`row id ${row.id} is not a gate in gates.json`);
      continue;
    }
    if (seen.has(row.id)) {
      errors.push(`duplicate row for gate ${row.id}`);
      continue;
    }
    seen.add(row.id);
    if (!KNOWN_STATUSES.has(row.status)) {
      errors.push(`gate ${row.id}: status ${row.status} is not one of PASS/FAIL/BLOCKED/SKIPPED`);
    }
    if (row.status === "PASS" && !row.evidenceFile) {
      errors.push(`gate ${row.id}: PASS requires an evidenceFile pointer`);
    }
    if (row.evidenceFile) {
      const p = resolve(root, row.evidenceFile);
      if (!existsSync(p)) {
        errors.push(`gate ${row.id}: cited evidence missing on disk: ${row.evidenceFile}`);
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const report = {
    schema: "candice/completion-report@1",
    fix: "FIX-024",
    generatedAt: new Date().toISOString(),
    candidate: freeze,
    gates: rows.map((r) => ({
      id: r.id,
      label: (gates.gates.find((g) => g.id === r.id) || {}).label || r.id,
      status: r.status,
      evidenceFile: r.evidenceFile || "",
      exitCode: r.exitCode ?? null,
      output: r.output ?? "",
      recordedAt: r.recordedAt || new Date().toISOString(),
    })),
  };
  return { ok: true, errors: [], report };
}

function main() {
  const args = process.argv.slice(2);
  const root = resolve(readArg(args, "--root") || REPO_ROOT());
  const freezePath = readArg(args, "--freeze");
  const out = readArg(args, "--out");
  if (!freezePath) {
    fail("usage: node report-gen.mjs --freeze <candidate-freeze.json> (--gate <id> --command | --gate <id> --result '<json>')... [--out <path>] [--root <dir>]");
  }
  const fp = resolve(root, freezePath);
  if (!existsSync(fp)) fail(`freeze record missing: ${fp}`);
  let freeze;
  try {
    freeze = JSON.parse(readFileSync(fp, "utf8"));
  } catch (e) {
    fail(`freeze record unreadable: ${e.message}`);
  }

  let gates;
  try {
    gates = loadGates();
  } catch (e) {
    fail(e.message);
  }

  const rows = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--gate" || !args[i + 1]) continue;
    const id = args[i + 1];
    const mode = args[i + 2];
    if (mode === "--command") {
      const spec = gates.gates.find((g) => g.id === id);
      if (!spec) fail(`gate ${id} not found in gates.json`);
      if (!spec.commands || spec.commands.length === 0) fail(`gate ${id} has no commands to run`);
      const cmd = spec.commands[0];
      const r = runCommand(cmd, root);
      const evidenceFile = spec.evidence?.[0] || join("evidence", "FIX-024", "builder", `${id}.txt`);
      rows.push({
        id,
        status: r.status,
        exitCode: r.exitCode,
        output: r.output,
        evidenceFile,
        recordedAt: new Date().toISOString(),
      });
    } else if (mode === "--result") {
      let parsed;
      try {
        parsed = JSON.parse(args[i + 3]);
      } catch {
        fail(`--gate ${id} --result needs a JSON object`);
      }
      if (!KNOWN_STATUSES.has(parsed.status)) fail(`--gate ${id}: result status ${parsed.status} invalid`);
      rows.push({
        id,
        status: parsed.status,
        exitCode: parsed.exitCode ?? null,
        output: parsed.output ?? "",
        evidenceFile: parsed.evidenceFile || "",
        recordedAt: parsed.recordedAt || new Date().toISOString(),
      });
    } else {
      fail(`--gate ${id} requires --command or --result '<json>'`);
    }
  }
  if (rows.length === 0) fail("no gate rows supplied");

  const result = generateReport({ freeze, rows, gates, root });
  if (!result.ok) {
    console.error("REPORT_REFUSED");
    for (const e of result.errors) console.error(`- ${e}`);
    process.exit(1);
  }
  const json = JSON.stringify(result.report, null, 2);
  if (out) {
    writeFileSync(resolve(root, out), json + "\n");
    console.log(`REPORT_OK: ${out} (${rows.length} gate rows)`);
  } else {
    console.log("REPORT_OK");
    console.log(json);
  }
  process.exit(0);
}

if (isMainModule(import.meta.url)) main();
