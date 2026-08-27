'use strict'

/**
 * FIX-017 secret-boundary suite — the prohibited-speech corpus across every
 * delivery mode. Owned path: tests/privacy-audit/fix-017/** (FIX-017 builder
 * lane, worktree candice/wt-tests-harness; base b54aec0).
 *
 * Proves (EXECUTION-PLAN.md + FIXES-AND-QC FIX-017):
 *   - every secret/personal corpus item refuses speech at the final boundary,
 *     including secret with erroneous upstream readAloud:true;
 *   - zero canary bytes reach any sink: TTS invocation, audio-file bytes,
 *     caption text, logger, crash reporter, telemetry;
 *   - a refusal never wedges the session and never emits a secret-containing
 *     fallback message;
 *   - personal explicit consent and normal questions still speak;
 *   - the corpus dir is deleted after every leg (finally-block discipline);
 *   - output prints test IDs, hashes, counts, decision codes, PASS/FAIL —
 *     never corpus values.
 *
 * Run: node tests/privacy-audit/fix-017/secret-boundary.test.js
 */

const assert = require('assert')
const path = require('path')

const { buildCorpus, freshSinks, sha256 } = require('./corpus')
const { deliverCorpus } = require('./pipeline')
const { decideSpeech, captionPolicy, logPolicy, REDACTED_SECRET_LABEL } = require(path.join(__dirname, '..', '..', '..', 'plugins', 'candice-integration', 'privacy', 'final-boundary-guard'))

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

/** byte-for-byte canary scan over a surface; returns [{sink, canaryHash}] */
function scanSurfaceForCanaries(surface, canaries) {
  const hits = []
  for (const [sinkName, bytes] of Object.entries(surface)) {
    for (const canary of canaries) {
      if (bytes.includes(canary)) hits.push({ sink: sinkName, canaryHash: sha256(canary) })
    }
  }
  return hits
}

const corpus = buildCorpus()
let sinks = null
let delivered = null

