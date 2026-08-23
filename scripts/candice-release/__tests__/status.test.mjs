import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { evaluateRelease, evaluateReleaseWithPin } from "../status.mjs";

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
    artifacts: [{ name: "forged", url: "https://example.test/fake", sha256: fakeSha, signature: "forged", localPath: "release-artifacts/fake.bin" }],
  }));
  mkdirSync(join(root, "release-artifacts"));
  writeFileSync(join(root, "release-artifacts", "fake.bin"), "forged");
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

// ---------------------------------------------------------------------------
// Q-03 key pin: the compiled OPERATOR_RELEASE_AUTHORITY_PUBLIC_KEY_SHA256 pin
// is authoritative once configured. These tests stand in for the configured
// state (the pin in this branch is still UNCONFIGURED) and prove that a key
// at the fixed repository location must hash to the pin, exactly as the code
// would enforce after FIX-024 sets a real pin. They are hermetic: no fixture
// asserts the pin value itself, only the code path that compares against it.
// ---------------------------------------------------------------------------

import { createHash, generateKeyPairSync } from "node:crypto";

// Real Ed25519 SPKI PEM, generated per run: the authority parses it with
// createPublicKey, and the pin covers its exact bytes.
function makeKeyBytes() {
  const { publicKey } = generateKeyPairSync("ed25519");
  return Buffer.from(publicKey.export({ type: "spki", format: "pem" }).toString("utf8"));
}

function keyPinFixture(keyFileText = null) {
  const root = fixture({ releaseReady: true, lifecycle: "RELEASE_CANDIDATE", openFixIds: [] });
  const CONTROL = join(root, "CONTROL");
  if (keyFileText !== null) writeFileSync(join(CONTROL, "release-authority.pub"), keyFileText);
  return root;
}

function makeCompiledPin(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("a key at the fixed repo location whose SHA-256 equals the compiled pin emits no key-pin error", () => {
  const keyBytes = makeKeyBytes();
  const root = keyPinFixture(keyBytes);
  const gatePath = join(root, "CONTROL", "release-gate.json");
  const gate = JSON.parse(readFileSync(gatePath, "utf8"));
  gate.candidate = { commit: "c".repeat(40), tag: "v9.9.9" };
  writeFileSync(gatePath, JSON.stringify(gate));
  const result = evaluateReleaseWithPin(root, makeCompiledPin(keyBytes));
  const keyErrors = result.errors.filter((e) => e.includes("release authority key"));
  assert.deepEqual(keyErrors, [], keyErrors.join("; "));
});

test("pin mismatch refuses release when the compiled pin differs from the key file hash", () => {
  const root = keyPinFixture(makeKeyBytes());
  const wrongPin = makeCompiledPin(makeKeyBytes());
  const result = evaluateReleaseWithPin(root, wrongPin);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => e.includes("operator release authority key hash does not equal the compiled OPERATOR_RELEASE_AUTHORITY_PUBLIC_KEY_SHA256 pin")),
    result.errors.join("; "),
  );
});

test("missing key file refuses release once a pin is configured", () => {
  const root = keyPinFixture(null);
  const result = evaluateReleaseWithPin(root, "a".repeat(64));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("operator release authority key is missing")), result.errors.join("; "));
});

test("the key pin is authoritative over the editable control document", () => {
  const root = keyPinFixture(makeKeyBytes());
  const gatePath = join(root, "CONTROL", "release-gate.json");
  const gate = JSON.parse(readFileSync(gatePath, "utf8"));
  gate.publicKeySha256 = "forged"; // an edited control document cannot change the pin
  writeFileSync(gatePath, JSON.stringify(gate));
  const result = evaluateReleaseWithPin(root, makeCompiledPin(makeKeyBytes()));
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => e.includes("hash does not equal the compiled OPERATOR_RELEASE_AUTHORITY_PUBLIC_KEY_SHA256 pin")),
    result.errors.join("; "),
  );
});

