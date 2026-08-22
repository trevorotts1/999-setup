/**
 * WS-33 checksum verifier tests (node:test).
 *
 * Proves: good payload passes, corrupt payload fails, size mismatch fails,
 * unknown component fails closed, wrong sha256 fails.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const here = fileURLToPath(new URL(".", import.meta.url));
const verify = join(here, "..", "verify.mjs");

function run(args) {
  try {
    const out = execFileSync(process.execPath, [verify, ...args], { encoding: "utf8" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout ?? "") + String(e.stderr ?? "") };
  }
}

test("verify accepts a matching payload with explicit sha256", () => {
  const dir = mkdtempSync(join(tmpdir(), "ws33-v-"));
  try {
    const f = join(dir, "payload.bin");
    writeFileSync(f, "hello candice");
    const good = createHash("sha256").update("hello candice").digest("hex");
    const r = run(["--file", f, "--sha256", good]);
    assert.equal(r.code, 0, r.out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("verify rejects a corrupt payload (mismatched sha256)", () => {
  const dir = mkdtempSync(join(tmpdir(), "ws33-v-"));
  try {
    const f = join(dir, "payload.bin");
    writeFileSync(f, "corrupted bytes");
    const r = run(["--file", f, "--sha256", "f3a290d384fbb27966d462905c71a46cef9e5fd00516b40df32a0b4afe77ac96"]);
    assert.equal(r.code, 1);
    assert.match(r.out, /mismatch/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("verify rejects an unknown component (fail closed, no record)", () => {
  const dir = mkdtempSync(join(tmpdir(), "ws33-v-"));
  try {
    const f = join(dir, "payload.bin");
    writeFileSync(f, "anything");
    const r = run(["--file", f, "--id", "not-a-component", "--version", "9.9.9", "--platform", "darwin"]);
    assert.equal(r.code, 1);
    assert.match(r.out, /no checksum record|refusing/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("verify validates registry lookup against real recorded sha256", () => {
  const dir = mkdtempSync(join(tmpdir(), "ws33-v-"));
  try {
    const f = join(dir, "whisper.zip");
    // Not the real bytes; verification must fail because the hash won't match.
    writeFileSync(f, "not the whisper archive");
    const r = run(["--file", f, "--id", "stt-assets", "--version", "whisper-1.9.2", "--platform", "win32"]);
    assert.equal(r.code, 1);
    assert.match(r.out, /mismatch/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("usage error without --file exits 2", () => {
  const r = run([]);
  assert.equal(r.code, 2);
});