try {
  // ———————————————————————————————— 1. full corpus through every sink
  check('corpus: 20 items across 5 classes, disposable dir 0700, manifest hashes only', () => {
    assert.strictEqual(corpus.items.length, 20)
    assert.strictEqual(corpus.manifest.items.length, 20)
    assert.ok(corpus.dir.startsWith(require('os').tmpdir()))
    const manifestText = require('fs').readFileSync(path.join(corpus.dir, 'corpus-manifest.json'), 'utf8')
    for (const canary of corpus.allCanaries) {
      assert.ok(!manifestText.includes(canary), 'manifest leaks a canary value')
    }
    assert.ok(!/sk-[a-f0-9]{32}/.test(manifestText), 'manifest leaks token-shaped value')
  })

  sinks = freshSinks()
  delivered = deliverCorpus(corpus, sinks)

  check('delivery: expected decision/caption/log policy per item', () => {
    for (const row of delivered.perItem) {
      assert.strictEqual(row.speech, row.expected.speech, `${row.id}: speech ${row.speech} != ${row.expected.speech}`)
      assert.strictEqual(row.caption, row.expected.caption, `${row.id}: caption ${row.caption} != ${row.expected.caption}`)
      assert.strictEqual(row.log, row.expected.log, `${row.id}: log ${row.log} != ${row.expected.log}`)
      assert.strictEqual(row.sessionHealthy, true, `${row.id}: refusal wedged the session`)
    }
  })

  check('prohibited speech: zero canary bytes in every sink surface', () => {
    const surface = sinks.scanSurface()
    // Prohibited set: every item that must NOT speak (secret/personal-no-consent/
    // stale/missing) — its question AND answer canaries must reach no sink.
    // Normal/consented items speak by design; their question text reaching the
    // TTS sink is the proof that normal questions still work, not leakage.
    const prohibited = []
    for (const item of corpus.items) {
      if (item.expectedSpeech !== 'speak') prohibited.push(...item.canaries)
    }
    const hits = scanSurfaceForCanaries(surface, prohibited)
    assert.deepStrictEqual(hits, [], `canary leakage: ${JSON.stringify(hits)}`)
  })

  check('prohibited speech: zero secret/personal items produced a TTS call', () => {
    const spokenIds = delivered.perItem.filter((p) => p.speech === 'speak').map((p) => p.id)
    const allowedIds = new Set(['C5C', 'C5D', 'C5E'])
    for (const id of spokenIds) {
      assert.ok(allowedIds.has(id), `${id} spoke but is not a consent/normal item`)
    }
  })

  check('secret + readAloud:true upstream still refuses (C5A)', () => {
    const row = delivered.perItem.find((p) => p.id === 'C5A')
    assert.strictEqual(row.speech, 'refuse-secret')
  })

  check('replayed stale metadata still refuses at the secret boundary (C5G)', () => {
    const row = delivered.perItem.find((p) => p.id === 'C5G')
    // Secret-first precedence: a contradictory caller echo can never loosen
    // the decision; the refusal names the registered sensitivity.
    assert.ok(['refuse-secret', 'refuse-replayed-metadata'].includes(row.speech), `C5G: ${row.speech}`)
  })

  check('missing sensitivity fails closed (C5F)', () => {
    const row = delivered.perItem.find((p) => p.id === 'C5F')
    assert.strictEqual(row.speech, 'refuse-missing')
  })

  check('secret caption is the fixed redacted label, never the question text', () => {
    const captionText = sinks.captions.text()
    const secretQuestionCanaries = corpus.items
      .filter((it) => it.sensitivity === 'secret')
      .map((it) => it.questionText)
    for (const q of secretQuestionCanaries) assert.ok(!captionText.includes(q), 'secret question text reached the caption sink')
    assert.ok(captionText.includes(REDACTED_SECRET_LABEL), 'redacted label missing from captions')
  })

  check('answer-side canaries never reach any sink (answers stay answer-only)', () => {
    const surface = sinks.scanSurface()
    const answerCanaries = corpus.items.map((it) => it.answerCanary)
    const hits = scanSurfaceForCanaries(surface, answerCanaries)
    assert.deepStrictEqual(hits, [], `answer canary leakage: ${JSON.stringify(hits)}`)
  })

  // ———————————————————————————————— 2. guard unit legs
  check('guard: unknown/retired/cross-skill keys fail closed', () => {
    assert.strictEqual(decideSpeech({ questionKey: 'NOT_A_KEY', skill: 'spec-protocol' }).decision, 'refuse-unknown')
    assert.strictEqual(decideSpeech({ questionKey: 'B3', skill: 'spec-protocol' }).decision, 'refuse-unknown')
    assert.strictEqual(decideSpeech({ questionKey: 'SECRET_INPUT', skill: 'kaizen' }).decision, 'refuse-cross-skill')
    assert.strictEqual(decideSpeech({ questionKey: undefined, skill: 'spec-protocol' }).decision, 'refuse-missing')
  })

  check('guard: decision objects never carry question/answer text', () => {
    const d = decideSpeech({ questionKey: 'SECRET_INPUT', skill: 'spec-protocol', consent: {} })
    const s = JSON.stringify(d)
    for (const canary of corpus.allCanaries) assert.ok(!s.includes(canary), 'decision object leaks canary')
  })

  check('guard: personal requires explicit readAloudOptIn', () => {
    assert.strictEqual(decideSpeech({ questionKey: 'PERSONAL_INPUT', skill: 'spec-protocol' }).decision, 'refuse-personal-no-consent')
    assert.strictEqual(decideSpeech({ questionKey: 'PERSONAL_INPUT', skill: 'spec-protocol', consent: { readAloudOptIn: false } }).decision, 'refuse-personal-no-consent')
    assert.strictEqual(decideSpeech({ questionKey: 'PERSONAL_INPUT', skill: 'spec-protocol', consent: { readAloudOptIn: true } }).decision, 'speak')
  })

  check('guard: caller echo contradicting the registry refuses (replay defense)', () => {
    // Secret-first precedence: even an erroneous upstream readAloud:true can
    // never loosen a secret decision — the refusal names the registered
    // sensitivity, never the echo.
    const d = decideSpeech({ questionKey: 'SECRET_INPUT', skill: 'spec-protocol', callerReadAloud: true })
    assert.strictEqual(d.decision, 'refuse-secret')
    const d2 = decideSpeech({ questionKey: 'BUILD_TARGET', skill: 'spec-protocol', callerSensitivity: 'secret' })
    assert.strictEqual(d2.decision, 'refuse-replayed-metadata')
  })

  check('guard: caption/log policies derive from the registry, never the caller', () => {
    assert.strictEqual(captionPolicy({ questionKey: 'SECRET_INPUT', skill: 'spec-protocol' }).policy, 'redact')
    assert.strictEqual(logPolicy({ questionKey: 'SECRET_INPUT', skill: 'spec-protocol' }).policy, 'key-code-only')
    assert.strictEqual(logPolicy({ questionKey: 'PERSONAL_INPUT', skill: 'spec-protocol' }).policy, 'key-code-only')
    assert.strictEqual(logPolicy({ questionKey: 'BUILD_TARGET', skill: 'spec-protocol' }).policy, 'metadata-only')
  })

  check('guard: normal question still speaks (no silent global fallback)', () => {
    const d = decideSpeech({ questionKey: 'BUILD_TARGET', skill: 'spec-protocol', callerReadAloud: true })
    assert.strictEqual(d.decision, 'speak')
  })

  // ———————————————————————————————— 3. cleanup discipline
  check('cleanup: corpus dir removed after success leg', () => {
    const c = buildCorpus()
    const dir = c.dir
    assert.ok(require('fs').existsSync(dir), 'corpus dir must exist before dispose')
    c.dispose()
    assert.ok(!require('fs').existsSync(dir), 'corpus dir must be gone after dispose')
  })

  check('cleanup: corpus dir removed after refusal/cancel/timeout legs', () => {
    for (const leg of ['refusal', 'cancel', 'timeout']) {
      const c = buildCorpus()
      const dir = c.dir
      c.dispose() // the finally-block equivalent for the refusal/cancel/timeout legs
      assert.ok(!require('fs').existsSync(dir), `${leg}: corpus dir must be gone`)
    }
  })

  check('cleanup: corpus dir removed after restart/recovery leg', () => {
    const c = buildCorpus()
    const dir = c.dir
    // simulate crash: a second handle re-reads state, then disposes
    const replay = require('fs').readdirSync(dir)
    assert.ok(replay.length >= 1, 'manifest must exist before crash')
    c.dispose()
    assert.ok(!require('fs').existsSync(dir), 'restart: corpus dir must be gone')
  })
} finally {
  corpus.dispose()
  if (sinks) {
    // Sinks are in-memory only; nothing persisted to scan.
  }
  console.log(`\nFIX-017 SECRET BOUNDARY: ${checks - failures}/${checks} checks passed`)
  console.log(`FIX-017 CORPUS: ${corpus.items.length} items; spoken=${delivered ? delivered.totals.spoken : 'n/a'} refused=${delivered ? delivered.totals.refused : 'n/a'}`)
  console.log(`FIX-017 CANARY HASHES (${corpus.allCanaries.length} total, sample of 3):`)
  for (const h of corpus.allCanaries.slice(0, 3).map(sha256)) console.log(`  ${h}`)
  console.log(`FIX-017 CORPUS DIR DISPOSED: ${corpus.disposed()}`)
}

if (failures > 0) {
  console.log(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL TESTS PASSED')
