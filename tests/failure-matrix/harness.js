'use strict'

/**
 * candice failure matrix — shared helpers — owned path: tests/failure-matrix/**
 *
 * E.1 WS-43: "Claude is never blocked, reset, or destroyed" — the invariant
 * harness: every check prints PASS/FAIL with the exact input that produced it
 * (primary-source evidence for the acceptance run) and the file exits
 * nonzero on any failure.
 *
 * `check` is synchronous; `checkAsync` returns a promise — callers MUST await
 * it (or drive it through an async main) before `finish`, so async failures
 * are counted before the exit decision.
 */

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

async function checkAsync(name, fn) {
  try {
    await fn()
    console.log(`PASS  ${name}`)
  } catch (err) {
    failures += 1
    console.log(`FAIL  ${name}: ${err.message}`)
  }
}

function finish(label) {
  if (failures > 0) {
    console.log(`${label}: ${failures} CHECK(S) FAILED`)
    process.exit(1)
  }
  console.log('ALL TESTS PASSED')
}

module.exports = { check, checkAsync, finish }
