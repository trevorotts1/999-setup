'use strict'

/**
 * candice failure matrix — single entry point — owned path: tests/failure-matrix/**
 *
 * Runs every failure/fallback/chaos file and the two cargo-crate suites.
 * Exit 0 only when every file prints ALL TESTS PASSED. Each file also runs
 * standalone.
 *
 *   node tests/failure-matrix/suite
 */

const { spawnSync } = require('node:child_process')
const path = require('node:path')

const HERE = __dirname

// Order matters: MCP/fallback first (fast), then the crate suites (slow).
const FILES = [
  'app-missing.test.js',
  'app-crash.test.js',
  'speech-model-missing.test.js',
  'corrupt-checksum.test.js',
  'mic-denied.test.js',
  'no-device.test.js',
  'temp-unwritable.test.js',
  'plugin-missing.test.js',
  'mcp-unavailable.test.js',
  'wrong-session.test.js',
  'claude-busy.test.js',
]

let failures = 0

function runOne(label, args, env) {
  const r = spawnSync(process.execPath, args, { cwd: HERE, encoding: 'utf8', env: { ...process.env, ...env } })
  const ok = r.status === 0 && r.stdout.includes('ALL TESTS PASSED')
  console.log(`==== ${label}: ${ok ? 'PASS' : 'FAIL'} ====`)
  process.stdout.write(r.stdout)
  if (!ok) {
    failures += 1
    if (r.stderr) process.stderr.write(r.stderr)
  }
}

for (const file of FILES) {
  runOne(file, [path.join(HERE, file)], {})
}

// Plugin-missing silent-MCP mode: the companion accepted the question but
// never answers — must fail soft on the wait window, never hang.
runOne('plugin-missing (silent-MCP mode)', [path.join(HERE, 'plugin-missing.test.js')], {
  CANDICE_FM_SILENT_MCP: '1',
})

if (failures > 0) {
  console.log(`\n${failures} SUITE FILE(S) FAILED`)
  process.exit(1)
}
console.log('\nFAILURE MATRIX ALL GREEN')
