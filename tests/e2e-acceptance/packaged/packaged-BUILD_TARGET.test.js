'use strict'

/**
 * FIX-019 packaged-automated leg: typed BUILD_TARGET round trip.
 * Owned path: tests/e2e-acceptance/packaged/**.
 *
 * Real `candice.ask_user` tool call carrying the governed BUILD_TARGET
 * canonical event; the packaged app performs its own native TCP handshake
 * and renders the answer UI; the operator-side driver types an answer into
 * the real packaged accessibility tree and activates TYPE ANSWER; exactly
 * one answer returns to the same session; no answer elements remain after
 * the return (FIX-011 timeout-cleanup behavior preserved).
 *
 * The event trace records keys/codes only — never question text, answer
 * text, tokens, or secrets (FIX-017 boundary).
 *
 *   node tests/e2e-acceptance/packaged/packaged-BUILD_TARGET.test.js \
 *     --app <packaged binary> --trace-dir <dir> [--wait-ms <n>]
 *
 * Exit 0 = PASS, 1 = FAIL, 2 = BLOCKED (environment gate).
 */

const fs = require('fs')
const path = require('path')
const {
  createRun, environmentGate, killAppProcesses, packagedBinarySha,
  appendTrace, traceFrame, waitForAnswerControls, waitForAnswerGone,
  typeAnswer, answerSurfaceVisible, PACKAGED_BINARY, APP_PROCESS, LABELS,
} = require('./packaged-driver')

function argValue(name, fallback) {
  const ix = process.argv.indexOf(name)
  return ix >= 0 && process.argv[ix + 1] ? process.argv[ix + 1] : fallback
}

const APP = argValue('--app', PACKAGED_BINARY)
const TRACE_DIR = argValue('--trace-dir', null)
const WAIT_WINDOW_MS = Number(argValue('--wait-ms', '45000'))
const RUN_ID = `build-target-${Date.now()}`

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
  // Environment gate: macOS + packaged binary + a11y control probe.
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

  const launcher = `node tests/e2e-acceptance/packaged/packaged-BUILD_TARGET.test.js --app ${APP}`
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

    // Delivery is async: the server blocks on the answer. Drive the UI in
    // the background while the server waits for the real slot.
    const pending = run.server.askUser({ question: run.buildTarget(sessionId), sessionId })

    await check('packaged binary SHA recorded (evidence pin)', () => {
      const sha = packagedBinarySha()
      if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error('bad SHA')
      fs.writeFileSync(path.join(TRACE_DIR, 'packaged-binary.sha256'), `${sha}  ${path.basename(APP)}\n`, 'utf8')
    })

    await check('typed answer returns exactly once to the same session', async () => {
      await waitForAnswerControls(APP_PROCESS, 30000, run.probe)
      emit(sessionId, 'question-presented', null)
      if (!answerSurfaceVisible(APP_PROCESS)) throw new Error('answer surface not visible after wait')

      typeAnswer(APP_PROCESS, 'FIX-019 packaged typed BUILD_TARGET answer')
      emit(sessionId, 'answer-submitted', 'typed')

      const result = await pending
      emit(sessionId, 'answer-returned', 'typed')
      if (!result || !result.result || result.result.ok !== true) {
        throw new Error(`askUser did not return ok: ${JSON.stringify(result).slice(0, 400)}`)
      }
      const answer = result.result.answer
      if (!answer || answer.sessionId !== sessionId) {
        throw new Error('answer returned for the wrong session (spec 17)')
      }
      if (answer.questionKey !== 'BUILD_TARGET') {
        throw new Error(`wrong question key returned: ${answer.questionKey}`)
      }
      if (answer.inputMode !== 'typed') throw new Error(`inputMode ${answer.inputMode}, expected typed`)
      if (typeof answer.answerText !== 'string' || answer.answerText.length === 0) {
        throw new Error('empty answerText returned')
      }
      if (answer.userConfirmedTranscript !== true) throw new Error('answer not user-confirmed')

      await waitForAnswerGone(APP_PROCESS, 10000, run.probe)
      if (answerSurfaceVisible(APP_PROCESS)) {
        throw new Error('answer elements still present after return (FIX-011 cleanup regression)')
      }
      // The real server cleared the delivered slot on answer.
      if (run.server.registry.openCount() !== 0) {
        throw new Error(`bridge slots not drained after answer: ${run.server.registry.openCount()}`)
      }
    })

    // The trace never carries question/answer text (FIX-017 boundary).
    await check('trace frames carry keys and codes only', () => {
      const raw = fs.readFileSync(path.join(TRACE_DIR, 'event-trace.jsonl'), 'utf8')
      const forbidden = [
        'Tell me about your idea', 'FIX-019 packaged typed BUILD_TARGET answer', LABELS.TYPE_INPUT,
      ]
      for (const text of forbidden) {
        if (raw.includes(text)) throw new Error(`trace contains forbidden text: ${text}`)
      }
      for (const line of raw.trim().split('\n')) {
        const frame = JSON.parse(line)
        for (const key of ['runId', 'launcher', 'sessionId', 'questionKey', 'inputMode', 'eventKind', 'ts']) {
          if (!(key in frame)) throw new Error(`trace frame missing ${key}`)
        }
      }
    })
  } finally {
    killAppProcesses()
    if (run) await run.close()
  }

  console.log(`\nLEG packaged-BUILD_TARGET: ${failures === 0 ? 'ALL TESTS PASSED' : 'FAILED'}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.log(`LEG packaged-BUILD_TARGET: FAILED`)
  console.log(`  ${err && err.message ? err.message : err}`)
  process.exit(1)
})
