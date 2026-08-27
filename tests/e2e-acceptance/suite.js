'use strict'

/**
 * FIX-019 four-tier e2e-acceptance aggregating runner — single entry point.
 * Owned path: tests/e2e-acceptance/** (FIX-019 implementation lane).
 *
 *   node tests/e2e-acceptance/suite.js
 *
 * Runs the tiers that can execute from a plain checkout and merges the
 * evidence produced by the sub-runners:
 *
 *   UNIT               — contract / same-session / failure-matrix test files
 *                        (each file = one leg) plus the tier-framework
 *                        self-test. Frontend + Rust crate legs are recorded
 *                        by the packaged runner (packaged/suite.js), which
 *                        owns the npm/cargo gates.
 *   INTEGRATION        — the six WS-50 walkthrough legs (real modules, fake
 *                        Claude input surface) plus the bridge-less MCP
 *                        leg recorded by the packaged runner.
 *   PACKAGED_AUTOMATED — merged from evidence/FIX-019/builder/packaged-report.json
 *                        (written by packaged/suite.js). Absent => the tier's
 *                        required legs are recorded SKIPPED with reason and
 *                        the tier promotes to BLOCKED.
 *   HUMAN_HARDWARE     — merged from evidence/FIX-019/builder/human-report.json
 *                        (written by human/record-run.js from filled trace
 *                        templates). Absent => required legs recorded SKIPPED
 *                        and the tier promotes to BLOCKED.
 *
 * Exit code is mechanical, never prose:
 *   0 = every required tier PASS, no required leg SKIPPED
 *   1 = any required leg FAIL
 *   2 = BLOCKED — a required skip is recorded and the suite prints
 *       `BLOCKED <tier> - <required-leg>` lines. A skip never hides behind a
 *       green exit (FIX-019 exact fix item 2; WS-50 defect).
 *
 * The aggregate is written to evidence/FIX-019/builder/report.json (+ a
 * human-readable REPORT.md). QC recomputes the aggregate from the JSON,
 * never from this prose.
 *
 * Pure CommonJS, zero dependencies, no network.
 */

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { leg } = require('./tiers')
const reportModule = require('./report')

const REPO_ROOT = path.join(__dirname, '..', '..')
const EVIDENCE = path.join(REPO_ROOT, 'evidence', 'FIX-019', 'builder')

// ---------------------------------------------------------------------------
// Tier inventories (leg ids are the machine contract; counts follow the plan
// QC defects: contract = six files (D4), same-session = four, failure-matrix
// = eleven).
// ---------------------------------------------------------------------------

const UNIT_SUITES = [
  { suite: 'contract', dir: path.join(REPO_ROOT, 'tests', 'contract'), files: [
    'schema.test.js', 'keys.test.js', 'registry-authority.test.js',
    'interview-inventory.test.js', 'exactly-one.test.js', 'secret.test.js',
  ] },
  { suite: 'same-session', dir: path.join(REPO_ROOT, 'tests', 'same-session'), files: [
    'no-second-ai.test.js', 'provider-identity.test.js',
    'same-session.test.js', 'session-authority.test.js',
  ] },
  { suite: 'failure-matrix', dir: path.join(REPO_ROOT, 'tests', 'failure-matrix'), files: [
    'app-crash.test.js', 'app-missing.test.js', 'claude-busy.test.js',
    'corrupt-checksum.test.js', 'mcp-unavailable.test.js', 'mic-denied.test.js',
    'no-device.test.js', 'plugin-missing.test.js', 'speech-model-missing.test.js',
    'temp-unwritable.test.js', 'wrong-session.test.js',
  ] },
]

const INTEGRATION_FILES = [
  'happy1-first-run-name-ask.test.js',
  'happy2-answer-surfaces.test.js',
  'happy3-captions-voice-toggle.test.js',
  'happy4-local-audio-privacy.test.js',
  'happy5-no-second-ai-same-session.test.js',
  'happy6-fresh-user-runs-skill.test.js',
]

const PACKAGED_LEG_IDS = [
  'typed-build-target', 'wrong-session', 'duplicate', 'fallback', 'restart', 'compact',
]

const HUMAN_REQUIRED_LEG_IDS = [
  'default-mode-claude', 'default-mode-claude-nine',
  'advanced-mode-claude', 'advanced-mode-claude-nine',
  'clarification-loop', 'ceiling-count', 'input-mode-per-question', 'final-write-through',
]

// ---------------------------------------------------------------------------
// Child-process helpers (each test file is its own process, so module caches
// stay isolated — the WS-50 suite convention).
// ---------------------------------------------------------------------------

function runFile(file) {
  try {
    const out = execFileSync(process.execPath, [file], {
      encoding: 'utf8', stdio: 'pipe', timeout: 300000,
    })
    return { ok: out.includes('ALL TESTS PASSED'), output: out }
  } catch (err) {
    return {
      ok: false,
      output: `${String(err.stdout || '')}\n${String(err.stderr || '')}\n${err.message || ''}`,
    }
  }
}

