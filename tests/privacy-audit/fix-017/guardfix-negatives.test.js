'use strict'

/**
 * FIX-017 guardfix negatives — one negative probe per repaired H01 defect.
 * Owned path: tests/privacy-audit/fix-017/** (FIX-017 builder lane, worktree
 * candice/wt-tests-harness; base b54aec0).
 *
 * Repairs under test (H01-RECHECK.md defects D1-D5):
 *   D1 — captionPolicy fails closed for missing/classified sensitivity: the
 *        same entry decideSpeech refuses must never be shown as a caption.
 *   D2 — registry privacy.readAloud:false on a normal key refuses speech;
 *        a caller echo of readAloud:true never overrides the registry.
 *   D3 — the source digest pinned in question-keys.json is the real sha256
 *        of the committed source file (computed live here, not trusted).
 *   D4 — the SECRET_INPUT registry row carries caption:"redact", matching
 *        the guard's fixed redacted label.
 *   D5 — registryVersion bumped past 2.0.0 (two new active keys exist).
 *
 * Run: node tests/privacy-audit/fix-017/guardfix-negatives.test.js
 */

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const GUARD_PATH = path.join(__dirname, '..', '..', '..', 'plugins', 'candice-integration', 'privacy', 'final-boundary-guard.js')
const KEYS_PATH = path.join(__dirname, '..', '..', '..', 'packages', 'candice-protocol', 'schemas', 'question-keys.json')
const SCHEMA_PATH = path.join(__dirname, '..', '..', '..', 'packages', 'candice-protocol', 'schemas', 'question-keys.schema.json')

const { decideSpeech, _decideFromEntry, captionPolicy, _captionFromEntry, REDACTED_SECRET_LABEL } = require(GUARD_PATH)
const { lookup, registryVersion } = require(path.join(__dirname, '..', '..', '..', 'packages', 'candice-protocol', 'question-registry'))

const keys = JSON.parse(fs.readFileSync(KEYS_PATH, 'utf8'))
const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'))

const FABRICATED_DIGEST = 'be5390b7ef325d3b45129efbacb6cea98b78d5b3127a3059eec2100bd7272950'

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

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function row(key) {
  return keys.keys.find((e) => e.key === key)
}

/** Deep copy of a registry entry with privacy.sensitivity deleted. */
function corruptedEntry(key, skill) {
  const found = lookup(key, skill)
  assert.ok(found.ok, `lookup(${key}) must succeed`)
  const corrupted = JSON.parse(JSON.stringify(found.entry))
  delete corrupted.privacy.sensitivity
  return corrupted
}

// ———————————————————————————————— D1: caption fails closed
check('D1: caption denies when sensitivity metadata is missing', () => {
  const corrupted = corruptedEntry('BUILD_TARGET', 'spec-protocol')
  const c = _captionFromEntry(corrupted, {})
  assert.strictEqual(c.ok, false)
  assert.strictEqual(c.policy, 'deny')
})

check('D1: caption denies when sensitivity is an unknown class ("classified")', () => {
  const found = lookup('BUILD_TARGET', 'spec-protocol')
  const mutated = JSON.parse(JSON.stringify(found.entry))
  mutated.privacy.sensitivity = 'classified'
  const c = _captionFromEntry(mutated, {})
  assert.strictEqual(c.ok, false)
  assert.strictEqual(c.policy, 'deny')
})

check('D1: the same entry decideSpeech refuses is never shown as a caption', () => {
  const corrupted = corruptedEntry('BUILD_TARGET', 'spec-protocol')
  const speech = _decideFromEntry(corrupted, {})
  const caption = _captionFromEntry(corrupted, {})
  assert.strictEqual(speech.ok, false)
  assert.strictEqual(speech.decision, 'refuse-missing')
  assert.notStrictEqual(caption.policy, 'show', 'refused entry must never caption as show')
  assert.strictEqual(caption.policy, 'deny')
})

