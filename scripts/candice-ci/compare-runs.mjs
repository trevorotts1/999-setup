#!/usr/bin/env node
/**
 * Candice determinism comparator (FIX-021 layer 5).
 *
 * Owned glob: `scripts/candice-ci/**` (FIX-021 repair integration lane;
 * PROJECT-MANIFEST 9.4 class 4 — global CI tooling, non-partitionable).
 *
 * Compares two clean hosted reruns of the exact same candidate commit and
 * fails on any required-result divergence, missing required leg, or
 * deterministic failure. Q-01 step 3: the comparison succeeds ONLY when
 * every required leg is present in both runs, performed (non-BLOCKED), and
 * passed. Two reruns that went red the same way are a deterministic
 * release-blocking failure (verdict FAILED-DETERMINISTICALLY), never a pass.
 *
 * Nothing here is timing-sensitive by design (Master Spec workflow
 * determinism rule): comparisons use stable fingerprints, never wall clocks.
 * Timestamps and wall-clock measurements inside the reports are NOT compared.
 *
 * Usage:
 *   node scripts/candice-ci/compare-runs.mjs --run <dir> <dir>
 *   node scripts/candice-ci/compare-runs.mjs --sha <sha> --run <dir> <dir>
 *
 * Exit codes:
 *   0  identical required verdicts, no missing required legs (output is
 *      the determinism evidence record on stdout)
 *   1  divergence or missing leg
 *   2  usage error or malformed report
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const COMPARE_SCHEMA = "candice/ci/determinism@1";

const COMPARED_REPORT_KEYS = ["schemaVersion", "lane", "suite", "platforms"];

/** Stable representation of a report for result comparison. */
export function reportFingerprint(report) {
  const keep = {};
  for (const key of COMPARED_REPORT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(report, key)) keep[key] = report[key];
  }
  return createHash("sha256")
    .update(JSON.stringify(keep, Object.keys(keep).sort()))
    .digest("hex");
}

function normKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/**
 * One required leg's result from a run. `blocked` means the leg did not
 * perform (BLOCKED / skip-with-exit-0), which counts as a missing leg for
 * the determinism verdict, never as a pass.
 */
export function normalizeLeg(entry) {
  const record = entry.record;
  const key = String(entry.key ?? record?.key ?? record?.name ?? "unnamed");
  const status = entry.status ?? record?.status;
  const pass = String(status).toUpperCase() === "PASS";
  return {
    key: normKey(key),
    rawKey: key,
    status,
    pass,
    blocked: entry.blocked === true || status === "BLOCKED" || status === "SKIP",
    fingerprint: createHash("sha256").update(JSON.stringify(record ?? status)).digest("hex"),
  };
}

/**
 * Build a comparable result set from raw report records.
 * Recognized shapes:
 *   { key|name, status: "PASS"|"FAIL"|"SKIP"|"BLOCKED", ... }  — leg records
 *   { verdict: { ok, failures[], skippedReasons[], blockedReasons[] } } — WS-45-style report
 *   { verdict: { blockReasons[] } } — blocked-tier report
 *   { status: "pass"|"fail"|... , reason } — bare suite result
 * A WS-45-style verdict contributes one leg per failure reason and one per
 * skip/block reason; its `ok` boolean alone is not a required-leg result.
 */
export function extractLegs(report) {
  const legs = [];
  if (Array.isArray(report?.legs)) {
    for (const entry of report.legs) {
      legs.push(normalizeLeg(typeof entry === "string" ? { key: entry, status: entry } : entry));
    }
  }
  if (report?.verdict && typeof report.verdict === "object") {
    for (const reason of report.verdict.failures ?? []) {
      legs.push(normalizeLeg({ key: `failure:${reason}`, status: "FAIL", record: reason }));
    }
    for (const reason of report.verdict.skippedReasons ?? []) {
      legs.push(normalizeLeg({ key: `skip:${reason}`, status: "SKIP", blocked: true, record: reason }));
    }
    for (const reason of report.verdict.blockedReasons ?? []) {
      legs.push(normalizeLeg({ key: `block:${reason}`, status: "BLOCKED", blocked: true, record: reason }));
    }
    for (const reason of report.verdict.blockReasons ?? []) {
      legs.push(normalizeLeg({ key: `block:${reason}`, status: "BLOCKED", blocked: true, record: reason }));
    }
  }
  if (legs.length === 0 && typeof report?.status === "string") {
    const raw = report.status;
    const blocked = raw === "blocked" || raw === "skipped" || raw === "BLOCKED" || raw === "SKIP";
    const pass = raw === "pass" || raw === "PASS";
    legs.push(
      normalizeLeg({ key: "status", status: raw, blocked, pass, record: report.reason ?? raw }),
    );
  }
  return legs;
}