test("the key pin applies to the exact file bytes, not a re-hash of another file", () => {
  const keyBytes = makeKeyBytes();
  const root = keyPinFixture(keyBytes);
  const pinOfFixture = makeCompiledPin(keyBytes);
  const result = evaluateReleaseWithPin(root, pinOfFixture);
  const keyErrors = result.errors.filter((e) => e.includes("release authority key"));
  assert.deepEqual(keyErrors, [], keyErrors.join("; "));
});

// ---------------------------------------------------------------------------
// Q-03 steps 2-3: canonical payload + detached Ed25519 signature verification.
// The authority loads the pinned key and verifies each artifact signature
// against the canonical payload; a truthy non-signature can never pass.
// ---------------------------------------------------------------------------

import { sign as edSign, createHash as hashFn } from "node:crypto";
import { canonicalSignedPayload } from "../status.mjs";

const FULL_GATE_NAMES = Object.freeze([
  "independentQc", "packagedEndToEnd", "privacy", "visualParity", "cleanMachine",
  "macosSigningAndNotarization", "windowsSigningAndInteractiveSmoke",
  "ciRequiredChecks", "supplyChain",
]);

function signatureFixture({ commit = "d".repeat(40), tag = "v9.9.9", artifactOverrides = {}, keyBytes }) {
  const root = mkdtempSync(join(tmpdir(), "candice-release-sig-"));
  mkdirSync(join(root, "CONTROL"));
  writeFileSync(join(root, "CONTROL", "project_state.json"), JSON.stringify({ candice: { release_ready: true, repair_status: "RELEASE_CANDIDATE" } }));
  const artifactContent = Buffer.from("artifact bytes for signature fixture");
  const artifactSha = hashFn("sha256").update(artifactContent).digest("hex");
  const gate = {
    schema: "candice/release-gate@1",
    lifecycle: "RELEASE_CANDIDATE",
    openFixIds: [],
    requiredGates: Object.fromEntries(FULL_GATE_NAMES.map((n) => [n, n === "windowsSigningAndInteractiveSmoke" ? "PENDING" : "PASS"])),
    checklist: { requiredUnchecked: 0 },
    candidate: { commit, tag },
    ciRequiredChecks: {
      commitSha: commit,
      runIds: ["12345678901", "12345678902"],
      requiredFailures: 0,
      requiredSkips: 0,
      continueOnErrorCount: 0,
      reportArtifacts: ["commit-sha", "perf-report", "verifier-macos", "verifier-windows", "windows-shell-compat", "cargo-test-output", "determinism-evidence"],
      windowsProduction: false,
    },
    artifacts: [{ name: "candice-0.2.0.dmg", url: "https://example.test/candice-0.2.0.dmg", sha256: artifactSha, signature: "", localPath: "release-artifacts/candice-0.2.0.dmg", ...artifactOverrides }],
  };
  writeFileSync(join(root, "CONTROL", "release-gate.json"), JSON.stringify(gate));
  mkdirSync(join(root, "release-artifacts"));
  writeFileSync(join(root, "release-artifacts", "candice-0.2.0.dmg"), artifactContent);
  writeFileSync(join(root, "CONTROL", "release-authority.pub"), keyBytes);
  return { root, commit, tag, artifactSha, pin: makeCompiledPin(keyBytes) };
}

function payloadFor({ commit, tag, name, url, sha256 }) {
  return Buffer.from(canonicalSignedPayload({
    candidateCommit: commit,
    tag,
    artifactName: name,
    url,
    sha256,
  }), "utf8");
}

function signRecord(privateKey, { commit, tag, name, url, sha256 }) {
  return edSign(null, payloadFor({ commit, tag, name, url, sha256 }), privateKey).toString("base64");
}

function signatureErrors(result) {
  return result.errors.filter((e) => e.includes("signature"));
}

