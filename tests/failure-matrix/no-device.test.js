'use strict'

/**
 * candice failure matrix — no audio device — owned path: tests/failure-matrix/**
 *
 * E.1 WS-43 "no audio device" leg (spec 20: no-device fallback; typing
 * remains available). Drives the REAL WS-17 PTT controller paths through the
 * capture crate's own pinned tests (no-device press -> NoDevice status, no
 * stream ever attempted; device lost mid-hold recovers without crashing) and
 * the real permission policy's mic-status mapping for the no-device-adjacent
 * conservative Denied reading.
 *
 * Invariants: no device -> named NoDevice state, mic never opens, typing
 * stays; a device lost mid-hold never crashes or wedges the session.
 */

const assert = require('assert')
const path = require('path')
const { spawnSync } = require('node:child_process')
const { check, finish } = require('./harness')

const CAPTURE = path.join(
  __dirname, '..', '..', 'apps', 'candice-companion', 'src-tauri', 'audio', 'capture'
)

function cargoTest(filter) {
  const r = spawnSync('cargo', ['test', '--offline', '--quiet', filter], {
    cwd: CAPTURE,
    encoding: 'utf8',
    timeout: 300_000,
  })
  return r
}

function main() {
  check('no device: press surfaces NoDevice, never opens a stream, typing stays (real crate tests)', () => {
    const r = cargoTest('no_devices_surfaces_no_device_no_open_typing_stays')
    assert.equal(r.status, 0, `cargo test failed:\n${r.stdout}\n${r.stderr}`)
    assert.ok(r.stdout.includes('test result: ok'))
  })

  check('device lost mid-hold: no crash, session usable (real crate tests)', () => {
    const r = cargoTest('device_lost_mid_hold_recovers_no_crash')
    assert.equal(r.status, 0, `cargo test failed:\n${r.stdout}\n${r.stderr}`)
  })

  check('no-device release returns Idle so the next question can type (real crate tests)', () => {
    const r = cargoTest('denied_release_returns_idle_next_question_can_type')
    assert.equal(r.status, 0, `cargo test failed:\n${r.stdout}\n${r.stderr}`)
  })

  check('capture crate full default-feature suite green offline (25 tests, no hardware)', () => {
    const r = cargoTest('')
    assert.equal(r.status, 0, `cargo test failed:\n${r.stdout}\n${r.stderr}`)
    assert.ok(r.stdout.includes('25 passed'), `expected 25 passing tests, got:\n${r.stdout}`)
  })

  finish('NO-DEVICE')
}

main()
