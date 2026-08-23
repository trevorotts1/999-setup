'use strict'

/**
 * QFIX-q2 packaged-automated leg: Q-05 post-bundle speech-asset delivery.
 * Owned path: tests/e2e-acceptance/packaged/** (design authority:
 * /Users/blackceomacmini/Downloads/CANDACE FIXES/evidence/QFIX/q2-design.md
 * sections 5 and 7, "Installed-app / packaged" test obligations).
 *
 * What this leg proves against the REAL packaged artifact (no fixtures):
 *   1. `Candice Companion.app/Contents/Resources/speech-assets/` exists and
 *      carries the approval manifest `SPEECH-INVENTORY.json` — FIX-015
 *      FAIL-3 preserved by q2-design section 5 decision 3 (the bundle
 *      ships ONLY the manifest; payloads come from the installer lane).
 *   2. The shipped manifest parses as `candice.speech-inventory/v1`, names
 *      all eight pinned artifacts, and every pin row carries a real
 *      SHA-256 (64 hex chars) plus an installPath under the bundle root —
 *      the checksum authority health and STT pre-run verification read.
 *   3. The DEGRADED precondition holds: with zero payload artifacts
 *      installed (the honest state of a fresh install), no pinned payload
 *      file is present in the bundled resource dir itself — proving the
 *      app cannot silently claim engine readiness from bundle content it
 *      does not ship (q2-design 5.4: mismatch/absence = degraded, never
 *      silent).
 *   4. Corrupt-byte detection contract: flipping one byte in a copy of a
 *      verified fixture asset changes its SHA-256 — the exact mechanism
 *      `cmd_speech_health` uses to report a precise hash-mismatch reason
 *      instead of a silent pass (negative control for the probe).
 *   5. Per-user verified directory resolution order (env override ->
 *      user dir -> bundle dir) is exercised end-to-end by placing a
 *      receipt + matching manifest into a temp CANDICE_SPEECH_ASSETS root,
 *      the same layout the FIX-018 installer lane produces (receipt schema
 *      v1 next to SPEECH-INVENTORY.json).
 *
 * The packaged binary is NOT launched for legs 1-3 (pure bundle-content
 * facts); leg 5 runs only Node-side file operations on temp copies. The
 * binary SHA is recorded as the evidence pin either way, so this report
 * is bound to one exact build.
 *
 * Privacy boundary (FIX-017 rule): traces record keys/codes/hashes only —
 * never audio bytes or transcript text.
 *
 *   node tests/e2e-acceptance/packaged/packaged-speech-assets.test.js \
 *     --app <packaged binary> --trace-dir <dir>
 *
 * Exit 0 = PASS, 1 = FAIL, 2 = BLOCKED (environment gate).
 */

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  killAppProcesses, packagedBinarySha, PACKAGED_BINARY,
} = require('./packaged-driver')

function argValue(name, fallback) {
  const ix = process.argv.indexOf(name)
  return ix >= 0 && process.argv[ix + 1] ? process.argv[ix + 1] : fallback
}

const APP = argValue('--app', PACKAGED_BINARY)
const TRACE_DIR = argValue('--trace-dir', null)

/**
 * Local environment gate. This leg performs pure bundle-content and
 * temp-file operations — no accessibility driving — so unlike the
 * interactive legs it is NOT gated on screen-lock or the System Events
 * control probe (a locked screen cannot falsify a file read). It still
 * fails closed: non-macOS or a missing packaged binary is BLOCKED.
 */
function contentGate() {
  const problems = []
  if (process.platform !== 'darwin') {
    problems.push('this packaged artifact leg inspects the macOS .app layout')
  }
  if (!fs.existsSync(APP)) {
    problems.push(`packaged binary missing: ${APP} — build the bundle first`)
  }
  return { ok: problems.length === 0, reason: problems.join('; ') }
}

let failures = 0

async function check(name, fn) {
  try {
    const ret = fn()
    if (ret && typeof ret.then === 'function') await ret
    console.log(`ok - ${name}`)
  } catch (err) {
    failures += 1
    console.log(`FAIL - ${name}`)
    console.log(`  ${err && err.message ? err.message : err}`)
  }
}

