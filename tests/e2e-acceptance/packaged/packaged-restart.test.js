'use strict'

/**
 * FIX-019 packaged-automated leg: restart recovery.
 * Owned path: tests/e2e-acceptance/packaged/**.
 *
 * Kill the packaged process after the question was displayed but before
 * any answer; then recover: the FIX-013 durable store hands back the
 * exact pending (sessionId, questionKey) exactly once; the second
 * recovery finds nothing (no double hand-off); the question counter was
 * never incremented (no re-ask, no count increment — section 20).
 *
 *   node tests/e2e-acceptance/packaged/packaged-restart.test.js \
 *     --app <packaged binary> --trace-dir <dir> [--wait-ms <n>]
 *
 * Exit 0 = PASS, 1 = FAIL, 2 = BLOCKED.
 */

const fs = require('fs')
const path = require('path')
const {
  createRun, environmentGate, killAppProcesses, PACKAGED_BINARY,
  appendTrace, traceFrame, waitForAnswerControls, APP_PROCESS,
} = require('./packaged-driver')

function argValue(name, fallback) {
  const ix = process.argv.indexOf(name)
  return ix >= 0 && process.argv[ix + 1] ? process.argv[ix + 1] : fallback
}

const APP = argValue('--app', PACKAGED_BINARY)
const TRACE_DIR = argValue('--trace-dir', null)
const WAIT_WINDOW_MS = Number(argValue('--wait-ms', '45000'))
const RUN_ID = `restart-${Date.now()}`

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

  const launcher = `node tests/e2e-acceptance/packaged/packaged-restart.test.js --app ${APP}`
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

    const pending = run.server.askUser({ question: run.buildTarget(sessionId), sessionId })

    await check('kill mid-question, recover exact pending question once, count never increments', async () => {
      await waitForAnswerControls(APP_PROCESS, 30000, run.probe)
      emit(sessionId, 'question-presented', null)

      // Named boundary: displayed, not answered. Kill the real process.
      killAppProcesses()

      const result = await pending
      if (!result || !result.result || result.result.isError !== true) {
        throw new Error('askUser must fail soft when the app dies mid-question')
      }

      // FIX-013 recovery seam: exact pending question, exactly once.
      const first = run.lifecycle.recoverPendingQuestion({ sessionId })
      if (!first.ok || !first.recovered) throw new Error('first recovery must return the pending question')
      if (first.recovered.questionKey !== 'BUILD_TARGET') {
        throw new Error(`recovered wrong question key: ${first.recovered.questionKey}`)
      }
      if (first.recovered.counted !== false) {
        throw new Error('BUILD_TARGET must be uncounted (STATIC question)')
      }
      const second = run.lifecycle.recoverPendingQuestion({ sessionId })
      if (!second.ok || second.recovered !== null) {
        throw new Error('second recovery must find nothing — pending question hands off exactly once')
      }

      // No count increment: recovery never double-counts (section 20).
      const record = run.lifecycle.getSession(sessionId)
      if (!record || record.questionCount !== 0) {
        throw new Error(`recovery must not increment questionCount: ${record && record.questionCount}`)
      }
      if (record.status !== 'recovering') {
        throw new Error(`session must be in recovering status, got ${record.status}`)
      }
      emit(sessionId, 'question-presented', 'terminal')

      // resumeSession returns the session to active with no pending question.
      const resumed = run.lifecycle.resumeSession({ sessionId })
      if (!resumed.ok) throw new Error(`resumeSession failed: ${resumed.code}`)
      const after = run.lifecycle.getSession(sessionId)
      if (after.status !== 'active' || after.pendingQuestion !== null) {
        throw new Error('after resume: session active, no pending question — expected')
      }
    })

    await check('trace frames carry keys and codes only', () => {
      const raw = fs.readFileSync(path.join(TRACE_DIR, 'event-trace.jsonl'), 'utf8')
      for (const forbidden of ['Tell me about your idea']) {
        if (raw.includes(forbidden)) throw new Error(`trace contains forbidden text: ${forbidden}`)
      }
    })
  } finally {
    killAppProcesses()
    if (run) await run.close()
  }

  console.log(`\nLEG packaged-restart: ${failures === 0 ? 'ALL TESTS PASSED' : 'FAILED'}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.log('LEG packaged-restart: FAILED')
  console.log(`  ${err && err.message ? err.message : err}`)
  process.exit(1)
})
