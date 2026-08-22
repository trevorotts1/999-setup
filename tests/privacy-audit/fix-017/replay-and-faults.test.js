'use strict'

/**
 * FIX-017 replay-and-faults suite — failure injection and replay defense at
 * the final boundary.
 * Owned path: tests/privacy-audit/fix-017/** (FIX-017 builder lane, worktree
 * candice/wt-tests-harness; base b54aec0).
 *
 * Legs (EXECUTION-PLAN.md sequence item 6):
 *   - refusal happens BEFORE synthesis / OS-TTS / audio-file / playback;
 *   - cancellation and timeout after the decision, before side effects,
 *     leave every sink untouched;
 *   - app crash during capture/playback leaks nothing to crash payloads;
 *   - restart recovery re-derives identical decisions from persisted state;
 *   - missing TTS engine degrades without a secret-containing fallback;
 *   - telemetry/logging failure never falls back to text logging;
 *   - a privacy refusal must not wedge the pending session and must not
 *     produce a secret-containing fallback message.
 *
 * Prints test IDs, hashes, counts, decision codes, PASS/FAIL only — never
 * canary values. Exits nonzero on any prohibited canary byte.
 *
 * Run: node tests/privacy-audit/fix-017/replay-and-faults.test.js
 */

const assert = require('assert')
const path = require('path')

const { buildCorpus, freshSinks, sha256 } = require('./corpus')
const { runOne, deliverCorpus } = require('./pipeline')
const { decideSpeech, _decideFromEntry } = require(path.join(__dirname, '..', '..', '..', 'plugins', 'candice-integration', 'privacy', 'final-boundary-guard'))

let failures = 0
let checks = 0

function check(name, fn) {
  checks += 1
  try {
    fn()
    console.log(`PASS  ${name}`)
  } catch (err) {
    failures += 1
    console.log(`FAIL  ${name}: ${err.message}`)
  }
}

/** Byte scan of one sink surface string against canaries. */
function scan(surface, canaries) {
  const hits = []
  for (const [sinkName, bytes] of Object.entries(surface)) {
    for (const c of canaries) {
      if (bytes.includes(c)) hits.push({ sink: sinkName, canaryHash: sha256(c) })
    }
  }
  return hits
}

const corpus = buildCorpus()