test("canonical signed payload is byte-exact", () => {
  const payload = canonicalSignedPayload({
    candidateCommit: "0123456789abcdef0123456789abcdef01234567",
    tag: "v0.2.0",
    artifactName: "candice-companion-0.2.0.dmg",
    url: "https://example.test/releases/candice-companion-0.2.0.dmg",
    sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  });
  assert.equal(payload, [
    "candidateCommit=0123456789abcdef0123456789abcdef01234567",
    "tag=v0.2.0",
    "artifactName=candice-companion-0.2.0.dmg",
    "url=https://example.test/releases/candice-companion-0.2.0.dmg",
    "sha256=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  ].join("\n"));
});

test("valid detached Ed25519 signature over the canonical payload emits no signature error", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keyBytes = Buffer.from(publicKey.export({ type: "spki", format: "pem" }).toString("utf8"));
  const { root, commit, tag, artifactSha } = signatureFixture({ keyBytes });
  const signature = signRecord(privateKey, { commit, tag, name: "candice-0.2.0.dmg", url: "https://example.test/candice-0.2.0.dmg", sha256: artifactSha });
  const gatePath = join(root, "CONTROL", "release-gate.json");
  const gate = JSON.parse(readFileSync(gatePath, "utf8"));
  gate.artifacts[0].signature = signature;
  writeFileSync(gatePath, JSON.stringify(gate));
  const result = evaluateReleaseWithPin(root, makeCompiledPin(keyBytes));
  assert.deepEqual(signatureErrors(result), [], signatureErrors(result).join("; "));
});

test("truthy non-signature string is rejected", () => {
  const keyBytes = makeKeyBytes();
  const { root } = signatureFixture({ keyBytes, artifactOverrides: { signature: "not-a-signature" } });
  const result = evaluateReleaseWithPin(root, makeCompiledPin(keyBytes));
  assert.equal(result.ok, false);
  assert.ok(signatureErrors(result).length > 0, result.errors.join("; "));
});

test("signature over a different payload is rejected", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keyBytes = Buffer.from(publicKey.export({ type: "spki", format: "pem" }).toString("utf8"));
  const { root, commit, tag } = signatureFixture({ keyBytes });
  // Sign the payload for a DIFFERENT artifact hash (tampered hash field).
  const forged = signRecord(privateKey, { commit, tag, name: "candice-0.2.0.dmg", url: "https://example.test/candice-0.2.0.dmg", sha256: "f".repeat(64) });
  const gatePath = join(root, "CONTROL", "release-gate.json");
  const gate = JSON.parse(readFileSync(gatePath, "utf8"));
  gate.artifacts[0].signature = forged;
  writeFileSync(gatePath, JSON.stringify(gate));
  const result = evaluateReleaseWithPin(root, makeCompiledPin(keyBytes));
  assert.equal(result.ok, false);
  assert.ok(signatureErrors(result).some((e) => e.includes("verification failed")), result.errors.join("; "));
});

test("signature from a different key pair is rejected", () => {
  const { publicKey, privateKey: otherPrivate } = generateKeyPairSync("ed25519");
  const keyBytes = Buffer.from(publicKey.export({ type: "spki", format: "pem" }).toString("utf8"));
  const { root, commit, tag, artifactSha } = signatureFixture({ keyBytes });
  const wrongKey = generateKeyPairSync("ed25519");
  const forged = signRecord(wrongKey.privateKey, { commit, tag, name: "candice-0.2.0.dmg", url: "https://example.test/candice-0.2.0.dmg", sha256: artifactSha });
  const gatePath = join(root, "CONTROL", "release-gate.json");
  const gate = JSON.parse(readFileSync(gatePath, "utf8"));
  gate.artifacts[0].signature = forged;
  writeFileSync(gatePath, JSON.stringify(gate));
  const result = evaluateReleaseWithPin(root, makeCompiledPin(keyBytes));
  assert.equal(result.ok, false);
  assert.ok(signatureErrors(result).some((e) => e.includes("verification failed")), result.errors.join("; "));
});

