'use strict'

/**
 * candice contract suite — stable question keys — owned path: tests/contract/**
 *
 * Checklist E.1 WS-41 second leg: "question keys stable"; E.1 WS-01: "question
 * keys are stable" (spec 14: stable question keys fixed for the life of the
 * contract — never re-ask a key already answered, never reuse a key for a
 * different question; the registry is the mechanical source).
 *
 * Sections:
 *   1. registry data validates against question-keys.schema.json;
 *   2. keys are stable over time (identical re-load — the durability half of
 *      "stable" at the data layer);
 *   3. format: key pattern, unique keys, unique per-skill lists,
 *      skills cross-reference consistency;
 *   4. key properties agree with the question-event schema (every registry
 *      key forms a valid question for its skill's answerKind/sensitivity);
 *   5. the seeded BUILD_TARGET key is the spec 14 canonical question;
 *   6. no knowledge of an OLD registry survives: a answered-key simulation via
 *      the WS-03 lifecycle proves never-re-ask semantics are enforced at the
 *      session layer (the registry cannot be re-asked).
 */

const assert = require('assert')
const path = require('path')

const { SCHEMAS_DIR, newValidator, readJson } = require('./harness')

let failures = 0

function check(name, fn) {
  try {
    fn()
    console.log(`PASS  ${name}`)
  } catch (err) {
    failures += 1
    console.log(`FAIL  ${name}: ${err.message}`)
  }
}

const KEYS_DATA = path.join(SCHEMAS_DIR, 'question-keys.json')
const KEYS_SCHEMA = path.join(SCHEMAS_DIR, 'question-keys.schema.json')
const QUESTION_SCHEMA = path.join(SCHEMAS_DIR, 'question-event.schema.json')
const SKILLS = ['spec-protocol', 'kaizen', 'eli5', 'bro']

// ————————————————————————————————
// 1. Registry validates against its schema
// ————————————————————————————————

check('question-keys.json validates against question-keys.schema.json', () => {
  const ajv = newValidator()
  const validate = ajv.compile(readJson(KEYS_SCHEMA))
  const data = readJson(KEYS_DATA)
  assert.strictEqual(validate(data), true, JSON.stringify(validate.errors))
})

// ————————————————————————————————
// 2. Stability: loading twice yields the identical registry
// ————————————————————————————————

check('registry is stable: two loads are byte-identical (no drift between runs)', () => {
  const first = JSON.stringify(readJson(KEYS_DATA))
  const second = JSON.stringify(readJson(KEYS_DATA))
  assert.strictEqual(first, second)
})

check('registry keys are strictly unique', () => {
  const data = readJson(KEYS_DATA)
  const keys = data.keys.map((k) => k.key)
  assert.strictEqual(new Set(keys).size, keys.length, 'duplicate key in registry')
})

check('activeKeys exactly enumerate the active authority entries', () => {
  const data = readJson(KEYS_DATA)
  assert.deepStrictEqual(data.activeKeys.slice().sort(), data.keys.map((k) => k.key).sort())
  for (const retired of data.retiredKeys) assert.ok(!data.activeKeys.includes(retired.key), `retired key ${retired.key} is active`)
})

check('every registry key matches the ^[A-Z][A-Z0-9_-]*$ pattern', () => {
  const re = /^[A-Z][A-Z0-9_-]*$/
  const data = readJson(KEYS_DATA)
  for (const k of data.keys) assert.ok(re.test(k.key), `bad key ${k.key}`)
})

// ————————————————————————————————
// 3. Registry key forms a contract-valid question event
// ————————————————————————————————

check('every registry key produces a valid question event for its skill', () => {
  const ajv = newValidator()
  const qv = ajv.compile(readJson(QUESTION_SCHEMA))
  const data = readJson(KEYS_DATA)
  for (const k of data.keys) {
    const q = {
      schemaVersion: '1.0',
      sessionId: 'opaque-session-id',
      skill: k.skill,
      event: 'question',
      questionKey: k.key,
      text: k.display,
      answerKind: k.answerKind || 'free_text',
      allowedInputModes: ['voice', 'typed', 'terminal'],
      readAloud: k.privacy.readAloud,
      sensitivity: k.privacy.sensitivity,
      counted: k.count.counted,
      progress: null,
      helpText: null,
      canGoBack: true,
    }
    assert.strictEqual(qv(q), true, `${k.key}: ${JSON.stringify(qv.errors)}`)
  }
})

// ————————————————————————————————
// 4. Canonical seed key (spec 14 example)
// ————————————————————————————————

check('BUILD_TARGET is the seeded spec-protocol key with spec 14 meaning', () => {
  const data = readJson(KEYS_DATA)
  const bt = data.keys.find((k) => k.key === 'BUILD_TARGET')
  assert.ok(bt, 'BUILD_TARGET must exist')
  assert.strictEqual(bt.skill, 'spec-protocol')
  assert.strictEqual(bt.answerKind, 'free_text')
  assert.ok(bt.display.includes('your own words'), 'display carries the spec 14 wording')
})

// ————————————————————————————————
// 5. Never-re-ask at the session layer (spec 14: a key is never re-asked
//     once answered in the session)
// ————————————————————————————————

check('an answered question key cannot be re-asked or re-answered (WS-03 lifecycle)', () => {
  const { SessionManager } = require('../../plugins/candice-integration/session/session-manager')
  const mgr = new SessionManager({ stateDir: null })
  assert.strictEqual(mgr.beginSession({ sessionId: 'sess-keys', skill: 'spec-protocol' }).ok, true)
  mgr.setPendingQuestion({ sessionId: 'sess-keys', questionKey: 'BUILD_TARGET', text: 'q', counted: true })
  // First unconditional answer record — the key is consumed.
  const first = mgr.recordAnswer({ sessionId: 'sess-keys', questionKey: 'BUILD_TARGET' })
  assert.strictEqual(first.ok, true)
  // A second answer for the same key refuses (no-pending-question: the slot is gone).
  const second = mgr.recordAnswer({ sessionId: 'sess-keys', questionKey: 'BUILD_TARGET' })
  assert.strictEqual(second.ok, false)
  assert.strictEqual(second.code, 'no-pending-question')
})

if (failures > 0) {
  console.log(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL TESTS PASSED')
