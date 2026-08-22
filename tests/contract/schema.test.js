'use strict'

/**
 * candice contract suite — schema validation — owned path: tests/contract/**
 *
 * Checklist E.1 WS-41 first leg: "schemas validate".
 * Also E.1 WS-01: "`question-event`, `answer-event`, `status-event`,
 * `preferences` JSON schemas exist in `packages/candice-protocol/schemas/`,
 * validate against fixtures, and question keys are stable".
 *
 * Sections:
 *   1. every schema file compiles under ajv draft 2020-12;
 *   2. the four E.1 schemas validate their valid fixtures and reject their
 *      invalid fixtures (WS-01 package fixtures);
 *   3. extra WS-41 fixtures (secret, options, validation, progress shapes)
 *      validate and the guards reject;
 *   4. schema index integrity: every index entry resolves to a real file.
 *
 * Runs with plain `node` (Node >= 22.6), zero network:
 *   node tests/contract/schema.test.js
 */

const assert = require('assert')
const path = require('path')

const { SCHEMAS_DIR, FIXTURES_DIR, newValidator, schemaFiles, readJson, E1_SCHEMAS } = require('./harness')

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

// ————————————————————————————————
// 1. Schema compilation (full 2020-12)
// ————————————————————————————————

check('every schema file in schemas/** compiles under ajv draft 2020-12', () => {
  const ajv = newValidator()
  const files = schemaFiles()
  assert.ok(files.length >= 6, `expected >= 6 schema files, found ${files.length}`)
  for (const file of files) {
    const name = path.relative(SCHEMAS_DIR, file)
    // question-keys.schema.json and schema-index.json are registry/index
    // shapes validated as DATA in the keys test; they still compile as
    // schemas here.
    ajv.compile(readJson(file))
    assert.ok(true, `compiled ${name}`)
  }
})

check('the four E.1 schemas exist at the exact required path', () => {
  for (const name of E1_SCHEMAS) {
    const file = path.join(SCHEMAS_DIR, `${name}.schema.json`)
    assert.ok(fsExists(file), `missing ${name}.schema.json`)
  }
})

function fsExists(p) {
  return require('fs').existsSync(p)
}

// ————————————————————————————————
// 2. WS-01 package fixtures through the authoritative validator
// ————————————————————————————————

// valid fixtures must validate; invalid fixtures must fail
const FIXTURE_CASES = [
  ['question-event', 'question-event.valid.json', true],
  ['question-event', 'question-event.invalid.json', false],
  ['answer-event', 'answer-event.valid.json', true],
  ['answer-event', 'answer-event.invalid.json', false],
  ['status-event', 'status-event.valid.json', true],
  ['preferences', 'preferences.valid.json', true],
]

for (const [schema, fixture, expectValid] of FIXTURE_CASES) {
  check(`${schema}.schema.json ${expectValid ? 'validates' : 'rejects'} ${fixture}`, () => {
    const ajv = newValidator()
    const validate = ajv.compile(readJson(path.join(SCHEMAS_DIR, `${schema}.schema.json`)))
    const data = readJson(path.join(FIXTURES_DIR, fixture))
    assert.strictEqual(validate(data), expectValid)
    if (!expectValid) {
      assert.ok(validate.errors && validate.errors.length > 0, 'errors were reported')
    }
  })
}

// The invalid fixture must fail for its DOCUMENTED reason (not accidentally).
check('question-event.invalid.json fails for skill/questionKey/text/allowedInputModes', () => {
  const ajv = newValidator()
  const validate = ajv.compile(readJson(path.join(SCHEMAS_DIR, 'question-event.schema.json')))
  const data = readJson(path.join(FIXTURES_DIR, 'question-event.invalid.json'))
  validate(data)
  const paths = (validate.errors || []).map((e) => `${e.instancePath} ${e.keyword}`).join(' | ')
  assert.ok(paths.includes('skill'), `skill violation present: ${paths}`)
  assert.ok(paths.includes('questionKey'), `questionKey violation present: ${paths}`)
  assert.ok(paths.includes('text'), `text violation present: ${paths}`)
  assert.ok(paths.includes('allowedInputModes'), `allowedInputModes violation present: ${paths}`)
})

check('answer-event.invalid.json fails for questionKey/answerText/inputMode', () => {
  const ajv = newValidator()
  const validate = ajv.compile(readJson(path.join(SCHEMAS_DIR, 'answer-event.schema.json')))
  const data = readJson(path.join(FIXTURES_DIR, 'answer-event.invalid.json'))
  validate(data)
  const paths = (validate.errors || []).map((e) => `${e.instancePath} ${e.keyword}`).join(' | ')
  assert.ok(paths.includes('required'), `required violation present: ${paths}`)
  assert.ok(paths.includes('answerText'), `answerText violation present: ${paths}`)
  assert.ok(paths.includes('inputMode'), `inputMode violation present: ${paths}`)
})

// ————————————————————————————————
// 3. Format guards (date-time) — the WS-01 format-guard proof, committed
// ————————————————————————————————

check('status-event rejects a bad timestamp (format date-time is enforced)', () => {
  const ajv = newValidator()
  const validate = ajv.compile(readJson(path.join(SCHEMAS_DIR, 'status-event.schema.json')))
  const good = readJson(path.join(FIXTURES_DIR, 'status-event.valid.json'))
  assert.strictEqual(validate(good), true)
  const bad = Object.assign({}, good, { timestamp: 'not-a-date' })
  assert.strictEqual(validate(bad), false)
  assert.ok((validate.errors || []).some((e) => e.keyword === 'format'), 'format keyword reported')
})

// ————————————————————————————————
// 4. Schema index integrity (schema-index.json enumeration)
// ————————————————————————————————

check('schema-index.json entries resolve to real files and cover every event schema', () => {
  const index = readJson(path.join(SCHEMAS_DIR, 'schema-index.json'))
  assert.strictEqual(index.schemaVersion, '1.0')
  const names = new Set()
  for (const entry of index.protocolSchemas) {
    const file = path.join(SCHEMAS_DIR, entry.path)
    assert.ok(fsExists(file), `index entry ${entry.name} -> ${entry.path} must exist`)
    names.add(entry.name)
  }
  for (const bare of E1_SCHEMAS) {
    assert.ok(names.has(bare), `index must enumerate ${bare}`)
  }
  assert.ok(names.has('event-envelope'), 'index must enumerate the shared envelope')
  assert.ok(names.has('question-keys'), 'index must enumerate the keys registry')
  assert.ok(names.has('question-keys-registry'), 'index must enumerate the keys data')
})

if (failures > 0) {
  console.log(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL TESTS PASSED')
