'use strict'

/**
 * WS-44 privacy/security/secrets audit — suite runner.
 *
 * Owned lane (manifest 9.2 WR-021 / WS-44):
 *   `tests/privacy-audit/**` + `docs/privacy-audit/**` — READ-ONLY audit
 *   lane. Defects found outside this lane are recorded as
 *   CROSS-LANE-FINDING + fix tickets (docs/privacy-audit/FINDINGS.md);
 *   nothing outside the two owned globs is ever written by this lane (0C).
 *
 * Run: node tests/privacy-audit/run.js   (zero deps, plain node)
 */

const { execFileSync } = require('child_process')
const path = require('path')

const SUITES = [
  'audit-a-audio.js',
  'audit-b-secrets.js',
  'audit-c-profile.js',
  // FIX-017 prohibited-speech corpus suites (builder lane, worktree
  // candice/wt-tests-harness; base b54aec0).
  'fix-017/secret-boundary.test.js',
  'fix-017/artifact-scan.test.js',
  'fix-017/replay-and-faults.test.js',
]

let failed = 0
let exitCode = 0
for (const s of SUITES) {
  const file = path.join(__dirname, s)
  console.log(`\n=== ${s} ===`)
  try {
    execFileSync('node', [file], { stdio: 'inherit', timeout: 180000 })
  } catch (err) {
    failed += 1
    exitCode = 1
  }
}

console.log(`\nPRIVACY AUDIT (WS-44): ${SUITES.length - failed}/${SUITES.length} suites completed`)
if (failed) {
  console.log('PRIVACY AUDIT: FAILING SUITES — see per-suite output above')
} else {
  console.log('PRIVACY AUDIT: suites green — findings (if any) recorded in docs/privacy-audit/README.md')
}
process.exit(exitCode)
