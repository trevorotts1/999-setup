import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { evaluateRelease } from "../status.mjs";

function fixture({ releaseReady = false, lifecycle = "REPAIR_IN_PROGRESS", openFixIds = ["FIX-001"] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "candice-release-gate-"));
  mkdirSync(join(root, "CONTROL"));
  writeFileSync(join(root, "CONTROL", "project_state.json"), JSON.stringify({ candice: { release_ready: releaseReady, repair_status: lifecycle } }));
  writeFileSync(join(root, "CONTROL", "release-gate.json"), JSON.stringify({
    schema: "candice/release-gate@1",
    lifecycle,
    openFixIds,
    requiredGates: { independentQc: "PENDING" },
    checklist: { requiredUnchecked: 1 },
    candidate: null,
    artifacts: [],
  }));
  return root;
}

test("release authority fails closed while repairs are open", () => {
  const result = evaluateRelease(fixture());
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("open fixes remain")));
  assert.ok(result.errors.some((error) => error.includes("required gate independentQc is PENDING")));
});

test("release authority refuses a manually toggled release flag without complete evidence", () => {
  const result = evaluateRelease(fixture({ releaseReady: true, lifecycle: "RELEASE_CANDIDATE", openFixIds: [] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("required checklist")));
  assert.ok(result.errors.some((error) => error.includes("candidate must contain")));
  assert.ok(result.errors.some((error) => error.includes("no signed release artifacts")));
});

test("release authority rejects a forged editable release-gate document", () => {
  const root = fixture({ releaseReady: true, lifecycle: "RELEASE_CANDIDATE", openFixIds: [] });
  const gatePath = join(root, "CONTROL", "release-gate.json");
  const fakeSha = "a".repeat(64);
  writeFileSync(gatePath, JSON.stringify({
    schema: "anything-else",
    lifecycle: "RELEASE_CANDIDATE",
    openFixIds: [],
    requiredGates: { madeUpGate: "PASS" },
    checklist: { requiredUnchecked: 0 },
    candidate: { commit: "b".repeat(40), tag: "v9.9.9" },
    artifacts: [{ name: "forged", url: "https://example.test/fake", sha256: fakeSha, signature: "forged", localPath: "fake.bin" }],
  }));
  writeFileSync(join(root, "fake.bin"), "forged");
  const result = evaluateRelease(root);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("release gate schema is anything-else")));
  assert.ok(result.errors.some((error) => error.includes("fixed release schema")));
  assert.ok(result.errors.some((error) => error.includes("operator release authority is not configured")));
});

test("CLI executes and fails closed through a symlinked path", () => {
  const root = fixture();
  const script = fileURLToPath(new URL("../status.mjs", import.meta.url));
  const link = join(mkdtempSync(join(tmpdir(), "candice-release-link-")), "status.mjs");
  symlinkSync(script, link);
  const result = spawnSync(process.execPath, [link, "--root", root], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /NOT_RELEASE_READY/);
});

// ---------------------------------------------------------------------------
// FIX-021 ciRequiredChecks evidence enforcement (plan section 5 negatives).
// Every test below must REFUSE release; the assertions pin the exact error
// the new fail-closed check emits, so a silently absorbed negative fails
// this suite.
// ---------------------------------------------------------------------------

const FULL_ARTIFACTS = [
  "commit-sha",
  "perf-report",
  "verifier-macos",
  "verifier-windows",
  "windows-shell-compat",
  "cargo-test-output",
  "determinism-evidence",
];

function validCiEvidence(overrides = {}) {
  return {
    commitSha: "a".repeat(40),
    runIds: ["12345678901", "12345678902"],
    requiredFailures: 0,
    requiredSkips: 0,
    continueOnErrorCount: 0,
    reportArtifacts: [...FULL_ARTIFACTS],
    windowsProduction: false,
    ...overrides,
  };
}

