#!/usr/bin/env node
/**
 * FIX-015 speech asset inventory generator (plan section 3B / 7).
 *
 * Deterministic machine-readable manifest of every speech artifact that
 * ships inside the app bundle. The committed SPEECH-INVENTORY.json is the
 * release record; this script regenerates it so the committed file and
 * the packaged tree can never drift silently.
 *
 * Honesty contract (plan section 3B):
 *  - an artifact present in the source tree is listed with real
 *    size + sha256, `bundled: true`;
 *  - an artifact the tree does NOT yet contain is listed from its
 *    pinned manifest identity with `bundled: false` — the inventory
 *    never invents a file, and `bundled: false` entries are how the
 *    health command reports capability absence;
 *  - this script performs NO downloads, NO network access, NO writes
 *    outside the app tree.
 *
 * Usage: node scripts/generate-speech-inventory.mjs
 * Output: src-tauri/speech-assets/SPEECH-INVENTORY.json
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..');
const SRC_TAURI = join(APP_ROOT, 'src-tauri');
const OUT_PATH = join(SRC_TAURI, 'speech-assets', 'SPEECH-INVENTORY.json');

/** Pinned identity records (single write point: lane manifests). */
const STT_RUNTIME = {
  name: 'whisper.cpp',
  version: '1.9.2',
  license: 'MIT',
  source: 'https://github.com/ggml-org/whisper.cpp',
};

const ENTRIES = [
  {
    id: 'stt-model',
    filename: 'ggml-tiny.en-q5_1.bin',
    path: ['stt', 'ggml-tiny.en-q5_1.bin'],
    version: STT_RUNTIME.version,
    license: 'MIT',
    arch: 'universal',
    sha256: 'c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b',
    sourceUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en-q5_1.bin',
    role: 'speech-to-text model (whisper.cpp ggml format)',
  },
  // sha256 is null ON PURPOSE, and this is the honest half of shipping a
  // working engine. What ships is NOT the Homebrew bottle: the bottle's
  // binary links /opt/homebrew dylibs a client does not have, so
  // scripts/relocate-whisper-macos.mjs copies the dependency closure next
  // to the binary and rewrites every install name to @loader_path. That
  // rewrite changes the bytes, so the bottle digest is no longer the hash
  // of the shipped file. Recording it as the pin anyway would put a false
  // statement in the one file whose entire job is to be true. The upstream
  // digest stays as PROVENANCE — what this was derived from — and the
  // shipped bytes carry their own measured hash.
  {
    id: 'stt-binary-macos',
    filename: 'whisper-cli',
    path: ['stt', 'whisper-cli'],
    version: STT_RUNTIME.version,
    license: 'MIT',
    arch: 'aarch64-apple-darwin',
    sha256: null,
    derivedFrom: {
      sourceUrl:
        'ghcr.io/v2/homebrew/core/whisper-cpp/blobs/sha256:c96d59cc9322a25f3b488b5f01d2a91aa6e2298ba2f39239108e1c85cb549460',
      sha256: 'c96d59cc9322a25f3b488b5f01d2a91aa6e2298ba2f39239108e1c85cb549460',
      transform: 'install_name_tool: dependency closure staged alongside, install names rewritten to @loader_path',
    },
    sourceUrl: 'relocated from the Homebrew bottle by scripts/relocate-whisper-macos.mjs',
    role: 'speech-to-text binary (macOS Apple Silicon, relocated whisper-cpp@1.9.2)',
  },
  // The engine's own libraries. They ship beside the binary because
  // @loader_path resolves from the binary's directory; without them the
  // first push-to-talk dies with a dyld error on a machine we cannot debug.
  ...['libwhisper.1.9.2.dylib', 'libggml.0.19.0.dylib', 'libggml-base.0.19.0.dylib', 'libomp.dylib'].map(
    (name) => ({
      id: `stt-lib-macos-${name.replace(/\.dylib$/, '').replace(/\./g, '-')}`,
      filename: name,
      path: ['stt', name],
      version: STT_RUNTIME.version,
      license: 'MIT',
      arch: 'aarch64-apple-darwin',
      sha256: null,
      sourceUrl: 'relocated from the Homebrew bottle by scripts/relocate-whisper-macos.mjs',
      role: `speech-to-text runtime library (${name}), loaded via @loader_path`,
    }),
  ),
  {
    id: 'stt-binary-windows-x64',
    filename: 'whisper-cli.exe',
    path: ['stt', 'whisper-cli.exe'],
    version: STT_RUNTIME.version,
    license: 'MIT',
    arch: 'x86_64-pc-windows-msvc',
    sha256: '95e3c0b0e778ad9499eb0125f97c1dcf437dd9eb4ea77050b043574f93c2631d',
    sourceUrl:
      'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip (Release/whisper-cli.exe)',
    role: 'speech-to-text binary (Windows x64)',
  },
  {
    id: 'stt-binary-windows-win32',
    filename: 'whisper-cli.exe',
    path: ['stt', 'whisper-cli-win32', 'whisper-cli.exe'],
    version: STT_RUNTIME.version,
    license: 'MIT',
    arch: 'i686-pc-windows-msvc',
    sha256: '850b471a9758aba01393ca8eecd0604d8a69026a0a701b976a6eedb4a236bf97',
    sourceUrl:
      'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-Win32.zip (Release/whisper-cli.exe)',
    role: 'speech-to-text binary (Windows 32-bit)',
  },
  {
    id: 'tts-model',
    filename: 'kokoro-v1.0.fp16.onnx',
    path: ['tts', 'runtime', 'kokoro-v1.0.fp16.onnx'],
    version: '1.0',
    license: 'Apache-2.0',
    arch: 'universal',
    sha256: 'f3a290d384fbb27966d462905c71a46cef9e5fd00516b40df32a0b4afe77ac96',
    sourceUrl: 'https://huggingface.co/hexgrad/Kokoro-82M',
    role: 'text-to-speech model (Kokoro-82M ONNX fp16)',
  },
  {
    id: 'tts-voices',
    filename: 'voices-v1.0.bin',
    path: ['tts', 'runtime', 'voices-v1.0.bin'],
    version: '1.0',
    license: 'Apache-2.0',
    arch: 'universal',
    sha256: 'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d',
    sourceUrl: 'https://huggingface.co/hexgrad/Kokoro-82M',
    role: 'text-to-speech voice pack (Kokoro voices, 54 voices)',
  },
  {
    id: 'tts-worker',
    filename: 'runtime.py',
    path: ['tts', 'runtime', 'runtime.py'],
    version: '0.6.1',
    license: 'MIT (worker script); runtime pins per src-tauri/tts/NOTICE.md',
    arch: 'universal',
    sha256: null, // measured from the live tree below
    sourceUrl: 'apps/candice-companion/src-tauri/tts/scripts/runtime.py',
    role: 'text-to-speech worker (Kokoro JSON-lines contract)',
  },
  {
    id: 'tts-runtime-pins',
    filename: 'requirements.txt',
    path: ['tts', 'runtime', 'requirements.txt'],
    version: '0.6.1',
    license: 'per-package; see src-tauri/tts/NOTICE.md (phonemizer/espeak-ng GPL-3.0 run as separate worker process)',
    arch: 'universal',
    sha256: null,
    sourceUrl: 'apps/candice-companion/src-tauri/tts/scripts/requirements.txt',
    role: 'text-to-speech Python runtime pins (kokoro-onnx==0.6.1, onnxruntime==1.29.0, espeakng-loader==0.2.4, phonemizer==3.4.0, numpy==2.5.2; Python 3.12)',
  },
];