// ---------------------------------------------------------------------------
// QFIX-q3-paths: artifact localPath confinement. The designated
// release-artifacts/ root is code, not configuration: no control-document
// value may redirect artifact reads outside it, through it, or around it.
// ---------------------------------------------------------------------------

function pathAttackFixture({ localPath, setup } = {}) {
  const keyBytes = makeKeyBytes();
  const { root } = signatureFixture({ keyBytes, artifactOverrides: localPath === undefined ? {} : { localPath } });
  if (setup) setup(root);
  return { root, keyBytes };
}

function assertInvalidArtifactRecord(result) {
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("invalid artifact record")), result.errors.join("; "));
}

test("localPath outside the designated candidate-artifacts root is rejected", () => {
  const { root, keyBytes } = pathAttackFixture({ localPath: "candice-0.2.0.dmg" });
  const result = evaluateReleaseWithPin(root, makeCompiledPin(keyBytes));
  assertInvalidArtifactRecord(result);
});

test("localPath escaping the designated root via .. is rejected", () => {
  const { root, keyBytes } = pathAttackFixture({ localPath: "../outside.bin" });
  writeFileSync(join(root, "..", "outside.bin"), "escape bytes");
  const result = evaluateReleaseWithPin(root, makeCompiledPin(keyBytes));
  assertInvalidArtifactRecord(result);
});

test("absolute localPath is rejected even when it lands inside the root", () => {
  const keyBytes = makeKeyBytes();
  const { root } = signatureFixture({ keyBytes });
  const gatePath = join(root, "CONTROL", "release-gate.json");
  const gate = JSON.parse(readFileSync(gatePath, "utf8"));
  gate.artifacts[0].localPath = join(root, "release-artifacts", "candice-0.2.0.dmg");
  writeFileSync(gatePath, JSON.stringify(gate));
  const result = evaluateReleaseWithPin(root, makeCompiledPin(keyBytes));
  assertInvalidArtifactRecord(result);
});

test("a symlinked artifact file is rejected even when it points back inside the root", () => {
  const keyBytes = makeKeyBytes();
  const { root } = signatureFixture({ keyBytes, artifactOverrides: { localPath: "release-artifacts/linked.dmg" } });
  symlinkSync(join(root, "release-artifacts", "candice-0.2.0.dmg"), join(root, "release-artifacts", "linked.dmg"));
  const result = evaluateReleaseWithPin(root, makeCompiledPin(keyBytes));
  assertInvalidArtifactRecord(result);
});

test("a symlinked intermediate directory is rejected", () => {
  const keyBytes = makeKeyBytes();
  const { root } = signatureFixture({ keyBytes, artifactOverrides: { localPath: "release-artifacts/linked-dir/out.dmg" } });
  const outside = mkdtempSync(join(tmpdir(), "candice-outside-dir-"));
  writeFileSync(join(outside, "out.dmg"), "outside bytes");
  symlinkSync(outside, join(root, "release-artifacts", "linked-dir"));
  const result = evaluateReleaseWithPin(root, makeCompiledPin(keyBytes));
  assertInvalidArtifactRecord(result);
});

test("a symlinked candidate-artifacts root is rejected", () => {
  const keyBytes = makeKeyBytes();
  const { root } = signatureFixture({ keyBytes });
  const outside = mkdtempSync(join(tmpdir(), "candice-outside-root-"));
  writeFileSync(join(outside, "candice-0.2.0.dmg"), "outside bytes");
  rmSync(join(root, "release-artifacts"), { recursive: true, force: true });
  symlinkSync(outside, join(root, "release-artifacts"));
  const result = evaluateReleaseWithPin(root, makeCompiledPin(keyBytes));
  assertInvalidArtifactRecord(result);
});

