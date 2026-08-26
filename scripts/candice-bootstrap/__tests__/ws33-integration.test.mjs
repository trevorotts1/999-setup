import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runAtomic, runDownloadGate, ATOMIC_INSTALL, VERIFY, DOWNLOAD_GATE, REGISTRY, installAssets } from "../install.mjs";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * WS-33 cross-lane integration tests: the bootstrap drives the WS-33 engine
 * through its CLI contracts (atomic-install.mjs / verify.mjs / download.mjs)
 * and the registry module — this lane never re-implements checksumming,
 * atomicity, or payload records.
 */

test("WS-33 engine paths resolve to real files in the updater lane", () => {
  assert.equal(existsSync(ATOMIC_INSTALL), true, ATOMIC_INSTALL);
  assert.equal(existsSync(VERIFY), true, VERIFY);
  assert.equal(existsSync(DOWNLOAD_GATE), true, DOWNLOAD_GATE);
  assert.equal(existsSync(REGISTRY), true, REGISTRY);
});

test("real atomic-install.mjs: stage -> install -> old-tree backup -> marker verify", () => {
  const root = mkdtempSync(join(tmpdir(), "candice-ws33-"));
  const staged = join(root, "staged");
  const target = join(root, "target");
  mkdirSync(staged, { recursive: true });
  writeFileSync(join(staged, "SKILL.md"), "# skill\n");
  writeFileSync(join(staged, ".candice-install-ok"), "marker\n");

  const r = runAtomic(staged, target, {});
  assert.equal(r.ok, true, r.message);
  assert.equal(existsSync(join(target, "SKILL.md")), true);

  // Second install backs up the old tree (never leaves a half-written target).
  const staged2 = join(root, "staged2");
  mkdirSync(staged2, { recursive: true });
  writeFileSync(join(staged2, "SKILL.md"), "# skill v2\n");
  writeFileSync(join(staged2, ".candice-install-ok"), "marker\n");
  const r2 = runAtomic(staged2, target, {});
  assert.equal(r2.ok, true, r2.message);
  assert.match(r2.message, /backed up/);
  assert.equal(existsSync(join(target, "SKILL.md")), true);

  rmSync(root, { recursive: true, force: true });
});

test("download gate refuses an unverifiable payload (fail closed, nothing lands on disk)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "candice-gate-"));
  const out = join(dir, "x.bin");
  const r = await runDownloadGate("candice-companion", "0.2.0", "win32", out);
  // No candice-companion payload is recorded for win32 -> the gate must refuse.
  assert.equal(r.ok, false);
  assert.match(r.message, /FAIL|no checksum record|refusing/i);
  assert.equal(existsSync(out), false, "refused payload must not land on disk");
  rmSync(dir, { recursive: true, force: true });
});

test("registry integration: pinned payload records resolve exactly (sha256 + filenames)", async () => {
  const reg = await import(pathToFileURL(REGISTRY).href);
  assert.equal(
    reg.resolveComponent("stt-assets", "whisper-1.9.2", "darwin").payload.sha256,
    "c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b",
  );
  assert.equal(reg.resolveComponent("tts-assets", "kokoro-model-files-v1.1", "any").payload.file, "kokoro-v1.0.fp16.onnx");
  assert.equal(reg.resolveComponent("tts-assets", "kokoro-model-files-v1.1", "voicepack").payload.file, "voices-v1.0.bin");
  assert.equal(reg.resolveComponent("stt-assets", "whisper-1.9.2", "win32").payload.file, "whisper-bin-x64.zip");
  // Unknown component -> undefined (fail closed upstream).
  assert.equal(reg.resolveComponent("does-not-exist", "1.0.0", "any"), undefined);
});
