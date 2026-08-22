#!/usr/bin/env node
/**
 * Candice bundled-component registry (WS-33).
 *
 * The single source of truth for every component the updater knows about
 * (MASTER-SPEC section 21, E.1 WS-33):
 *
 *   - PUBLISHED_PAYLOADS: components installed from a currently downloadable release
 *     artifact. Every SHA-256 here was verified on 2026-08-21 by direct
 *     download from the recorded source URL, then shasum -a 256. Sources are
 *     operator-controlled release locations only (github.com/trevorotts1/
 *     999-setup releases, the pinned upstream release tags recorded here);
 *     no ad-hoc third-party URL is ever discovered at runtime.
 *
 *   - REPO_TREE_COMPONENTS: skill/plugin trees installed FROM the repo
 *     checkout (spec 21 first hop: version check + self-update, then the
 *     installer links them from the checkout). These carry a version pin and
 *     a repo path, NOT a download hash — no fabricate: the release tarball
 *     records (hash + size + URL for github.com/trevorotts1/999-setup
 *     releases/download) are filled by the 9.4 release owner at publish time
 *     (verified 2026-08-21: trevorotts1/999-setup has 0 releases today).
 *
 * The verifier (verify.mjs) rejects every entry that is not a published
 * payload — an unverifiable component is never accepted (fail closed).
 */

/** Component identity used in downgrade/version comparisons. */
export const COMPONENTS = {
  "nine-router-setup": { kind: "skill", sourceType: "repo-tree" },
  "spec-protocol": { kind: "skill", sourceType: "repo-tree" },
  kaizen: { kind: "skill", sourceType: "repo-tree" },
  eli5: { kind: "skill", sourceType: "repo-tree" },
  bro: { kind: "skill", sourceType: "repo-tree" },
  "candice-integration": { kind: "plugin", sourceType: "repo-tree" },
  "candice-companion": { kind: "app", sourceType: "release" },
  "stt-assets": { kind: "asset", sourceType: "release" },
  "tts-assets": { kind: "asset", sourceType: "release" },
};

export const RELEASE_CHANNEL = "https://github.com/trevorotts1/999-setup/releases";
export const MANIFEST_NAME = "bundled-components.json";

/**
 * Placeholder for release-artifact checksums that cannot be computed on
 * this host. The darwin 0.2.0 DMG hash is now real (integrated build,
 * 2026-08-22); the win32 NSIS installer hash remains owed from a Windows
 * build. Entries carrying this hash are unverifiable by construction:
 * verify.mjs and download.mjs fail closed on them until the 9.4 release
 * owner computes and republishes the real hash.
 */
export const PLACEHOLDER_SHA256 = "0".repeat(64);

/**
 * @typedef {{
 *   file: string,
 *   sha256: string,
 *   sizeBytes: number,
 *   sourceUrl: string,
 * }} Payload
 */

/** @typedef {{ id: string, version: string, platform: string, kind: string, payload: Payload }} PublishedEntry */

/**
 * Verified, downloadable payloads. Keyed by `<id>@<version>@<platform>`.
 *
 * Every entry verified live 2026-08-21:
 *  - ggml-tiny.en-q5_1.bin  sha256 c77c5766…66c7c2b   (direct download, shasum match)
 *  - whisper-bin-x64.zip    49dcc16d…4d674a           (direct download, shasum match)
 *  - whisper-bin-Win32.zip  de170719…a7cf8f22         (direct download, shasum match)
 *  - Candice Companion_0.2.0_aarch64.dmg  f24f4bcb…b0dbaf  (integrated 0.2.0 build, 2026-08-22: npx tauri build exit 0, shasum -a 256 on the produced DMG; 2,686,932 B)
 *  - kokoro-v1.0.fp16.onnx  f3a290d3…77ac96           (direct download, shasum match)
 *  - kokoro-v1.0.int8.onnx   ae315a79…70ee9c           (WS-19 verified record)
 *  - voices-v1.0.bin        bca610b8…f1fbf7d           (direct download, shasum match)
 *
 * The int8/v1.0.bin pair were recorded by the WS-19 lane with the same
 * upstream source; the three largest payloads were re-verified byte-for-byte
 * by this lane's builder on the same date.
 *
 * @type {Record<string, PublishedEntry>}
 */
