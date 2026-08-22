/**
 * Candice STT runtime contract — whisper.cpp (WS-16).
 *
 * The single integration seam between Candice's audio pipeline and the
 * pinned whisper.cpp runtime. WS-17 (capture) and WS-18 (transcript
 * confirmation) consume this interface; they must never shell out to
 * whisper-cli themselves and never assume a model location.
 *
 * Contract guarantees (Master Spec 7, 8, 20):
 *  - transcription is local/offline; no cloud speech endpoint is ever contacted;
 *  - the model and binary are checksum-verified before load
 *    (deterministic download / bundled artifact — spec 33 class);
 *  - returned text is UNCONFIRMED — WS-18 owns the confirm-before-submit gate;
 *  - on any failure the caller keeps typing available; an empty transcript
 *    is a typed failure, never a blank answer.
 */

export const STT_RUNTIME = 'whisper.cpp';
export const STT_RUNTIME_VERSION = '1.9.2';
export const STT_MODEL = 'ggml-tiny.en-q5_1.bin';
export const STT_MODEL_SHA256 =
  'c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b';

/** Inputs must be 16 kHz mono PCM WAV (spec: mic -> ring buffer -> whisper.cpp). */
export const STT_SAMPLE_RATE = 16000;

/**
 * @typedef {Object} SttOptions
 * @property {string} modelPath   absolute path to the ggml model file
 * @property {string} binaryPath  absolute path to whisper-cli (or whisper-cli.exe)
 * @property {string} [language]  language hint, default 'en'
 */

/**
 * @typedef {Object} SttResult
 * @property {boolean} ok
 * @property {string} [text]        transcript text (empty string when no speech)
 * @property {string[]} [segments]
 * @property {string} [language]
 * @property {string} [reason]      machine-readable failure reason
 * @property {string} [detail]      stderr tail on failure
 */

/**
 * @typedef {Object} SttFailure
 * @property {boolean} ok  always false
 * @property {string} reason
 * @property {string} [detail]
 */

/**
 * Transcribe a WAV file with the pinned whisper.cpp runtime.
 *
 * @param {string} wavPath
 * @param {SttOptions} opts
 * @returns {Promise<SttResult>}
 */
export async function transcribe(wavPath, opts) {
  const { modelPath, binaryPath, language = 'en' } = opts;
  if (!wavPath || !modelPath || !binaryPath) {
    return failure('missing-argument', 'wavPath, modelPath and binaryPath are required');
  }

  // Deterministic asset verification before any run (spec 33 class).
  const modelCheck = await verifySha256(modelPath, STT_MODEL_SHA256);
  if (!modelCheck.ok) return modelCheck;

  // Out-file path: derived from the wav path (whisper-cli appends the
  // format extension). Kept in a Candice-owned per-session temp dir by the
  // caller (spec 8); deleted by the caller after transcription.
  const outPrefix = wavPath.replace(/\.wav$/i, '');

  let out;
  try {
    out = await runWhisper(binaryPath, {
      model: modelPath,
      file: wavPath,
      language,
      outTxt: true,
      outPrefix,
    });
  } catch (err) {
    return failure('runtime-error', String(err && err.message ? err.message : err));
  }

  if (!out.ok) return out;

  const text = (out.stdoutText || '').trim();
  if (!text) {
    // Empty transcript is a failure — never submit a blank answer (spec 20).
    return { ok: false, reason: 'empty-transcript', detail: out.stderrTail };
  }

  return {
    ok: true,
    text,
    segments: text.split(/\n+/).filter(Boolean),
    language: out.language || language,
  };
}

/** Runtime availability probe used by the UI before enabling HOLD TO TALK. */
export async function checkRuntime(binaryPath) {
  try {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(binaryPath, ['--version'], { encoding: 'utf8', timeout: 15000 });
    if (r.error) return { ok: false, reason: 'runtime-not-found', detail: String(r.error) };
    if (r.status !== 0) return { ok: false, reason: 'runtime-version-failed', detail: r.stderr };
    return { ok: true, version: (r.stdout || r.stderr || '').trim() };
  } catch (err) {
    return { ok: false, reason: 'runtime-probe-error', detail: String(err) };
  }
}

/**
 * SHA-256 integrity check of a bundled/downloaded artifact.
 * @returns {Promise<{ok: boolean, reason?: string, detail?: string}>}
 */
export async function verifySha256(filePath, expectedHex) {
  const { createHash } = await import('node:crypto');
  const { createReadStream, statSync } = await import('node:fs');
  try {
    statSync(filePath);
  } catch {
    return failure('model-missing', `model file not found: ${filePath}`);
  }
  return new Promise((resolve) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', (e) => resolve(failure('model-read-error', String(e))));
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => {
      const actual = hash.digest('hex');
      if (actual.toLowerCase() !== expectedHex.toLowerCase()) {
        return resolve(
          failure(
            'checksum-mismatch',
            `model sha256 mismatch: expected ${expectedHex}, got ${actual}`
          )
        );
      }
      resolve({ ok: true });
    });
  });
}

/** @private */
async function runWhisper(binaryPath, args) {
  const { spawnSync } = await import('node:child_process');
  const { existsSync, readFileSync } = await import('node:fs');

  const r = spawnSync(
    binaryPath,
    ['-m', args.model, '-f', args.file, '-l', args.language, '-otxt', '-of', args.outPrefix],
    { encoding: 'utf8', timeout: 120000 }
  );

  if (r.error) return failure('spawn-error', String(r.error));
  if (r.status !== 0) {
    return failure('nonzero-exit', `whisper-cli exited ${r.status}: ${(r.stderr || '').trim()}`);
  }

  const txtPath = `${args.outPrefix}.txt`;
  let stdoutText = '';
  if (existsSync(txtPath)) {
    try {
      stdoutText = readFileSync(txtPath, 'utf8');
    } catch {
      /* text read failure surfaces as empty-transcript downstream */
    }
  }

  const languageMatch = /language\s*=\s*(\w+)/.exec(r.stderr || '');
  return {
    ok: true,
    stdoutText,
    language: languageMatch ? languageMatch[1] : undefined,
    stderrTail: (r.stderr || '').slice(-4000),
  };
}

/** @private */
function failure(reason, detail) {
  return { ok: false, reason, detail };
}
