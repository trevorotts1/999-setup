'use strict'

/**
 * FIX-019 packaged-automated leg: wrong-session refusal.
 * Owned path: tests/e2e-acceptance/packaged/**.
 *
 * A second session id answers the owning session's open slot: the answer
 * registry refuses (spec 17 hard fail, never a silent re-route); the
 * owning session's pending call stays unanswered until its own answer
 * arrives, and its slot is unaffected by the foreign put.
 *
 *   node tests/e2e-acceptance/packaged/packaged-wrong-session.test.js \
 *     --app <packaged binary> --trace-dir <dir> [--wait-ms <n>]
 *
 * Exit 0 = PASS, 1 = FAIL, 2 = BLOCKED.
 */

const fs = require('fs')
const path = require('path')
const {
  createRun, environmentGate, killAppProcesses, PACKAGED_BINARY,
  appendTrace, traceFrame, waitForAnswerControls,
} = require('./packaged-driver')

function argValue(name, fallback) {
  const ix = process.argv.indexOf(name)
  return ix >= 0 && process.argv[ix + 1] ? process.argv[ix + 1] : fallback
}

const APP = argValue('--app', PACKAGED_BINARY)
const TRACE_DIR = argValue('--trace-dir', null)
const WAIT_WINDOW_MS = Number(argValue('--wait-ms', '15000'))
const RUN_ID = `wrong-session-${Date.now()}`

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

async function main() {
  const gate = environmentGate()
  if (!gate.ok) {
    console.log(`BLOCKED - ${gate.reason}`)
    process.exit(2)
  }
  if (!TRACE_DIR) {
    console.log('BLOCKED - --trace-dir required')
    process.exit(2)
  }
  fs.mkdirSync(TRACE_DIR, { recursive: true })

  const launcher = `node tests/e2e-acceptance/packaged/packaged-wrong-session.test.js --app ${APP}`
  const emit = (sessionId, eventKind, inputMode) => {
    appendTrace(TRACE_DIR, traceFrame({
      runId: RUN_ID, launcher, sessionId, questionKey: 'BUILD_TARGET',
      inputMode, eventKind, ts: new Date().toISOString(),
    }))
  }

  killAppProcesses()

  let run = null
  try {
    run = await createRun({ launchCommand: APP, waitWindowMs: WAIT_WINDOW_MS })
    const sessionId = run.beginSession()
    const foreignSessionId = `fix019-foreign-${Date.now()}`

    // Delivery is real: the app presents the question; the owning call
    // blocks on the slot while we attack with the foreign session.
    const pending = run.server.askUser({ question: run.buildTarget(sessionId), sessionId })

    await check('foreign-session answer is refused, owning slot unaffected (spec 17)', async () => {
      await waitForAnswerControls('candice-companion', 30000, run.probe)
      emit(sessionId, 'question-presented', null)

      const foreign = {
        schemaVersion: '1.0',
        sessionId: foreignSessionId,
        questionKey: 'BUILD_TARGET',
        answerText: 'answer from the wrong session',
        inputMode: 'typed',
        userConfirmedTranscript: true,
      }
      const refused = run.server.registry.put({
        sessionId: foreignSessionId, questionKey: 'BUILD_TARGET', answer: foreign,
      })
      if (refused.ok !== false) throw new Error('foreign put must be refused')
      if (refused.code !== 'no-open-slot') throw new Error(`expected no-open-slot, got ${refused.code}`)

      // The same foreign answer aimed at the OWNING session/key pair is
      // refused by the session-mismatch rule (registry.put hard fail).
      const mismatched = run.server.registry.put({
        sessionId, questionKey: 'BUILD_TARGET', answer: foreign,
      })
      if (mismatched.ok !== false) throw new Error('session-mismatch put must be refused')
      if (mismatched.code !== 'session-mismatch') throw new Error(`expected session-mismatch, got ${mismatched.code}`)
      emit(foreignSessionId, 'wrong-session-refused', 'typed')

      // The owning slot is still waiting — the owning call has not been
      // satisfied by the foreign traffic.
      const peeked = run.server.registry.peek({ sessionId, questionKey: 'BUILD_TARGET' })
      if (!peeked.ok || peeked.status !== 'waiting') {
        throw new Error(`owning slot disturbed by foreign put: ${JSON.stringify(peeked)}`)
      }
    })

    // The owning call must not return until a real answer arrives. Cancel
    // through the real bridge (companion-cancel path, FIX-011 semantics).
    run.bridge.cancel({ sessionId, questionKey: 'BUILD_TARGET' })
    const result = await pending
    if (!result || !result.result || result.result.isError !== true) {
      throw new Error('owning call must fail soft after cancel, never deliver the foreign answer')
    }
    await check('owning call never received the foreign answer', () => {
      if (result.result.content && String(result.result.content).includes('answer from the wrong session')) {
        throw new Error('foreign answer text leaked into the owning result')
      }
    })
  } finally {
    killAppProcesses()
    if (run) await run.close()
  }

  console.log(`\nLEG packaged-wrong-session: ${failures === 0 ? 'ALL TESTS PASSED' : 'FAILED'}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.log('LEG packaged-wrong-session: FAILED')
  console.log(`  ${err && err.message ? err.message : err}`)
  process.exit(1)
})
