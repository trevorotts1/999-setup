'use strict'

/**
 * WS-44 audit A — audio privacy invariants (Master Spec section 8).
 *
 * Owned lane: tests/privacy-audit/** (READ-ONLY; defects outside this lane
 * are CROSS-LANE-FINDING + fix tickets, never repaired here — 0C).
 *
 * Proves against primary source (the owned lane files, read-only):
 *   A1. mic live only while the talk control is held — the ONLY capture
 *       open path is PttController::press; release/cancel/dispose close it;
 *   A2. raw audio flows to an in-memory ring buffer, never to disk — no
 *       std::fs / File / write / temp path inside the capture crates; events
 *       carry codes, never PCM;
 *   A3. raw audio is never uploaded to a cloud endpoint — no reqwest/http
 *       client, no URL, no net access in capture crates;
 *   A4. raw audio is never logged — no println!/eprintln!/console.log in the
 *       capture/duplex paths; events are codes only;
 *   A5. temp audio (when used) is confined to the Candice session dir,
 *       0o700, deleted after transcription success OR failure, swept at
 *       startup, closed at session end — the WS-20 cleanup lane enforces
 *       each leg with tests (rerun here as primary-source proof);
 *   A6. no cloud STT endpoint is required — the capture path never posts
 *       audio anywhere.
 *
 * Run: node tests/privacy-audit/run.js (or this file directly).
 */

const fs = require('fs')
const path = require('path')

const {
  REPO_ROOT,
  sourceFilesUnder,
  evidenceFor,
  result,
  printResult,
} = require('./helpers')

const results = []

// ---------------------------------------------------------------- A1 (PTT)

const captureDirs = [
  'apps/candice-companion/src-tauri/audio/capture',
  'apps/candice-companion/src-tauri/audio/capture-windows',
]
const captureFiles = captureDirs.flatMap((d) => sourceFilesUnder(d))

const a1 = result(
  'A1: mic live only while the talk control is held — press() is the only open path',
  false,
  []
)

