'use strict'

/**
 * candice failure matrix — app crash — owned path: tests/failure-matrix/**
 *
 * E.1 WS-43 "app crash" leg (spec 20: crash mid-question recovers the exact
 * pending question; spec 8 step 6: startup sweep removes crash-left temp
 * audio). Drives the REAL WS-35 recovery lane (`runStartupRecovery`) with
 * injected surfaces — the same code the app runs at startup — plus the WS-04
 * crash-between-delivery-and-answer path.
 *
 * Invariants: the exact pending question is restored, never re-asked, never
 * double-counted; a crash before delivery leaves no pending question and no
 * open answer slot; every leg is total (a throwing lifecycle or sweep is a
 * named failure, never a propagated throw); Claude is never reset.
 */

const assert = require('assert')
const path = require('path')
const fsp = require('node:fs/promises')
const os = require('node:os')
const { check, checkAsync, finish } = require('./harness')

// The REAL WS-35 orchestration and WS-20 sweep engine (TS stripped natively
// by Node 26; CommonJS require resolves the modules directly).
const { runStartupRecovery, RECOVERY_VERB, RECOVERY_STATUS, isRecoveryStatus } = require(
  path.join(__dirname, '..', '..', 'apps', 'candice-companion', 'src-tauri', 'recovery', 'index.ts')
)
const { sweepStaleTempAudio, SWEEP_DEFAULTS, CANDICE_TEMP_ROOT } = require(
  path.join(__dirname, '..', '..', 'apps', 'candice-companion', 'src-tauri', 'audio', 'cleanup', 'index.ts')
)
const { AnswerSlotRegistry } = require(
  path.join(__dirname, '..', '..', 'plugins', 'candice-integration', 'mcp', 'ask-user', 'answer-registry')
)

const PENDING = {
  questionKey: 'BUILD_TARGET',
  text: 'Who is the application for?',
  answerKind: 'free_text',
  counted: true,
  askedAt: '2026-08-21T00:00:00.000Z',
}

function lifecycleWithPending(sessionId, pending) {
  return {
    recoverPendingQuestion(id) {
      if (id !== sessionId) return { ok: false, code: 'no-pending-question' }
      return pending ? { ok: true, recovered: { ...pending } } : { ok: true, recovered: null }
    },
    resumeSession(id) {
      return { ok: id === sessionId }
    },
  }
}

function noopSweep() {
  return Promise.resolve({ scanned: 0, removed: 0, kept: 0, failed: 0 })
}

function realFs() {
  return {
    mkdir: (p, m) => fsp.mkdir(p, m),
    readdir: (p) => fsp.readdir(p),
    stat: async (p) => {
      const s = await fsp.stat(p)
      return { isDirectory: s.isDirectory(), isFile: s.isFile(), mtimeMs: s.mtimeMs, mode: s.mode }
    },
    rm: (p, o) => fsp.rm(p, o),
    writeFile: (p, d) => fsp.writeFile(p, d),
    realpath: (p) => fsp.realpath(p),
    exists: (p) => fsp.access(p).then(() => true, () => false),
  }
}

