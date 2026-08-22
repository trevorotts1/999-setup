import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { compareRuns, extractLegs, loadReport, unionLegs } from "../compare-runs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const COMPARE = join(here, "..", "compare-runs.mjs");
const SHA = "a".repeat(40);

function freshDir() {
  return mkdtempSync(join(tmpdir(), "candice-ci-compare-"));
}

/** Report object with a WS-45-style verdict. */
function legReport(legs, { verdict } = {}) {
  return { schemaVersion: 1, lane: "ws45", suite: "candice-performance", legs, verdict };
}

/** Two-dir fixture for the CLI. Writes identical file contents, returns dirs. */
function writePair(report) {
  const a = freshDir();
  const b = freshDir();
  const payload = JSON.stringify(report);
  writeFileSync(join(a, "perf-report.json"), payload);
  writeFileSync(join(b, "perf-report.json"), payload);
  return [a, b];
}

test("identical required verdicts produce IDENTICAL", () => {
  const report = legReport([
    { key: "macos-arm64: verifier", status: "PASS", record: { checked: 8 } },
    { key: "macos-arm64: ws45", status: "PASS", record: { metrics: 3 } },
    { key: "macos-arm64: cargo", status: "PASS", record: { crates: 6 } },
  ]);
  const runs = writePair(report);
  const { ok, record } = compareRuns({
    sha: SHA,
    runA: { report, reportSha256: "x", fingerprint: "f" },
    runB: { report, reportSha256: "x", fingerprint: "f" },
  });
  assert.equal(ok, true, JSON.stringify(record.differences));
  assert.equal(record.verdict, "IDENTICAL");
  assert.equal(record.requiredLegs.length, 3);
  rmSync(runs[0], { recursive: true, force: true });
  rmSync(runs[1], { recursive: true, force: true });
});

test("pass/fail divergence fails", () => {
  const a = legReport([
    { key: "macos-arm64: verifier", status: "PASS", record: { checked: 8 } },
  ]);
  const b = legReport([
    { key: "macos-arm64: verifier", status: "FAIL", record: { failed: 1 } },
  ]);
  const { ok, record } = compareRuns({
    sha: SHA,
    runA: { report: a, reportSha256: "x", fingerprint: "f" },
    runB: { report: b, reportSha256: "x", fingerprint: "f" },
  });
  assert.equal(ok, false);
  assert.equal(record.verdict, "DIVERGENT");
  assert.ok(record.differences.some((d) => d.includes("pass/fail divergence")));
});

test("a required skip in one run that the other lacks fails (injected-skip oracle)", () => {
  const a = legReport([
    { key: "macos-arm64: verifier", status: "PASS", record: { checked: 8 } },
    { key: "windows-x64: platform verifier", status: "SKIP", record: { reason: "injected" } },
  ]);
  const b = legReport([
    { key: "macos-arm64: verifier", status: "PASS", record: { checked: 8 } },
  ]);
  const { ok, record } = compareRuns({
    sha: SHA,
    runA: { report: a, reportSha256: "x", fingerprint: "f" },
    runB: { report: b, reportSha256: "x", fingerprint: "f" },
  });
  assert.equal(ok, false);
  assert.ok(record.differences.some((d) => d.includes("performed in only one run")));
});

test("the same BLOCKED row in both runs is an agreed host-class limitation (FIX-021 convention)", () => {
  const report = legReport([
    { key: "macos-arm64: verifier", status: "BLOCKED", record: { reason: "no host class" } },
  ]);
  const { ok, record } = compareRuns({
    sha: SHA,
    runA: { report, reportSha256: "x", fingerprint: "f" },
    runB: { report, reportSha256: "x", fingerprint: "f" },
  });
  assert.equal(ok, true, JSON.stringify(record.differences));
  assert.equal(record.verdict, "IDENTICAL");
  assert.equal(record.requiredLegs[0].blocked, true);
});

test("BLOCKED rows with divergent reasons fail", () => {
  const a = legReport([
    { key: "macos-arm64: verifier", status: "BLOCKED", record: { reason: "no host class" } },
  ]);
  const b = legReport([
    { key: "macos-arm64: verifier", status: "BLOCKED", record: { reason: "injected divergence" } },
  ]);
  const { ok, record } = compareRuns({
    sha: SHA,
    runA: { report: a, reportSha256: "x", fingerprint: "f" },
    runB: { report: b, reportSha256: "x", fingerprint: "f" },
  });
  assert.equal(ok, false);
  assert.ok(record.differences.some((d) => d.includes("BLOCKED reason diverges")));
});

test("report content SHA disagreement fails", () => {
  const report = legReport([
    { key: "macos-arm64: verifier", status: "PASS", record: { checked: 8 } },
  ]);
  const { ok, record } = compareRuns({
    sha: SHA,
    runA: { report, reportSha256: "aaa", fingerprint: "f" },
    runB: { report, reportSha256: "bbb", fingerprint: "f" },
  });
  assert.equal(ok, false);
  assert.ok(record.differences.some((d) => d.includes("report SHAs disagree")));
});

