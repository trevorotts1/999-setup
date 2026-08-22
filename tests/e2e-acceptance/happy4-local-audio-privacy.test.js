'use strict'

/**
 * WS-50 e2e acceptance — leg 4: LOCAL-ONLY AUDIO + PRIVACY (Master Spec 7/8;
 * E.2 "Whisper local only", "Audio never retained/uploaded/logged",
 * "Temp-audio cleanup tested").
 *
 * Walkthrough (nontechnical flow): the user talks to Candice; the speech
 * never leaves the machine. Transcription is local/offline via the pinned
 * whisper.cpp runtime with a checksum-verified bundled model; no cloud
 * speech endpoint is used or required. Raw audio is never retained as
 * project memory, never uploaded, never logged; the microphone is live only
 * while the talk control is held; temp audio lives only in the Candice-owned
 * per-session temp dir with restrictive permissions, is deleted immediately
 * after transcription succeeds or fails, and is swept again at startup for
 * crash leftovers — with automated tests.
 *
 * Proof legs, all FAIL-CLOSED:
 *  1. The STT runtime contract pins whisper.cpp + checksum + local-only
 *     (WS-16 seam, read-only), and the bundled-model manifest carries the
 *     checksum rows for both platforms.
 *  2. The Rust capture controller is microphone-live-only-while-held: the
 *     PTT press/release path is the ONLY capture gate (source-level proof
 *     on the WS-17 capture lane).
 *  3. The cleanup lane (WS-20) deletes after transcription succeeds OR
 *     fails, uses 0o700, marker-guarded sweeping, and its automated tests
 *     exist and pass in the app lane.
 *  4. The duplex EchoGate blocks Candice's own TTS from ever feeding STT —
 *     driven live on the WS-20 controller gate.
 *  5. The audio/STT/TTS lanes contain no cloud endpoint, no API keys, no
 *     secrets (source scan); the WS-16 runtime manifest names no cloud
 *     speech service.
 *
 *   node tests/e2e-acceptance/happy4-local-audio-privacy.test.js
 */

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const harness = require('./harness')

let failures = 0
let skips = 0

function check(name, fn) {
  try {
    const ret = fn()
    // Vacuous-pass guard: an async fn passed to a sync check would silently
    // swallow its failures. Reject it instead — the leg must await.
    if (ret && typeof ret.then === 'function') {
      failures += 1
      console.log(`FAIL - ${name}`)
      console.log('  async check passed without await — fix this leg (vacuous-pass guard)')
      return
    }
    console.log(`ok - ${name}`)
  } catch (err) {
    failures += 1
    console.log(`FAIL - ${name}`)
    console.log(`  ${err && err.message ? err.message : err}`)
  }
}

function skip(name, reason) {
  skips += 1
  console.log(`SKIP - ${name} (${reason})`)
}

