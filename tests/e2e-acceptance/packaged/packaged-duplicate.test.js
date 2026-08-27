'use strict'

/**
 * FIX-019 packaged-automated leg: duplicate-answer refusal.
 * Owned path: tests/e2e-acceptance/packaged/**.
 *
 * Two answers for the same (sessionId, questionKey): the first returns to
 * the owning tool call; the second is refused (exactly-one-answer, spec
 * 14); the session count stays one (FIX-013 write-through).
 *
 *   node tests/e2e-acceptance/packaged/packaged-duplicate.test.js \
 *     --app <packaged binary> --trace-dir <dir> [--wait-ms <n>]
 *
 * Exit 0 = PASS, 1 = FAIL, 2 = BLOCKED.
 */

const fs = require('fs')
const path = require('path')
const {
  createRun, environmentGate, killAppProcesses, PACKAGED_BINARY,
  appendTrace, traceFrame, waitForAnswerControls, waitForAnswerGone,
  typeAnswer, APP_PROCESS,
} = require('./packaged-driver')

function argValue(name, fallback) {
  const ix = process.argv.indexOf(name)
  return ix >= 0 && process.argv[ix + 1] ? process.argv[ix + 1] : fallback
}

const APP = argValue('--app', PACKAGED_BINARY)
const TRACE_DIR = argValue('--trace-dir', null)
const WAIT_WINDOW_MS = Number(argValue('--wait-ms', '45000'))
const RUN_ID = `duplicate-${Date.now()}`

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

  const launcher = `node tests/e2e-acceptance/packaged/packaged-duplicate.test.js --app ${APP}`
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

    await check('first typed answer returns; duplicate is refused; count stays one', async () => {
      await waitForAnswerControls(APP_PROCESS, 30000, run.probe)
      emit(sessionId, 'question-presented', null)

      typeAnswer(APP_PROCESS, 'FIX-019 duplicate first answer')
      emit(sessionId, 'answer-submitted', 'typed')

      const result = await pending
      emit(sessionId, 'answer-returned', 'typed')
      if (!result || !result.result || result.result.ok !== true) {
        throw new Error(`first answer did not return ok: ${JSON.stringify(result).slice(0, 300)}`)
      }

      // Second answer attempt aimed at the now-consumed slot: the slot is
      // gone after take() — put must refuse (not-answered / no-open-slot).
      const second = {
        schemaVersion: '1.0',
        sessionId,
        questionKey: 'BUILD_TARGET',
        answerText: 'FIX-019 duplicate second answer',
        inputMode: 'typed',
        userConfirmedTranscript: true,
      }
      const refused = run.server.registry.put({ sessionId, questionKey: 'BUILD_TARGET', answer: second })
      if (refused.ok !== false) throw new Error('second put must be refused (exactly-one-answer)')
      emit(sessionId, 'duplicate-refused', 'typed')

      // Session accounting: exactly one recordAnswer for BUILD_TARGET.
      const record = run.lifecycle.getSession(sessionId)
      if (!record || record.questionCount !== 1) {
        throw new Error(`session questionCount must be exactly 1, got ${record && record.questionCount}`)
      }
      if (record.answeredQuestionKeys.filter((k) => k === 'BUILD_TARGET').length !== 1) {
        throw new Error('BUILD_TARGET recorded more than once in answeredQuestionKeys')
      }

      await waitForAnswerGone(APP_PROCESS, 10000, run.probe)
      if (run.server.registry.openCount() !== 0) {
        throw new Error(`bridge slots not drained: ${run.server.registry.openCount()}`)
      }
    })

    await check('trace frames carry keys and codes only', () => {
      const raw = fs.readFileSync(path.join(TRACE_DIR, 'event-trace.jsonl'), 'utf8')
      for (const forbidden of ['FIX-019 duplicate first answer', 'FIX-019 duplicate second answer']) {
        if (raw.includes(forbidden)) throw new Error(`trace contains forbidden text: ${forbidden}`)
      }
    })
  } finally {
    killAppProcesses()
    if (run) await run.close()
  }

  console.log(`\nLEG packaged-duplicate: ${failures === 0 ? 'ALL TESTS PASSED' : 'FAILED'}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.log('LEG packaged-duplicate: FAILED')
  console.log(`  ${err && err.message ? err.message : err}`)
  process.exit(1)
})
