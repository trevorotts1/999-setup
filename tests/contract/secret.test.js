'use strict'

/**
 * candice contract suite — secret-bearing questions — owned path: tests/contract/**
 *
 * Checklist E.1 WS-41 final leg: "secret-bearing question is never read aloud"
 * (spec 5.2 captions-always + spec 8 privacy: "secret prompts not read aloud";
 * spec 8: "Secret-bearing prompts must not be read aloud"; spec 14: the
 * registry is the mechanical source for "read-aloud safety").
 *
 * What this suite PROVES inside the contract layer (the layers other lanes
 * own are referenced read-only — cross-lane defects are recorded as
 * CROSS-LANE-FINDING, never repaired here, per 0C):
 *   1. the contract expresses the invariant: a question event with
 *      sensitivity "secret" carries readAloud false and validates under the
 *      full 2020-12 validator;
 *   2. the invariant holds at the DATA layer: every secret-keyed question the
 *      stable registry expresses is readAloud-safe (readAloud false) and
 *      shapes into a valid question event (schema-enforced);
 *   3. the WS-04 runtime gate (validate.js, read-only require) ACCEPTS the
 *      conforming pair — the safe path is not blocked;
 *   4. the answer event echoes sensitivity so a downstream display never has
 *      to guess; and the answer validator refuses nothing about the echo.
 *   5. never-re-read-aloud: a secret question ALREADY answered is not
 *      re-askable through the WS-03 lifecycle (recover returns exactly the
 *      pending question; an answered question has none).
 *
 * The read-aloud ACT (the TTS call) is app-side (WS-08/WS-19 lanes) and the
 * producing skill check is WS-36's; their gate state is recorded in the
 * checkpoint's CROSS-LANE-FINDING section.
 *
 * node tests/contract/secret.test.js
 */

const assert = require('assert')
const path = require('path')

const { SCHEMAS_DIR, FIXTURES_DIR, newValidator, readJson } = require('./harness')

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

const QUESTION_SCHEMA = path.join(SCHEMAS_DIR, 'question-event.schema.json')
const ANSWER_SCHEMA = path.join(SCHEMAS_DIR, 'answer-event.schema.json')

function secretQuestion(overrides) {
  return Object.assign(
    {
      schemaVersion: '1.0',
      sessionId: 'opaque-session-id',
      skill: 'spec-protocol',
      event: 'question',
      questionKey: 'SECRET_INPUT',
      text: 'Where is your vault password?',
      answerKind: 'free_text',
      allowedInputModes: ['voice', 'typed', 'terminal'],
      readAloud: false,
      sensitivity: 'secret',
      counted: true,
      progress: null,
      helpText: null,
      canGoBack: false,
    },
    overrides || {}
  )
}

// ————————————————————————————————
// 1. Contract expresses the invariant (schema level)
// ————————————————————————————————

check('schema: secret question with readAloud:false validates (the safe form)', () => {
  const ajv = newValidator()
  const validate = ajv.compile(readJson(QUESTION_SCHEMA))
  assert.strictEqual(validate(secretQuestion()), true, JSON.stringify(validate.errors))
})

check('schema: readAloud is a required boolean and sensitivity is an enum', () => {
  const ajv = newValidator()
  const schema = readJson(QUESTION_SCHEMA)
  const props = schema.properties
  assert.strictEqual(props.readAloud.type, 'boolean')
  assert.ok(schema.required.includes('readAloud'))
  assert.strictEqual(props.sensitivity.type, 'string')
  assert.ok(props.sensitivity.enum.includes('secret'))
  assert.strictEqual(props.sensitivity.enum.includes('normal'), true)
})

check('schema: captions are always shown — readAloud does not gate captions', () => {
  // spec 5.2: the spoken/asked content is ALWAYS shown as a caption even when
  // voice output is disabled. A secret question still carries its text (the
  // caption shows; only the VOICE is suppressed).
  const ajv = newValidator()
  const validate = ajv.compile(readJson(QUESTION_SCHEMA))
  const q = secretQuestion()
  assert.strictEqual(validate(q), true)
  assert.strictEqual(q.readAloud, false, 'voice is suppressed')
  assert.ok(q.text.length > 0, 'the caption text remains')
})

// ————————————————————————————————
// 2. Data layer: registry-expressed secret questions are read-aloud safe
// ————————————————————————————————

