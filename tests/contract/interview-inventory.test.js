'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const registry = require('../../packages/candice-protocol/question-registry')
const inventory = require('../../packages/candice-protocol/schemas/question-inventory.json')

const active = inventory.records.filter((r) => r.status === 'active')
const retired = inventory.records.filter((r) => r.status === 'retired')
const zero = inventory.records.filter((r) => r.status === 'zero-governed')
assert.strictEqual(new Set(inventory.records.map((r) => r.key)).size, inventory.records.length, 'duplicate inventory key')
assert.deepStrictEqual(active.map((r) => r.key).sort(), registry.activeEntries().map((r) => r.key).sort(), 'active inventory/registry gap')
assert.deepStrictEqual(retired.map((r) => r.key).sort(), ['B3', 'C7', 'C8'], 'retirement record gap')
assert.deepStrictEqual(zero.map((r) => r.skill).sort(), ['bro', 'eli5'], 'zero-governed review gap')
for (const row of inventory.records) {
  const file = row.source.split('#')[0]
  assert.ok(fs.existsSync(path.resolve(__dirname, '../..', file)), `source missing: ${file}`)
}
console.log(`PASS inventory: active=${active.length} retired=${retired.length} zero-governed=${zero.length}`)
console.log('ALL TESTS PASSED')
