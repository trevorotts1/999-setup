'use strict'

/**
 * FIX-019 packaged-automated leg: compact-state submit.
 * Owned path: tests/e2e-acceptance/packaged/**.
 *
 * After the interview question round trip completes, the compact surface
 * (FIX-014 owns the surface; FIX-019 only consumes its accessibility
 * tree) accepts a typed question and a `/bro` or `/eli5` slash command,
 * and no governed question is re-asked.
 *
 * Dependency-honest gate: this leg records BLOCKED with a named dependency
 * rather than a fake PASS or a FAIL for code it does not own.
 *
 * WHAT THE DEPENDENCY ACTUALLY IS (measured 2026-08-26, was previously
 * recorded wrongly as "FIX-014 appui lane not yet landed"):
 *
 * The FIX-014 surface IS landed. `src/ui/compact/` is complete and tested
 * — view, controller, queue, status, config, CONTRACT.md. Nothing about it
 * is missing. It is simply never mounted, and mounting it would be wrong,
 * because `CompactTransport.submit(entry)` has no implementation anywhere
 * in this product and cannot have one at this commit.
 *
 * The compact surface is a box where the user types a message TO Claude,
 * unprompted. Every channel this product owns runs the other direction:
 * Claude asks, the user answers, the answer returns to the asking call.
 * Verified across four sources, each with a control that came back
 * non-empty on the same instrument:
 *
 *   1. src-tauri commands (25 of them) — all bridge-question lifecycle,
 *      window, prefs or speech. None sends user-initiated text.
 *      control: cmd_submit_bridge_answer found in lib.rs + runtime.rs.
 *   2. the MCP plugin — exposes exactly one tool, `candice.ask_user`.
 *      There is no inbound tool for Claude to receive on.
 *   3. packages/candice-protocol/schemas — question, answer, status,
 *      lifecycle, preferences. No user-initiated message schema exists.
 *      control: answer-event.schema.json present.
 *   4. a source sweep for any implementor of CompactTransport, or any
 *      sendToClaude / injectPrompt / user_initiated path: zero hits
 *      outside src/ui/compact/ itself.
 *      control: the same regex found CompactTransport in controller.ts.
 *
 * NOT checked: whether a future MCP revision adds a client-initiated
 * message tool. That is a product capability decision, not a defect.
 *
 * So this is not a repair that was skipped. Mounting a text box that
 * submits into nothing would ship a control that silently eats what the
 * user types — worse than not shipping it. The leg stays BLOCKED and now
 * names the real owner.
 *
 *   node tests/e2e-acceptance/packaged/packaged-compact.test.js \
 *     --app <packaged binary> --trace-dir <dir> [--wait-ms <n>]
 *
 * Exit 0 = PASS, 1 = FAIL, 2 = BLOCKED.
 */

const fs = require('fs')
const path = require('path')
const {
  createRun, environmentGate, killAppProcesses, PACKAGED_BINARY,
  appendTrace, traceFrame, waitForAnswerControls, waitForAnswerGone,
  typeAnswer, compactInputVisible, compactSubmit, APP_PROCESS,
} = require('./packaged-driver')

function argValue(name, fallback) {
  const ix = process.argv.indexOf(name)
  return ix >= 0 && process.argv[ix + 1] ? process.argv[ix + 1] : fallback
}

const APP = argValue('--app', PACKAGED_BINARY)
const TRACE_DIR = argValue('--trace-dir', null)
const WAIT_WINDOW_MS = Number(argValue('--wait-ms', '45000'))
const COMPACT_WAIT_MS = Number(argValue('--compact-wait-ms', '15000'))
const RUN_ID = `compact-${Date.now()}`

let failures = 0
let blockedReason = null

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

async function waitForCompactInput(timeoutMs, probe) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      if (compactInputVisible(APP_PROCESS)) return true
    } catch (_) { /* surface not mounted yet */ }
    if (Date.now() > deadline) return false
    await probe.sleep(250)
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

  const launcher = `node tests/e2e-acceptance/packaged/packaged-compact.test.js --app ${APP}`
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

    // Complete one real BUILD_TARGET round trip so the interview flow
    // reaches its terminal state.
    const pending = run.server.askUser({ question: run.buildTarget(sessionId), sessionId })

    await check('BUILD_TARGET round trip completes before compact state', async () => {
      await waitForAnswerControls(APP_PROCESS, 30000, run.probe)
      emit(sessionId, 'question-presented', null)
      typeAnswer(APP_PROCESS, 'FIX-019 compact prelude answer')
      emit(sessionId, 'answer-submitted', 'typed')
      const result = await pending
      if (!result || !result.result || result.result.ok !== true) {
        throw new Error('prelude answer did not return ok')
      }
      emit(sessionId, 'answer-returned', 'typed')
      await waitForAnswerGone(APP_PROCESS, 10000, run.probe)
    })

    // Dependency-honest gate: compact surface is FIX-014's.
    const compactPresent = await waitForCompactInput(COMPACT_WAIT_MS, run.probe)
    if (!compactPresent) {
      blockedReason = 'compact input absent by design: the FIX-014 surface is built and tested, but CompactTransport has no implementation in any tier — this product has no user-initiated channel to Claude (verified: 25 src-tauri commands, 1 MCP tool candice.ask_user, 11 protocol schemas, full source sweep). Needs a product capability, not a fix.'
      console.log(`BLOCKED - ${blockedReason}`)
    } else {
      await check('compact typed question submits; no governed question re-asked', async () => {
        emit(sessionId, 'compact-entered', 'typed')

        compactSubmit(APP_PROCESS, 'FIX-019 compact typed question')
        emit(sessionId, 'compact-submit', 'typed')

        // No governed question re-asked: the lifecycle record shows
        // BUILD_TARGET answered exactly once and nothing pending.
        const record = run.lifecycle.getSession(sessionId)
        if (!record || record.pendingQuestion !== null) {
          throw new Error('compact submit re-armed a pending governed question')
        }
        if (record.answeredQuestionKeys.filter((k) => k === 'BUILD_TARGET').length !== 1) {
          throw new Error('BUILD_TARGET must be answered exactly once')
        }
      })

      await check('slash command /bro submits through the compact surface', async () => {
        compactSubmit(APP_PROCESS, '/bro')
        emit(sessionId, 'compact-submit', 'typed')
        const record = run.lifecycle.getSession(sessionId)
        if (!record || record.pendingQuestion !== null) {
          throw new Error('/bro submit re-armed a pending governed question')
        }
      })
    }

    await check('trace frames carry keys and codes only', () => {
      const raw = fs.readFileSync(path.join(TRACE_DIR, 'event-trace.jsonl'), 'utf8')
      for (const forbidden of ['FIX-019 compact prelude answer', 'FIX-019 compact typed question']) {
        if (raw.includes(forbidden)) throw new Error(`trace contains forbidden text: ${forbidden}`)
      }
    })
  } finally {
    killAppProcesses()
    if (run) await run.close()
  }

  if (blockedReason) {
    console.log(`\nLEG packaged-compact: BLOCKED`)
    process.exit(2)
  }
  console.log(`\nLEG packaged-compact: ${failures === 0 ? 'ALL TESTS PASSED' : 'FAILED'}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.log('LEG packaged-compact: FAILED')
  console.log(`  ${err && err.message ? err.message : err}`)
  process.exit(1)
})