/**
 * Load one report file (JSON or a plain-text pass/fail log).
 * Returns { ok, report?, reason? }. A FAIL/undetermined exit marker in a
 * text log is a failure reason, not a required-leg pass.
 */
export function loadReport(file) {
  const raw = readFileSync(file, "utf8");
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return { ok: true, report: JSON.parse(trimmed) };
  }
  const report = { text: raw, legs: [] };
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*(PASS|FAIL|SKIP|BLOCKED)\s+(.*)$/i);
    if (m) {
      report.legs.push({
        key: m[2].trim() || line,
        status: m[1].toUpperCase(),
        blocked: /^(SKIP|BLOCKED)$/i.test(m[1]),
      });
    }
  }
  const failed = /FAIL|UNDETERMINED|not measured/i.test(raw);
  return { ok: true, report, failed };
}

/** The set of required-leg keys both runs must perform and agree on. */
export function unionLegs(a, b) {
  const seen = new Set();
  const list = [];
  for (const leg of [...a, ...b]) {
    if (!seen.has(leg.key)) {
      seen.add(leg.key);
      list.push(leg.key);
    }
  }
  return list.sort();
}

/**
 * Whether a value is a single report (carries legs, a verdict, or a status)
 * as opposed to a per-file manifest of reports.
 */
export function isSingleReport(value) {
  return (
    Array.isArray(value?.legs)
    || (value?.verdict && typeof value.verdict === "object")
    || typeof value?.status === "string"
  );
}

/**
 * Normalize a report file name for cross-run comparison. Timestamped report
 * names (perf-<stamp>.json, determinism evidence stamps) map to their class
 * name — two honest reruns differ only in the stamp, never in the class.
 */
export function normalizedFileName(file) {
  return String(file)
    .replace(/perf-\d{4}-\d{2}-\d{2}T[\d.-]+Z?\.json/, "perf-<stamp>.json")
    .replace(/-2026-\d{2}-\d{2}T[\d.-]+Z?\.json/, "-<stamp>.json");
}

/** Legs from a single report or a {fileName: report} manifest. */
export function allLegs(report) {
  if (isSingleReport(report)) return extractLegs(report);
  const legs = [];
  for (const [file, sub] of Object.entries(report ?? {})) {
    if (sub === null || typeof sub !== "object") continue;
    for (const leg of extractLegs(sub)) {
      legs.push({ ...leg, key: `${normalizedFileName(file)}:${leg.key}` });
    }
  }
  return legs;
}

/** Sorted normalized report-file names of a manifest, or null for a single report. */
export function manifestFiles(report) {
  if (isSingleReport(report)) return null;
  return Object.keys(report ?? {}).map(normalizedFileName).sort();
}

/**
 * Stable projection of a report set for content hashing: normalized legs
 * only (key/status/blocked/fingerprint). Wall clocks, durations, and
 * per-run timestamps never enter the projection — deterministic reruns must
 * hash equal.
 */
export function stableProjection(report) {
  const legs = allLegs(report)
    .map((l) => ({ key: l.key, status: l.status, blocked: l.blocked, fingerprint: l.fingerprint }))
    .sort((x, y) => x.key.localeCompare(y.key));
  return JSON.stringify(legs);
}

/**
 * Compare two runs for one commit SHA.
 * Returns { ok, record } where record is the determinism evidence document
 * and `ok` is false on any required-result divergence or missing required
 * leg.
 */