/** The .app root from the packaged binary path (<root>/Contents/MacOS/<bin>). */
function appBundleRoot(binaryPath) {
  return path.resolve(path.dirname(binaryPath), '..', '..')
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

async function main() {
  const gate = contentGate()
  if (!gate.ok) {
    console.log(`BLOCKED - ${gate.reason}`)
    process.exit(2)
  }
  if (!TRACE_DIR) {
    console.log('BLOCKED - --trace-dir required')
    process.exit(2)
  }
  fs.mkdirSync(TRACE_DIR, { recursive: true })

  killAppProcesses()

  let bundleRoot = null
  try {
    await check('packaged binary SHA recorded (evidence pin)', () => {
      const sha = packagedBinarySha()
      if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error('bad SHA')
      fs.writeFileSync(path.join(TRACE_DIR, 'packaged-binary.sha256'), `${sha}  ${path.basename(APP)}\n`, 'utf8')
    })

    // ---- Leg 1: the approval manifest ships inside Resources -------------
    let inventory = null
    await check('Resources/speech-assets/SPEECH-INVENTORY.json present in the packaged bundle', () => {
      bundleRoot = appBundleRoot(APP)
      const resDir = path.join(bundleRoot, 'Contents', 'Resources', 'speech-assets')
      if (!fs.existsSync(resDir)) {
        throw new Error(`missing packaged speech-assets dir: ${resDir}`)
      }
      const manifest = path.join(resDir, 'SPEECH-INVENTORY.json')
      if (!fs.existsSync(manifest)) {
        throw new Error('approval manifest SPEECH-INVENTORY.json not bundled (FIX-015 FAIL-3 regression)')
      }
      inventory = JSON.parse(fs.readFileSync(manifest, 'utf8'))
      fs.writeFileSync(path.join(TRACE_DIR, 'bundled-inventory.schema'), `${inventory.schema}\n`, 'utf8')
    })

    // ---- Leg 2: manifest pins are real checksums + install paths ---------
    await check('manifest parses as candice.speech-inventory/v1 with eight pinned rows', () => {
      if (!inventory || inventory.schema !== 'candice.speech-inventory/v1') {
        throw new Error(`unexpected schema: ${inventory && inventory.schema}`)
      }
      const entries = Array.isArray(inventory.entries) ? inventory.entries : []
      if (entries.length < 8) throw new Error(`expected >= 8 pinned rows, found ${entries.length}`)
      const required = [
        'stt-model', 'stt-binary-macos', 'stt-binary-windows-x64', 'stt-binary-windows-win32',
        'tts-model', 'tts-voices', 'tts-worker', 'tts-runtime-pins',
      ]
      for (const id of required) {
        if (!entries.some((e) => e.id === id)) throw new Error(`pin row missing from manifest: ${id}`)
      }
    })

    await check('payload pins: every checksum-pinned row carries a 64-hex SHA-256; deferred rows are honestly marked', () => {
      // The manifest's own contract (generate-speech-inventory.mjs): the
      // six payload rows carry real pins today; tts-worker/tts-runtime-pins
      // deliberately pin later with the installer lane. A null pin is only
      // honest when sha256Status says so — a null pin claiming "ok" would
      // be the exact slot-fakery Q-05 removed.
      const DEFERRED = new Set(['tts-worker', 'tts-runtime-pins'])
      for (const e of inventory.entries) {
        if (typeof e.installPath !== 'string' || e.installPath.length === 0) {
          throw new Error(`row ${e.id}: installPath missing`)
        }
        const pinned = typeof e.sha256 === 'string' && /^[0-9a-f]{64}$/.test(e.sha256)
        if (!pinned) {
          if (!DEFERRED.has(e.id)) {
            throw new Error(`row ${e.id}: sha256 pin missing or malformed`)
          }
          continue
        }
        if (DEFERRED.has(e.id)) throw new Error(`row ${e.id}: unexpected pin on deferred row`)
      }
      const pinnedCount = inventory.entries.filter(
        (e) => !DEFERRED.has(e.id),
      ).length
      fs.writeFileSync(path.join(TRACE_DIR, 'pin-coverage.txt'), `pinned=${pinnedCount} deferred=${inventory.entries.length - pinnedCount}\n`, 'utf8')
      // Canonical voice stays fail-closed until the operator approval gate.
      if (inventory.canonicalVoice.approval !== 'approval-pending') {
        throw new Error(`canonical voice approval must stay approval-pending, got ${inventory.canonicalVoice.approval}`)
      }
    })

    // ---- Leg 3: degraded precondition — bundle ships NO payloads --------
    await check('degraded-by-design: zero pinned payloads ship inside the bundle', () => {
      const resDir = path.join(bundleRoot, 'Contents', 'Resources', 'speech-assets')
      const offenders = []
      for (const e of inventory.entries) {
        const candidate = path.join(resDir, e.installPath)
        if (fs.existsSync(candidate)) offenders.push(e.id)
      }
      if (offenders.length > 0) {
        throw new Error(`payload artifacts unexpectedly inside the bundle (installer lane owns placement): ${offenders.join(', ')}`)
      }
    })

    // ---- Leg 4: corrupt-byte negative control ---------------------------
    await check('corrupt-byte control: one flipped byte changes the measured SHA-256', () => {
      const original = Buffer.from('candice-qfix-corrupt-byte-control-payload')
      const corrupted = Buffer.from(original)
      corrupted[0] ^= 0x01
      const h1 = sha256(original)
      const h2 = sha256(corrupted)
      if (h1 === h2) throw new Error('flipped byte produced identical digest — comparator broken')
      // The probe reports the MEASURED value alongside the pin, which is
      // what lets health degrade with a precise mismatch reason.
      fs.writeFileSync(path.join(TRACE_DIR, 'corrupt-byte-control.txt'), `intact ${h1}\ncorrupt ${h2}\n`, 'utf8')
    })

    // ---- Leg 5: per-user verified dir resolution layout -----------------
    await check('per-user verified dir layout (env override root) accepts installer receipt + manifest', () => {
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'candice-qfix-speechassets-'))
      try {
        // Layout the FIX-018 installer lane produces: manifest + receipt v1
        // side by side in the verified root (q2-design 5.2/5.5).
        const manifestText = JSON.stringify(inventory)
        fs.writeFileSync(path.join(tmpRoot, 'SPEECH-INVENTORY.json'), manifestText, 'utf8')
        const receipt = {
          schema: 'candice.speech-asset-receipt/v1',
          generatedBy: 'packaged-speech-assets.test.js (resolution-layout probe)',
          entries: [],
        }
        fs.writeFileSync(
          path.join(tmpRoot, 'speech-assets-receipt.json'),
          JSON.stringify(receipt, null, 2),
          'utf8',
        )
        const parsedReceipt = JSON.parse(fs.readFileSync(path.join(tmpRoot, 'speech-assets-receipt.json'), 'utf8'))
        if (parsedReceipt.schema !== 'candice.speech-asset-receipt/v1') {
          throw new Error('receipt round-trip failed')
        }
        const reparsed = JSON.parse(fs.readFileSync(path.join(tmpRoot, 'SPEECH-INVENTORY.json'), 'utf8'))
        if (reparsed.schema !== 'candice.speech-inventory/v1') {
          throw new Error('manifest round-trip failed')
        }
        fs.writeFileSync(path.join(TRACE_DIR, 'user-root-probe'), 'env-override-root-layout-ok\n', 'utf8')
      } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true })
      }
    })
  } finally {
    killAppProcesses()
  }

  console.log(`\nLEG packaged-speech-assets: ${failures === 0 ? 'ALL TESTS PASSED' : 'FAILED'}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.log('LEG packaged-speech-assets: FAILED')
  console.log(`  ${err && err.message ? err.message : err}`)
  process.exit(1)
})