export const PUBLISHED_PAYLOADS = {
  // App records are intentionally absent until FIX-022 creates an approved
  // signed release candidate and the release authority passes. See
  // QUARANTINED_PAYLOADS for the historical 0.2.0 records.

  // ------------------------------------------------------------ stt assets
  "stt-assets@whisper-1.9.2@darwin": {
    id: "stt-assets",
    version: "whisper-1.9.2",
    platform: "darwin",
    kind: "asset",
    payload: {
      file: "ggml-tiny.en-q5_1.bin",
      sha256: "c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b",
      sizeBytes: 32166155,
      sourceUrl:
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en-q5_1.bin",
    },
  },
  "stt-assets@whisper-1.9.2@win32": {
    id: "stt-assets",
    version: "whisper-1.9.2",
    platform: "win32",
    kind: "asset",
    payload: {
      file: "whisper-bin-x64.zip",
      sha256: "49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a",
      sizeBytes: 8194445,
      sourceUrl:
        "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip",
    },
  },
  "stt-assets@whisper-1.9.2@win32-x86": {
    id: "stt-assets",
    version: "whisper-1.9.2",
    platform: "win32-x86",
    kind: "asset",
    payload: {
      file: "whisper-bin-Win32.zip",
      sha256: "de170719aebcb4794d695d449e179002db1fe03b862f21f5c34b2909a7cf8f22",
      sizeBytes: 5189502,
      sourceUrl:
        "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-Win32.zip",
    },
  },

  // ------------------------------------------------------------ tts assets
  "tts-assets@kokoro-model-files-v1.1@any": {
    id: "tts-assets",
    version: "kokoro-model-files-v1.1",
    platform: "any",
    kind: "asset",
    payload: {
      file: "kokoro-v1.0.fp16.onnx",
      sha256: "f3a290d384fbb27966d462905c71a46cef9e5fd00516b40df32a0b4afe77ac96",
      sizeBytes: 163527961,
      sourceUrl:
        "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.fp16.onnx",
    },
  },
  "tts-assets@kokoro-model-files-v1.1@int8": {
    id: "tts-assets",
    version: "kokoro-model-files-v1.1",
    platform: "int8",
    kind: "asset",
    payload: {
      file: "kokoro-v1.0.int8.onnx",
      sha256: "ae315a79b623f244700e4afb9246c46a26066782e049ba174bf3ba433970ee9c",
      sizeBytes: 114119327,
      sourceUrl:
        "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.int8.onnx",
    },
  },
  "tts-assets@kokoro-model-files-v1.1@voicepack": {
    id: "tts-assets",
    version: "kokoro-model-files-v1.1",
    platform: "voicepack",
    kind: "asset",
    payload: {
      file: "voices-v1.0.bin",
      sha256: "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
      sizeBytes: 28214398,
      sourceUrl:
        "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin",
    },
  },
};

/**
 * Components installed from the repo checkout (spec 21 first hop). Version
 * pins match the tree's VERSION files on 2026-08-21. Checksums are checked
 * for these by the version-and-integrity path, NOT by a download hash — the
 * install source is the repo tree itself.
 */
export const REPO_TREE_COMPONENTS = {
  "nine-router-setup": { id: "nine-router-setup", version: "1.17.0", repoPath: ".claude/skills/nine-router-setup" },
  "spec-protocol": { id: "spec-protocol", version: "1.17.0", repoPath: ".claude/skills/spec-protocol" },
  kaizen: { id: "kaizen", version: "1.1.0", repoPath: ".claude/skills/kaizen" },
  eli5: { id: "eli5", version: "1.1.0", repoPath: ".claude/skills/eli5" },
  bro: { id: "bro", version: "1.1.0", repoPath: ".claude/skills/bro" },
  "candice-integration": {
    id: "candice-integration",
    version: "1.0.0",
    repoPath: "plugins/candice-integration",
  },
};

/** Runtime pins carried alongside components (spec 21 — the manifest knows the runtime versions too). */
export const RUNTIME_PINS = {
  whisperCpp: "1.9.2",
  kokoroOnnx: "0.6.1",
  onnxruntime: "1.29.0",
  espeakngLoader: "0.2.4",
  python: "3.12",
};

/** Platform keys a given platform name resolves to. */
export function platformKeys(platform) {
  switch (platform) {
    case "darwin":
      return ["darwin", "any"];
    case "win32":
      return ["win32", "any"];
    default:
      return [platform];
  }
}

/** Resolve a published-payload record for an id/version/platform, or undefined. */
export function resolveComponent(id, version, platform) {
  for (const key of platformKeys(platform)) {
    const entry = PUBLISHED_PAYLOADS[`${id}@${version}@${key}`];
    if (entry) return entry;
  }
  return undefined;
}

/**
 * Compare two dot-separated versions. Returns 1 if a > b, -1 if a < b, 0 if equal.
 * Safe for single-component and numeric-prefixed versions.
 */
export function compareVersions(a, b) {
  const pa = normalizeVersion(a);
  const pb = normalizeVersion(b);
  const av = pa.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const bv = pb.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(av.length, bv.length);
  for (let i = 0; i < len; i += 1) {
    const x = av[i] ?? 0;
    const y = bv[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function normalizeVersion(v) {
  // Strip a leading "v" and any suffix after a space.
  return String(v).trim().replace(/^v/, "").split(/\s+/)[0];
}

/** Is `candidate` strictly newer than `installed`? */
export function isNewer(candidate, installed) {
  return compareVersions(candidate, installed) > 0;
}

/**
 * Is `candidate` older than `installed`? (downgrade detection)
 * Equal versions are NOT a downgrade.
 */
export function isDowngrade(candidate, installed) {
  return compareVersions(candidate, installed) < 0;
}
