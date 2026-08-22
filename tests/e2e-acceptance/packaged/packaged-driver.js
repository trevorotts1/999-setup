'use strict'

/**
 * FIX-019 packaged-automated driver — real binary, real bridge, real server.
 * Owned path: tests/e2e-acceptance/packaged/** (FIX-019 implementation lane).
 *
 * Reuses the exact FIX-011 recheck pattern:
 *   - the packaged executable is `apps/candice-companion/dist/Candice
 *     Companion.app/Contents/MacOS/candice-companion` (built by tauri:build +
 *     scripts/package-macos/build-macos-bundle.sh adhoc, then
 *     `codesign --verify --deep --strict`);
 *   - a real `LocalCompanionBridge` is constructed with `launchCommand` set
 *     to that binary (never a unit fixture — a test double cannot close this
 *     tier, EXECUTION-PLAN.md "Packaged driver mechanics");
 *   - a real `AskUserServer` is attached to that bridge; the question event
 *     is the registry's canonical BUILD_TARGET (questionKey only ever from
 *     packages/candice-protocol/schemas/question-inventory.json);
 *   - the packaged UI is driven through its accessibility tree via System
 *     Events (osascript), not through private DOM internals (FIX-014 owns
 *     the UI; FIX-019 only consumes it).
 *
 * Lifecycle wiring (FIX-013 seam, consumed read-only): a real SessionManager
 * backed by an isolated temp state dir, passed to AskUserServer as
 * `lifecycle`; a real FallbackCoordinator with an isolated guard store.
 * These are the production modules — no doubles.
 *
 * Privacy boundary (FIX-017 rule): traces record keys/codes only — never
 * question text, answer text, secrets, tokens, or raw audio.
 *
 * macOS-only: System Events accessibility driving requires Accessibility
 * permission for the calling terminal. The packaged suite probes this with
 * a known-good control before any leg runs; a failed probe records BLOCKED
 * (environment gate), never a fake PASS.
 *
 * Pure CommonJS, zero dependencies.
 */

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawn } = require('child_process')

const REPO_ROOT = path.join(__dirname, '..', '..', '..')

const PACKAGED_BINARY = path.join(
  REPO_ROOT,
  'apps', 'candice-companion', 'dist', 'Candice Companion.app', 'Contents', 'MacOS', 'candice-companion',
)

const APP_PROCESS = 'candice-companion'

// Stable a11y labels (FIX-014 answer-controls contract; do not rephrase).
const LABELS = Object.freeze({
  TYPE_INPUT: 'TYPE ANSWER',
  ANSWER_IN_CLAUDE: 'Answer in Claude instead',
  COMPACT_INPUT: 'Type a question or /bro, /eli5',
  SEND: 'Send',
})

/** Event-trace contract (EXECUTION-PLAN.md exact fix item 6). */
const EVENT_KINDS = Object.freeze([
  'question-presented', 'answer-submitted', 'answer-returned', 'fallback-returned',
  'duplicate-refused', 'wrong-session-refused', 'clarification-asked',
  'clarification-returned', 'compact-entered', 'compact-submit',
  'interview-complete', 'write-through',
])

function assertEventKind(eventKind) {
  if (!EVENT_KINDS.includes(eventKind)) throw new Error(`unknown eventKind ${JSON.stringify(eventKind)}`)
}

/** Trace frame: keys and codes only (FIX-017 boundary). */
function traceFrame({ runId, launcher, sessionId, questionKey, inputMode, eventKind, ts }) {
  assertEventKind(eventKind)
  const frame = { runId, launcher, sessionId, questionKey, inputMode, eventKind, ts }
  if (typeof questionKey !== 'string' || questionKey.length === 0) throw new Error('trace frame requires questionKey')
  if (inputMode !== null && !['voice', 'typed', 'terminal'].includes(inputMode)) {
    throw new Error(`trace frame inputMode must be voice|typed|terminal or null (got ${JSON.stringify(inputMode)})`)
  }
  return frame
}

/**
 * Appends an event to the leg trace file (newline-delimited JSON). Never
 * logs the frame to stdout — the trace is evidence, not a console log.
 */
