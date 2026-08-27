'use strict'

/**
 * FIX-019 packaged-automated leg: fallback transfer.
 * Owned path: tests/e2e-acceptance/packaged/**.
 *
 * The packaged app is killed mid-question (delivered, not yet answered):
 * `candice.ask_user` fails soft with the stable fallback code; the real
 * FallbackCoordinator hands the SAME governed question to the terminal
 * surface; the terminal answer records exactly once with inputMode
 * 'terminal'; the question is counted exactly once (FIX-013 fallback
 * seam, no double-count).
 *
 *   node tests/e2e-acceptance/packaged/packaged-fallback.test.js \
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
const RUN_ID = `fallback-${Date.now()}`

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

  const launcher = `node tests/e2e-acceptance/packaged/packaged-fallback.test.js --app ${APP}`
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

    await check('app killed mid-question fails soft and falls back; counted exactly once', async () => {
      await waitForAnswerControls(APP_PROCESS, 30000, run.probe)
      emit(sessionId, 'question-presented', null)

      // Kill the real packaged process mid-question (named boundary).
      killAppProcesses()

      const result = await pending
      if (!result || !result.result || result.result.isError !== true) {
        throw new Error('askUser must fail soft when the companion dies mid-question')
      }
      const text = JSON.stringify(result.result.content)
      if (!text.includes('ask the same question in Claude normally')) {
        throw new Error(`fallback instruction missing from fail-soft result: ${text.slice(0, 300)}`)
      }

      // Real FallbackCoordinator: hand the same governed question to the
      // terminal surface and record the terminal answer exactly once.
      const deferred = run.fallback.fallbackQuestion(run.buildTarget(sessionId))
      if (!deferred.ok) throw new Error(`fallbackQuestion failed: ${deferred.code}`)
      const terminal = run.fallback.answerFromTerminal({
        sessionId,
        questionKey: 'BUILD_TARGET',
        answerText: 'FIX-019 fallback terminal answer',
        userConfirmedTranscript: true,
      })
      if (!terminal.ok) throw new Error(`answerFromTerminal failed: ${terminal.code}`)
      if (!terminal.answer || terminal.answer.inputMode !== 'terminal') {
        throw new Error('fallback answer must carry inputMode terminal (spec 5.1)')
      }
      emit(sessionId, 'fallback-returned', 'terminal')

      // Exactly once: a second terminal answer for the same question is
      // refused — the guard consumed the deferral on the first answer.
      const again = run.fallback.answerFromTerminal({
        sessionId,
        questionKey: 'BUILD_TARGET',
        answerText: 'FIX-019 fallback second terminal answer',
        userConfirmedTranscript: true,
      })
      if (again.ok !== false) throw new Error('second terminal answer must be refused (double-count guard)')

      // No MCP answer was recorded: the server's own lifecycle path never
      // counted this question, and no MCP slot remains.
      const record = run.lifecycle.getSession(sessionId)
      if (!record || record.questionCount !== 0) {
        throw new Error(`MCP path must not count a question it never answered: count ${record && record.questionCount}`)
      }
      if (run.server.registry.openCount() !== 0) {
        throw new Error(`MCP slot left open after fallback: ${run.server.registry.openCount()}`)
      }
    })

    await check('trace frames carry keys and codes only', () => {
      const raw = fs.readFileSync(path.join(TRACE_DIR, 'event-trace.jsonl'), 'utf8')
      for (const forbidden of ['FIX-019 fallback terminal answer', 'Tell me about your idea']) {
        if (raw.includes(forbidden)) throw new Error(`trace contains forbidden text: ${forbidden}`)
      }
    })
  } finally {
    killAppProcesses()
    if (run) await run.close()
  }

  console.log(`\nLEG packaged-fallback: ${failures === 0 ? 'ALL TESTS PASSED' : 'FAILED'}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.log('LEG packaged-fallback: FAILED')
  console.log(`  ${err && err.message ? err.message : err}`)
  process.exit(1)
})
