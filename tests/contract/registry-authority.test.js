'use strict'
const assert = require('assert')
const registry = require('../../packages/candice-protocol/question-registry')

let failures = 0
function check(name, fn) { try { fn(); console.log(`PASS  ${name}`) } catch (err) { failures += 1; console.log(`FAIL  ${name}: ${err.message}`) } }

for (const entry of registry.activeEntries()) {
  check(`${entry.key}: canonical event is the sole authority`, () => {
    const built = registry.canonicalQuestion({ sessionId: 'registry-test', questionKey: entry.key, skill: entry.skill })
    assert.strictEqual(built.ok, true)
    assert.strictEqual(registry.verifyQuestion(built.question).ok, true)
    for (const [field, value] of Object.entries({
      text: 'altered wording', answerKind: 'yes_no', allowedInputModes: ['typed'],
      readAloud: !built.question.readAloud, sensitivity: 'secret',
      counted: !built.question.counted, helpText: 'altered help', canGoBack: !built.question.canGoBack,
    })) {
      const changed = { ...built.question, [field]: value }
      assert.strictEqual(registry.verifyQuestion(changed).ok, false, `${field} mutation accepted`)
    }
  })
}

check('unknown and retired keys fail closed', () => {
  assert.strictEqual(registry.lookup('UNREGISTERED_GOVERNED_QUESTION', 'spec-protocol').code, 'unregistered-governed-question')
  assert.strictEqual(registry.lookup('B3', 'spec-protocol').code, 'retired-governed-question')
})
check('wrong skill fails closed', () => {
  assert.strictEqual(registry.lookup('BUILD_TARGET', 'kaizen').code, 'question-skill-mismatch')
})
check('retry and resume semantics are explicit for every active question', () => {
  for (const entry of registry.activeEntries()) {
    assert.ok(Number.isInteger(entry.retry.maxRetries))
    assert.ok(['accepted', 'default', 'not-applicable'].includes(entry.retry.dontKnow))
    assert.strictEqual(entry.resume.pendingRecovery, 'same-key-once')
    assert.strictEqual(entry.resume.answeredKey, 'never-reask')
    if (entry.retry.dontKnow === 'default') assert.notStrictEqual(entry.retry.default, 'none')
  }
})
check('registry objects cannot be mutated through public reads', () => {
  const record = registry.activeEntries()[0]
  record.display = 'tamper'
  assert.notStrictEqual(registry.activeEntries()[0].display, 'tamper')
})
if (failures) process.exit(1)
console.log('ALL TESTS PASSED')
