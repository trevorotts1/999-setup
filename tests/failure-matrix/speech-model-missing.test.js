'use strict'

/**
 * candice failure matrix — speech model missing — owned path: tests/failure-matrix/**
 *
 * E.1 WS-43 "speech model missing" leg. Drives the REAL WS-16 whisper runtime
 * (`verifySha256` refuses missing model files, `transcribe` refuses missing
 * model/binary before any run, `checkRuntime` reports runtime-not-found) and
 * the REAL WS-19 TTS fallback ladder (`isSystemTtsAvailable` false until a
 * platform adapter registers — the system-TTS fallback must NOT be claimed
 * when nothing is wired; the ladder degrades to captions-only, spec 20).
 *
 * Invariants: a missing model/binary is a named failure with typing still
 * available — never a crash, never a blank answer, never a cloud endpoint.
 */

const assert = require('assert')
const path = require('path')
const fsp = require('node:fs/promises')
const os = require('node:os')
const { check, checkAsync, finish } = require('./harness')

const STT = require(
  path.join(__dirname, '..', '..', 'apps', 'candice-companion', 'src-tauri', 'stt', 'runtime', 'whisper-runtime.mjs')
)
const { transcribe, checkRuntime, verifySha256, STT_MODEL, STT_MODEL_SHA256 } = STT

const TTS = require(
  path.join(__dirname, '..', '..', 'apps', 'candice-companion', 'src-tauri', 'tts', 'fallback.ts')
)
const { isSystemTtsAvailable, speakWithSystemTts } = TTS

async function main() {
  // ---- STT model missing. ----
  await checkAsync('missing STT model file: named model-missing failure, never a crash', async () => {
    const missing = path.join(os.tmpdir(), 'candice-fm-does-not-exist.bin')
    const r = await verifySha256(missing, STT_MODEL_SHA256)
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'model-missing')
    assert.equal(r.detail.includes('model file not found'), true)
  })

  await checkAsync('transcribe with a missing model path refuses before any run', async () => {
    const r = await transcribe('/tmp/any.wav', {
      modelPath: path.join(os.tmpdir(), 'candice-fm-no-model.bin'),
      binaryPath: 'whisper-cli',
    })
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'model-missing')
  })

  await checkAsync('transcribe without required arguments refuses (never a blank answer)', async () => {
    const r = await transcribe(null, { modelPath: null, binaryPath: null })
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'missing-argument')
  })

  // ---- STT binary missing. ----
  await checkAsync('missing whisper binary: runtime-not-found, typing stays available', async () => {
    const r = await checkRuntime('candice-fm-whisper-cli-that-does-not-exist')
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'runtime-not-found')
  })

  // ---- TTS: Kokoro unavailable -> system fallback not fabricated. ----
  // N1 fix (fan-in): FAIL-2 made the default probe a REAL macOS `say`
  // check, so the no-argument probe is host-dependent. The "capability
  // must not be invented" invariant is proven with an INJECTED false probe
  // (the DI seam `probe?: SystemTtsProbe`) — that is the platform-less
  // scenario this leg owns — plus one real-probe assertion that the wired
  // macOS path reports honestly on this host.
  check('TTS: system fallback refuses when the injected probe says unavailable (never a fake fallback)', () => {
    assert.equal(isSystemTtsAvailable(() => false), false, 'an unwired platform must not report capability')
  })

  check('TTS: real default probe reports the honest host fact (macOS say present here)', () => {
    // Truth assertion, not a hard true/false: the value must MATCH reality.
    const expected = process.platform === 'darwin'
    assert.equal(isSystemTtsAvailable(), expected, 'default probe must reflect the host OS truthfully')
  })

  await checkAsync('TTS: speakWithSystemTts fails closed with engine-unavailable (captions-only rung)', async () => {
    const r = await speakWithSystemTts('hello candice', { probe: () => false })
    assert.deepEqual(r, { ok: false, reason: 'engine-unavailable' })
  })

  await checkAsync('TTS: speakWithSystemTts honors a working injected speaker without inventing audio', async () => {
    let spoken = ''
    const r = await speakWithSystemTts('probe text', {
      probe: () => true,
      speak: async (text) => { spoken = text; return true },
    })
    assert.deepEqual(r, { ok: true, usedFallback: true })
    assert.equal(spoken, 'probe text')
  })

  finish('SPEECH-MODEL-MISSING')
}

main()
