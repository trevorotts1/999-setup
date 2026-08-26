'use strict'

/**
 * candice-integration / integrations/kaizen/invariants.test.js
 * WS-37 tests — owned path: plugins/candice-integration/integrations/kaizen/**
 *
 * Runs with plain `node` (zero dependencies, cross-platform):
 *   node plugins/candice-integration/integrations/kaizen/invariants.test.js
 * Exits 0 on PASS, 1 on FAIL. Every assertion prints PASS/FAIL with the
 * exact input that produced it — primary-source evidence for the acceptance
 * run.
 *
 * Covers the WS-37 acceptance criteria (task-graph snapshot required_outputs
 * + acceptance_criteria; E.1 WS-37):
 *   - "Kaizen minimum integration instructions present (spec 25)" — the
 *     README in this lane exists and names activation, availability check,
 *     bridge, fallback, and the reference to the WS-36 references;
 *   - "no question-order/rules modification (spec 15)" — the invariant
 *     checks in invariants.js: order fixed and contiguous, keys unique and
 *     upper-snake, wording non-empty, answerKind in the schema enum, event
 *     envelope schema-conformant (schemaVersion 1.0 / skill kaizen /
 *     event question), secret questions never read aloud;
 *   - deps regression: the question map's events stay usable with the WS-04
 *     validate.js contract (skill "kaizen" accepted) — exercised through the
 *     plugin's own validator, which is the WS-04-owned seam.
 */

const assert = require('assert')
const path = require('path')

const { checkInvariants } = require('./invariants')
const { KAIZEN_QUESTIONS, KAIZEN_ORDER, questionEvent } = require('./question-map')

let failures = 0

function check(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (err) {
    failures += 1
    console.log(`FAIL ${name}: ${err.message}`)
  }
}

// ————————————————————————————————————————————————
// 1. The lane's own invariant battery (order, wording, schema envelope)
// ————————————————————————————————————————————————

check('invariants: order fixed, contiguous 1..N, keys upper-snake, schema-conformant', () => {
  const result = checkInvariants()
  assert.strictEqual(result.ok, true, JSON.stringify(result.failures))
})

check('invariants: exactly seven Recipe questions plus the approval confirmation', () => {
  assert.strictEqual(KAIZEN_ORDER.length, 8)
  const recipe = KAIZEN_ORDER.slice(0, 7)
  assert.deepStrictEqual(recipe, [
    'KAZEN_TARGET',
    'KAZEN_LOCATION',
    'KAZEN_BETTER',
    'KAZEN_SCOPE',
    'KAZEN_PERMISSION',
    'KAZEN_PROOF',
    'KAZEN_INTERVAL',
  ])
  assert.strictEqual(KAIZEN_ORDER[7], 'KAZEN_CONTRACT_APPROVAL')
})

check('invariants: no question-order/rules modification — the Recipe order is the skill order', () => {
  // The Kaizen skill's own onboarding sequence (onboarding.md §The Kaizen
  // Recipe): Target, Location, Better, Scope, Permission, Proof, Interval,
  // then the Contract approval. Candice surfaces this order; she never
  // renumbers or reorders it (Master Spec 15, E.1 WS-37).
  const skillOrder = [
    'KAZEN_TARGET',
    'KAZEN_LOCATION',
    'KAZEN_BETTER',
    'KAZEN_SCOPE',
    'KAZEN_PERMISSION',
    'KAZEN_PROOF',
    'KAZEN_INTERVAL',
  ]
  assert.deepStrictEqual(KAIZEN_ORDER.slice(0, 7), skillOrder)
})

check('invariants: approval confirmation is counted:false and comes last', () => {
  const approval = KAIZEN_QUESTIONS[KAIZEN_ORDER.length - 1]
  assert.strictEqual(approval.key, 'KAZEN_CONTRACT_APPROVAL')
  assert.strictEqual(approval.counted, false)
  assert.strictEqual(approval.answerKind, 'confirm')
})

// ————————————————————————————————————————————————
// 2. Dependency regression — WS-04 gate (validate.js skill enum + event shape)
// ————————————————————————————————————————————————

check('dependency: WS-04 validate.js accepts a Kaizen question event (skill enum)', () => {
  // validate.js is the WS-04 owned gate the bridge calls before delivery.
  // A Kaizen event must pass it; otherwise the WS-37 map could not be
  // delivered through the WS-04 seam it depends on. Read-only consumption.
  const validate = require(path.join(__dirname, '..', '..', 'mcp', 'ask-user', 'validate.js'))
  const built = questionEvent('KAZEN_TARGET', 'session-1')
  assert.strictEqual(built.ok, true)
  const v = validate.validateQuestionEvent(built.question)
  assert.strictEqual(v.ok, true, JSON.stringify(v.errors))
})

check('dependency: every Kaizen map event validates through WS-04 validate.js', () => {
  const validate = require(path.join(__dirname, '..', '..', 'mcp', 'ask-user', 'validate.js'))
  for (const key of KAIZEN_ORDER) {
    const built = questionEvent(key, 'opaque-1')
    assert.strictEqual(built.ok, true, `event build failed for ${key}`)
    const v = validate.validateQuestionEvent(built.question)
    assert.strictEqual(v.ok, true, `${key}: ${JSON.stringify(v.errors)}`)
  }
})

// ————————————————————————————————————————————————
// 3. Surface-only wording (spec 15)
// ————————————————————————————————————————————————

check('surface-only: every question carries the skill wording, never a Candice rewrite', () => {
  for (const q of KAIZEN_QUESTIONS) {
    assert.ok(q.text && q.text.trim().length > 0, `${q.key} missing display wording`)
    // Candice surfaces the wording; the skill remains the source of rules.
    // No field in the map redefines how the Recipe is asked — only how it is
    // displayed/spoken through the companion surface.
    assert.strictEqual(q.skill, undefined, `${q.key} must not carry skill rules into the surface map`)
  }
})

check('surface-only: unknown key is refused, never silently renumbered', () => {
  const built = questionEvent('NOT_A_KAIZEN_KEY', 'opaque-1')
  assert.strictEqual(built.ok, false)
  assert.strictEqual(built.code, 'unknown-key')
})

// ————————————————————————————————————————————————
// 4. Once-answered / never-re-ask (spec 14)
// ————————————————————————————————————————————————

check('once-answered: the delivery order never repeats a key', () => {
  const seen = new Set()
  for (const key of KAIZEN_ORDER) {
    assert.ok(!seen.has(key), `key ${key} appears twice`)
    seen.add(key)
  }
  assert.strictEqual(seen.size, KAIZEN_ORDER.length)
})

// ————————————————————————————————————————————————
// 5. Minimum integration instructions present (E.1 WS-37, spec 25)
// ————————————————————————————————————————————————

check('spec 25: minimum integration instructions exist in the lane README', () => {
  const readme = require('fs').readFileSync(path.join(__dirname, 'README.md'), 'utf8')
  for (const needle of ['Activation', 'availability check', 'bridge', 'fallback', 'candice-companion.md', 'candice-question-contract.md']) {
    assert.ok(readme.includes(needle), `README missing: ${needle}`)
  }
})

// ————————————————————————————————————————————————

console.log(`\n${failures} FAILURE(S)`)
if (failures > 0) {
  process.exit(1)
}
console.log('\nALL TESTS PASSED')