test("a non-regular file (directory) as the artifact leaf is rejected", () => {
  const keyBytes = makeKeyBytes();
  const { root } = signatureFixture({ keyBytes, artifactOverrides: { localPath: "release-artifacts/subdir" } });
  mkdirSync(join(root, "release-artifacts", "subdir"));
  const result = evaluateReleaseWithPin(root, makeCompiledPin(keyBytes));
  assertInvalidArtifactRecord(result);
});

test("a plain file inside the designated root resolves and verifies", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keyBytes = Buffer.from(publicKey.export({ type: "spki", format: "pem" }).toString("utf8"));
  const { root, commit, tag, artifactSha } = signatureFixture({ keyBytes });
  const signature = signRecord(privateKey, { commit, tag, name: "candice-0.2.0.dmg", url: "https://example.test/candice-0.2.0.dmg", sha256: artifactSha });
  const gatePath = join(root, "CONTROL", "release-gate.json");
  const gate = JSON.parse(readFileSync(gatePath, "utf8"));
  gate.artifacts[0].signature = signature;
  writeFileSync(gatePath, JSON.stringify(gate));
  const result = evaluateReleaseWithPin(root, makeCompiledPin(keyBytes));
  assert.equal(result.errors.some((e) => e.includes("invalid artifact record")), false, result.errors.join("; "));
  assert.deepEqual(signatureErrors(result), [], signatureErrors(result).join("; "));
});

// ---------------------------------------------------------------------------
// Q-10: unsigned smoke artifacts must be rejected by the release authority.
// Merged-resolution note: QFIX-q3-paths confines artifact localPath to the
// designated release-artifacts/ root, so these Q-10 posture tests place their
// fixtures inside that root — same posture assertions, now composed with the
// confinement gate rather than bypassing it.
// ---------------------------------------------------------------------------

function artifactFixture(records) {
  const root = mkdtempSync(join(tmpdir(), "candice-release-artifact-"));
  mkdirSync(join(root, "CONTROL"));
  mkdirSync(join(root, "release-artifacts"));
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
    candidate: { commit: "c".repeat(40), tag: "v9.9.9" },
    artifacts: records,
    ciRequiredChecks: validCiEvidence(),
  };
  writeFileSync(join(root, "CONTROL", "release-gate.json"), JSON.stringify(gate));
  return root;
}

test("Q-10: unsigned smoke artifact with an updater claim is rejected by the release authority", () => {
  const root = artifactFixture([]);
  const artifactPath = join(root, "release-artifacts", "smoke.tar.gz");
  writeFileSync(artifactPath, "smoke bytes");
  const sha = createHash("sha256").update(readFileSync(artifactPath)).digest("hex");
  const gatePath = join(root, "CONTROL", "release-gate.json");
  const gate = JSON.parse(readFileSync(gatePath, "utf8"));
  gate.artifacts = [
    {
      name: "smoke-unsigned",
      url: "https://github.com/trevorotts1/999-setup/releases/download/candice-v9.9.9/smoke.tar.gz",
      sha256: sha,
      signature: "", // smoke builds produce no .sig
      updater: true, // but the record claims updater-ready posture
      localPath: "release-artifacts/smoke.tar.gz",
    },
  ];
  writeFileSync(gatePath, JSON.stringify(gate));
  const result = evaluateRelease(root);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("updater-ready posture")), result.errors.join("; "));
});