function sha256Of(filePath) {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
}

function main() {
  const inventory = {
    schema: 'candice.speech-inventory/v1',
    generatedBy: 'scripts/generate-speech-inventory.mjs (FIX-015)',
    generatedAt: new Date().toISOString(),
    bundleRoot: 'speech-assets/',
    canonicalVoice: {
      id: 'af_bella',
      voicepackRelease: 'model-files-v1.1',
      // FIX-015 FAIL-6: the operator approval record landed 2026-08-25
      // (evidence/FIX-015/operator-review/VOICE-APPROVAL.md) — Trevor chose
      // af_bella after auditioning all 11 candidates. src-tauri/speech/mod.rs
      // reads this value and fails closed to approval-pending if it and
      // src-tauri/tts/voices.ts ever disagree, so keep them in step.
      approval: 'approved',
    },
    pythonRuntime: {
      version: '3.12',
      note: 'Bundled interpreter ships at speech-assets/tts/python/** (installer lane artifact). Until the installer places it, engine resolution falls back per the lane contract: CANDICE_PYTHON env, then bundled path, then "python3" dev fallback.',
    },
    entries: ENTRIES.map((entry) => {
      const abs = join(SRC_TAURI, 'speech-assets', ...entry.path);
      let present = false;
      let sizeBytes = null;
      let measuredSha256 = null;
      // The catch covers ONE question: is there a file here. Nothing else
      // may run inside it. The pin check below lived in here at first, and
      // its throw was swallowed by this very catch — so a tampered artifact
      // was quietly recorded as `absent` and the app degraded politely
      // around it. An integrity failure that presents as "not shipped" is
      // worse than no check at all.
      try {
        const st = statSync(abs);
        if (st.isFile()) {
          present = true;
          sizeBytes = st.size;
        }
      } catch {
        present = false;
      }
      if (present) {
        // Measure FIRST, then hold the pin to reality. This read
        // `entry.sha256 ?? sha256Of(abs)` — it preferred the DECLARED hash
        // and only measured when none was declared, so a present file whose
        // bytes disagreed with its pin was recorded as `pinned` carrying a
        // hash it did not have. A pin that cannot fail is decoration.
        measuredSha256 = sha256Of(abs);
        if (entry.sha256 !== null && entry.sha256 !== undefined && entry.sha256 !== measuredSha256) {
          throw new Error(
            `speech inventory: ${entry.id} is pinned to ${entry.sha256} but the file at ` +
              `${abs} measures ${measuredSha256}. Refusing to write an inventory that ` +
              `asserts a hash the shipped bytes do not have.`,
          );
        }
      }
      return {
        id: entry.id,
        filename: entry.filename,
        version: entry.version,
        license: entry.license,
        arch: entry.arch,
        sizeBytes: present ? sizeBytes : null,
        sha256: present ? measuredSha256 : entry.sha256,
        sha256Status: present
          ? (entry.sha256 === null ? 'measured-from-tree' : 'pinned')
          : 'absent',
        // QFIX Q-05: where the installer lane must place this artifact,
        // relative to the verified asset root (per-user dir or bundle
        // resource dir — the app resolves via this exact path).
        installPath: entry.path.join('/'),
        sourceUrl: entry.sourceUrl,
        ...(entry.derivedFrom ? { derivedFrom: entry.derivedFrom } : {}),
        role: entry.role,
        bundled: present,
        absentNote: present ? null : 'not present in the source tree; installer lane must place it before packaging',
      };
    }),
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
  console.log(`SPEECH-INVENTORY.json written: ${OUT_PATH}`);
  const bundled = inventory.entries.filter((e) => e.bundled).length;
  const absent = inventory.entries.filter((e) => !e.bundled).length;
  console.log(`entries=${inventory.entries.length} bundled=${bundled} absent=${absent} (honest record, no downloads)`);
}

main();
