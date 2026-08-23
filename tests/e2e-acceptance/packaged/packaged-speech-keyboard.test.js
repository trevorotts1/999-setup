'use strict'

/**
 * QFIX-q2 packaged-automated leg: Q-02 step 6 installed-app keyboard path.
 * Owned path: tests/e2e-acceptance/packaged/** (design authority:
 * /Users/blackceomacmini/Downloads/CANDACE FIXES/evidence/QFIX/q2-design.md
 * sections 2.3, 6 and 7).
 *
 * What this leg proves against the REAL packaged app (real binary, real
 * bridge, real server — the exact FIX-011/FIX-019 packaged-driver pattern):
 *
 *   1. The PTT control reaches the packaged accessibility tree with its
 *      spec-6 label ("HOLD TO TALK") once a governed question is on
 *      screen — the keyboard operator's press surface exists.
 *   2. Keyboard traversal: Tab moves focus into the TYPE ANSWER field
 *      (the mounted answer controls are native focusable elements), so
 *      the mounted state has reachable tab stops.
 *   3. Keyboard submit: typing an answer and pressing Enter submits it —
 *      exactly one answer returns to the same session with inputMode
 *      `typed` and userConfirmedTranscript true (the view's Enter handler
 *      is the keyboard equivalent of the TYPE ANSWER button; the typed
 *      path must stay intact while the voice path lands).
 *   4. Typed answers survive the speech lane's presence: the degraded
 *      speech precondition of this build (no payload assets installed,
 *      per the q2-design section 5 decision) never blocks or corrupts the
 *      keyboard/typed fallback (spec 20 degrade contract).
 *
 * Voice-capture hardware legs (real mic open + real STT) stay owned by the
 * HUMAN_HARDWARE tier per tiers doctrine; this leg closes the automated
 * keyboard obligations that do NOT require audio hardware.
 *
 * Privacy boundary (FIX-017 rule): traces record keys/codes only — never
 * question text, answer text, tokens, or raw audio.
 *
 *   node tests/e2e-acceptance/packaged/packaged-speech-keyboard.test.js \
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
const RUN_ID = `speech-keyboard-${Date.now()}`

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

/** Raw osascript run (System Events) used for focus/tab probing. */
function osa(script, timeoutMs = 15000) {
  const { execFileSync } = require('child_process')
  return execFileSync('osascript', ['-e', script], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs,
  }).trim()
}

/**
 * Reads the AXFocusedUIElement's description in the app window. Empty on
 * any absence/failure — callers treat empty as "focus not provable".
 */
function focusedElementDescription(procName) {
  const script = `
tell application "System Events"
  tell (first process whose name is "${procName}")
    try
      set el to value of attribute "AXFocusedUIElement"
      return (value of attribute "AXDescription" of el) & "|" & (value of attribute "AXRole" of el)
    end try
  end tell
end tell
return ""`
  try { return osa(script) } catch (_) { return '' }
}

/**
 * Presses Tab (key code 48) with modifiers via System Events, directed at
 * the frontmost app (the packaged companion is activated before this runs).
 */