test("Q-10: a signed artifact record with a real signature passes the updater claim check", () => {
  const root = artifactFixture([]);
  const artifactPath = join(root, "release-artifacts", "release.tar.gz");
  writeFileSync(artifactPath, "release bytes");
  const sha = createHash("sha256").update(readFileSync(artifactPath)).digest("hex");
  const gatePath = join(root, "CONTROL", "release-gate.json");
  const gate = JSON.parse(readFileSync(gatePath, "utf8"));
  gate.artifacts = [
    {
      name: "release-signed",
      url: "https://github.com/trevorotts1/999-setup/releases/download/candice-v9.9.9/release.tar.gz",
      sha256: sha,
      signature: "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIG1pbmlzaWduIGRlbmV5IEJsYWNrQ0VPClJXdHBIS3A3bmFpdUJPTW9JWWUxZXJ3RjM2Y1lKMEtKUjh1ZkF0bjNEdnJNTElVNDhSTDdJSmlPZ1B4bVE1R2p3b2Z2ZkF0SE5hbVBQOXpSeStBM1ltbW1BPT0KdHJ1c3RlZCBjb21tZW50OiB0aW1lc3RhbXA6MTc4Mjg0ODQ0MyAgZmlsZTpjYW5kaWNlLnRhci5negpYbjFaL3pNMmVmd1NiZEFGRWpOVWZJVGZ5VUplTURBQXNSMDBxU2d4MVJCOStRS1I5WFVhYlN4eHRGNWt1Y2dnNk0xNENlQk5pRVdTTFRybC9PN1Y0aGc9PQo=",
      updater: true,
      localPath: "release-artifacts/release.tar.gz",
    },
  ];
  writeFileSync(gatePath, JSON.stringify(gate));
  const result = evaluateRelease(root);
  const q10Errors = result.errors.filter((e) => e.includes("updater-ready posture"));
  assert.deepEqual(q10Errors, [], q10Errors.join("; "));
});

test("Q-10: a symlinked artifact is refused by the release authority", () => {
  const root = artifactFixture([]);
  const target = join(root, "real.tar.gz");
  writeFileSync(target, "real bytes");
  const link = join(root, "release-artifacts", "link.tar.gz");
  symlinkSync(target, link);
  const sha = createHash("sha256").update(readFileSync(target)).digest("hex");
  const gatePath = join(root, "CONTROL", "release-gate.json");
  const gate = JSON.parse(readFileSync(gatePath, "utf8"));
  gate.artifacts = [
    {
      name: "symlinked",
      url: "https://github.com/trevorotts1/999-setup/releases/download/candice-v9.9.9/link.tar.gz",
      sha256: sha,
      signature: "sig",
      localPath: "release-artifacts/link.tar.gz",
    },
  ];
  writeFileSync(gatePath, JSON.stringify(gate));
  const result = evaluateRelease(root);
  assert.equal(result.ok, false);
  // Under the merged gates the confined resolver (QFIX-q3-paths) or the
  // regular-file lstat check (Q-10) may reject first; either refusal honors
  // the same invariant: a symlinked artifact never reaches distribution.
  assert.ok(
    result.errors.some((e) => e.includes("not a regular file") || e.includes("invalid artifact record")),
    result.errors.join("; "),
  );
});

// ---------------------------------------------------------------------------
// QFIX-adhoc: the macOS signing dimension accepts the honest ad-hoc alias
// "macosSigningAdhoc" as an alternative to "macosSigningAndNotarization".
// Exactly one of the two names must be present and PASS; both present is
// ambiguous and refused; neither present fails the schema-name check.
// ---------------------------------------------------------------------------

