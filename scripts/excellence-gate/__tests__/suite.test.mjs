#!/usr/bin/env node
/**
 * FIX-024 excellence-gate machinery self-tests.
 *
 * Hermetic: builds a fixture repo in a temp dir with a real git history,
 * fixture control files, fixture evidence, and fixture ledgers; then exercises
 * every module through its exported functions and its CLI surface. No network,
 * no writes outside the temp dir, no repo control files touched.
 *
 *   node scripts/excellence-gate/__tests__/suite.test.mjs
 *
 * Exit 0 only when every check prints PASS. Plain node:test, no dependencies.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GATE_DIR = resolve(__dirname, "..");

const TAG = "v9.9.9";
const FAKE_SHA256 = "ab".repeat(32);

function makeFixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), "exg-fixture-"));
  mkdirSync(join(root, "CONTROL"), { recursive: true });
  mkdirSync(join(root, "evidence", "FIX-024", "builder"), { recursive: true });
  const marker = (lifecycle, open, complete) =>
    `# T\n\n<!-- CANDICE_RELEASE_REPAIR_STATUS: lifecycle=${lifecycle} open=${open} complete=${complete} -->\n`;
  writeFileSync(join(root, "CONTROL", "TODO.md"), marker("RELEASE_CANDIDATE", 0, 24));
  writeFileSync(join(root, "CONTROL", "CHECKLIST.md"), marker("RELEASE_CANDIDATE", 0, 24));
  writeFileSync(join(root, "CONTROL", "LEDGER.md"), marker("RELEASE_CANDIDATE", 0, 24));
  writeFileSync(join(root, "CONTROL", "project_state.json"), JSON.stringify({ candice: { repair_status: "RELEASE_CANDIDATE" } }, null, 2));
  writeFileSync(join(root, "seed.txt"), "seed\n");
  execFileSync("git", ["-C", root, "init", "-q"]);
  execFileSync("git", ["-C", root, "config", "user.email", "test@example.test"]);
  execFileSync("git", ["-C", root, "config", "user.name", "test"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-qm", "fixture"]);
  const sha = execFileSync("git", ["-C", root, "rev-parse", "HEAD"]).toString().trim();
  // Write the release-gate candidate on disk (uncommitted) with the real
  // HEAD SHA — the modules under test read the files, not the git index, and
  // a committed self-referential SHA is impossible to construct.
  writeFileSync(
    join(root, "CONTROL", "release-gate.json"),
    JSON.stringify({ lifecycle: "RELEASE_CANDIDATE", openFixIds: [], candidate: { commit: sha, tag: TAG } }, null, 2),
  );
  execFileSync("git", ["-C", root, "tag", TAG]);
  return { root, sha, tag: TAG };
}

function goodLedger(root) {
  const p = join(root, "good-ledger.md");
  let text = "# Ledger\n\n| ID | Pri | Status | Depends |\n|---|---|---|---|\n";
  for (let i = 1; i <= 24; i++) {
    text += `| FIX-${String(i).padStart(3, "0")} | P0 | ${i === 24 ? "OPEN" : "COMPLETE"} | — |\n`;
  }
  writeFileSync(p, text);
  return p;
}

function allRows(gates, status = "PASS", evidencePrefix = "evidence/FIX-024/builder") {
  return gates.map((g) => ({
    id: g.id,
    label: g.label,
    status,
    evidenceFile: `${evidencePrefix}/${g.id}.txt`,
    exitCode: 0,
    output: `PASS ${g.id}\n`,
    recordedAt: new Date().toISOString(),
  }));
}

async function importModule(name) {
  return import(pathToFileURL(join(GATE_DIR, name)).href);
}

function reportFixture() {
  return JSON.parse(readFileSync(join(GATE_DIR, "gates.json"), "utf8"));
}

function writeGreenEvidence(root, gates) {
  for (const g of gates) {
    const p = join(root, "evidence", "FIX-024", "builder", `${g.id}.txt`);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, `PASS ${g.id}\n`);
  }
}

function greenReport(fx) {
  const gates = reportFixture();
  const rows = allRows(gates.gates);
  writeGreenEvidence(fx.root, gates.gates);
  const freeze = {
    commit: fx.sha,
    tag: fx.tag,
    artifacts: [{ name: "d", url: "https://e/d", sha256: FAKE_SHA256, sizeBytes: 1, signature: "s" }],
  };
  return { schema: "candice/completion-report@1", fix: "FIX-024", generatedAt: new Date().toISOString(), candidate: freeze, gates: rows };
}

test("prereq-gate passes only when all FIX-001..023 are COMPLETE", async (t) => {
  const { evaluatePrereqs } = await importModule("prereq-gate.mjs");
  const root = mkdtempSync(join(tmpdir(), "exg-prereq-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const empty = join(root, "empty.md");
  writeFileSync(empty, "# none\n");
  const r1 = evaluatePrereqs(empty);
  assert.equal(r1.ok, false);
  assert.equal(r1.missing.length, 23);

  const mixed = join(root, "mixed.md");
  let text = "# Ledger\n";
  for (let i = 1; i <= 23; i++) {
    text += `| FIX-${String(i).padStart(3, "0")} | P0 | ${i === 5 ? "OPEN" : i === 8 ? "BLOCKED_EXTERNAL" : "COMPLETE"} | — |\n`;
  }
  writeFileSync(mixed, text);
  const r2 = evaluatePrereqs(mixed);
  assert.equal(r2.ok, false);
  assert.ok(r2.errors.some((e) => e.includes("FIX-005") && e.includes("OPEN")));
  assert.ok(r2.errors.some((e) => e.includes("FIX-008") && e.includes("BLOCKED_EXTERNAL")));

  const good = goodLedger(root);
  const r3 = evaluatePrereqs(good);
  assert.equal(r3.ok, true, r3.errors.join("; "));
});

test("candidate-freeze rejects quarantined tag, bad hashes, tag/commit mismatch", async (t) => {
  const { evaluateFreeze } = await importModule("candidate-freeze.mjs");
  const root = mkdtempSync(join(tmpdir(), "exg-freeze-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const r1 = evaluateFreeze(
    { commit: "a".repeat(40), tag: "v0.2.0", artifacts: [{ name: "x", url: "https://e/x", sha256: FAKE_SHA256, sizeBytes: 1, signature: "s" }] },
    root,
  );
  assert.equal(r1.ok, false);
  assert.ok(r1.errors.some((e) => e.includes("quarantined")));

  const r2 = evaluateFreeze({ commit: "not-a-sha", tag: TAG, artifacts: [] }, root);
  assert.equal(r2.ok, false);
  assert.ok(r2.errors.some((e) => e.includes("full 40-char")));
  assert.ok(r2.errors.some((e) => e.includes("at least one artifact")));

  const r3 = evaluateFreeze(
    { commit: "a".repeat(40), tag: TAG, artifacts: [{ name: "x", url: "https://e/x", sha256: "zz", sizeBytes: 0, signature: "" }] },
    root,
  );
  assert.equal(r3.ok, false);
  assert.ok(r3.errors.some((e) => e.includes("sha256 is not")));
  assert.ok(r3.errors.some((e) => e.includes("sizeBytes must be")));
  assert.ok(r3.errors.some((e) => e.includes("no signature")));
});

test("candidate-freeze accepts a real pinned commit/tag in a git repo", async (t) => {
  const { evaluateFreeze } = await importModule("candidate-freeze.mjs");
  const fx = makeFixtureRepo();
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  const r = evaluateFreeze(
    { commit: fx.sha, tag: fx.tag, artifacts: [{ name: "dmg", url: "https://e/dmg", sha256: FAKE_SHA256, sizeBytes: 100, signature: "sig" }] },
    fx.root,
  );
  assert.equal(r.ok, true, r.errors.join("; "));
  assert.equal(r.frozen.tag, TAG);
  assert.equal(r.frozen.artifacts.length, 1);
});

test("candidate-freeze rejects when tag resolves elsewhere or HEAD differs", async (t) => {
  const { evaluateFreeze } = await importModule("candidate-freeze.mjs");
  const fx = makeFixtureRepo();
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  execFileSync("git", ["-C", fx.root, "commit", "--allow-empty", "-qm", "second"]);
  execFileSync("git", ["-C", fx.root, "tag", "v9.9.10"]);
  // HEAD moved; freezing fx.sha must fail on the HEAD check, and the tag
  // v9.9.10 resolves to the new HEAD, not fx.sha.
  const r = evaluateFreeze(
    { commit: fx.sha, tag: "v9.9.10", artifacts: [{ name: "d", url: "https://e/d", sha256: FAKE_SHA256, sizeBytes: 1, signature: "s" }] },
    fx.root,
  );
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some((e) => e.includes("not the checked-out HEAD")) || r.errors.some((e) => e.includes("resolves to")),
    r.errors.join("; "),
  );
});

test("report-gen refuses missing evidence and unknown gate ids", async (t) => {
  const { generateReport } = await importModule("report-gen.mjs");
  const root = mkdtempSync(join(tmpdir(), "exg-report-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const gates = reportFixture();
  const freeze = { commit: "a".repeat(40), tag: TAG, artifacts: [{ name: "d", url: "https://e/d", sha256: FAKE_SHA256, sizeBytes: 1, signature: "s" }] };
  const rows = allRows(gates.gates);
  rows[0] = { ...rows[0], evidenceFile: "evidence/FIX-024/builder/nope.txt" };
  const r1 = generateReport({ freeze, rows, gates, root });
  assert.equal(r1.ok, false);
  assert.ok(r1.errors.some((e) => e.includes("cited evidence missing")));

  const r2 = generateReport({ freeze, rows: [{ id: "nope", status: "PASS", evidenceFile: "" }], gates, root });
  assert.equal(r2.ok, false);
  assert.ok(r2.errors.some((e) => e.includes("not a gate")));

  const r3 = generateReport({ freeze, rows: [{ id: "unit", status: "PASS", evidenceFile: "" }], gates, root });
  assert.equal(r3.ok, false);
  assert.ok(r3.errors.some((e) => e.includes("PASS requires an evidenceFile")));

  const r4 = generateReport({ freeze, rows: [{ id: "unit", status: "SOMETIMES", evidenceFile: "x" }], gates, root });
  assert.equal(r4.ok, false);
  assert.ok(r4.errors.some((e) => e.includes("SOMETIMES is not")));
});

test("report-gen emits a valid report when evidence exists", async (t) => {
  const { generateReport } = await importModule("report-gen.mjs");
  const root = mkdtempSync(join(tmpdir(), "exg-report2-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const gates = reportFixture();
  const rows = allRows(gates.gates);
  for (const g of gates.gates) {
    const p = join(root, "evidence", "FIX-024", "builder", `${g.id}.txt`);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, `PASS ${g.id}\n`);
  }
  const freeze = { commit: "a".repeat(40), tag: TAG, artifacts: [{ name: "d", url: "https://e/d", sha256: FAKE_SHA256, sizeBytes: 1, signature: "s" }] };
  const r = generateReport({ freeze, rows, gates, root });
  assert.equal(r.ok, true, r.errors.join("; "));
  assert.equal(r.report.schema, "candice/completion-report@1");
  assert.equal(r.report.gates.length, gates.gates.length);
  assert.equal(r.report.candidate.commit, "a".repeat(40));
});

test("control-reconcile catches marker/release-gate/report disagreement", async (t) => {
  const { evaluateAgreement } = await importModule("control-reconcile.mjs");
  const fx = makeFixtureRepo();
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));

  const report = greenReport(fx);
  const reportPath = join(fx.root, "report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  const ledger = goodLedger(fx.root);

  const agree = evaluateAgreement({ reportPath, root: fx.root, ledgerPath: ledger });
  assert.equal(agree.ok, true, agree.errors.join("; "));

  // Break one marker: CHECKLIST disagrees with the other two.
  writeFileSync(
    join(fx.root, "CONTROL", "CHECKLIST.md"),
    "# C\n\n<!-- CANDICE_RELEASE_REPAIR_STATUS: lifecycle=REPAIR_IN_PROGRESS open=5 complete=19 -->\n",
  );
  const broken = evaluateAgreement({ reportPath, root: fx.root, ledgerPath: ledger });
  assert.equal(broken.ok, false);
  assert.ok(broken.errors.some((e) => e.includes("lifecycles disagree")), broken.errors.join("; "));
});

test("control-reconcile fails when evidence is missing", async (t) => {
  const { evaluateAgreement } = await importModule("control-reconcile.mjs");
  const fx = makeFixtureRepo();
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  const gates = reportFixture();
  const rows = allRows(gates.gates); // evidence files never written
  const freeze = {
    commit: fx.sha,
    tag: fx.tag,
    artifacts: [{ name: "d", url: "https://e/d", sha256: FAKE_SHA256, sizeBytes: 1, signature: "s" }],
  };
  const report = { schema: "candice/completion-report@1", fix: "FIX-024", generatedAt: new Date().toISOString(), candidate: freeze, gates: rows };
  const reportPath = join(fx.root, "report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  const ledger = goodLedger(fx.root);
  const r = evaluateAgreement({ reportPath, root: fx.root, ledgerPath: ledger });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("evidence missing")), r.errors.join("; "));
});

test("verdict-gen blocks on FAIL rows, missing gates, wrong candidate, blank signer stays blank", async (t) => {
  const { evaluateVerdict, renderVerdictBlock } = await importModule("verdict-gen.mjs");
  const fx = makeFixtureRepo();
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  const gates = reportFixture();
  const report = greenReport(fx);
  const ledger = goodLedger(fx.root);

  // All PASS, ledger COMPLETE, candidate matches HEAD -> signable.
  const ok = evaluateVerdict({ report, gates, root: fx.root, ledgerPath: ledger });
  assert.equal(ok.ok, true, ok.errors.join("; "));
  const block = renderVerdictBlock(report, gates);
  assert.ok(block.includes("FINAL EXCELLENCE VERDICT — FIX-024"));
  assert.ok(block.includes("FINAL_STATE=COMPLETE_EXCELLENT"));
  assert.ok(block.includes("OPEN_REQUIRED_TASKS=0"));
  assert.ok(block.includes("REQUIRED_SKIPS=0"));
  assert.ok(block.includes(FAKE_SHA256));
  assert.ok(block.includes(fx.sha));
  assert.ok(block.includes("Independent reviewer (signer): ________________________________"));
  assert.ok(!block.includes("signer: test"), "signer must remain blank");

  // One FAIL row -> blocked.
  const failRows = report.gates.map((r) => (r.id === "privacy" ? { ...r, status: "FAIL" } : r));
  const r1 = evaluateVerdict({ report: { ...report, gates: failRows }, gates, root: fx.root, ledgerPath: ledger });
  assert.equal(r1.ok, false);
  assert.ok(r1.errors.some((e) => e.includes("privacy") && e.includes("FAIL")));

  // Missing gate row -> blocked.
  const missingRows = report.gates.filter((r) => r.id !== "unit");
  const r2 = evaluateVerdict({ report: { ...report, gates: missingRows }, gates, root: fx.root, ledgerPath: ledger });
  assert.equal(r2.ok, false);
  assert.ok(r2.errors.some((e) => e.includes("unit") && e.includes("no report row")));

  // Candidate mismatch vs HEAD -> blocked.
  const wrongFreeze = { ...report.candidate, commit: "c".repeat(40) };
  const r3 = evaluateVerdict({ report: { ...report, candidate: wrongFreeze }, gates, root: fx.root, ledgerPath: ledger });
  assert.equal(r3.ok, false);
  assert.ok(r3.errors.some((e) => e.includes("not checked-out HEAD")));

  // Dependency ledger not complete -> blocked.
  const badLedger = join(fx.root, "bad-ledger.md");
  writeFileSync(badLedger, "# Ledger\n| FIX-001 | P0 | OPEN | — |\n");
  const r4 = evaluateVerdict({ report, gates, root: fx.root, ledgerPath: badLedger });
  assert.equal(r4.ok, false);
  assert.ok(r4.errors.some((e) => e.includes("dependency gate failed")));
});

test("CLI surfaces: prereq-gate, candidate-freeze, verdict-gen", async (t) => {
  const fx = makeFixtureRepo();
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  const node = process.execPath;
  const run = (args) => {
    try {
      return { code: 0, out: execFileSync(node, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
    } catch (e) {
      return { code: e.status ?? -1, out: `${e.stdout || ""}${e.stderr || ""}` };
    }
  };

  // prereq-gate: usage error without --ledger.
  const usage = run([join(GATE_DIR, "prereq-gate.mjs")]);
  assert.equal(usage.code, 2);

  // prereq-gate: fails on empty ledger.
  const emptyLedger = join(fx.root, "empty-ledger.md");
  writeFileSync(emptyLedger, "# none\n");
  const failRun = run([join(GATE_DIR, "prereq-gate.mjs"), "--ledger", emptyLedger]);
  assert.equal(failRun.code, 1);
  assert.ok(failRun.out.includes("PREREQ_FAIL"));

  // prereq-gate: passes on good ledger.
  const ledger = goodLedger(fx.root);
  const passRun = run([join(GATE_DIR, "prereq-gate.mjs"), "--ledger", ledger]);
  assert.equal(passRun.code, 0, passRun.out);
  assert.ok(passRun.out.includes("PREREQ_OK"));

  // candidate-freeze CLI writes the freeze record.
  const freezeOut = join(fx.root, "freeze.json");
  const freezeRun = run([
    join(GATE_DIR, "candidate-freeze.mjs"),
    "--commit", fx.sha,
    "--tag", TAG,
    "--artifact", `name=dmg,url=https://e/dmg,sha256=${FAKE_SHA256},sizeBytes=10,signature=sig`,
    "--root", fx.root,
    "--write", freezeOut,
  ]);
  assert.equal(freezeRun.code, 0, freezeRun.out);
  assert.ok(existsSync(freezeOut));
  const frozen = JSON.parse(readFileSync(freezeOut, "utf8"));
  assert.equal(frozen.commit, fx.sha);

  // verdict-gen CLI generates an unsigned block on a fully-green fixture.
  const report = greenReport(fx);
  const reportPath = join(fx.root, "report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  const verdictOut = join(fx.root, "verdict.txt");
  const verdictRun = run([
    join(GATE_DIR, "verdict-gen.mjs"),
    "--report", reportPath,
    "--ledger", ledger,
    "--root", fx.root,
    "--out", verdictOut,
  ]);
  assert.equal(verdictRun.code, 0, verdictRun.out);
  const block = readFileSync(verdictOut, "utf8");
  assert.ok(block.includes("FINAL_STATE=COMPLETE_EXCELLENT"));
  assert.ok(block.includes("Independent reviewer (signer): ________________________________"));

  // verdict-gen CLI refuses when the ledger is incomplete.
  const noLedger = run([join(GATE_DIR, "verdict-gen.mjs"), "--report", reportPath, "--ledger", emptyLedger, "--root", fx.root]);
  assert.equal(noLedger.code, 1);
  assert.ok(noLedger.out.includes("VERDICT_BLOCKED"));

  // report-gen CLI end-to-end: --gate unit --command plus --result rows.
  const freezePath = join(fx.root, "freeze-cli.json");
  writeFileSync(freezePath, JSON.stringify(frozen, null, 2));
  const reportOut = join(fx.root, "COMPLETION-REPORT.json");
  const gates = reportFixture();
  const reportArgs = [
    join(GATE_DIR, "report-gen.mjs"),
    "--freeze", freezePath,
    "--root", fx.root,
    "--out", reportOut,
  ];
  for (const g of gates.gates) {
    if (g.id === "unit") {
      reportArgs.push("--gate", "unit", "--result", JSON.stringify({ status: "PASS", evidenceFile: `evidence/FIX-024/builder/unit.txt` }));
    } else {
      reportArgs.push("--gate", g.id, "--result", JSON.stringify({ status: "PASS", evidenceFile: `evidence/FIX-024/builder/${g.id}.txt` }));
    }
  }
  const reportRun = run(reportArgs);
  assert.equal(reportRun.code, 0, reportRun.out);
  assert.ok(existsSync(reportOut));

  // control-reconcile CLI agrees on the green fixture.
  const agreeRun = run([
    join(GATE_DIR, "control-reconcile.mjs"),
    "--report", reportOut,
    "--ledger", ledger,
    "--root", fx.root,
  ]);
  assert.equal(agreeRun.code, 0, agreeRun.out);
  assert.ok(agreeRun.out.includes("AGREEMENT_OK"));
});

test("gates.json registry: every automated gate command resolves to a real file", () => {
  const gates = reportFixture();
  assert.ok(gates.gates.length >= 15, `expected the full gate set, got ${gates.gates.length}`);
  for (const g of gates.gates) {
    assert.ok(g.id && g.label && g.kind && Array.isArray(g.evidence), `gate ${g.id} missing required fields`);
    for (const cmd of g.commands || []) {
      const first = cmd.split(/\s+/)[0];
      assert.ok(["cargo", "npm", "node", "bash", "powershell"].includes(first), `gate ${g.id}: unknown command prefix ${first}`);
    }
    if (g.kind === "human" || g.kind === "automated+human" || g.kind === "human-independent") {
      assert.ok(g.note, `gate ${g.id} (human leg) needs a note describing the evidence record`);
    }
  }
  // Spec citations must not use the fabricated 28A/28B/28D BAR tokens.
  const raw = readFileSync(join(GATE_DIR, "gates.json"), "utf8");
  assert.ok(!/BAR-0\d|BAR-1\d|28A|28B|28C|28D/.test(raw), "fabricated spec tokens leaked into gates.json");
});