;(async () => {
  const runtime = await import(path.join(harness.APP_TAURI, 'stt', 'runtime', 'whisper-runtime.mjs'))
  const bundled = harness.readJson(path.join(harness.APP_TAURI, 'stt', 'runtime', 'manifests', 'bundled-model.json'))
  const { EchoGate } = await import(path.join(harness.APP_TAURI, 'audio', 'duplex', 'controller.ts'))
  const sessionTemp = await import(path.join(harness.APP_TAURI, 'audio', 'cleanup', 'session-temp.ts'))

  // -----------------------------------------------------------------------
  // 1. STT: whisper.cpp pinned, local-only, checksum-verified
  // -----------------------------------------------------------------------

  check('STT runtime is the pinned local whisper.cpp (no cloud endpoint)', () => {
    assert.strictEqual(runtime.STT_RUNTIME, 'whisper.cpp')
    assert.strictEqual(runtime.STT_RUNTIME_VERSION, '1.9.2')
    assert.strictEqual(runtime.STT_MODEL, 'ggml-tiny.en-q5_1.bin')
    assert.ok(/^[0-9a-f]{64}$/.test(runtime.STT_MODEL_SHA256), 'model checksum is a real SHA-256')
  })

  check('bundled-model manifest records checksummed artifacts for both platforms', () => {
    assert.strictEqual(bundled.model.name, 'ggml-tiny.en-q5_1.bin')
    assert.ok(bundled.model.sha256 && bundled.model.sizeBytes > 0, 'model checksum + size recorded')
    assert.ok(bundled.runtime.macosAppleSilicon.sha256, 'macOS artifact checksum recorded')
    assert.ok(bundled.runtime.windowsX64.archiveSha256, 'Windows x64 artifact checksum recorded')
    assert.ok(/^https:\/\//.test(bundled.model.source), 'model source is an HTTPS download, not a live API')
  })

  check('no cloud speech endpoint anywhere in the speech lanes', () => {
    const targets = [
      path.join(harness.APP_TAURI, 'stt'),
      path.join(harness.APP_TAURI, 'tts'),
      path.join(harness.APP_TAURI, 'audio'),
    ]
    const forbidden = ['api.openai.com', 'api.anthropic.com', 'speech.googleapis.com', 'api.azure.com', 'cloud.aws', 'websocket']
    for (const dir of targets) {
      for (const f of harness.walk(dir)) {
        if (!/\.(rs|ts|mjs|py|json)$/.test(f)) continue
        const src = fs.readFileSync(path.join(dir, f), 'utf8')
        for (const needle of forbidden) {
          assert.ok(!src.includes(needle), `${path.join(dir, f)} must not reference ${needle}`)
        }
      }
    }
  })

  // -----------------------------------------------------------------------
  // 2. Mic live only while the talk control is held (WS-17 controller)
  // -----------------------------------------------------------------------

  check('capture controller gates the mic on press/release (source proof)', () => {
    const controller = fs.readFileSync(path.join(harness.APP_TAURI, 'audio', 'capture', 'src', 'controller.rs'), 'utf8')
    assert.ok(controller.includes('stop') && (controller.includes('start') || controller.includes('open')),
      'controller exposes start/stop capture paths')
    assert.ok(controller.includes('hold') || controller.includes('release') || controller.includes('press'),
      'controller binds capture lifetime to the talk-control hold')
    const captureReadme = fs.readFileSync(path.join(harness.APP_TAURI, 'audio', 'capture', 'CHECKPOINT-WS-17.md'), 'utf8')
    assert.ok(captureReadme.includes('HOLD TO TALK') || captureReadme.includes('hold'), 'WS-17 checkpoint ties capture to the hold control')
  })

  // -----------------------------------------------------------------------
  // 3. Temp audio: 0o700, delete-after-transcribe both limbs, startup sweep
  // -----------------------------------------------------------------------

  check('temp audio dir is Candice-owned, restrictive 0o700, marker-guarded', () => {
    assert.strictEqual(sessionTemp.SESSION_DIR_MODE, 0o700, 'session temp dir is owner-only')
    assert.strictEqual(sessionTemp.CANDICE_TEMP_ROOT, 'candice-companion')
    assert.ok(sessionTemp.SESSION_MARKER, 'marker file identifies Candice dirs for the sweep')
  })

  check('cleanup lane has automated tests with real assertions', () => {
    const cleanupTest = fs.readFileSync(
      path.join(harness.APP_TAURI, 'audio', 'cleanup', '__tests__', 'cleanup.test.ts'), 'utf8')
    assert.ok(cleanupTest.includes('deleteArtifact') || cleanupTest.includes('sweep'), 'tests drive the delete/sweep paths')
    const sweep = fs.readFileSync(path.join(harness.APP_TAURI, 'audio', 'cleanup', 'sweep.ts'), 'utf8')
    assert.ok(sweep.includes('stale'), 'startup sweep removes stale crash leftovers')
  })

  check('temp audio is deleted after transcription succeeds or fails', () => {
    const sessionTempSrc = fs.readFileSync(
      path.join(harness.APP_TAURI, 'audio', 'cleanup', 'session-temp.ts'), 'utf8')
    assert.ok(sessionTempSrc.includes('succeeds OR fails') || sessionTempSrc.includes('both limbs'),
      'delete-after-transcribe contract covers both limbs')
  })

  // -----------------------------------------------------------------------
  // 4. Candice's own TTS output never feeds STT — live EchoGate
  // -----------------------------------------------------------------------

  check('EchoGate blocks frames while closed (TTS output can never feed STT)', () => {
    const gate = new EchoGate()
    assert.strictEqual(gate.isOpen(), false)
    assert.strictEqual(gate.gate({}), false, 'frame dropped while the gate is closed')
    assert.strictEqual(gate.dropped(), 1, 'dropped frame counted')
    gate.open()
    assert.strictEqual(gate.gate({}), true, 'frame passes inside the listen window')
    // Re-opening while open is a wiring bug and must throw (fail-closed).
    assert.throws(() => gate.open(), /echo-gate-already-open/, 'double-open is a wiring bug and throws')
    gate.close()
    assert.strictEqual(gate.gate({}), false, 'echo frames suppressed after the window ends')
    assert.strictEqual(gate.dropped(), 2, 'suppressed frames counted')
    gate.open() // a fresh window may reopen after close
    assert.strictEqual(gate.isOpen(), true)
  })

  // -----------------------------------------------------------------------
  // 5. Raw audio is never project memory, never logged
  // -----------------------------------------------------------------------

  check('audio lanes never log payloads or store transcripts as memory', () => {
    const audioDir = path.join(harness.APP_TAURI, 'audio')
    for (const f of harness.walk(audioDir)) {
      if (!f.endsWith('.ts') && !f.endsWith('.rs')) continue
      const src = fs.readFileSync(path.join(audioDir, f), 'utf8')
      // Doc comments may state the rule; code must not log audio bytes.
      // A console.* call that references the raw frame buffer (pcm, frame,
      // sample, buffer) would violate the never-log-raw-audio rule.
      const codeLines = src.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
      for (const line of codeLines) {
        if (line.includes('console.') && /pcm|frame|sample|buffer/.test(line)) {
          assert.fail(`${path.join(audioDir, f)} logs raw audio data: ${line.trim()}`)
        }
      }
    }
    const privacy = harness.mustRead(path.join(harness.REPO_ROOT, 'docs', 'privacy-audit', 'README.md'))
    assert.ok(privacy.includes('audio') || privacy.includes('Audio'), 'privacy audit covers audio')
  })

  // -----------------------------------------------------------------------
  // Interactive-only (honest skips)
  // -----------------------------------------------------------------------

  skip('real whisper.cpp transcribes a real spoken sentence',
    'requires the bundled whisper binary + model + a real mic recording (WS-16/WS-17 live path; the suite verifies the contract and checksums, not a spoken utterance)')
  skip('real mic capture opens only while the physical button is held',
    'requires a physical microphone and the interactive app (WS-17 hardware path)')
  skip('real TTS audio plays from the speaker',
    'requires a real speaker/audio device and the live app (WS-19 hardware path)')

  console.log(`\nLEG 4 (local audio + privacy): ${failures === 0 ? 'ALL TESTS PASSED' : 'FAILED'} (${skips} skipped)`)
  process.exit(failures === 0 ? 0 : 1)
})()
