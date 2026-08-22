#!/usr/bin/env node
/**
 * Candice STT asset verifier (WS-16).
 *
 * Verifies every pinned artifact before the runtime is allowed to use it:
 *   - the model file (ggml-tiny.en-q5_1.bin) against its SHA-256,
 *   - the whisper-cli binary is present and answers --version,
 *   - (installer/updater lanes) the runtime archives against the recorded
 *     archive SHA-256 — this lane verifies, it does not download.
 *
 * Usage:
 *   node verify-assets.mjs --model <path> [--binary <path>] [--json]
 *
 * Exit codes: 0 = all checks pass, 1 = a check failed (machine-readable when --json).
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { transcribe, checkRuntime, verifySha256, STT_MODEL, STT_MODEL_SHA256 } from './whisper-runtime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const readArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const hasFlag = (name) => args.includes(name);

const modelPath = readArg('--model') || process.env.CANDICE_STT_MODEL;
const binaryPath = readArg('--binary') || process.env.CANDICE_STT_BINARY || 'whisper-cli';
const asJson = hasFlag('--json');

const results = { model: null, runtime: null, status: 'PENDING' };

async function main() {
  if (!modelPath) {
    const msg = 'usage: node verify-assets.mjs --model <ggml-model.bin> [--binary <whisper-cli>] [--json]';
    if (asJson) {
      console.log(JSON.stringify({ status: 'ERROR', message: msg }, null, 2));
    } else {
      console.error(msg);
    }
    process.exit(2);
  }

  // 1. Model integrity
  const modelCheck = await verifySha256(modelPath, STT_MODEL_SHA256);
  results.model = {
    file: path.basename(modelPath),
    expected: STT_MODEL,
    expectedSha256: STT_MODEL_SHA256,
    ok: modelCheck.ok,
    reason: modelCheck.reason || null,
  };

  // 2. Runtime binary presence + version
  const runtimeCheck = await checkRuntime(binaryPath);
  results.runtime = {
    binary: binaryPath,
    ok: runtimeCheck.ok,
    version: runtimeCheck.version || null,
    reason: runtimeCheck.reason || null,
    detail: runtimeCheck.detail || null,
  };

  results.status = results.model.ok && results.runtime.ok ? 'PASS' : 'FAIL';

  if (asJson) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    const line = (ok, label, extra = '') => `${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`;
    console.log(line(results.model.ok, `model ${results.model.file}`, results.model.reason || ''));
    console.log(line(results.runtime.ok, `runtime ${binaryPath}`, results.runtime.version || results.runtime.reason || ''));
    console.log(`STATUS: ${results.status}`);
  }

  process.exit(results.status === 'PASS' ? 0 : 1);
}

main();
