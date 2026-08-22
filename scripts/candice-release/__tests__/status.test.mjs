import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
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
