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
  // The compact field's aria-label (src/ui/compact/config.ts
  // COMPACT_INPUT_LABEL), NOT its placeholder. It was the placeholder, so
  // rewording user-visible copy silently broke this locator.
  COMPACT_INPUT: 'Compact message input',
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
// Accessibility element search (ax-driver.swift)
// ---------------------------------------------------------------------------
//
// WHY THIS REPLACED THE APPLESCRIPT ELEMENT PATHS
//
// Every packaged leg failed at the same step with the same message: "answer
// controls never appeared in the packaged a11y tree". They were in the tree
// the whole time. The driver asked for
//
//     text field 1 of group 1 of window 1 whose ... "AXDescription" is "TYPE ANSWER"
//
// which asserts the control is a DIRECT child of the window's first group.
// The real shape is
//
//     AXWindow > AXGroup > AXGroup > AXScrollArea > AXWebArea > ... > AXTextField
//
// because the UI is web content in a WKWebView and a scrollable region adds
// an AXScrollArea of its own. A dump of the live app confirmed the element,
// correctly labelled, several levels below where the query looked. So the
// tier read FAIL — a product verdict — for a locator bug in the harness.
//
// The AppleScript repair does not exist: `entire contents of window 1`
// returns a flat list that cannot be filtered by element class (System Events
// answers -1700/-1728 for `every text field of (entire contents of ...)`),
// leaving a per-element AppleScript loop inside a polling wait.
//
// So the search moved to a tiny Swift tool that walks the same public
// accessibility tree a screen reader walks, by ROLE and LABEL, at any depth.
// It reads no DOM internals and injects no test hooks, so the FIX-014
// boundary this tier must respect is unchanged — and a future layout change
// cannot silently un-find a control again.
//
// Typing still goes through real key events. Setting AXValue directly was
// tried and does not work: it changes the accessibility value without firing
// the DOM input events the view listens to, so the app never learns the text,
// the submit validates an empty answer, and askUser hangs forever.

const AX_SOURCE = path.join(__dirname, 'ax-driver.swift')

let axBinaryCache = null

/**
 * Compile ax-driver.swift once per source revision and cache it in the temp
 * dir. Returns { ok, path } or { ok: false, reason } — never throws, because
 * a toolchain problem is an environment BLOCK, not a product FAIL.
 */
function axDriver() {
  if (axBinaryCache !== null) return axBinaryCache
  try {
    const source = fs.readFileSync(AX_SOURCE)
    const digest = crypto.createHash('sha256').update(source).digest('hex').slice(0, 16)
    const out = path.join(os.tmpdir(), `candice-ax-driver-${digest}`)
    if (!fs.existsSync(out)) {
      runQuiet('swiftc', ['-O', '-o', out, AX_SOURCE], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 })
    }
    axBinaryCache = { ok: true, path: out }
  } catch (err) {
    axBinaryCache = { ok: false, reason: `ax-driver could not be built: ${osaErrDetail(err)}` }
  }
  return axBinaryCache
}

/**
 * PID of the packaged app. Matched on the FULL binary path, never on the bare
 * name: an operator's own Candice (installed elsewhere) has the same process
 * name, and matching that would drive — or kill — the wrong window.
 */
function appPid() {
  try {
    const out = runQuiet('pgrep', ['-f', PACKAGED_BINARY], { stdio: ['ignore', 'pipe', 'pipe'] })
    const pids = out.trim().split('\n').filter(Boolean)
    return pids.length > 0 ? pids[pids.length - 1] : null
  } catch (_) {
    return null
  }
}

/** Run one ax-driver command. Returns { rc, out }; rc 1 means "not found". */
function ax(...args) {
  const driver = axDriver()
  if (!driver.ok) return { rc: 2, out: driver.reason }
  const pid = appPid()
  if (pid === null) return { rc: 2, out: 'no packaged app process' }
  try {
    const out = runQuiet(driver.path, [pid, ...args], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 })
    return { rc: 0, out: out.trim() }
  } catch (err) {
    return { rc: typeof err.status === 'number' ? err.status : 2, out: osaErrDetail(err) }
  }
}

/** True when an element with this role and label exists at ANY depth. */
function axExists(role, label) {
  return ax('find', role, label).rc === 0
}

/** Same, but the label need only CONTAIN the substring (decorated labels). */
function axContains(role, substring) {
  return ax('contains', role, substring).rc === 0
}

/**
 * "<description>|<role>" of whatever currently holds focus, or '' when focus
 * is not provable. Used by the keyboard leg to name where a Tab landed.
 */
function axFocusedDescription() {
  const r = ax('focused')
  return r.rc === 0 ? r.out : ''
}

/**
 * Bring the app to the front. `keystroke` is delivered to the FRONTMOST
 * application, not to whatever holds AXFocused — without this the keys land
 * in the terminal running the suite and the field stays empty.
 */
function activateApp() {
  const pid = appPid()
  if (pid === null) return false
  try {
    osa(`tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`)
    return true
  } catch (_) {
    return false
  }
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
  // Deliberately NOT System Events. Its window enumeration for this app is
  // unreliable (it answers -1719 "Can't get window 1" on a transparent,
  // undecorated, always-on-top window), and a flaky readiness probe reports
  // a healthy app as a launch failure.
  void procName
  return axExists('AXWindow', 'Candice')
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
    // Prints "<lockKey>|<onConsole>|<dictCount>". The COUNT is the control: it
    // proves the session dictionary was actually read, which is what separates
    // "the key is absent because the screen is unlocked" (the normal case)
    // from "the probe learned nothing".
    const out = runQuiet('swift', ['-e',
      'import Foundation; import CoreGraphics; let d = CGSessionCopyCurrentDictionary() as NSDictionary?; '
      + 'print(String(describing: d?["CGSSessionScreenIsLocked"] ?? "absent") + "|" '
      + '+ String(describing: d?["kCGSSessionOnConsoleKey"] ?? "absent") + "|" + String(d?.count ?? 0))',
    ], { timeout: 30000 })
    const [lockRaw, consoleRaw, countRaw] = out.trim().split('|')
    const count = Number(countRaw)
    // No dictionary => the instrument failed. Undetermined, and it still gates.
    if (!Number.isFinite(count) || count <= 0) return null
    if (lockRaw === '1') return true
    // macOS omits the key when unlocked, so absence is the expected unlocked
    // reading -- but only trust it when the session is on the console, which
    // is independent corroboration from the same (proven-readable) dictionary.
    if ((lockRaw === 'absent' || lockRaw === '0') && consoleRaw === '1') return false
    return null
  } catch (err) {
    return null
  }
}

