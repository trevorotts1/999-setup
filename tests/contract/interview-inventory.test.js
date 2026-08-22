'use strict'
const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const registry = require('../../packages/candice-protocol/question-registry')
const inventory = require('../../packages/candice-protocol/schemas/question-inventory.json')

const repoRoot = path.resolve(__dirname, '../..')
const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')

const active = inventory.records.filter((r) => r.status === 'active')
const retired = inventory.records.filter((r) => r.status === 'retired')
const zero = inventory.records.filter((r) => r.status === 'zero-governed')

// Counts: 51 active, 15 retired, 2 zero-governed.
assert.strictEqual(active.length, 51, 'active count')
assert.strictEqual(retired.length, 15, 'retired count')
assert.strictEqual(zero.length, 2, 'zero-governed count')
assert.strictEqual(inventory.records.length, 68, 'total record count')
assert.strictEqual(new Set(inventory.records.map((r) => r.key)).size, inventory.records.length, 'duplicate inventory key')

// Bidirectional inventory <-> registry agreement.
const regActive = registry.activeEntries().map((r) => r.key).sort()
assert.deepStrictEqual(active.map((r) => r.key).sort(), regActive, 'active inventory/registry gap')
for (const row of retired) {
  assert.strictEqual(registry.lookup(row.key, row.skill).code, 'retired-governed-question', `retired key ${row.key} must fail closed in the registry`)
}
assert.deepStrictEqual(zero.map((r) => r.skill).sort(), ['bro', 'eli5'], 'zero-governed review gap')

// Doctrine digest: the inventory's doctrineDigest must equal the live sha256 of interview.md.
const interviewPath = path.resolve(repoRoot, '.claude/skills/spec-protocol/references/interview.md')
assert.strictEqual(inventory.doctrineDigest, sha256(interviewPath), 'doctrineDigest must equal live sha256 of interview.md')

// Parse doctrine files against implemented keys: every record's source file must exist,
// and every active record's anchor must be a real substring of that file.
for (const row of inventory.records) {
  const file = row.source.split('#')[0]
  const abs = path.resolve(repoRoot, file)
  assert.ok(fs.existsSync(abs), `source missing: ${file}`)
  if (row.status === 'active') {
    const anchor = row.source.slice(row.source.indexOf('#') + 1)
    const content = fs.readFileSync(abs, 'utf8')
    assert.ok(content.includes(anchor), `anchor not found in ${file}: ${JSON.stringify(anchor)} (key ${row.key})`)
  }
}

// Every active registry entry's source.digest must equal the live sha256 of its doctrine file.
for (const entry of registry.activeEntries()) {
  const abs = path.resolve(repoRoot, entry.source.path)
  assert.strictEqual(entry.source.digest, sha256(abs), `digest mismatch for ${entry.key} (${entry.source.path})`)
}

console.log(`PASS inventory: active=${active.length} retired=${retired.length} zero-governed=${zero.length}`)
console.log('ALL TESTS PASSED')
