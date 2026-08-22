'use strict'

/**
 * candice end-to-end nontechnical-user acceptance suite — single entry point.
 *
 * Owned path: tests/e2e-acceptance/** (PROJECT-MANIFEST 9.2 WR-021, WS-50).
 *
 * E.1 WS-50 acceptance criterion (CONTROL/CHECKLIST.md): "a fresh user runs
 * a supported skill, Candice appears and reports setup checking, answers by
 * voice and by type, and the answer reaches the same Claude session."
 *
 * Runs every leg with plain `node` (each file is its own process, so module
 * caches stay isolated):
 *
 *   node tests/e2e-acceptance/suite.js
 *
 * Exit 0 only when every file prints ALL TESTS PASSED. A leg that prints
 * SKIP lines is still a pass — skips are recorded with reasons (real
 * microphone, real Windows desktop, real interactive Claude session) and
 * never claimed as tested. Cross-platform: pure Node, no shell, no npm, no
 * network, no dependencies outside the repo (repo convention, sections
 * 12/17/27; matches tests/contract and tests/same-session suites).
 *
 * The happy-path walkthrough is scripted as six legs:
 *   leg1  first-run name ask (spec 4)
 *   leg2  HOLD-TO-TALK + TYPE ANSWER + Answer-in-Claude on every question
 *         (spec 5.1/6)
 *   leg3  voice toggle independent + captions always (spec 5.2)
 *   leg4  local-only audio + privacy (spec 7/8)
 *   leg5  no second AI + no competing memory + same-session answers (spec
 *         2/9/13.2)
 *   leg6  fresh user runs a supported skill: wake, setup-check, bootstrap
 *         (spec 2/3/13.1/22)
 */

const { execFileSync } = require('child_process')
const path = require('path')

const FILES = [
  'happy1-first-run-name-ask.test.js',
  'happy2-answer-surfaces.test.js',
  'happy3-captions-voice-toggle.test.js',
  'happy4-local-audio-privacy.test.js',
  'happy5-no-second-ai-same-session.test.js',
  'happy6-fresh-user-runs-skill.test.js',
]

let failures = 0
let total = 0

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
    if (ok) total += 1
    else failures += 1
  } catch (err) {
    failures += 1
    console.log(`==== ${label}: FAIL (nonzero exit) ====`)
    if (err.stdout) process.stdout.write(String(err.stdout))
    if (err.stderr) process.stderr.write(String(err.stderr))
    if (err.message) console.log(err.message)
  }
}

console.log(`\n${total}/${FILES.length} LEG(S) PASSED`)
if (failures > 0) {
  console.log(`${failures} SUITE FILE(S) FAILED`)
  process.exit(1)
}
console.log('E2E-ACCEPTANCE SUITE ALL GREEN')