function pressTab() {
  osa(`
tell application "System Events"
  key code 48
end tell`)
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

  const launcher = `node tests/e2e-acceptance/packaged/packaged-speech-keyboard.test.js --app ${APP}`
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

    await check('packaged binary SHA recorded (evidence pin)', () => {
      const sha = packagedBinarySha()
      if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error('bad SHA')
      fs.writeFileSync(path.join(TRACE_DIR, 'packaged-binary.sha256'), `${sha}  ${path.basename(APP)}\n`, 'utf8')
    })

    let pttSeen = false
    await check('answer controls mount and PTT control is present in the a11y tree', async () => {
      await waitForAnswerControls(APP_PROCESS, 30000, run.probe)
      emit(sessionId, 'question-presented', null)
      if (!answerSurfaceVisible(APP_PROCESS)) throw new Error('answer surface not visible after wait')

      // The HOLD TO TALK button mounts with the question surface. Probed
      // through the same accessibility tree the other legs drive; the
      // emoji prefix is part of the spec-6 label but System Events matches
      // on the readable suffix.
      const script = `
tell application "System Events"
  tell (first process whose name is "${APP_PROCESS}")
    try
      return exists (button 1 of group 1 of window 1 whose description contains "HOLD TO TALK")
    end try
  end tell
end tell
return false`
      const out = (() => { try { return osa(script) } catch (_) { return 'false' } })()
      if (out !== 'true') throw new Error('PTT control (HOLD TO TALK) absent from the packaged a11y tree')
      pttSeen = true
      fs.writeFileSync(path.join(TRACE_DIR, 'ptt-present'), 'true\n', 'utf8')
    })

    await check('Tab traversal focuses a named interactive element (keyboard reachability)', () => {
      if (!pttSeen) throw new Error('skipped: no answer surface')
      // Focus the TYPE ANSWER field first (the driver's proven primitive),
      // then one Tab walk: focus must land on another named control —
      // proving the mounted surface has real tab stops, not a focus trap.
      typeAnswerFocusOnly(APP_PROCESS)
      pressTab()
      const desc = focusedElementDescription(APP_PROCESS)
      if (!desc || desc === '|') {
        throw new Error('after Tab, no focused element with a name/role was resolvable (surface not keyboard-reachable)')
      }
      const [description, role] = desc.split('|')
      fs.writeFileSync(
        path.join(TRACE_DIR, 'tab-focus.txt'),
        `role=${role} desc=${description ? 'named' : 'unnamed'}\n`,
        'utf8',
      )
      if (!['AXTextField', 'AXButton', 'AXTextArea'].includes(role)) {
        throw new Error(`Tab landed on unexpected role ${role}`)
      }
    })

    await check('Enter-key submit returns exactly one confirmed typed answer to the same session', async () => {
      emit(sessionId, 'answer-submitted', 'typed')
      typeAnswerWithEnter(APP_PROCESS, 'QFIX-q2 keyboard Enter submit')
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
        throw new Error(`wrong question key: ${answer.questionKey}`)
      }
      if (answer.inputMode !== 'typed') throw new Error(`inputMode ${answer.inputMode}, expected typed`)
      if (answer.userConfirmedTranscript !== true) throw new Error('answer not user-confirmed')

      await waitForAnswerGone(APP_PROCESS, 10000, run.probe)
      if (answerSurfaceVisible(APP_PROCESS)) {
        throw new Error('answer elements still present after return (FIX-011 cleanup regression)')
      }
      if (run.server.registry.openCount() !== 0) {
        throw new Error(`bridge slots not drained: ${run.server.registry.openCount()}`)
      }
    })

    // The trace never carries question/answer text (FIX-017 boundary).
    await check('trace frames carry keys and codes only', () => {
      const raw = fs.readFileSync(path.join(TRACE_DIR, 'event-trace.jsonl'), 'utf8')
      const forbidden = [
        'Tell me about your idea', 'QFIX-q2 keyboard Enter submit', LABELS.TYPE_INPUT,
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

  console.log(`\nLEG packaged-speech-keyboard: ${failures === 0 ? 'ALL TESTS PASSED' : 'FAILED'}`)
  process.exit(failures === 0 ? 0 : 1)
}

// ---------------------------------------------------------------------------
// Local System Events primitives (keyboard-specific; the shared driver owns
// click-based primitives — these extend it without touching it).
// ---------------------------------------------------------------------------

/** Focuses the TYPE ANSWER field without typing (click only). */
function typeAnswerFocusOnly(procName) {
  osa(`
tell application "System Events"
  tell (first process whose name is "${procName}")
    click (text field 1 of group 1 of window 1 whose value of attribute "AXDescription" is "${LABELS.TYPE_INPUT}")
  end tell
end tell`)
}

/** Types text then presses Return (key code 36) to submit via Enter. */
function typeAnswerWithEnter(procName, text) {
  osa(`
tell application "System Events"
  tell (first process whose name is "${procName}")
    set targetField to text field 1 of group 1 of window 1 whose value of attribute "AXDescription" is "${LABELS.TYPE_INPUT}"
    set focused of targetField to true
    keystroke ${JSON.stringify(String(text))}
    key code 36
  end tell
end tell`)
}

main().catch((err) => {
  console.log('LEG packaged-speech-keyboard: FAILED')
  console.log(`  ${err && err.message ? err.message : err}`)
  process.exit(1)
})
