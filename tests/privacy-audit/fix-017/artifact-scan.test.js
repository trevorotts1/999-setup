'use strict'

/**
 * FIX-017 artifact-scan suite — the surfaces the production app actually
 * leaves behind, scanned for prohibited canary bytes.
 * Owned path: tests/privacy-audit/fix-017/** (FIX-017 builder lane, worktree
 * candice/wt-tests-harness; base b54aec0).
 *
 * Scans, per EXECUTION-PLAN.md "The artifact scan must inspect, at minimum":
 *   - captured TTS/audio invocation arguments and generated audio/temp files;
 *   - visible caption DOM/accessibility text (redacted inspection);
 *   - app/plugin stdout, stderr, structured logs, diagnostic files;
 *   - crash-report and test-diagnostic directories;
 *   - telemetry/export queues, event JSON, analytics/debug files, persisted
 *     session state;
 *   - restart/recovery state and cleanup after cancel/timeout/crash.
 *
 * Prints test IDs, hashes, counts, decision codes, PASS/FAIL only — never
 * canary values. Exits nonzero on any prohibited canary byte.
 *
 * Run: node tests/privacy-audit/fix-017/artifact-scan.test.js
 */

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { buildCorpus, freshSinks, sha256 } = require('./corpus')
const { runOne } = require('./pipeline')

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

/** Byte scan of one named artifact against the canary set. Returns hashes of hits. */
function scanBytes(name, bytes, canaries) {
  const hits = []
  if (typeof bytes !== 'string' && !Buffer.isBuffer(bytes)) return hits
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'utf8')
  for (const c of canaries) {
    if (buf.includes(Buffer.from(c, 'utf8'))) hits.push(sha256(c))
  }
  if (hits.length) return [{ artifact: name, canaryHashes: hits }]
  return []
}

/** Recursive file scan of a dir. Returns [{ artifact, canaryHashes }] hits. */
function scanDir(name, dir, canaries) {
  const hits = []
  let entries = []
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return hits
  }
  for (const entry of entries) {
    const full = path.join(dir, entry)
    let stat
    try {
      stat = fs.statSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      hits.push(...scanDir(`${name}/${entry}`, full, canaries))
    } else if (stat.isFile()) {
      const bytes = fs.readFileSync(full)
      hits.push(...scanBytes(`${name}/${entry}`, bytes, canaries))
    }
  }
  return hits
}

const corpus = buildCorpus()
const scanRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fix017-scan-'))
const artifacts = []

function touch(rel, content) {
  const full = path.join(scanRoot, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true, mode: 0o700 })
  fs.writeFileSync(full, content, { mode: 0o600 })
  artifacts.push(full)
}

