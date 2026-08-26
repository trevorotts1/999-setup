'use strict'

/**
 * candice failure matrix — corrupt checksum — owned path: tests/failure-matrix/**
 *
 * E.1 WS-43 "model download corrupt checksum" leg (spec 33 class: downloads
 * come only from operator-controlled locations and are checksum-verified
 * before use; a corrupt payload is never accepted). Drives the REAL WS-16
 * `verifySha256` (the same check transcribe() runs before any whisper run)
 * and the REAL WS-33 updater `verify.mjs` CLI (registry lookup + explicit
 * expectation paths) with real temp files.
 *
 * Invariants: corrupt payload -> named checksum-mismatch, payload refused;
 * an unverifiable (no-record) payload is refused — fail closed; nothing is
 * ever installed or transcribed from a corrupt artifact.
 */

const assert = require('assert')
const path = require('path')
const fsp = require('node:fs/promises')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { check, checkAsync, finish } = require('./harness')

const STT = require(
  path.join(__dirname, '..', '..', 'apps', 'candice-companion', 'src-tauri', 'stt', 'runtime', 'whisper-runtime.mjs')
)
const { verifySha256, STT_MODEL, STT_MODEL_SHA256, transcribe } = STT

const VERIFY = path.join(
  __dirname, '..', '..', 'scripts', 'candice-updater', 'checksums', 'verify.mjs'
)

function sha256Of(p) {
  return createHash('sha256').update(require('node:fs').readFileSync(p)).digest('hex')
}

async function main() {
  // ---- WS-16 model checksum gate. ----
  await checkAsync('corrupt model file: checksum-mismatch, transcription refused', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'candice-fm-checksum-'))
    try {
      const bad = path.join(dir, 'ggml-tiny.en-q5_1.bin')
      await fsp.writeFile(bad, Buffer.alloc(4096, 0xab)) // corrupt: right name, wrong bytes
      const r = await verifySha256(bad, STT_MODEL_SHA256)
      assert.equal(r.ok, false)
      assert.equal(r.reason, 'checksum-mismatch')
      const t = await transcribe('/tmp/any.wav', { modelPath: bad, binaryPath: 'whisper-cli' })
      assert.equal(t.ok, false, 'transcribe refuses a corrupt model before any run')
      assert.equal(t.reason, 'checksum-mismatch')
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  await checkAsync('valid bytes against the pin: gate passes', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'candice-fm-checksum-'))
    try {
      const good = path.join(dir, 'good.bin')
      const payload = Buffer.from('deterministic payload for the gate probe')
      await fsp.writeFile(good, payload)
      const r = await verifySha256(good, sha256Of(good))
      assert.equal(r.ok, true)
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  // ---- WS-33 updater payload verifier (CLI, real module). ----
  await checkAsync('updater verify.mjs: corrupt payload exits 1 with mismatch', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'candice-fm-upd-'))
    try {
      const payload = path.join(dir, 'payload.bin')
      const corrupt = Buffer.from('this payload was corrupted in transit')
      await fsp.writeFile(payload, corrupt)
      const r = spawnSync(process.execPath, [VERIFY, '--file', payload, '--sha256', '0'.repeat(64)], {
        encoding: 'utf8',
      })
      assert.equal(r.status, 1)
      assert.ok(r.stderr.includes('sha256 mismatch'))
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  await checkAsync('updater verify.mjs: unverifiable payload (no record) is refused, fail-closed', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'candice-fm-upd-'))
    try {
      const payload = path.join(dir, 'unknown-component.bin')
      await fsp.writeFile(payload, Buffer.from('no checksum record exists for me'))
      const r = spawnSync(process.execPath, [VERIFY, '--file', payload, '--id', 'no-such-component', '--version', '9.9.9'], {
        encoding: 'utf8',
      })
      assert.equal(r.status, 1)
      assert.ok(r.stderr.includes('refusing unverified payload'))
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  await checkAsync('updater verify.mjs: exact match exits 0', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'candice-fm-upd-'))
    try {
      const payload = path.join(dir, 'payload.bin')
      const bytes = Buffer.from('verified payload')
      await fsp.writeFile(payload, bytes)
      const r = spawnSync(process.execPath, [VERIFY, '--file', payload, '--sha256', sha256Of(payload)], {
        encoding: 'utf8',
      })
      assert.equal(r.status, 0)
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  finish('CORRUPT-CHECKSUM')
}

main()