function labelOf(file) {
  return path.basename(file).replace(/\.test\.js$/, '')
}

function collectLegs(kind, suiteDefs, tierId, prefix) {
  const legs = []
  for (const suite of suiteDefs) {
    for (const file of suite.files) {
      const filePath = path.join(suite.dir, file)
      const result = runFile(filePath)
      const id = `${prefix}${suite.suite}-${labelOf(file)}`
      legs.push(leg({
        id, tier: tierId, name: `${kind}: ${suite.suite}/${labelOf(file)}`,
        verdict: result.ok ? 'PASS' : 'FAIL',
        reason: result.ok ? undefined : 'test file failed or exited nonzero',
      }))
      console.log(`==== ${id}: ${result.ok ? 'PASS' : 'FAIL'} ====`)
      process.stdout.write(result.output)
      if (!result.output.endsWith('\n')) process.stdout.write('\n')
    }
  }
  return legs
}

/** Merges legs from a sub-runner report file when present. */
function mergeSubReport(relPath, tierId, requiredIds, kindLabel, skippableAllowed) {
  const file = path.join(EVIDENCE, relPath)
  let parsed = null
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    // Absent or unreadable sub-report => required legs recorded SKIPPED with
    // the named source, and the tier promotes to BLOCKED.
  }
  const legs = []
  if (parsed && Array.isArray(parsed.legs)) {
    for (const record of parsed.legs) {
      legs.push(leg({
        id: record.id,
        tier: tierId,
        name: record.name || record.id,
        verdict: record.verdict,
        reason: record.reason,
      }))
    }
  }
  for (const id of requiredIds) {
    if (legs.some((l) => l.id === id)) continue
    legs.push(leg({
      id,
      tier: tierId,
      name: `${kindLabel}: ${id}`,
      verdict: 'SKIPPED',
      reason: `no evidence for required leg ${id} (sub-report ${relPath} absent or incomplete)`,
    }))
  }
  return legs
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const legs = []

// UNIT tier — hermetic suites + framework self-test.
for (const def of collectLegs('unit suite', UNIT_SUITES, 'UNIT', '')) legs.push(def)

{
  const selfTest = runFile(path.join(__dirname, 'tiers.test.js'))
  legs.push(leg({
    id: 'tier-self-test', tier: 'UNIT', name: 'unit: tier framework fail-closed self-test',
    verdict: selfTest.ok ? 'PASS' : 'FAIL',
    reason: selfTest.ok ? undefined : 'tiers.test.js failed — the framework itself is broken',
  }))
  console.log(`==== tier-self-test: ${selfTest.ok ? 'PASS' : 'FAIL'} ====`)
  process.stdout.write(selfTest.output)
  if (!selfTest.output.endsWith('\n')) process.stdout.write('\n')
}

// INTEGRATION tier — the six WS-50 walkthrough legs.
for (const file of INTEGRATION_FILES) {
  const result = runFile(path.join(__dirname, file))
  const id = labelOf(file)
  legs.push(leg({
    id, tier: 'INTEGRATION', name: `integration: ${id}`,
    verdict: result.ok ? 'PASS' : 'FAIL',
    reason: result.ok ? undefined : 'leg failed or exited nonzero',
  }))
  console.log(`==== ${id}: ${result.ok ? 'PASS' : 'FAIL'} ====`)
  process.stdout.write(result.output)
  if (!result.output.endsWith('\n')) process.stdout.write('\n')
}

// Merged tiers from the packaged + human sub-runners.
for (const l of mergeSubReport('packaged-report.json', 'PACKAGED_AUTOMATED', PACKAGED_LEG_IDS, 'packaged-automated', false)) legs.push(l)
for (const l of mergeSubReport('human-report.json', 'HUMAN_HARDWARE', HUMAN_REQUIRED_LEG_IDS, 'human/hardware', true)) legs.push(l)

// Compute and write the machine-readable aggregate.
const report = reportModule.writeReport({
  repo: '999-setup-audit',
  commitSha: 'recorded-at-run-time',
  runId: `suite-${Date.now()}`,
  launcher: 'node tests/e2e-acceptance/suite.js',
  legs,
  notes: 'Aggregating suite run. commitSha recorded-at-run-time: the packaged runner pins the built binary SHA.',
}, REPO_ROOT)

console.log(`\nAGGREGATE VERDICT: ${report.report.verdict}`)
for (const tier of report.report.tiers) {
  console.log(`  ${tier.tier}: ${tier.verdict} (${tier.legs.length} legs)`)
}
if (report.report.blockedLines.length > 0) {
  for (const line of report.report.blockedLines) console.log(line)
}

if (report.report.verdict === 'FAIL') process.exit(1)
if (report.report.verdict === 'BLOCKED') process.exit(2)
console.log('E2E-ACCEPTANCE SUITE ALL GREEN')
process.exit(0)