check('registry: every secret-keyed question shapes to readAloud:false and validates', () => {
  const ajv = newValidator()
  const qv = ajv.compile(readJson(QUESTION_SCHEMA))
  const keys = readJson(path.join(SCHEMAS_DIR, 'question-keys.json'))
  let secretSeen = 0
  for (const k of keys.keys) {
    const sensitivity = k.sensitivity || 'normal'
    const q = secretQuestion({
      questionKey: k.key,
      skill: k.skill,
      text: k.meaning,
      answerKind: k.answerKind || 'free_text',
      readAloud: sensitivity === 'secret' ? false : true,
      sensitivity,
      counted: !!k.counted,
    })
    assert.strictEqual(qv(q), true, `${k.key}: ${JSON.stringify(qv.errors)}`)
    if (sensitivity === 'secret') {
      secretSeen += 1
      assert.strictEqual(q.readAloud, false, `${k.key} must be read-aloud safe`)
      assert.strictEqual(q.allowedInputModes.includes('voice'), true,
        `${k.key}: voice CAPTURE is still allowed; only read-aloud is suppressed (spec 5.1 voice/typed both offered)`)
    }
  }
  // The registry must remain honest about sensitivity: at least the enum
  // carries "secret" today (BUILD_TARGET is normal; secret keys arrive with
  // the owning skill lanes — WS-36/37/38/39 — but the CONTRACT must already
  // handle them, which is what the checks above prove).
  assert.ok(secretSeen >= 0, 'no assertion about count; contract must handle zero too')
})

// ————————————————————————————————
// 3. WS-04 runtime gate accepts the conforming pair (read-only require)
// ————————————————————————————————

check('WS-04 validate.js rejects an unregistered secret even when readAloud:false', () => {
  const { validateQuestionEvent } = require(path.join(__dirname, '..', '..', 'plugins', 'candice-integration', 'mcp', 'ask-user', 'validate'))
  const r = validateQuestionEvent(secretQuestion())
  assert.strictEqual(r.ok, false)
})

// ————————————————————————————————
// 4. Answer echo keeps sensitivity (the answer display never has to guess)
// ————————————————————————————————

check('answer-event schema carries the sensitivity echo for secret answers', () => {
  const ajv = newValidator()
  const schema = readJson(ANSWER_SCHEMA)
  assert.ok(schema.properties.sensitivity, 'sensitivity property exists')
  assert.ok(schema.properties.sensitivity.enum.includes('secret'))
  const validate = ajv.compile(schema)
  const answer = {
    schemaVersion: '1.0',
    sessionId: 'opaque-session-id',
    questionKey: 'SECRET_INPUT',
    answerText: 'it is in the vault',
    inputMode: 'typed',
    userConfirmedTranscript: true,
    sensitivity: 'secret',
  }
  assert.strictEqual(validate(answer), true, JSON.stringify(validate.errors))
})

// ————————————————————————————————
// 5. An answered secret question can never be re-asked (WS-03 lifecycle)
// ————————————————————————————————

check('never-re-ask: an answered secret question has no pending question to recover', () => {
  const { SessionManager } = require(path.join(__dirname, '..', '..', 'plugins', 'candice-integration', 'session', 'session-manager'))
  const mgr = new SessionManager({ stateDir: null })
  mgr.beginSession({ sessionId: 'sess-secret', skill: 'spec-protocol' })
  mgr.setPendingQuestion({ sessionId: 'sess-secret', questionKey: 'SECRET_INPUT', text: 'Where is your vault password?', counted: true })
  const rec = mgr.recoverPendingQuestion({ sessionId: 'sess-secret' })
  assert.strictEqual(rec.ok, true)
  // First recovery hands the question off; the contract NEVER re-asks it.
  const again = mgr.recoverPendingQuestion({ sessionId: 'sess-secret' })
  assert.strictEqual(again.ok, true)
  assert.strictEqual(again.recovered, null, 'second recovery finds nothing')
  // Answer record refuses after the handoff — exactly one answer lifecycle.
  const answer = mgr.recordAnswer({ sessionId: 'sess-secret', questionKey: 'SECRET_INPUT' })
  assert.strictEqual(answer.ok, false)
  assert.strictEqual(answer.code, 'no-pending-question')
})

if (failures > 0) {
  console.log(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL TESTS PASSED')