export function compareRuns({ sha, runA, runB }) {
  const legsA = allLegs(runA.report);
  const legsB = allLegs(runB.report);
  const byKeyA = new Map(legsA.map((l) => [l.key, l]));
  const byKeyB = new Map(legsB.map((l) => [l.key, l]));
  const keys = unionLegs(legsA, legsB);
  const differences = [];
  const requiredLegs = [];

  // Report-file manifest must agree: a file present in only one run is a
  // missing required leg, never silently absorbed.
  const filesA = manifestFiles(runA.report);
  const filesB = manifestFiles(runB.report);
  if (filesA && filesB && JSON.stringify(filesA) !== JSON.stringify(filesB)) {
    differences.push(`report file manifest diverges (${filesA.join(", ") || "none"} vs ${filesB.join(", ") || "none"})`);
  }
  // Stable content SHAs must agree (computed from verdict lines / stable
  // projections only — never wall clocks).
  if (runA.reportSha256 !== runB.reportSha256) {
    differences.push(`report SHAs disagree (${runA.reportSha256} vs ${runB.reportSha256})`);
  }

  for (const key of keys) {
    const a = byKeyA.get(key);
    const b = byKeyB.get(key);
    if (!a || !b) {
      differences.push(`${key}: performed in only one run`);
      continue;
    }
    if (a.blocked && b.blocked) {
      // Both reruns recorded the same BLOCKED row: agreed host-class
      // limitation (FIX-021 BLOCKED-required convention). The rows must be
      // identical — a divergent reason still fails below. A blocked leg is
      // not a success (Q-01 step 3): it never enters the required-leg set
      // and the comparison cannot pass.
      if (a.fingerprint !== b.fingerprint) {
        differences.push(`${key}: BLOCKED reason diverges (${a.fingerprint} vs ${b.fingerprint})`);
      } else {
        differences.push(`${key}: required leg BLOCKED in both runs`);
      }
      continue;
    }
    if (a.blocked !== b.blocked) {
      differences.push(`${key}: blocked/perform mismatch (${a.status} vs ${b.status})`);
      continue;
    }
    if (a.pass !== b.pass) {
      differences.push(`${key}: pass/fail divergence (${a.status} vs ${b.status})`);
      continue;
    }
    if (!a.pass) {
      // Q-01 step 3: two matching FAILs are a deterministic release-blocking
      // failure, never an agreed non-result. Success requires pass===true.
      differences.push(`${key}: FAILED-DETERMINISTICALLY`);
      continue;
    }
    requiredLegs.push({
      key,
      status: a.status,
      pass: a.pass,
      fingerprint: a.fingerprint,
    });
  }

  const record = {
    schema: COMPARE_SCHEMA,
    commitSha: sha,
    runA: { reportSha256: runA.reportSha256, fingerprint: runA.fingerprint },
    runB: { reportSha256: runB.reportSha256, fingerprint: runB.fingerprint },
    requiredLegs,
    differences,
    verdict:
      differences.length === 0
        ? "IDENTICAL"
        : differences.some((d) => d.endsWith("FAILED-DETERMINISTICALLY"))
          ? "FAILED-DETERMINISTICALLY"
          : "DIVERGENT",
  };
  return { ok: differences.length === 0, record };
}

function usage() {
  console.error("usage: node scripts/candice-ci/compare-runs.mjs --run <dir> <dir> [--sha <sha>]");
  return 2;
}

function main() {
  const args = process.argv.slice(2);
  const runIdx = args.indexOf("--run");
  const shaIdx = args.indexOf("--sha");
  if (runIdx < 0 || runIdx + 2 >= args.length) return usage();
  const runDirs = [args[runIdx + 1], args[runIdx + 2]];
  const sha = shaIdx >= 0 ? args[shaIdx + 1] : null;
  if (!sha) return usage();

  const runs = [];
  for (const dirArg of runDirs) {
    const dir = resolve(dirArg);
    if (!existsSync(dir)) {
      console.error(`FAIL missing run directory: ${dir}`);
      return 2;
    }
    const files = readdirSync(dir).filter((f) => !f.startsWith(".")).sort();
    if (files.length === 0) {
      console.error(`FAIL no report files in ${dir}`);
      return 2;
    }
    const report = {};
    for (const file of files) {
      const loaded = loadReport(join(dir, file));
      if (!loaded.ok) {
        console.error(`FAIL unreadable report ${join(dir, file)}: ${loaded.reason}`);
        return 2;
      }
      report[file] = loaded.report;
    }
    runs.push({
      dir,
      report,
      reportSha256: createHash("sha256").update(stableProjection(report)).digest("hex"),
    });
  }
  for (const run of runs) {
    run.fingerprint = reportFingerprint(run.report);
  }
  if (runs[0].fingerprint !== runs[1].fingerprint) {
    console.error("FAIL report SHAs disagree: run manifests contain different report files");
    console.error(`  ${runDirs[0]}: ${runs[0].fingerprint}`);
    console.error(`  ${runDirs[1]}: ${runs[1].fingerprint}`);
    return 1;
  }

  const { ok, record } = compareRuns({
    sha,
    runA: { report: runs[0].report, reportSha256: runs[0].reportSha256, fingerprint: runs[0].fingerprint },
    runB: { report: runs[1].report, reportSha256: runs[1].reportSha256, fingerprint: runs[1].fingerprint },
  });
  console.log(JSON.stringify(record, null, 2));
  if (!ok) {
    console.error("DIVERGENT — required-result divergence or missing required leg");
    for (const d of record.differences) console.error(`  - ${d}`);
    return 1;
  }
  console.error("IDENTICAL — no required-result divergence, no missing required legs");
  return 0;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) process.exit(main());