test("same-key failures with different fingerprints diverge (two reds are not a pass)", () => {
  const a = legReport([
    { key: "ws45", status: "FAIL", record: { reason: "gate A" } },
  ]);
  const b = legReport([
    { key: "ws45", status: "FAIL", record: { reason: "gate B" } },
  ]);
  const { ok, record } = compareRuns({
    sha: SHA,
    runA: { report: a, reportSha256: "x", fingerprint: "f" },
    runB: { report: b, reportSha256: "x", fingerprint: "f" },
  });
  assert.equal(ok, false);
  assert.ok(record.differences.some((d) => d.includes("fingerprint divergence")));
});

test("WS-45 verdict shape: failures and skip reasons become required legs", () => {
  const report = legReport([], {
    verdict: {
      ok: true,
      failures: ["ptt-release-to-transcript: not measured"],
      skippedReasons: ["windows/idle: requires a real Windows x64 host"],
    },
  });
  const legs = extractLegs(report);
  const keys = legs.map((l) => l.key);
  assert.ok(keys.some((k) => k.startsWith("failure-")));
  assert.ok(keys.some((k) => k.startsWith("skip-")));
  assert.ok(legs.find((l) => l.key.startsWith("skip-"))?.blocked === true);
});

test("extractLegs on a bare status report uses the status as a leg", () => {
  const legs = extractLegs({ status: "pass", reason: "ok" });
  assert.equal(legs.length, 1);
  assert.equal(legs[0].pass, true);
  const blocked = extractLegs({ status: "blocked", reason: "nope" });
  assert.equal(blocked[0].blocked, true);
});

test("unionLegs returns the sorted union of leg keys", () => {
  const a = [{ key: "b" }, { key: "a" }];
  const b = [{ key: "c" }, { key: "a" }];
  assert.deepEqual(unionLegs(a, b), ["a", "b", "c"]);
});

test("loadReport parses JSON and plain-text PASS/FAIL/SKIP logs", () => {
  const dir = freshDir();
  const jsonFile = join(dir, "r.json");
  writeFileSync(jsonFile, JSON.stringify({ status: "pass" }));
  assert.equal(loadReport(jsonFile).report.status, "pass");
  const txtFile = join(dir, "r.log");
  writeFileSync(txtFile, "PASS  check one\nFAIL  check two\nSKIP  check three\n");
  const text = loadReport(txtFile);
  assert.equal(text.report.legs.length, 3);
  assert.equal(text.report.legs[0].status, "PASS");
  assert.equal(text.report.legs[2].blocked, true);
  assert.equal(text.failed, true);
  rmSync(dir, { recursive: true, force: true });
});

test("CLI: identical pair exits 0 and prints the determinism record", () => {
  const report = legReport([
    { key: "macos-arm64: verifier", status: "PASS", record: { checked: 8 } },
  ]);
  const [a, b] = writePair(report);
  const r = spawnSync(process.execPath, [COMPARE, "--sha", SHA, "--run", a, b], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const record = JSON.parse(r.stdout);
  assert.equal(record.schema, "candice/ci/determinism@1");
  assert.equal(record.commitSha, SHA);
  assert.equal(record.verdict, "IDENTICAL");
  rmSync(a, { recursive: true, force: true });
  rmSync(b, { recursive: true, force: true });
});

test("CLI: divergent pair exits 1", () => {
  const aDir = freshDir();
  const bDir = freshDir();
  writeFileSync(join(aDir, "r.json"), JSON.stringify(legReport([
    { key: "verifier", status: "PASS", record: {} },
  ])));
  writeFileSync(join(bDir, "r.json"), JSON.stringify(legReport([
    { key: "verifier", status: "FAIL", record: {} },
  ])));
  const r = spawnSync(process.execPath, [COMPARE, "--sha", SHA, "--run", aDir, bDir], {
    encoding: "utf8",
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /DIVERGENT/);
  rmSync(aDir, { recursive: true, force: true });
  rmSync(bDir, { recursive: true, force: true });
});

test("CLI: missing --sha exits 2 with usage", () => {
  const [a, b] = writePair({ status: "pass" });
  const r = spawnSync(process.execPath, [COMPARE, "--run", a, b], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/);
  rmSync(a, { recursive: true, force: true });
  rmSync(b, { recursive: true, force: true });
});

test("CLI: missing run directory exits 2", () => {
  const [a] = writePair({ status: "pass" });
  const r = spawnSync(process.execPath, [COMPARE, "--sha", SHA, "--run", a, join(a, "nope")], {
    encoding: "utf8",
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /missing run directory/);
  rmSync(a, { recursive: true, force: true });
});
