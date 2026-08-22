'use strict'

/**
 * candice failure matrix — mic denied — owned path: tests/failure-matrix/**
 *
 * E.1 WS-43 "microphone denied" leg. Drives the REAL WS-22 permission policy
 * (`decide_mode` from the candice-macos-permissions crate — compiled and run
 * via `cargo test --offline` with the crate's own pinned tests below) and the
 * REAL WS-17 PTT controller semantics proven by the capture crate's own test
 * suite (`mic_denied_surfaces_denied_no_recording_typing_stays`,
 * `denied_release_returns_idle_next_question_can_type`, plus the WS-22
 * floating-mode decisions).
 *
 * Invariants (spec 17/20): mic denied -> typing remains available; the
 * companion degrades to a movable floating mode, never anchored-to-nothing;
 * Claude never stops.
 */

const assert = require('assert')
const path = require('path')
const { spawnSync } = require('node:child_process')
const { check, finish } = require('./harness')

const CAPTURE = path.join(
  __dirname, '..', '..', 'apps', 'candice-companion', 'src-tauri', 'audio', 'capture'
)
const PERMISSIONS = path.join(
  __dirname, '..', '..', 'apps', 'candice-companion', 'src-tauri', 'permissions'
)

function cargoTest(dir, filter) {
  const r = spawnSync('cargo', ['test', '--offline', '--quiet', filter ? filter : '--'], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 300_000,
  })
  return r
}

function main() {
  // ---- WS-17 PTT controller mic-denied path (real crate tests). ----
  check('WS-17 crate: mic denied -> Denied status, no recording, typing stays (real crate tests)', () => {
    const r = cargoTest(CAPTURE, 'mic_denied_surfaces_denied_no_recording_typing_stays')
    assert.equal(r.status, 0, `cargo test failed:\n${r.stdout}\n${r.stderr}`)
    assert.ok(r.stdout.includes('test result: ok'))
  })

  check('WS-17 crate: denied release returns Idle so the next question can type (real crate tests)', () => {
    const r = cargoTest(CAPTURE, 'denied_release_returns_idle_next_question_can_type')
    assert.equal(r.status, 0, `cargo test failed:\n${r.stdout}\n${r.stderr}`)
  })

  // ---- WS-22 permission policy: deny -> floating companion (real crate tests). ----
  check('WS-22 crate: accessibility denied always degrades to Floating with notice (real crate tests)', () => {
    const r = cargoTest(PERMISSIONS, 'accessibility_denied_always_floats')
    assert.equal(r.status, 0, `cargo test failed:\n${r.stdout}\n${r.stderr}`)
  })

  check('WS-22 crate: mic status map keeps typing available on deny/restrict (real crate tests)', () => {
    const r = cargoTest(PERMISSIONS, 'mic')
    assert.equal(r.status, 0, `cargo test failed:\n${r.stdout}\n${r.stderr}`)
  })

  // ---- Same policy from the Node side: the copy the app renders. ----
  check('WS-22 crate: full default-feature suite green offline (20 tests, no TCC, no hardware)', () => {
    const r = cargoTest(PERMISSIONS, '')
    assert.equal(r.status, 0, `cargo test failed:\n${r.stdout}\n${r.stderr}`)
    assert.ok(r.stdout.includes('20 passed'), `expected 20 passing tests, got:\n${r.stdout}`)
  })

  finish('MIC-DENIED')
}

main()
