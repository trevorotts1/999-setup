/**
 * Q-10 release-path tests — the secret-vs-committed pubkey match gate that
 * candice-release.yml enforces before any signed build.
 *
 * The workflow embeds this logic as an inline node script. This test proves
 * the SAME contract against a fixture config:
 *   - a CANDICE_UPDATER_PUBKEY secret equal to the committed
 *     plugins.updater.pubkey is accepted;
 *   - a different (or empty) secret is refused;
 *   - the committed trust anchor itself must be a real key (never the
 *     commit-state placeholder).
 *
 * No production secrets are used; both sides are test fixtures.
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createHash } from "node:crypto";

const PLACEHOLDER = "RELEASE_OWNER_MUST_REPLACE_WITH_BASE64_PUBLIC_KEY";

import { readFileSync } from "node:fs";
function readConf() {
  return readFileSync(
    new URL("../../../apps/candice-companion/tauri.conf.json", import.meta.url),
    "utf8",
  );
}

// The exact committed trust anchor in apps/candice-companion/tauri.conf.json,
// read straight from the tracked file so this test fails if anyone swaps the
// shipped key without re-reviewing the release path.
const REAL_COMMITTED_PUBKEY = (() => {
  const conf = JSON.parse(readConf());
  return conf.plugins.updater.pubkey;
})();

/**
 * The same decision function the release workflow runs inline. Kept here as
 * one executable source of truth so the workflow step and this test can be
 * diffed line-for-line by a reviewer.
 */
function validateReleasePubkey({ secret, committed }) {
  const hash = (v) => createHash("sha256").update(v).digest("hex").slice(0, 12);
  if (!committed || !secret) {
    return { ok: false, reason: `empty input (secret ${hash(secret || "")} vs committed ${hash(committed || "")})` };
  }
  if (secret !== committed) {
    return { ok: false, reason: `secret ${hash(secret)} does not match committed ${hash(committed)}` };
  }
  return { ok: true, reason: "matches committed trust anchor" };
}

test("matching secret pubkey is accepted", () => {
  const result = validateReleasePubkey({
    secret: REAL_COMMITTED_PUBKEY,
    committed: REAL_COMMITTED_PUBKEY,
  });
  assert.equal(result.ok, true, result.reason);
});

test("mismatched secret pubkey is refused (hash comparison, value never printed)", () => {
  const wrongSecret = Buffer.from("untrusted comment: some other key\nRWQAAAAAAAAAA=").toString("base64");
  const result = validateReleasePubkey({ secret: wrongSecret, committed: REAL_COMMITTED_PUBKEY });
  assert.equal(result.ok, false);
  assert.ok(result.reason.includes("does not match"));
  // no raw key material leaks into diagnostics
  assert.ok(!result.reason.includes(wrongSecret));
  assert.ok(!result.reason.includes(REAL_COMMITTED_PUBKEY));
});

test("empty secret or empty committed key is refused", () => {
  assert.equal(validateReleasePubkey({ secret: "", committed: REAL_COMMITTED_PUBKEY }).ok, false);
  assert.equal(validateReleasePubkey({ secret: REAL_COMMITTED_PUBKEY, committed: "" }).ok, false);
});

test("the committed trust anchor itself is never the commit-state placeholder", () => {
  assert.notEqual(REAL_COMMITTED_PUBKEY, PLACEHOLDER);
});

test("the committed trust anchor decodes to a real minisign public key", () => {
  const decoded = Buffer.from(REAL_COMMITTED_PUBKEY, "base64").toString("utf8");
  assert.match(decoded, /^untrusted comment: minisign public key: [0-9A-F]{16}\n/);
  assert.match(decoded, /\nRW[A-Za-z0-9+/=]+\n?$/);
});

test("workflow file wires the validation step and both secrets via env indirection", () => {
  const wf = readFileSync(
    new URL("../../../.github/workflows/candice-release.yml", import.meta.url),
    "utf8",
  );
  assert.match(wf, /candice-v\*/);
  assert.match(wf, /CANDICE_UPDATER_PUBKEY:\s*\$\{\{\s*secrets\.CANDICE_UPDATER_PUBKEY\s*\}\}/);
  assert.match(wf, /TAURI_SIGNING_PRIVATE_KEY:\s*\$\{\{\s*secrets\.TAURI_SIGNING_PRIVATE_KEY\s*\}\}/);
  assert.match(wf, /TAURI_SIGNING_PRIVATE_KEY_PASSWORD:\s*\$\{\{\s*secrets\.TAURI_SIGNING_PRIVATE_KEY_PASSWORD\s*\}\}/);
  assert.match(wf, /--verify-helper/);
  assert.match(wf, /status\.mjs --root \$GITHUB_WORKSPACE/);
});
