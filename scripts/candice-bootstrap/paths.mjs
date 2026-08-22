#!/usr/bin/env node
/**
 * Candice fresh-install bootstrap — platform install paths (WS-31).
 *
 * Owned glob: `scripts/candice-bootstrap/**` (PROJECT-MANIFEST 9.2 WR-017).
 *
 * Resolves the per-component target directories under the bootstrap root
 * (state.mjs bootstrapRoot). Both platforms share one layout so the
 * installed-tree state document is portable:
 *
 *   <root>/skills/<skill>          bundled personal skills (shared config root
 *                                  linking happens in install.mjs)
 *   <root>/plugin/candice-integration
 *   <root>/app/Candice Companion.app (macOS)  |  <root>/app (Windows unpacked tree)
 *   <root>/assets/stt, /assets/tts
 *
 * No operator-specific absolute path is ever embedded (spec 24): every path
 * derives from HOME / LOCALAPPDATA at runtime.
 */
import { join } from "node:path";
import { bootstrapRoot } from "./state.mjs";

export function skillsDir(root) {
  return join(root, "skills");
}

export function pluginDir(root) {
  return join(root, "plugin", "candice-integration");
}

export function appDir(root) {
  return join(root, "app");
}

/** macOS .app bundle path inside the install root (prebuilt, never compiled). */
export function appBundlePath(root) {
  return join(appDir(root), "Candice Companion.app");
}

export function assetsDir(root, kind) {
  return join(root, "assets", kind);
}

/** whisper.cpp binary path for the current platform (macOS: whisper-cli). */
export function sttBinaryPath(root) {
  return join(assetsDir(root, "stt"), "whisper-cli");
}

export function sttBinaryPathWindows(root) {
  return join(assetsDir(root, "stt"), "whisper-cli.exe");
}

export function modelPath(root) {
  return join(assetsDir(root, "stt"), "ggml-tiny.en-q5_1.bin");
}

export function ttsModelPath(root, file) {
  return join(assetsDir(root, "tts"), file);
}

/** Resolve root once per process from env, so tests inject CANDICE_BOOTSTRAP_ROOT. */
export function resolvedRoot() {
  return bootstrapRoot(process.env, process.platform);
}