function ciFixture({ ciEvidence, workflowText = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "candice-release-ci-"));
  mkdirSync(join(root, "CONTROL"));
  writeFileSync(join(root, "CONTROL", "project_state.json"), JSON.stringify({ candice: { release_ready: true, repair_status: "RELEASE_CANDIDATE" } }));
  const gate = {
    schema: "candice/release-gate@1",
    lifecycle: "RELEASE_CANDIDATE",
    openFixIds: [],
    requiredGates: {
      independentQc: "PASS", packagedEndToEnd: "PASS", privacy: "PASS", visualParity: "PASS",
      cleanMachine: "PASS", macosSigningAndNotarization: "PASS",
      windowsSigningAndInteractiveSmoke: "PENDING", ciRequiredChecks: "PASS", supplyChain: "PASS",
    },
    checklist: { requiredUnchecked: 0 },
    candidate: null,
    artifacts: [],
  };
  if (ciEvidence !== undefined) gate.ciRequiredChecks = ciEvidence;
  writeFileSync(join(root, "CONTROL", "release-gate.json"), JSON.stringify(gate));
  if (workflowText !== null) {
    mkdirSync(join(root, ".github", "workflows"), { recursive: true });
    writeFileSync(join(root, ".github", "workflows", "candice-ci.yml"), workflowText);
  }
  return root;
}

function evaluateCi(overrides, workflowText) {
  return evaluateRelease(ciFixture({ ciEvidence: validCiEvidence(overrides), workflowText }));
}

test("injected skip in CI evidence refuses release", () => {
  const result = evaluateCi({ requiredSkips: 1 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("requiredSkips: 1")), result.errors.join("; "));
});

test("injected failure in CI evidence refuses release", () => {
  const result = evaluateCi({ requiredFailures: 1 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("requiredFailures: 1")), result.errors.join("; "));
});

test("single-run CI evidence refuses release", () => {
  const result = evaluateCi({ runIds: ["12345678901"] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("two distinct hosted run IDs")), result.errors.join("; "));
});

test("duplicate run IDs refuse release", () => {
  const result = evaluateCi({ runIds: ["12345678901", "12345678901"] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("two distinct hosted run IDs")), result.errors.join("; "));
});

test("mismatched commit SHA in CI evidence refuses release", () => {
  const root = ciFixture({
    ciEvidence: validCiEvidence({ commitSha: "f".repeat(40) }),
  });
  const gatePath = join(root, "CONTROL", "release-gate.json");
  const gate = JSON.parse(readFileSync(gatePath, "utf8"));
  gate.candidate = { commit: "e".repeat(40), tag: "v9.9.9" };
  writeFileSync(gatePath, JSON.stringify(gate));
  const result = evaluateRelease(root);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("does not equal the candidate commit")), result.errors.join("; "));
});

test("continue-on-error in the workflow file refuses release", () => {
  const workflow = `name: candice-ci
on: workflow_dispatch
jobs:
  macos-arm64:
    runs-on: macos-14
    steps:
      - name: verifier
        continue-on-error: true
        run: bash tests/macos/verify-macos.sh
`;
  const result = evaluateCi({}, workflow);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("contains continue-on-error: true")), result.errors.join("; "));
});

test("a clean workflow without continue-on-error emits no workflow-scan error", () => {
  const workflow = `name: candice-ci
on: workflow_dispatch
jobs:
  macos-arm64:
    runs-on: macos-14
    steps:
      - run: bash tests/macos/verify-macos.sh
`;
  const result = evaluateCi({}, workflow);
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((e) => e.includes("continue-on-error")), false, result.errors.join("; "));
});

test("windowsProduction true without interactive-smoke PASS refuses release", () => {
  const result = evaluateCi({ windowsProduction: true });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("windowsProduction must remain false")), result.errors.join("; "));
});

test("missing CI evidence record refuses release", () => {
  const result = evaluateRelease(ciFixture({ ciEvidence: undefined }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("evidence record is missing")), result.errors.join("; "));
});

test("missing uploaded report artifact in evidence refuses release", () => {
  const result = evaluateCi({ reportArtifacts: FULL_ARTIFACTS.slice(0, -1) });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("determinism-evidence")), result.errors.join("; "));
});

test("valid CI evidence with windowsProduction false emits no CI-evidence errors", () => {
  const result = evaluateCi({});
  assert.equal(result.ok, false);
  const ciErrors = result.errors.filter((e) => e.includes("ciRequiredChecks") || e.includes("windowsProduction") || e.includes("continue-on-error") || e.includes("run IDs"));
  assert.deepEqual(ciErrors, [], ciErrors.join("; "));
});
