'use strict'

/**
 * candice activation-matrix suite — single entry point — owned path:
 * tests/activation-matrix/** (G22 FIX-010 automated activation evidence).
 *
 * Runs every leg with plain `node` (each file is its own process, so module
 * caches stay isolated):
 *
 *   node tests/activation-matrix/suite.js
 *
 * Exit 0 only when every file prints ALL TESTS PASSED. Human-only rows are
 * recorded as honest skips by the last leg and never claimed as tested.
 * Cross-platform: pure Node, no shell, no npm, no network, no dependencies
 * outside the repo (repo convention, sections 12/17/27; matches
 * tests/contract, tests/same-session, tests/e2e-acceptance).
 */

const { execFileSync } = require('child_process')
const path = require('path')

const FILES = [
  'wake-dispatch.test.js',
  'session-binding.test.js',
  'replay-idempotency.test.js',
  'human-only-scenarios.test.js',
]

let failures = 0

for (const file of FILES) {
  const label = file.replace(/\.test\.js$/, '')
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, file)], {
      encoding: 'utf8',
      stdio: 'pipe',
    })
    const ok = out.includes('ALL TESTS PASSED')
    console.log(`==== ${label}: ${ok ? 'PASS' : 'FAIL'} ====`)
    process.stdout.write(out)
    if (!ok) failures += 1
  } catch (err) {
    failures += 1
    console.log(`==== ${label}: FAIL (nonzero exit) ====`)
    if (err.stdout) process.stdout.write(String(err.stdout))
    if (err.stderr) process.stderr.write(String(err.stderr))
    if (err.message) console.log(err.message)
  }
}

if (failures > 0) {
  console.log(`\n${failures} SUITE FILE(S) FAILED`)
  process.exit(1)
}
console.log('\nACTIVATION-MATRIX SUITE ALL GREEN')