/** Waits for the answer controls surface to appear in the app window. */
async function waitForAnswerControls(procName, timeoutMs, probe) {
  void procName
  const deadline = Date.now() + timeoutMs
  let lastSeen = 'nothing'
  for (;;) {
    // Wait for the WHOLE surface. Waiting on the text field alone raced: the
    // field and the buttons mount a frame or two apart, so a leg could pass
    // the wait and then fail to find the submit button that had not rendered.
    if (answerSurfaceVisible(procName)) return true
    if (axExists('AXTextField', LABELS.TYPE_INPUT)) lastSeen = 'the input, but not its buttons'
    else if (axExists('AXWindow', 'Candice')) lastSeen = 'the window, but no answer surface'
    if (Date.now() > deadline) {
      throw new Error(
        `answer controls never appeared in the packaged a11y tree within ${timeoutMs}ms (saw ${lastSeen})`,
      )
    }
    await probe.sleep(250)
  }
}

/**
 * Types the answer into the packaged answer field and activates the
 * TYPE ANSWER button. Returns the raw osascript stderr on failure (labels
 * and controls are proven present by waitForAnswerControls first).
 */
function typeAnswer(procName, text) {
  void procName
  activateApp()
  const focused = ax('focus', 'AXTextField', LABELS.TYPE_INPUT)
  if (focused.rc !== 0) throw new Error(`could not focus the answer field: ${focused.out}`)
  // Real key events, so the webview fires the input events its state depends
  // on. They go to the frontmost app, which activateApp() just made this one.
  osa(`tell application "System Events" to keystroke ${JSON.stringify(String(text))}`)
  // The role matters: the surface carries BOTH a text field and a button
  // labelled TYPE ANSWER, and a role-blind search finds the field, "presses"
  // it, and reports success while submitting nothing.
  const pressed = ax('press', 'AXButton', LABELS.TYPE_INPUT)
  if (pressed.rc !== 0) throw new Error(`could not press the submit button: ${pressed.out}`)
  return true
}

/**
 * Reads the presence of answer controls in the a11y tree: the TYPE ANSWER
 * field + button and the Answer-in-Claude button. `false` on any absence.
 */
function answerSurfaceVisible(procName) {
  void procName
  return axExists('AXTextField', LABELS.TYPE_INPUT)
    && axExists('AXButton', LABELS.TYPE_INPUT)
    && axExists('AXButton', LABELS.ANSWER_IN_CLAUDE)
}

/** Clicks Answer in Claude instead. */
function clickAnswerInClaude(procName) {
  void procName
  const pressed = ax('press', 'AXButton', LABELS.ANSWER_IN_CLAUDE)
  if (pressed.rc !== 0) throw new Error(`could not press "${LABELS.ANSWER_IN_CLAUDE}": ${pressed.out}`)
  return pressed.out
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
  void procName
  return axExists('AXTextField', LABELS.COMPACT_INPUT)
}

/** Types into the compact input and clicks Send. */
function compactSubmit(procName, text) {
  void procName
  activateApp()
  const focused = ax('focus', 'AXTextField', LABELS.COMPACT_INPUT)
  if (focused.rc !== 0) throw new Error(`could not focus the compact input: ${focused.out}`)
  osa(`tell application "System Events" to keystroke ${JSON.stringify(String(text))}`)
  const pressed = ax('press', 'AXButton', LABELS.SEND)
  if (pressed.rc !== 0) throw new Error(`could not press ${LABELS.SEND}: ${pressed.out}`)
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

/**
 * Kills leftover processes of THE PACKAGED BINARY, matched on its full path.
 *
 * This used to be `pkill -f candice-companion`, which is a bare substring
 * match against every command line on the box. That kills the operator's own
 * installed Candice (a different binary, same process name) the moment a leg
 * runs -- and it matches any rustc/cargo/tauri command line that merely
 * mentions the crate, so a suite run could tear down a build in progress.
 * A cleanup step is allowed to remove what the suite started and nothing else.
 */
function killAppProcesses() {
  try {
    runQuiet('pkill', ['-f', PACKAGED_BINARY], { stdio: 'ignore' })
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
  void probe
  // Scoped to the packaged binary's path. `pgrep -x candice-companion`
  // matched the operator's own installed Candice by name and reported the
  // environment dirty when nothing of this suite's was running at all.
  try {
    runQuiet('pgrep', ['-f', PACKAGED_BINARY], { stdio: 'ignore' })
    return { ok: false, reason: `a packaged app process is still running: ${PACKAGED_BINARY}` }
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
  if (process.platform === 'darwin') {
    // A harness that cannot build its own element search has proved nothing
    // about the product. That is an environment BLOCK, never a leg failure.
    const driver = axDriver()
    if (!driver.ok) problems.push(driver.reason)
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
  axDriver,
  appPid,
  ax,
  axExists,
  axContains,
  axFocusedDescription,
  activateApp,
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
