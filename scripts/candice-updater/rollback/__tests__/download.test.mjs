/**
 * WS-33 download-gate tests (node:test).
 *
 * Proves the fail-closed contract WITHOUT network: unknown component refuses,
 * non-operator-controlled source refuses BEFORE any fetch happens, usage
 * errors exit 2. (The happy path — an actual staged download — is exercised
 * by the WS-49 regression lane against a local fixture server.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
const download = join(here, "..", "download.mjs");

function run(args) {
  try {
    const out = execFileSync(process.execPath, [download, ...args], { encoding: "utf8" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout ?? "") + String(e.stderr ?? "") };
  }
}

test("unknown component refuses before network (fail closed)", () => {
  const r = run(["--id", "not-real", "--version", "1.0.0", "--out", "/tmp/x.bin"]);
  assert.equal(r.code, 1);
  assert.match(r.out, /no checksum record/);
});

test("usage error without out path exits 2", () => {
  const r = run(["--id", "candice-companion", "--version", "0.2.0"]);
  assert.equal(r.code, 2);
});

test("repo-tree components are refused for download (no release checksum exists)", () => {
  // kaizen is a repo-tree component — no downloadable payload record.
  const r = run(["--id", "kaizen", "--version", "1.1.0", "--out", "/tmp/k.bin"]);
  assert.equal(r.code, 1);
  assert.match(r.out, /no checksum record/);
});