check('D1: captionPolicy on an unknown key denies (never defaults open)', () => {
  const c = captionPolicy({ questionKey: 'NOT_A_KEY', skill: 'spec-protocol' })
  assert.strictEqual(c.ok, false)
  assert.strictEqual(c.policy, 'deny')
})

// ———————————————————————————————— D2: registry readAloud:false honored
check('D2: normal key with registry readAloud:false refuses speech', () => {
  const found = lookup('BUILD_TARGET', 'spec-protocol')
  const mutated = JSON.parse(JSON.stringify(found.entry))
  mutated.privacy.readAloud = false
  const d = _decideFromEntry(mutated, {})
  assert.strictEqual(d.ok, false)
  assert.strictEqual(d.decision, 'refuse-read-aloud-disabled')
})

check('D2: caller readAloud:true echo cannot override registry readAloud:false', () => {
  const found = lookup('BUILD_TARGET', 'spec-protocol')
  const mutated = JSON.parse(JSON.stringify(found.entry))
  mutated.privacy.readAloud = false
  const d = _decideFromEntry(mutated, { callerReadAloud: true })
  assert.strictEqual(d.ok, false)
  assert.strictEqual(d.decision, 'refuse-read-aloud-disabled')
})

check('D2 control: intact normal key with readAloud:true still speaks', () => {
  const d = decideSpeech({ questionKey: 'BUILD_TARGET', skill: 'spec-protocol', callerReadAloud: true })
  assert.strictEqual(d.decision, 'speak')
})

// ———————————————————————————————— D3: real source digest
check('D3: pinned digest equals live sha256 of the committed guard file', () => {
  const live = sha256File(GUARD_PATH)
  for (const key of ['SECRET_INPUT', 'PERSONAL_INPUT']) {
    const r = row(key)
    assert.strictEqual(r.source.path, 'plugins/candice-integration/privacy/final-boundary-guard.js')
    assert.strictEqual(r.source.digest, live, `${key}: pinned digest ${r.source.digest} != live ${live}`)
  }
})

check('D3: fabricated digest be5390b7... absent from question-keys.json', () => {
  const text = fs.readFileSync(KEYS_PATH, 'utf8')
  assert.ok(!text.includes(FABRICATED_DIGEST), 'fabricated digest still present')
})

check('D3 control: existing BUILD_TARGET digest matches its real source file', () => {
  const r = row('BUILD_TARGET')
  const live = sha256File(path.join(__dirname, '..', '..', '..', r.source.path))
  assert.strictEqual(r.source.digest, live, 'digest convention is real hashes')
})

// ———————————————————————————————— D4: secret caption redact
check('D4: SECRET_INPUT registry row carries caption:"redact"', () => {
  assert.strictEqual(row('SECRET_INPUT').privacy.caption, 'redact')
})

check('D4: captionPolicy for a secret key is redact with the fixed label', () => {
  const c = captionPolicy({ questionKey: 'SECRET_INPUT', skill: 'spec-protocol' })
  assert.strictEqual(c.ok, true)
  assert.strictEqual(c.policy, 'redact')
  assert.strictEqual(c.label, REDACTED_SECRET_LABEL)
})

check('D4: schema permits caption:"redact" (enum show|redact)', () => {
  const captionEnum = schema.$defs.privacy.properties.caption.enum
  assert.ok(captionEnum.includes('redact'), 'schema caption enum missing redact')
  assert.ok(captionEnum.includes('show'), 'schema caption enum missing show')
})

// ———————————————————————————————— D5: registryVersion bumped
check('D5: registryVersion bumped past 2.0.0 and semver-shaped', () => {
  assert.notStrictEqual(keys.registryVersion, '2.0.0')
  assert.match(keys.registryVersion, /^[0-9]+\.[0-9]+\.[0-9]+$/)
  assert.strictEqual(registryVersion, keys.registryVersion, 'registry module serves the same version')
})

if (failures > 0) {
  console.log(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log(`\nFIX-017 GUARDFIX NEGATIVES: ${checks}/${checks} checks passed`)
