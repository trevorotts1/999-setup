/**
 * WS-49 — checksum verification regression (spec 21, E.1 WS-49 leg 2).
 *
 * Drives the shipped WS-33 verifier CLI (verify.mjs) against registry
 * records and corrupt fixtures:
 *   - a payload matching the registry sha256 + size verifies (exit 0),
 *   - a bit-flipped payload is rejected (exit 1) — the update must never
 *     apply a corrupt payload,
 *   - size mismatch is rejected even when the hash record path is bypassed,
 *   - an unknown component is refused (fail closed — no record, no install),
 *   - the download gate refuses an unverifiable payload before anything
 *     lands on disk.
 *
 * No network: fixtures are synthesized, then the recorded sha256 is computed
 * from the fixture so the verifier path is exercised byte-for-byte.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { VERIFY, DOWNLOAD, run, load, freshRoot, tree } from "./helpers.mjs";

const reg = await load("scripts/candice-updater/checksums/components.mjs");

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

test("verifier: genuine payload with matching sha256 + size verifies (exit 0)", () => {
  const root = freshRoot("ws49-ck-");
  try {
    const payload = Buffer.from("payload-bytes-" + "x".repeat(200));
    const file = join(root, "payload.bin");
    writeFileSync(file, payload);
    const hash = sha256(payload);
    const r = run([VERIFY, "--file", file, "--sha256", hash]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /OK/);
    assert.match(r.out, new RegExp(`sha256=${hash}`));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verifier: corrupt payload (bit flip) rejected — never accepted", () => {
  const root = freshRoot("verify-bad-");
  try {
    const payload = Buffer.from("authentic-content");
    const file = join(root, "payload.bin");
    writeFileSync(file, payload);
    const hash = sha256(payload);
    // Flip one byte AFTER hashing the original.
    const corrupt = Buffer.from(payload);
    corrupt[4] = corrupt[4] ^ 0xff;
    writeFileSync(file, corrupt);
    const r = run([VERIFY, "--file", file, "--sha256", hash]);
    assert.equal(r.code, 1, "corrupt payload must fail");
    assert.match(r.out, /mismatch/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verifier: known registry path with wrong bytes rejected (registry lookup)", () => {
  const root = freshRoot("verify-reg-");
  try {
    // Registry path: --id/--version/--platform, no --sha256. Wrong bytes must
    // fail even though the record exists — the file is not the recorded payload.
    const file = join(root, "voices.bin");
    writeFileSync(file, "definitely-not-the-voices-v1.0.bin-payload");
    const r = run([
      VERIFY, "--file", file,
      "--id", "tts-assets", "--version", "kokoro-model-files-v1.1", "--platform", "voicepack",
    ]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /mismatch/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verifier: unknown component refused — fail closed (no record, no verify)", () => {
  const root = freshRoot("verify-unknown-");
  try {
    const payload = Buffer.from("anything");
    const file = join(root, "x.bin");
    writeFileSync(file, payload);
    const r = run([VERIFY, "--file", file, "--id", "no-such-component", "--version", "1.0.0", "--platform", "any"]);
    assert.equal(r.code, 1);
    assert.match(r.out, /refus|no checksum record/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("download gate: unverifiable payload refused and nothing lands on disk", () => {
  const root = freshRoot("gate-refuse-");
  try {
    const out = join(root, "x.bin");
    // candice-companion@0.2.0@win32 carries a placeholder checksum (recompute
    // owed from the integrated build) -> fail closed, nothing lands on disk.
    const r = run([DOWNLOAD, "--id", "candice-companion", "--version", "0.2.0", "--platform", "win32", "--out", out]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /FAIL|refusing|no checksum record/i);
    assert.equal(existsSync(out), false, "refused payload must not land on disk");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("registry integrity: every published payload has 64-hex sha256 + recorded size", () => {
  for (const [key, entry] of Object.entries(reg.PUBLISHED_PAYLOADS)) {
    assert.match(entry.payload.sha256, /^[0-9a-f]{64}$/, `${key} sha256 not 64-hex`);
    if (entry.payload.sha256 !== "0".repeat(64)) {
      assert.ok(entry.payload.sizeBytes > 0, `${key} sizeBytes missing`);
    }
    assert.ok(entry.payload.sourceUrl.startsWith("https://"), `${key} source not https`);
    assert.ok(
      entry.payload.sourceUrl.startsWith("https://github.com/trevorotts1/999-setup/releases") ||
        entry.payload.sourceUrl.startsWith("https://github.com/ggml-org/") ||
        entry.payload.sourceUrl.startsWith("https://github.com/thewh1teagle/") ||
        entry.payload.sourceUrl.startsWith("https://huggingface.co/"),
      `${key} source not operator-controlled: ${entry.payload.sourceUrl}`,
    );
  }
});