function appendTrace(dir, frame) {
  const file = path.join(dir, 'event-trace.jsonl')
  fs.appendFileSync(file, JSON.stringify(frame) + '\n', 'utf8')
  return file
}

/** execFileSync with stderr captured into the thrown message. */
function runQuiet(cmd, args, opts) {
  return execFileSync(cmd, args, { encoding: 'utf8', ...opts })
}

// ---------------------------------------------------------------------------
// osascript / System Events accessibility driving
// ---------------------------------------------------------------------------

function osa(script) {
  return runQuiet('osascript', ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 }).trim()
}

/**
 * Tells System Events to target the frontmost window of process `name`.
 * Returns true when the process has a visible window; false otherwise.
 */
function windowExists(procName) {
  const script = `tell application "System Events" to exists (first window of (first process whose name is "${procName}"))`
  return osa(script) === 'true'
}

/** Waits (polling System Events) until the app process exposes a window. */
async function waitForWindow(procName, timeoutMs, probe) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      if (windowExists(procName)) return true
    } catch (_) { /* app still launching */ }
    if (Date.now() > deadline) throw new Error(`no ${procName} window within ${timeoutMs}ms`)
    await probe.sleep(250)
  }
}

function osaErrDetail(err) {
  const msg = String(err && (err.stderr || err.message || err))
  return msg.replace(/\s+/g, ' ').slice(0, 400)
}

/**
 * Known-good control: System Events itself answers a property read. Proves
 * the accessibility gate is open for this terminal BEFORE any leg runs —
 * a control that also fails means the check is broken, not the app.
 */
function a11yControlProbe() {
  try {
    return osa('tell application "System Events" to get name of first process') !== ''
  } catch (err) {
    return false
  }
}

/**
 * Authoritative screen-lock check via CGSSessionScreenIsLocked. While the
 * screen is locked, macOS degrades AX window enumeration box-wide: System
 * Events reports only loginwindow, and AXFocusedWindow/AXWindows return the
 * application element itself instead of real windows (proven with
 * known-good controls on this instrument). The a11y probe above can
 * false-pass in that state, so the lock check runs first and is the
 * authoritative gate. Returns true (locked), false (unlocked), or null
 * (undetermined — the probe itself failed, which is also a gate problem).
 */
function screenLocked() {
  try {
    const out = runQuiet('swift', ['-e',
      'import Foundation; import CoreGraphics; let d = CGSessionCopyCurrentDictionary() as NSDictionary?; print(d?["CGSSessionScreenIsLocked"] ?? "?")',
    ], { timeout: 30000 })
    const value = out.trim()
    if (value === '1') return true
    if (value === '0') return false
    return null
  } catch (err) {
    return null
  }
}

/** Waits for the answer controls surface to appear in the app window. */
async function waitForAnswerControls(procName, timeoutMs, probe) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const script = `
tell application "System Events"
  tell (first process whose name is "${procName}")
    try
      return exists (text field 1 of group 1 of window 1 whose value of attribute "AXDescription" is "${LABELS.TYPE_INPUT}")
    end try
  end tell
end tell
return false`
    try {
      if (osa(script) === 'true') return true
    } catch (_) { /* not yet rendered */ }
    if (Date.now() > deadline) throw new Error('answer controls never appeared in the packaged a11y tree')
    await probe.sleep(250)
  }
}

/**
 * Types the answer into the packaged answer field and activates the
 * TYPE ANSWER button. Returns the raw osascript stderr on failure (labels
 * and controls are proven present by waitForAnswerControls first).
 */
function typeAnswer(procName, text) {
  const script = `
tell application "System Events"
  tell (first process whose name is "${procName}")
    set targetField to text field 1 of group 1 of window 1 whose value of attribute "AXDescription" is "${LABELS.TYPE_INPUT}"
    set focused of targetField to true
    keystroke ${JSON.stringify(String(text))}
    click (button 1 of group 1 of window 1 whose description is "${LABELS.TYPE_INPUT}")
  end tell
end tell`
  osa(script)
  return true
}

/**
 * Reads the presence of answer controls in the a11y tree: the TYPE ANSWER
 * field + button and the Answer-in-Claude button. `false` on any absence.
 */
