import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
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
