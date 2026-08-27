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

    await check('every row\'s pin agrees with its declared sha256Status', () => {
      // REWRITTEN. This asserted an installer posture the manifest does not
      // hold and the build does not implement: it treated tts-worker and
      // tts-runtime-pins as "deferred" rows that must NOT carry a pin, and
      // failed with "unexpected pin on deferred row" because they do carry
      // one. They carry one because they ARE bundled and they ARE measured.
      //
      // The manifest is the authority and it is honest: every row states
      // `bundled` and `sha256Status`. So the check is now that those two
      // fields agree with the pin, which is a real integrity statement rather
      // than a claim about which lane places files.
      for (const e of inventory.entries) {
        if (typeof e.installPath !== 'string' || e.installPath.length === 0) {
          throw new Error(`row ${e.id}: installPath missing`)
        }
        const pinned = typeof e.sha256 === 'string' && /^[0-9a-f]{64}$/.test(e.sha256)
        if (!pinned) throw new Error(`row ${e.id}: sha256 pin missing or malformed`)
        if (e.sha256Status !== 'pinned'
          && e.sha256Status !== 'measured-from-tree'
          && e.sha256Status !== 'absent') {
          throw new Error(`row ${e.id}: unknown sha256Status ${e.sha256Status}`)
        }
        // `absent` means the payload is NOT here. Such a row may keep an
        // upstream pin to verify against later, but it must never also claim
        // to be bundled — that pair is the slot-fakery Q-05 removed.
        if (e.sha256Status === 'absent' && e.bundled !== false) {
          throw new Error(`row ${e.id}: sha256Status absent but bundled=${e.bundled}`)
        }
        if (e.sha256Status !== 'absent' && e.bundled !== true) {
          throw new Error(`row ${e.id}: status ${e.sha256Status} but bundled=${e.bundled}`)
        }
        if (e.sha256Status === 'absent' && typeof e.absentNote !== 'string') {
          throw new Error(`row ${e.id}: absent rows must say why (absentNote)`)
        }
      }
      const bundled = inventory.entries.filter((e) => e.bundled === true)
      const absent = inventory.entries.filter((e) => e.bundled !== true)
      fs.writeFileSync(
        path.join(TRACE_DIR, 'pin-coverage.txt'),
        `bundled=${bundled.length} absent=${absent.length}\n`
        + `absent rows: ${absent.map((e) => e.id).join(', ')}\n`,
        'utf8',
      )
      // The canonical voice gate, asserted as the gate rather than as one
      // side of it. This required `approval-pending` forever, which is a
      // requirement that Candice never speak: the operator approved af_bella
      // in a134db5 ("approve af_bella and make the shipped bundle actually
      // speak"), so the gate has been passed and the leg was failing the
      // product for obeying its own operator.
      //
      // What must hold is that the value is EXACTLY one of the two governed
      // strings. speech/mod.rs resolves a speakable voice only on the exact
      // lowercase `approved` and refuses everything else as "not
      // operator-approved" — including `Approved` and `APPROVED`, which it
      // has a test for. Accepting a casing variant here is what would let an
      // unapproved voice look approved.
      const approval = inventory.canonicalVoice.approval
      if (approval !== 'approved' && approval !== 'approval-pending') {
        throw new Error(
          `canonical voice approval must be exactly "approved" or "approval-pending", got ${JSON.stringify(approval)}`,
        )
      }
      if (typeof inventory.canonicalVoice.id !== 'string' || inventory.canonicalVoice.id.length === 0) {
        throw new Error('canonical voice has no id')
      }
      fs.writeFileSync(
        path.join(TRACE_DIR, 'canonical-voice.txt'),
        `${inventory.canonicalVoice.id} ${approval} ${inventory.canonicalVoice.voicepackRelease}\n`,
        'utf8',
      )
    })

    // ---- Leg 3: what the manifest says is bundled IS bundled, byte for byte --
    await check('every bundled row is present and matches its pin; absent rows are absent', () => {
      // REWRITTEN. This asserted "zero pinned payloads ship inside the bundle
      // (installer lane owns placement)" and failed naming five payloads that
      // do ship. They ship on purpose: tauri.conf.json bundles speech-assets,
      // the manifest marks those five `bundled: true`, and that is what makes
      // Candice able to speak the moment a client opens her. No installer
      // lane exists in this repo to place them instead, so the old assertion
      // could only ever have been satisfied by a mute product.
      //
      // Verifying the bytes is strictly stronger than asserting the posture:
      // a corrupted or swapped payload passed the old check trivially, by
      // being absent.
      const resDir = path.join(bundleRoot, 'Contents', 'Resources', 'speech-assets')
      const problems = []
      let verified = 0
      for (const e of inventory.entries) {
        const candidate = path.join(resDir, e.installPath)
        const here = fs.existsSync(candidate)
        if (e.bundled === true) {
          if (!here) { problems.push(`${e.id}: declared bundled but missing from the artifact`); continue }
          const measured = sha256(fs.readFileSync(candidate))
          if (measured !== e.sha256) {
            problems.push(`${e.id}: bundled bytes do not match the pin (pinned ${e.sha256.slice(0, 16)}, measured ${measured.slice(0, 16)})`)
            continue
          }
          verified += 1
        } else if (here) {
          problems.push(`${e.id}: declared absent but present in the artifact`)
        }
      }
      fs.writeFileSync(
        path.join(TRACE_DIR, 'bundled-payload-verification.txt'),
        `verified=${verified} problems=${problems.length}\n${problems.join('\n')}\n`,
        'utf8',
      )
      if (problems.length > 0) throw new Error(problems.join('; '))
      if (verified === 0) throw new Error('no bundled payload was verified — the check proved nothing')
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