function answerSurfaceVisible(procName) {
  const script = `
tell application "System Events"
  tell (first process whose name is "${procName}")
    try
      set f to exists (text field 1 of group 1 of window 1 whose value of attribute "AXDescription" is "${LABELS.TYPE_INPUT}")
      set b to exists (button 1 of group 1 of window 1 whose description is "${LABELS.TYPE_INPUT}")
      set c to exists (button 1 of group 1 of window 1 whose description is "${LABELS.ANSWER_IN_CLAUDE}")
      return f and b and c
    end try
  end tell
end tell
return false`
  try {
    return osa(script) === 'true'
  } catch (_) {
    return false
  }
}

/** Clicks Answer in Claude instead. */
function clickAnswerInClaude(procName) {
  const script = `
tell application "System Events"
  tell (first process whose name is "${procName}")
    click (button 1 of group 1 of window 1 whose description is "${LABELS.ANSWER_IN_CLAUDE}")
  end tell
end tell`
  return osa(script)
}

/** Waits until the answer surface is gone from the a11y tree. */
async function waitForAnswerGone(procName, timeoutMs, probe) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (!answerSurfaceVisible(procName)) return true
    if (Date.now() > deadline) throw new Error('answer surface still present after answer returned (FIX-011 cleanup regression)')
    await probe.sleep(250)
  }
}

/** Reads the compact input field presence (post-interview compact surface). */
function compactInputVisible(procName) {
  const script = `
tell application "System Events"
  tell (first process whose name is "${procName}")
    try
      return exists (text field 1 of group 1 of window 1 whose value of attribute "AXDescription" is "${LABELS.COMPACT_INPUT}")
    end try
  end tell
end tell
return false`
  try {
    return osa(script) === 'true'
  } catch (_) {
    return false
  }
}

/** Types into the compact input and clicks Send. */
function compactSubmit(procName, text) {
  const script = `
tell application "System Events"
  tell (first process whose name is "${procName}")
    set targetField to text field 1 of group 1 of window 1 whose value of attribute "AXDescription" is "${LABELS.COMPACT_INPUT}"
    set focused of targetField to true
    keystroke ${JSON.stringify(String(text))}
    click (button 1 of group 1 of window 1 whose description is "${LABELS.SEND}")
  end tell
end tell`
  osa(script)
  return true
}

// ---------------------------------------------------------------------------
// Packaged-run scaffolding (real modules, isolated state)
// ---------------------------------------------------------------------------

/**
 * Builds one packaged run: bridge + server + session lifecycle + fallback
 * coordinator, all real, all pointing at one isolated temp state dir.
 */
async function createRun({ launchCommand, waitWindowMs = 45000, probe = { sleep: (ms) => new Promise((r) => setTimeout(r, ms)) } } = {}) {
  const {
    LocalCompanionBridge,
  } = require(path.join(REPO_ROOT, 'plugins', 'candice-integration', 'mcp', 'ask-user', 'local-companion-bridge.js'))
  const { AskUserServer } = require(path.join(REPO_ROOT, 'plugins', 'candice-integration', 'mcp', 'ask-user', 'server.js'))
  const { SessionManager } = require(path.join(REPO_ROOT, 'plugins', 'candice-integration', 'session', 'session-manager.js'))
  const { FallbackCoordinator } = require(path.join(REPO_ROOT, 'plugins', 'candice-integration', 'fallback', 'fallback-coordinator.js'))
  const registry = require(path.join(REPO_ROOT, 'packages', 'candice-protocol', 'question-registry.js'))

  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'candice-fix019-packaged-'))
  const fallbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'candice-fix019-fallback-'))
  const bridge = new LocalCompanionBridge({ launchCommand, token: crypto.randomBytes(32).toString('hex') })
  // The bridge must bind its loopback endpoint BEFORE the companion is
  // launched with it (server.js standalone path does this; in-process legs
  // must too). Without start(), the spawn carries --bridge-endpoint null
  // and the packaged app never surfaces its answer controls.
  await bridge.start()
  const lifecycle = new SessionManager({ stateDir })
  const fallback = new FallbackCoordinator({ adapterOpts: { stateDir: fallbackDir } })
  const server = new AskUserServer({ bridge, lifecycle, waitWindowMs, sleep: probe.sleep })

  return {
    bridge,
    server,
    lifecycle,
    fallback,
    registry,
    stateDir,
    fallbackDir,
    probe,
    /** beginSession with an isolated session id bound to this run. */
    beginSession(skill = 'spec-protocol') {
      const sessionId = `fix019-${crypto.randomBytes(6).toString('hex')}`
      const begun = lifecycle.beginSession({ sessionId, skill })
      if (!begun.ok) throw new Error(`beginSession failed: ${begun.code}`)
      return sessionId
    },
    /** Canonical BUILD_TARGET question event for a session. */
    buildTarget(sessionId) {
      const built = registry.canonicalQuestion({ sessionId, questionKey: 'BUILD_TARGET', skill: 'spec-protocol' })
      if (!built.ok) throw new Error(`canonicalQuestion BUILD_TARGET failed: ${built.code}`)
      return built.question
    },
    async close() {
      await bridge.close()
      try { fs.rmSync(stateDir, { recursive: true, force: true }) } catch (_) { /* temp dir */ }
      try { fs.rmSync(fallbackDir, { recursive: true, force: true }) } catch (_) { /* temp dir */ }
    },
  }
}

