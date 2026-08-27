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
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const here = fileURLToPath(new URL(".", import.meta.url));
const download = join(here, "..", "download.mjs");
const controlManifest = join(here, "..", "..", "..", "..", "CONTROL", "bundled-components.json");

function run(args) {
  try {
    const out = execFileSync(process.execPath, [download, ...args], { encoding: "utf8" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout ?? "") + String(e.stderr ?? "") };
  }
}

/** A caller-supplied manifest whose payload record declares an evil sourceUrl. */
function evilManifest(sourceUrl) {
  const dir = mkdtempSync(join(tmpdir(), "candice-dl-evil-"));
  const file = join(dir, "evil-manifest.json");
  writeFileSync(
    file,
    JSON.stringify({
      components: {
        "stt-assets": [
          {
            version: "whisper-1.9.2",
            platform: "darwin",
            file: "ggml-tiny.en-q5_1.bin",
            sha256: "a".repeat(64),
            sizeBytes: 1,
            sourceUrl,
          },
        ],
      },
    }),
  );
  return { dir, file };
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

test("candice-companion is refused before network even when a legacy manifest is supplied", () => {
  const r = run([
    "--id", "candice-companion",
    "--version", "0.2.0",
    "--platform", "darwin",
    "--manifest", controlManifest,
    "--out", "/tmp/candice-quarantine-test.bin",
  ]);
  assert.equal(r.code, 1);
  assert.match(r.out, /custom manifests cannot authorize candice-companion downloads/);
});

test("FIX-018 allow-list: a bare github.com source is refused before any fetch", () => {
  const m = evilManifest("https://github.com/evil-org/evil-repo/releases/download/v1/payload.bin");
  try {
    const r = run([
      "--id", "stt-assets",
      "--version", "whisper-1.9.2",
      "--platform", "darwin",
      "--manifest", m.file,
      "--out", join(m.dir, "out.bin"),
    ]);
    assert.equal(r.code, 1);
    assert.match(r.out, /source not operator-controlled/);
  } finally {
    rmSync(m.dir, { recursive: true, force: true });
  }
});

test("FIX-018 allow-list: a bare huggingface.co source is refused before any fetch", () => {
  const m = evilManifest("https://huggingface.co/evil-org/evil-model/resolve/main/payload.bin");
  try {
    const r = run([
      "--id", "stt-assets",
      "--version", "whisper-1.9.2",
      "--platform", "darwin",
      "--manifest", m.file,
      "--out", join(m.dir, "out.bin"),
    ]);
    assert.equal(r.code, 1);
    assert.match(r.out, /source not operator-controlled/);
  } finally {
    rmSync(m.dir, { recursive: true, force: true });
  }
});

test("FIX-018 allow-list: a lookalike operator channel on another host is refused before any fetch", () => {
  const m = evilManifest("https://github.com.evil-cdn.net/trevorotts1/999-setup/releases/download/v1/payload.bin");
  try {
    const r = run([
      "--id", "stt-assets",
      "--version", "whisper-1.9.2",
      "--platform", "darwin",
      "--manifest", m.file,
      "--out", join(m.dir, "out.bin"),
    ]);
    assert.equal(r.code, 1);
    assert.match(r.out, /source not operator-controlled/);
  } finally {
    rmSync(m.dir, { recursive: true, force: true });
  }
});
