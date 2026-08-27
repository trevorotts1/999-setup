'use strict'

/**
 * candice contract suite — single entry point — owned path: tests/contract/**
 *
 * Runs every contract test file with plain `node` (each file is its own
 * process, so the vendored ajv bootstrap and module caches stay isolated):
 *
 *   node tests/contract/suite.js
 *
 * Exit 0 only when every file prints ALL TESTS PASSED. Cross-platform (the
 * file body is pure Node, no shell), matching the lane convention: zero
 * package-manager step, zero network.
 */

const { execFileSync } = require('child_process')
const path = require('path')

const FILES = [
  'schema.test.js',
  'keys.test.js',
  'registry-authority.test.js',
  'vendored-parity.test.js',
  'interview-inventory.test.js',
  'exactly-one.test.js',
  'secret.test.js',
  'speakable.test.js',
  'tauri-platform-config.test.js',
  'release-version-parity.test.js',
]

let failures = 0

// A hand-maintained list only runs what someone remembered to add to it. A
// contract test added to this directory and left off FILES passes CI by never
// running -- silently, and looking green. Require the list to match the
// directory, so forgetting is a loud failure rather than an invisible gap.
const onDisk = require('fs')
  .readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.js'))
  .sort()
const unlisted = onDisk.filter((f) => !FILES.includes(f))
const missing = FILES.filter((f) => !onDisk.includes(f))
if (unlisted.length > 0 || missing.length > 0) {
  console.log('==== suite-coverage: FAIL ====')
  if (unlisted.length > 0) {
    console.log(`contract tests on disk but not in FILES (they never run): ${unlisted.join(', ')}`)
  }
  if (missing.length > 0) {
    console.log(`FILES names tests that are not on disk: ${missing.join(', ')}`)
  }
  process.exit(1)
}
// CONTROL: if the directory read returned nothing, the check above would pass
// for free and so would an empty run.
if (onDisk.length < FILES.length) {
  console.log('==== suite-coverage: FAIL ==== the directory walk is not reaching the tests')
  process.exit(1)
}

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
console.log('\nCONTRACT SUITE ALL GREEN')