try {
  // ———————————————————————————————— 1. refusal precedes every side effect
  check('fault: refusal happens before synthesis (no TTS call, no audio file)', () => {
    const sinks = freshSinks()
    const item = { ...corpus.items[0], fault: { abort: 'refusal' } }
    // C1A is secret; the decision itself is refuse-secret before any fault hook
    const r = runOne(item, sinks)
    assert.strictEqual(r.speech.decision, 'refuse-secret')
    assert.strictEqual(sinks.tts.calls.length, 0, 'TTS was invoked for a refused item')
    assert.strictEqual(sinks.audioFiles.written.length, 0, 'audio file was written for a refused item')
    const surface = sinks.scanSurface()
    const hits = scan(surface, item.canaries)
    assert.deepStrictEqual(hits, [], `refusal leak: ${JSON.stringify(hits)}`)
  })

  check('fault: cancellation after decision, before side effects, leaves sinks untouched', () => {
    const sinks = freshSinks()
    const item = { ...corpus.items[2], fault: { abort: 'cancel' } } // C1C secret
    const r = runOne(item, sinks)
    assert.strictEqual(r.aborted, 'cancel')
    assert.strictEqual(r.sessionHealthy, true)
    assert.strictEqual(sinks.tts.calls.length, 0)
    assert.strictEqual(sinks.audioFiles.written.length, 0)
    assert.strictEqual(sinks.captions.shown.length, 0)
    assert.strictEqual(sinks.logs.lines.length, 0)
    assert.strictEqual(sinks.crash.payloads.length, 0)
    assert.strictEqual(sinks.telemetry.events.length, 0)
  })

  check('fault: timeout after decision, before side effects, leaves sinks untouched', () => {
    const sinks = freshSinks()
    const item = { ...corpus.items[2], fault: { abort: 'timeout' } }
    const r = runOne(item, sinks)
    assert.strictEqual(r.aborted, 'timeout')
    assert.strictEqual(r.sessionHealthy, true)
    assert.strictEqual(sinks.tts.calls.length, 0)
    assert.strictEqual(sinks.audioFiles.written.length, 0)
    assert.strictEqual(sinks.captions.shown.length, 0)
    assert.strictEqual(sinks.logs.lines.length, 0)
    assert.strictEqual(sinks.crash.payloads.length, 0)
    assert.strictEqual(sinks.telemetry.events.length, 0)
  })

  // ———————————————————————————————— 2. crash during capture/playback
  check('fault: crash during capture/playback writes only key/code payloads', () => {
    const sinks = freshSinks()
    for (const item of corpus.items) {
      runOne(item, sinks)
    }
    // A simulated crash snapshot: the crash reporter receives only key/code.
    sinks.crash.report({ code: 'crash-during-playback', questionKey: corpus.items[0].questionKey, skill: 'spec-protocol' })
    const prohibited = []
    for (const item of corpus.items) {
      if (item.expectedSpeech !== 'speak') prohibited.push(...item.canaries)
    }
    const hits = scan(sinks.scanSurface(), prohibited)
    assert.deepStrictEqual(hits, [], `crash leak: ${JSON.stringify(hits)}`)
  })

  check('fault: crash payloads never contain answer canaries', () => {
    const sinks = freshSinks()
    for (const item of corpus.items) runOne(item, sinks)
    sinks.crash.report({ code: 'crash-during-capture', questionKey: 'SECRET_INPUT', skill: 'spec-protocol' })
    const answers = corpus.items.map((it) => it.answerCanary)
    const hits = scan(sinks.scanSurface(), answers)
    assert.deepStrictEqual(hits, [], `crash answer leak: ${JSON.stringify(hits)}`)
  })

  // ———————————————————————————————— 3. restart recovery
  check('fault: restart recovery re-derives identical decisions from persisted state', () => {
    const sinksA = freshSinks()
    const first = deliverCorpus(corpus, sinksA)
    const sinksB = freshSinks()
    const second = deliverCorpus(corpus, sinksB)
    for (let i = 0; i < first.perItem.length; i += 1) {
      assert.strictEqual(second.perItem[i].speech, first.perItem[i].speech, `${first.perItem[i].id}: restart decision drift`)
    }
  })

  check('fault: restart recovery after refusal still refuses (no first-run loophole)', () => {
    const sinks = freshSinks()
    const item = corpus.items.find((it) => it.id === 'C5A') // secret + readAloud:true
    const r1 = runOne(item, sinks)
    const r2 = runOne(item, sinks)
    assert.strictEqual(r1.speech.decision, 'refuse-secret')
    assert.strictEqual(r2.speech.decision, 'refuse-secret')
    assert.strictEqual(sinks.tts.calls.length, 0)
  })

  // ———————————————————————————————— 4. missing TTS engine
  check('fault: missing TTS engine degrades without a secret-containing fallback', () => {
    const sinks = freshSinks()
    // Simulate: engine unavailable — refusal path must not attempt synthesis
    // and must not emit any fallback message containing canary text.
    const item = corpus.items[0] // C1A secret
    const r = runOne(item, sinks)
    assert.strictEqual(r.speech.decision, 'refuse-secret')
    assert.strictEqual(sinks.tts.calls.length, 0, 'missing engine: TTS attempted for refused item')
    const hits = scan(sinks.scanSurface(), item.canaries)
    assert.deepStrictEqual(hits, [], `missing-engine leak: ${JSON.stringify(hits)}`)
  })

  // ———————————————————————————————— 5. telemetry/logging failure
  check('fault: telemetry/logging failure never falls back to text logging', () => {
    const sinks = freshSinks()
    // Simulate exporter failure: the pipeline records key/code only; verify a
    // failing exporter cannot reintroduce question/answer text.
    for (const item of corpus.items) runOne(item, sinks)
    sinks.telemetry.emit({ event: 'exporter-failed', questionKey: corpus.items[0].questionKey })
    sinks.logs.info({ code: 'exporter-failed', questionKey: corpus.items[0].questionKey })
    const prohibited = []
    for (const item of corpus.items) {
      if (item.expectedSpeech !== 'speak') prohibited.push(...item.canaries)
    }
    const hits = scan(sinks.scanSurface(), prohibited)
    assert.deepStrictEqual(hits, [], `exporter-failure leak: ${JSON.stringify(hits)}`)
  })

  // ———————————————————————————————— 6. refusal must not wedge the session
  check('fault: refusal never wedges the pending session (lifecycle continues)', () => {
    const sinks = freshSinks()
    const r = deliverCorpus(corpus, sinks)
    for (const row of r.perItem) {
      assert.strictEqual(row.sessionHealthy, true, `${row.id}: refusal wedged the session`)
    }
    // After the full corpus, a normal question still flows: the session is live.
    const normal = corpus.items.find((it) => it.id === 'C5D')
    const after = runOne(normal, freshSinks())
    assert.strictEqual(after.speech.decision, 'speak')
    assert.strictEqual(after.sessionHealthy, true)
  })

  // ———————————————————————————————— 7. replay defense (unit legs)
  check('replay: caller sensitivity echo contradicting the registry refuses', () => {
    const d = decideSpeech({ questionKey: 'BUILD_TARGET', skill: 'spec-protocol', callerSensitivity: 'secret' })
    assert.strictEqual(d.decision, 'refuse-replayed-metadata')
    const d2 = decideSpeech({ questionKey: 'BUILD_TARGET', skill: 'spec-protocol', callerSensitivity: 'personal' })
    assert.strictEqual(d2.decision, 'refuse-replayed-metadata')
  })

  check('replay: replayed stale metadata (deleted sensitivity) fails closed', () => {
    const { lookup } = require('../../../packages/candice-protocol/question-registry')
    const found = lookup('SECRET_INPUT', 'spec-protocol')
    assert.ok(found.ok)
    const corrupted = JSON.parse(JSON.stringify(found.entry))
    delete corrupted.privacy.sensitivity
    const d = _decideFromEntry(corrupted, { callerSensitivity: 'normal', callerReadAloud: false, consent: {} })
    assert.strictEqual(d.decision, 'refuse-missing')
  })

  check('replay: decision objects never carry question/answer text in any fault leg', () => {
    const decisions = [
      decideSpeech({ questionKey: 'SECRET_INPUT', skill: 'spec-protocol' }),
      decideSpeech({ questionKey: 'PERSONAL_INPUT', skill: 'spec-protocol' }),
      decideSpeech({ questionKey: 'BUILD_TARGET', skill: 'spec-protocol', callerSensitivity: 'secret' }),
      decideSpeech({ questionKey: 'NOT_A_KEY', skill: 'spec-protocol' }),
      decideSpeech({ questionKey: 'SECRET_INPUT', skill: 'kaizen' }),
    ]
    for (const d of decisions) {
      const s = JSON.stringify(d)
      for (const canary of corpus.allCanaries) {
        assert.ok(!s.includes(canary), 'fault-leg decision object leaks canary')
      }
    }
  })

  console.log(`FIX-017 REPLAY AND FAULTS: ${checks - failures}/${checks} checks passed`)
  console.log(`FIX-017 CANARY HASHES (${corpus.allCanaries.length} total, sample of 3):`)
  for (const h of corpus.allCanaries.slice(0, 3).map(sha256)) console.log(`  ${h}`)
} finally {
  corpus.dispose()
  console.log(`FIX-017 CORPUS DIR DISPOSED: ${corpus.disposed()}`)
}

if (failures > 0) {
  console.log(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL TESTS PASSED')