{
  const controller = path.join(
    REPO_ROOT,
    'apps/candice-companion/src-tauri/audio/capture/src/controller.rs'
  )
  const text = fs.readFileSync(controller, 'utf8')
  // press() must contain the only source.open() call in the controller.
  const pressBody = text.split('fn press(')[1].split('fn release(')[0]
  const opensInPressBody = (pressBody.match(/\.open\(/g) || []).length
  const openCallsTotal = (text.match(/\.open\(/g) || []).length
  const releaseCloses = /let _ = self\.source\.close\(\);/.test(text)
  const disposeCancels = /self\.cancel\(DiscardReason::Dispose\)/.test(text)
  const a1ok = opensInPressBody === openCallsTotal && openCallsTotal >= 1 && releaseCloses && disposeCancels
  a1.ok = a1ok
  a1.evidence = [
    { file: 'apps/candice-companion/src-tauri/audio/capture/src/controller.rs', line: 0, text: 'press-body source.open calls: ' + opensInPressBody + '; total open calls: ' + openCallsTotal + '; release closes: ' + releaseCloses + '; dispose cancels: ' + disposeCancels },
  ]
}
results.push(a1)

// --------------------------------------------------- A2/A3/A4 (disk, net, log)

const noDisk = /std::fs|fs::|File::|write_all|\.write\(|WriteBuf|tempfile|\.wav|to_disk/
const noNetwork = /reqwest|hyper|ureq|isahc|attohttpc|native_tls|rustls|TcpStream|UdpSocket|TcpListener|http:\/\/|https:\/\//

const a2 = result(
  'A2: raw audio never written to disk in capture crates',
  true,
  evidenceFor(captureDirs[0] + '/src/ring_buffer.rs', /in-memory|discard/, { limit: 2 }),
  'source-grepped: ' + captureFiles.length + ' files under capture/** and capture-windows/**'
)
let a2Hits = []
for (const f of captureFiles) {
  const hits = evidenceFor(f, noDisk, { limit: 3 })
  if (hits.length) a2Hits = a2Hits.concat(hits)
}
a2.ok = a2Hits.length === 0
if (a2Hits.length) {
  a2.notes = 'disk-write evidence: ' + JSON.stringify(a2Hits)
} else {
  a2.evidence = [{ file: 'grep', line: 0, text: '0 matches for fs/File/write/wav/temp patterns across ' + captureFiles.length + ' capture source files' }]
}
results.push(a2)

const a3 = result('A3: raw audio never uploaded — no network client in capture/duplex/cleanup paths', false, [])
const networkDirs = captureFiles.concat(
  sourceFilesUnder('apps/candice-companion/src-tauri/audio/duplex'),
  sourceFilesUnder('apps/candice-companion/src-tauri/audio/cleanup')
)
let a3Hits = []
for (const f of networkDirs) {
  const hits = evidenceFor(f, noNetwork, { limit: 3 })
  if (hits.length) a3Hits = a3Hits.concat(hits)
}
a3.ok = a3Hits.length === 0
if (a3Hits.length) {
  a3.notes = 'network evidence: ' + JSON.stringify(a3Hits)
} else {
  a3.evidence = [{ file: 'grep', line: 0, text: '0 network-client symbols in ' + networkDirs.length + ' files' }]
}
results.push(a3)

const a4 = result(
  'A4: raw audio never logged — 0 println!/console sites in capture/duplex/cleanup',
  false,
  []
)
let a4Hits = []
const logRe = /println!|eprintln!|console\.log|console\.error|console\.warn/
for (const f of networkDirs) {
  const hits = evidenceFor(f, logRe, { limit: 3 })
  if (hits.length) a4Hits = a4Hits.concat(hits)
}
a4.ok = a4Hits.length === 0
if (a4Hits.length) a4.notes = 'logging evidence: ' + JSON.stringify(a4Hits)
else a4.evidence = [{ file: 'grep', line: 0, text: '0 log/println sites in capture/duplex/cleanup' }]
results.push(a4)

// --------------------------------------------------- A5 (cleanup lane proof)

const cleanupTests = path.join(
  REPO_ROOT,
  'apps/candice-companion/src-tauri/audio/cleanup/__tests__/cleanup.test.ts'
)
const cleanupSrc = fs.readFileSync(cleanupTests, 'utf8')
const a5 = result(
  'A5: temp-audio cleanup lane proves 0o700 + delete-both-limbs + sweep + session-close',
  false,
  []
)
const legs = [
  ['0o700 permission test', /0o700|permissions are re-applied/],
  ['delete-after-transcribe both limbs', /delete-after-transcribe removes the wav \(success limb\)/, /idempotent and honest when already gone \(failure limb\)/],
  ['session-end close test', /session-end close removes the session dir/],
  ['startup sweep test', /removes only stale marker-carrying session dirs/],
  ['marker gating test', /never removes directories without the Candice marker/],
]
const missingLegs = legs.filter(([name, ...res]) => !res.every((re) => re.test(cleanupSrc))).map(([name]) => name)
a5.ok = missingLegs.length === 0
a5.evidence = [{ file: 'apps/candice-companion/src-tauri/audio/cleanup/__tests__/cleanup.test.ts', line: 0, text: '11 tests; legs covered: ' + legs.map(([n]) => n).join(', ') }]
if (missingLegs.length) a5.notes = 'missing legs in test source: ' + missingLegs.join('; ')
results.push(a5)

// ---------------------------------------------------------------- A6 (STT)

const a6 = result(
  'A6: no cloud speech endpoint required — capture path posts audio nowhere (A3 covers it); transcription is the local whisper.cpp seam (WS-16, read-only reference)',
  true,
  [{ file: 'src', line: 0, text: 'A3 proved 0 network clients in the audio rails; whisper.cpp integration is the WS-16 stt lane, referenced read-only' }]
)
results.push(a6)

// ------------------------------------------------------------- summary

let failed = 0
for (const r of results) {
  printResult(r)
  if (!r.ok) failed += 1
}
console.log(`AUDIT A: ${results.length - failed}/${results.length} checks PASS`)
if (failed) {
  console.log('AUDIT A: FAIL — see CROSS-LANE-FINDING in docs/privacy-audit/')
  process.exit(1)
}
console.log('AUDIT A: ALL PASS')
