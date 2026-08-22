'use strict'

/**
 * candice same-session suite — single entry point — owned path: tests/same-session/**
 *
 * WS-42 same-session Claude + Claude-Nine test suite (Master Spec 27 contract
 * tests; CONTROL/CHECKLIST.md E.1 WS-42). Runs every test file with plain
 * `node` (each file is its own process, so module caches stay isolated):
 *
 *   node tests/same-session/suite.js
 *
 * Exit 0 only when every file prints ALL TESTS PASSED. Cross-platform (the
 * file body is pure Node, no shell), matching the lane convention: zero
 * package-manager step, zero network, no dependencies outside the repo
 * (sections 12/17/27).
 */

const { execFileSync } = require('child_process')
const path = require('path')

const FILES = [
  'same-session.test.js',
  'no-second-ai.test.js',
  'provider-identity.test.js',
  'session-authority.test.js',
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
console.log('\nSAME-SESSION SUITE ALL GREEN')