/** Kills every leftover packaged app process (clean state, best effort). */
function killAppProcesses() {
  try {
    runQuiet('pkill', ['-f', APP_PROCESS], { stdio: 'ignore' })
  } catch (_) { /* no process — fine */ }
}

/** SHA-256 of the packaged binary (evidence pin, hex digest). */
function packagedBinarySha() {
  return crypto.createHash('sha256').update(fs.readFileSync(PACKAGED_BINARY)).digest('hex')
}

/**
 * Clean-state gate for one leg (EXECUTION-PLAN.md "Clean state means"):
 * no app process, bridge not started yet (checked by the caller via
 * bridge.isReady()), and the protected state dir freshly created by
 * createRun. Returns { ok, reason }.
 */
function cleanStateGate(probe) {
  try {
    runQuiet('pgrep', ['-x', APP_PROCESS], { stdio: 'ignore' })
    return { ok: false, reason: `${APP_PROCESS} process still running` }
  } catch (err) {
    if (err.status !== 1) return { ok: false, reason: `pgrep failed: ${err.message}` }
  }
  return { ok: true }
}

/** Environment gate: macOS + packaged binary present + screen unlocked + a11y control pass. */
function environmentGate() {
  const problems = []
  if (process.platform !== 'darwin') {
    problems.push('packaged tier requires macOS (System Events accessibility driving)')
  }
  if (!fs.existsSync(PACKAGED_BINARY)) {
    problems.push(`packaged binary missing: ${PACKAGED_BINARY} — run Layer 4 (tauri:build + build-macos-bundle.sh adhoc) first`)
  }
  if (problems.length === 0) {
    const locked = screenLocked()
    if (locked === true) {
      problems.push('screen is locked (CGSSessionScreenIsLocked=1) — macOS degrades AX window enumeration box-wide while locked; unlock the screen and rerun')
    } else if (locked === null) {
      problems.push('screen-lock probe failed (swift CGSSessionScreenIsLocked read returned no value) — cannot prove the screen is unlocked')
    }
  }
  if (problems.length === 0 && !a11yControlProbe()) {
    problems.push('osascript System Events control probe failed — grant Accessibility to the terminal running this suite')
  }
  return { ok: problems.length === 0, reason: problems.join('; ') }
}

module.exports = {
  PACKAGED_BINARY,
  APP_PROCESS,
  LABELS,
  EVENT_KINDS,
  traceFrame,
  appendTrace,
  createRun,
  killAppProcesses,
  packagedBinarySha,
  cleanStateGate,
  environmentGate,
  a11yControlProbe,
  screenLocked,
  waitForWindow,
  waitForAnswerControls,
  typeAnswer,
  answerSurfaceVisible,
  clickAnswerInClaude,
  waitForAnswerGone,
  compactInputVisible,
  compactSubmit,
  osaErrDetail,
}
