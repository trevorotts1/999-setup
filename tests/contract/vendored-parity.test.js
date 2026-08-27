'use strict'

/**
 * candice contract suite — vendored registry parity — owned path: tests/contract/**
 *
 * The plugin ships its own copy of the question registry. `verifyQuestion`
 * (packages/candice-protocol/question-registry.js) compares the delivered
 * question against that copy field by field with `equal()`, so the two copies
 * are not "roughly the same document" — they are one document that happens to
 * exist twice, and any difference is a delivery failure.
 *
 * They drifted. Both files declared `registryVersion: 3.0.0` while twelve
 * entries carried different text: the repo copy had the rewritten, plain-
 * language questions and the vendored copy still had the originals, complete
 * with un-substituted placeholders like "Question <N> of no more than <C>".
 * Whichever side won, the user lost — either `question-authority-mismatch` on
 * every affected question, or Candice reading raw placeholder syntax aloud.
 *
 * Nothing could detect it. The version is the only drift signal the format
 * has, and an edit to one copy does not move it. So the guard cannot be "the
 * versions agree" — it has to be byte equality, checked here.
 *
 * Deliberately a BYTE comparison, not a parsed one: key order, spacing and
 * trailing newline all belong to the artifact. A parsed comparison would pass
 * on two files that hash differently, and the hash is what a release audit
 * records.
 */

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.join(__dirname, '..', '..')
const CANONICAL_DIR = path.join(REPO_ROOT, 'packages', 'candice-protocol')
const VENDORED_DIR = path.join(
  REPO_ROOT, 'plugins', 'candice-integration', 'packages', 'candice-protocol',
)

/** Every file the plugin vendors from the protocol package. */
const MIRRORED = ['question-registry.js', path.join('schemas', 'question-keys.json')]

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
// 1. The mirrored files are byte-identical
// ————————————————————————————————

for (const rel of MIRRORED) {
  check(`vendored ${rel} is byte-identical to the canonical copy`, () => {
    const canonical = fs.readFileSync(path.join(CANONICAL_DIR, rel))
    const vendored = fs.readFileSync(path.join(VENDORED_DIR, rel))
    if (canonical.equals(vendored)) return
    // A bare "not equal" would send someone diffing a 93KB file by hand.
    let detail = `sizes ${canonical.length} vs ${vendored.length}`
    if (rel.endsWith('.json')) {
      try {
        const a = JSON.parse(canonical.toString('utf8'))
        const b = JSON.parse(vendored.toString('utf8'))
        if (Array.isArray(a.keys) && Array.isArray(b.keys)) {
          const bByKey = new Map(b.keys.map((e) => [e.key, e]))
          const drifted = a.keys
            .filter((e) => bByKey.has(e.key))
            .filter((e) => JSON.stringify(e) !== JSON.stringify(bByKey.get(e.key)))
            .map((e) => e.key)
          const onlyCanonical = a.keys.filter((e) => !bByKey.has(e.key)).map((e) => e.key)
          const aKeys = new Set(a.keys.map((e) => e.key))
          const onlyVendored = b.keys.filter((e) => !aKeys.has(e.key)).map((e) => e.key)
          detail += `; drifted entries: ${drifted.join(', ') || 'none'}`
          if (onlyCanonical.length) detail += `; only in canonical: ${onlyCanonical.join(', ')}`
          if (onlyVendored.length) detail += `; only in vendored: ${onlyVendored.join(', ')}`
        }
      } catch {
        detail += '; (one side is not parseable JSON)'
      }
    }
    assert.fail(
      `${rel} differs between packages/candice-protocol and the plugin's vendored copy. ` +
        `verifyQuestion compares delivered text with equal(), so this breaks question ` +
        `delivery at runtime. Re-sync the vendored copy from the canonical one. ${detail}`,
    )
  })
}

// ————————————————————————————————
// 2. The mirror is complete — a file present in one place and absent in the
//    other is drift that byte-equality above would never reach
// ————————————————————————————————

check('every vendored protocol file exists in the canonical package', () => {
  const walk = (dir, base = '') => {
    const out = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = path.join(base, entry.name)
      if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel))
      else out.push(rel)
    }
    return out
  }
  const vendored = walk(VENDORED_DIR)
  const orphans = vendored.filter((rel) => !fs.existsSync(path.join(CANONICAL_DIR, rel)))
  assert.deepStrictEqual(
    orphans,
    [],
    `vendored files with no canonical original: ${orphans.join(', ')} — ` +
      `these can never be kept in sync because there is nothing to sync them from`,
  )
  // And everything vendored must be declared above, or it is unguarded.
  const unguarded = vendored.filter((rel) => !MIRRORED.includes(rel))
  assert.deepStrictEqual(
    unguarded,
    [],
    `vendored files not covered by the parity check: ${unguarded.join(', ')} — ` +
      `add them to MIRRORED in this file`,
  )
})

// ————————————————————————————————
// 3. The declared version cannot distinguish the copies, which is WHY the
//    checks above are byte-level. Assert the trap rather than trusting it.
// ————————————————————————————————

check('registryVersion agrees (necessary, and provably not sufficient)', () => {
  const rel = path.join('schemas', 'question-keys.json')
  const a = JSON.parse(fs.readFileSync(path.join(CANONICAL_DIR, rel), 'utf8'))
  const b = JSON.parse(fs.readFileSync(path.join(VENDORED_DIR, rel), 'utf8'))
  assert.strictEqual(
    a.registryVersion,
    b.registryVersion,
    'the two registry copies declare different versions',
  )
  // The drift that shipped had MATCHING versions and different text, so a
  // version check alone is not a parity check. This asserts that editing one
  // copy leaves the version untouched — i.e. that the guard above is the only
  // thing standing between an edit and a silent runtime mismatch.
  const mutated = JSON.parse(JSON.stringify(a))
  mutated.keys[0].display = `${mutated.keys[0].display} MUTATED`
  assert.strictEqual(
    mutated.registryVersion,
    a.registryVersion,
    'version moved on its own — if this ever becomes true, a version check would suffice',
  )
  assert.notStrictEqual(
    JSON.stringify(mutated.keys[0]),
    JSON.stringify(a.keys[0]),
    'the mutation did not change anything; this assertion proves nothing',
  )
})

if (failures > 0) {
  console.log(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL TESTS PASSED')