function aliasFixture({ macosGate }) {
  const root = mkdtempSync(join(tmpdir(), "candice-release-alias-"));
  mkdirSync(join(root, "CONTROL"));
  writeFileSync(join(root, "CONTROL", "project_state.json"), JSON.stringify({ candice: { release_ready: true, repair_status: "RELEASE_CANDIDATE" } }));
  const requiredGates = {
    independentQc: "PASS", packagedEndToEnd: "PASS", privacy: "PASS", visualParity: "PASS",
    cleanMachine: "PASS",
    windowsSigningAndInteractiveSmoke: "PENDING", ciRequiredChecks: "PASS", supplyChain: "PASS",
  };
  if (macosGate !== null) Object.assign(requiredGates, macosGate);
  const gate = {
    schema: "candice/release-gate@1",
    lifecycle: "RELEASE_CANDIDATE",
    openFixIds: [],
    requiredGates,
    checklist: { requiredUnchecked: 0 },
    candidate: { commit: "e".repeat(40), tag: "v1.0.0" },
    artifacts: [],
  };
  if (requiredGates.windowsSigningAndInteractiveSmoke === "PASS") {
    gate.ciRequiredChecks = {
      commitSha: "e".repeat(40),
      runIds: ["12345678901", "12345678902"],
      requiredFailures: 0,
      requiredSkips: 0,
      continueOnErrorCount: 0,
      reportArtifacts: [...FULL_ARTIFACTS],
      windowsProduction: false,
    };
  }
  writeFileSync(join(root, "CONTROL", "release-gate.json"), JSON.stringify(gate));
  return root;
}

test("macosSigningAdhoc alias satisfies the macOS signing gate", () => {
  const result = evaluateRelease(aliasFixture({ macosGate: { macosSigningAdhoc: "PASS" } }));
  assert.equal(result.ok, false); // authority pin still unconfigured — expected
  assert.ok(
    !result.errors.some((e) => e.includes("macosSigning")),
    `alias must not produce a macOS signing error; got: ${result.errors.join("; ")}`,
  );
});

test("original macosSigningAndNotarization name keeps working unchanged", () => {
  const result = evaluateRelease(aliasFixture({ macosGate: { macosSigningAndNotarization: "PASS" } }));
  assert.equal(result.ok, false);
  assert.ok(!result.errors.some((e) => e.includes("macosSigning")), result.errors.join("; "));
});

test("both macOS signing gate names present is ambiguous and refused", () => {
  const result = evaluateRelease(aliasFixture({ macosGate: { macosSigningAdhoc: "PASS", macosSigningAndNotarization: "PASS" } }));
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => e.includes("record exactly one")),
    `expected ambiguity refusal; got: ${result.errors.join("; ")}`,
  );
});

test("neither macOS signing name present refuses release (schema-name check)", () => {
  const result = evaluateRelease(aliasFixture({ macosGate: { macosSigningAdhoc: "PASS", macosSigningAndNotarization: undefined } }));
  // Simulate "neither present" by deleting both keys post-construction.
  const root = mkdtempSync(join(tmpdir(), "candice-release-alias-"));
  mkdirSync(join(root, "CONTROL"));
  writeFileSync(join(root, "CONTROL", "project_state.json"), JSON.stringify({ candice: { release_ready: true, repair_status: "RELEASE_CANDIDATE" } }));
  const gate = {
    schema: "candice/release-gate@1",
    lifecycle: "RELEASE_CANDIDATE",
    openFixIds: [],
    requiredGates: {
      independentQc: "PASS", packagedEndToEnd: "PASS", privacy: "PASS", visualParity: "PASS",
      cleanMachine: "PASS",
      windowsSigningAndInteractiveSmoke: "PENDING", ciRequiredChecks: "PASS", supplyChain: "PASS",
    },
    checklist: { requiredUnchecked: 0 },
    candidate: null,
    artifacts: [],
  };
  writeFileSync(join(root, "CONTROL", "release-gate.json"), JSON.stringify(gate));
  const result2 = evaluateRelease(root);
  assert.equal(result2.ok, false);
  const joined = result2.errors.join("; ");
  assert.ok(
    joined.includes("fixed release schema") || joined.includes("macosSigning"),
    `expected missing-macos-gate refusal; got: ${joined}`,
  );
  void result;
});

test("macosSigningAdhoc recorded as non-PASS still blocks release", () => {
  const result = evaluateRelease(aliasFixture({ macosGate: { macosSigningAdhoc: "PENDING" } }));
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => e.includes("required gate macosSigningAdhoc is PENDING, not PASS")),
    result.errors.join("; "),
  );
});