async function main() {
  // ---- Crash mid-question: exact pending question recovered (spec 20). ----
  await checkAsync('crash mid-question restores the EXACT pending question, counted mirror untouched', async () => {
    const events = []
    const outcome = await runStartupRecovery({
      lifecycle: lifecycleWithPending('sess-crash-1', PENDING),
      sweep: noopSweep,
      tempRoot: '/tmp',
      sessionId: 'sess-crash-1',
      rollbackAvailable: () => true,
      onEvent: (e) => events.push(e),
    })
    assert.equal(outcome.ok, true)
    assert.equal(outcome.recovery.recovered, true)
    assert.equal(outcome.recovery.pending.questionKey, PENDING.questionKey)
    assert.equal(outcome.recovery.pending.text, PENDING.text)
    assert.equal(outcome.recovery.pending.counted, true, 'mirrored flag, never mutated')
    assert.equal(outcome.recovery.counted, true)
    assert.ok(events.some((e) => e.type === 'question:found'))
    assert.ok(events.some((e) => e.type === 'question:handoff'))
  })

  await checkAsync('crash mid-question raises recovering status for the WS-08 machine', async () => {
    const events = []
    await runStartupRecovery({
      lifecycle: lifecycleWithPending('sess-crash-2', PENDING),
      sweep: noopSweep,
      tempRoot: '/tmp',
      sessionId: 'sess-crash-2',
      onEvent: (e) => events.push(e),
    })
    assert.ok(
      events.some((e) => e.type === 'recovering:entered'),
      'recovering entered before the front-end re-raises'
    )
    assert.equal(isRecoveryStatus(RECOVERY_STATUS), true)
    assert.equal(RECOVERY_VERB, 'question:recovered')
  })

  // ---- Crash before delivery: no pending question, nothing to restore. ----
  await checkAsync('crash before the question was asked: no phantom recovery', async () => {
    const outcome = await runStartupRecovery({
      lifecycle: lifecycleWithPending('sess-crash-3', null),
      sweep: noopSweep,
      tempRoot: '/tmp',
      sessionId: 'sess-crash-3',
    })
    assert.equal(outcome.ok, true)
    assert.equal(outcome.recovery.recovered, false)
    assert.equal(outcome.recovery.pending, null)
  })

  // ---- Crash before delivery: WS-04 slot released, question re-askable. ----
  await checkAsync('crash between ask and answer: the registry slot is released, question re-askable', () => {
    const reg = new AnswerSlotRegistry()
    const open = reg.open({ sessionId: 'sess-crash-4', questionKey: 'BUILD_TARGET' })
    assert.equal(open.ok, true)
    assert.equal(reg.openCount(), 1)
    reg.cancel({ sessionId: 'sess-crash-4', questionKey: 'BUILD_TARGET' })
    assert.equal(reg.openCount(), 0, 'a crashed ask never leaves a wedge slot')
    const reopen = reg.open({ sessionId: 'sess-crash-4', questionKey: 'BUILD_TARGET' })
    assert.equal(reopen.ok, true, 'the question can be re-asked after the crash')
  })

  // ---- Startup temp sweep removes crash leftovers (spec 8 step 6). ----
  await checkAsync('startup sweep removes stale crash-orphan temp audio, keeps fresh sessions', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'candice-fm-crash-'))
    try {
      // The sweep engine scans baseRoot/<CANDICE_TEMP_ROOT> (the Candice-owned
      // temp root the bridge passes) — nest session dirs there.
      const owned = path.join(root, CANDICE_TEMP_ROOT)
      await fsp.mkdir(owned)
      const staleDir = path.join(owned, 'candice-crash-orphan')
      await fsp.mkdir(staleDir)
      await fsp.writeFile(path.join(staleDir, '.candice-session'), '')
      const old = new Date(Date.now() - SWEEP_DEFAULTS.staleAfterMs - 60_000)
      await fsp.utimes(staleDir, old, old)
      const freshDir = path.join(owned, 'candice-fresh')
      await fsp.mkdir(freshDir)
      await fsp.writeFile(path.join(freshDir, '.candice-session'), '')
      const result = await sweepStaleTempAudio({ fs: realFs(), baseRoot: root, nowMs: Date.now() })
      assert.equal(result.removed, 1, 'stale orphan removed')
      assert.equal(result.kept, 1, 'fresh session kept')
      const remains = await fsp.readdir(owned)
      assert.equal(remains.includes('candice-fresh'), true)
      assert.equal(remains.includes('candice-crash-orphan'), false)
    } finally {
      await fsp.rm(root, { recursive: true, force: true })
    }
  })

  // ---- Throwing lifecycle is a named failure, never a propagated throw. ----
  await checkAsync('a throwing lifecycle is captured as a named failure (total startup)', async () => {
    const outcome = await runStartupRecovery({
      lifecycle: {
        recoverPendingQuestion() {
          throw new Error('crash')
        },
        resumeSession() {
          throw new Error('crash')
        },
      },
      sweep: noopSweep,
      tempRoot: '/tmp',
      sessionId: 'sess-crash-5',
    })
    assert.equal(outcome.ok, false)
    assert.ok(outcome.failures.includes('recovery:lifecycle-threw'))
  })

  finish('APP-CRASH')
}

main()