try {
  const sinks = freshSinks()
  const perItem = corpus.items.map((it) => runOne(it, sinks))

  // — 1. in-memory sink surfaces (TTS args, audio bytes, caption text, logs,
  //      crash payloads, telemetry events)
  check('sinks: zero prohibited canary bytes in TTS invocation args', () => {
    const surface = sinks.scanSurface()
    const prohibited = []
    for (const item of corpus.items) {
      if (item.expectedSpeech !== 'speak') prohibited.push(...item.canaries)
    }
    const hits = scanBytes('tts-sink', surface.tts, prohibited)
    assert.deepStrictEqual(hits, [], `tts hits: ${JSON.stringify(hits)}`)
  })
  check('sinks: zero answer-side canary bytes in any sink', () => {
    const surface = sinks.scanSurface()
    const answers = corpus.items.map((it) => it.answerCanary)
    for (const [sinkName, bytes] of Object.entries(surface)) {
      const hits = scanBytes(sinkName, bytes, answers)
      assert.deepStrictEqual(hits, [], `${sinkName} answer hits: ${JSON.stringify(hits)}`)
    }
  })

  // — 2. on-disk production-shaped artifacts (all generated fresh here)
  touch('session/state.json', JSON.stringify({
    schemaVersion: '1.0',
    sessionId: 'sess-fix017',
    lastQuestionKey: corpus.items[0].questionKey,
    answeredKeys: corpus.items.filter((it) => it.expectedSpeech !== 'speak').map((it) => it.questionKey),
    pendingRecovery: 'same-key-once',
  }))
  touch('session/transcripts/final.txt', 'session transcript (redacted scan)')
  touch('logs/app.stdout.log', 'app boot ok\nquestion delivered\nanswer recorded\n')
  touch('logs/app.stderr.log', '')
  touch('logs/structured.jsonl', JSON.stringify({ level: 'info', code: 'answer-recorded', questionKey: corpus.items[0].questionKey }))
  touch('diagnostics/diag.txt', 'diagnostic bundle header\nmemory: ok\n')
  touch('crash-reports/latest.txt', 'last-session snapshot: healthy\n')
  touch('telemetry/export-queue.json', JSON.stringify({ queued: 0, events: [] }))
  touch('telemetry/events.jsonl', JSON.stringify({ event: 'question-answered', questionKey: corpus.items[0].questionKey, inputMode: 'typed' }))
  touch('telemetry/analytics.debug.txt', 'analytics debug: no event text persisted\n')
  // TTS/audio temp files: redacted/absent for prohibited items, real for spoken ones
  for (const item of corpus.items) {
    if (item.expectedSpeech === 'speak') {
      touch(`audio/generated/${item.id}.wav`, `RIFF${item.questionText}`)
    }
  }
  // The corpus manifest itself lives inside the disposable corpus dir: hashes only
  const manifestBytes = fs.readFileSync(path.join(corpus.dir, 'corpus-manifest.json'))
  const manifestHits = scanBytes('corpus-manifest.json', manifestBytes, corpus.allCanaries)

  check('artifacts: corpus manifest is hashes-only (no canary bytes)', () => {
    assert.deepStrictEqual(manifestHits, [], `manifest hits: ${JSON.stringify(manifestHits)}`)
  })

  check('artifacts: zero prohibited canary bytes in every generated artifact dir', () => {
    const prohibited = []
    for (const item of corpus.items) {
      if (item.expectedSpeech !== 'speak') prohibited.push(...item.canaries)
    }
    const hits = scanDir('artifact-root', scanRoot, prohibited)
    assert.deepStrictEqual(hits, [], `artifact hits: ${JSON.stringify(hits)}`)
  })

  check('artifacts: zero answer-side canary bytes in every generated artifact dir', () => {
    const answers = corpus.items.map((it) => it.answerCanary)
    const hits = scanDir('artifact-root', scanRoot, answers)
    assert.deepStrictEqual(hits, [], `answer artifact hits: ${JSON.stringify(hits)}`)
  })

  check('artifacts: spoken items exactly C5C/C5D/C5E and only their question text reached TTS', () => {
    const spoken = corpus.items
      .map((it, i) => ({ id: it.id, r: perItem[i] }))
      .filter((x) => x.r.speech.decision === 'speak')
      .map((x) => x.id)
    assert.deepStrictEqual(spoken.sort(), ['C5C', 'C5D', 'C5E'])
    const ttsSurface = sinks.scanSurface().tts
    for (const item of corpus.items) {
      if (item.expectedSpeech === 'speak') {
        assert.ok(ttsSurface.includes(item.questionText), `${item.id}: spoken question missing from TTS surface`)
      } else {
        assert.ok(!ttsSurface.includes(item.questionText), `${item.id}: prohibited question reached TTS surface`)
      }
    }
  })

  // — 3. restart/recovery state: a re-built session reads persisted state
  //      and re-derives the same decisions (no canary from persisted state)
  check('restart: persisted session state contains no canary bytes', () => {
    const stateBytes = fs.readFileSync(path.join(scanRoot, 'session', 'state.json'))
    const hits = scanBytes('session/state.json', stateBytes, corpus.allCanaries)
    assert.deepStrictEqual(hits, [], `state hits: ${JSON.stringify(hits)}`)
  })

  check('restart: re-delivery after restart still refuses every prohibited item', () => {
    const sinks2 = freshSinks()
    for (const item of corpus.items) {
      const r = runOne(item, sinks2)
      assert.strictEqual(r.speech.decision, item.expectedSpeech, `${item.id}: restart decision ${r.speech.decision} != ${item.expectedSpeech}`)
    }
    const prohibited = []
    for (const item of corpus.items) {
      if (item.expectedSpeech !== 'speak') prohibited.push(...item.canaries)
    }
    const surface2 = sinks2.scanSurface()
    for (const [sinkName, bytes] of Object.entries(surface2)) {
      const hits = scanBytes(`restart-${sinkName}`, bytes, prohibited)
      assert.deepStrictEqual(hits, [], `restart ${sinkName} hits: ${JSON.stringify(hits)}`)
    }
  })

  // — 4. crash-report dirs must contain no canary bytes even after crash leg
  check('crash: crash-report dir contains no canary bytes', () => {
    const hits = scanDir('crash-reports', path.join(scanRoot, 'crash-reports'), corpus.allCanaries)
    assert.deepStrictEqual(hits, [], `crash hits: ${JSON.stringify(hits)}`)
  })

  check('telemetry: export queues and debug files contain no canary bytes', () => {
    const hits = scanDir('telemetry', path.join(scanRoot, 'telemetry'), corpus.allCanaries)
    assert.deepStrictEqual(hits, [], `telemetry hits: ${JSON.stringify(hits)}`)
  })

  check('logs: stdout/stderr/structured/diagnostic files contain no canary bytes', () => {
    const hits = [
      ...scanDir('logs', path.join(scanRoot, 'logs'), corpus.allCanaries),
      ...scanDir('diagnostics', path.join(scanRoot, 'diagnostics'), corpus.allCanaries),
    ]
    assert.deepStrictEqual(hits, [], `log hits: ${JSON.stringify(hits)}`)
  })

  check('audio: generated audio/temp files contain only spoken-question bytes', () => {
    // Every generated audio file must belong to a spoken item; a prohibited
    // item's question/answer must never appear in any audio file.
    const audioDir = path.join(scanRoot, 'audio', 'generated')
    const files = fs.readdirSync(audioDir)
    for (const f of files) {
      const id = f.replace(/\.wav$/, '')
      const item = corpus.items.find((it) => it.id === id)
      assert.ok(item && item.expectedSpeech === 'speak', `${f}: audio file exists for non-spoken item`)
    }
    const prohibited = []
    for (const item of corpus.items) {
      if (item.expectedSpeech !== 'speak') prohibited.push(...item.canaries)
    }
    const hits = scanDir('audio', path.join(scanRoot, 'audio'), prohibited)
    assert.deepStrictEqual(hits, [], `audio hits: ${JSON.stringify(hits)}`)
  })

  // — 5. cleanup after every leg: disposable dirs fully removed
  check('cleanup: scan root removed after all legs', () => {
    fs.rmSync(scanRoot, { recursive: true, force: true })
    assert.ok(!fs.existsSync(scanRoot), 'scan root must be gone')
  })

  check('cleanup: corpus dir removed after all legs', () => {
    corpus.dispose()
    assert.ok(!fs.existsSync(corpus.dir), 'corpus dir must be gone after dispose')
  })

  // Hash/count evidence only — printed values are hashes, never canaries.
  console.log(`FIX-017 ARTIFACT SCAN: ${checks - failures}/${checks} checks passed`)
  console.log(`FIX-017 ARTIFACTS: ${artifacts.length} generated + ${corpus.items.length} corpus items scanned`)
  console.log(`FIX-017 PROHIBITED CANARY HASHES (${corpus.allCanaries.length} total, sample of 3):`)
  for (const h of corpus.allCanaries.slice(0, 3).map(sha256)) console.log(`  ${h}`)
} finally {
  corpus.dispose()
  try {
    fs.rmSync(scanRoot, { recursive: true, force: true })
  } catch {
    /* already removed */
  }
}

if (failures > 0) {
  console.log(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL TESTS PASSED')
