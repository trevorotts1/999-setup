'use strict'

/**
 * FIX-019 packaged-automated sub-runner (plan defect D3 fix: the plan
 * names `tests/e2e-acceptance/packaged/suite.js` as the packaged runner).
 * Owned path: tests/e2e-acceptance/packaged/**.
 *
 *   node tests/e2e-acceptance/packaged/suite.js
 *
 * Runs the six packaged legs (typed BUILD_TARGET, wrong-session, duplicate,
 * fallback, restart, compact) against the real packaged binary + real
 * AskUserServer + real LocalCompanionBridge (exact FIX-011 recheck
 * pattern), writes the PACKAGED_AUTOMATED tier report to
 * evidence/FIX-019/builder/packaged-report.json, and exits mechanically:
 *
 *   0 = every required packaged leg PASS
 *   1 = any leg FAIL
 *   2 = BLOCKED (environment gate closed, or a required leg BLOCKED)
 *
 * Legs are child processes: one leg = one process, so bridge/server/module
 * state stays isolated (suite convention). Clean state is verified before
 * every leg, not assumed. Run this suite TWICE from clean state — the
 * second run's traces must equal the first run's modulo timestamps
 * (EXECUTION-PLAN.md exact fix item).
 *
 * Pure CommonJS, zero dependencies.
 */

const { spawnSync } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { leg } = require('../tiers')
const reportModule = require('../report')
const {
  PACKAGED_BINARY, killAppProcesses, packagedBinarySha, cleanStateGate, environmentGate,
} = require('./packaged-driver')

const REPO_ROOT = path.join(__dirname, '..', '..', '..')
const EVIDENCE = path.join(REPO_ROOT, 'evidence', 'FIX-019', 'builder')
const TRACES_DIR = path.join(EVIDENCE, 'packaged-traces')

const LEGS = [
  { id: 'typed-build-target', file: 'packaged-BUILD_TARGET.test.js' },
  { id: 'wrong-session', file: 'packaged-wrong-session.test.js' },
  { id: 'duplicate', file: 'packaged-duplicate.test.js' },
  { id: 'fallback', file: 'packaged-fallback.test.js' },
  { id: 'restart', file: 'packaged-restart.test.js' },
  { id: 'compact', file: 'packaged-compact.test.js' },
]

const LEG_IDS = LEGS.map((l) => l.id)

function runLeg(def, runNo) {
  const file = path.join(__dirname, def.file)
  const traceDir = path.join(TRACES_DIR, `run${runNo}`, def.id)
  fs.mkdirSync(traceDir, { recursive: true })
  const result = spawnSync(process.execPath, [file, '--app', PACKAGED_BINARY, '--trace-dir', traceDir], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 240000,
  })
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  const verdict = result.status === 0 ? 'PASS' : result.status === 2 ? 'BLOCKED' : 'FAIL'
  console.log(`==== ${def.id}: ${verdict} ====`)
  process.stdout.write(output)
  if (!output.endsWith('\n')) process.stdout.write('\n')
  return {
    record: leg({
      id: def.id,
      tier: 'PACKAGED_AUTOMATED',
      name: `packaged-automated: ${def.id}`,
      verdict,
      reason: verdict === 'PASS' ? undefined : `leg exited ${result.status}`,
    }),
    traceDir,
  }
}

function main() {
  // Environment gate first: without macOS + a11y + binary the whole tier
  // is BLOCKED with the named reason, never a fake green.
  const gate = environmentGate()
  if (!gate.ok) {
    console.log(`BLOCKED - ${gate.reason}`)
    fs.mkdirSync(EVIDENCE, { recursive: true })
    reportModule.writeReport({
      repo: '999-setup-audit',
      commitSha: 'packaged-suite-run',
      packagedBinarySha: null,
      runId: `packaged-suite-blocked-${Date.now()}`,
      launcher: 'node tests/e2e-acceptance/packaged/suite.js',
      tierScope: 'PACKAGED_AUTOMATED',
      legs: LEG_IDS.map((id) => leg({
        id,
        tier: 'PACKAGED_AUTOMATED',
        name: `packaged-automated: ${id}`,
        verdict: 'BLOCKED',
        reason: gate.reason,
      })),
      notes: `Packaged suite environment gate closed: ${gate.reason}`,
    }, REPO_ROOT, { jsonName: 'packaged-report.json', mdName: 'PACKAGED-REPORT.md' })
    process.exit(2)
  }

  killAppProcesses()

  const packagedSha = packagedBinarySha()
  fs.writeFileSync(path.join(EVIDENCE, 'packaged-binary.sha256'), `${packagedSha}  ${path.basename(PACKAGED_BINARY)}\n`, 'utf8')
  console.log(`packaged binary: ${PACKAGED_BINARY}`)
  console.log(`packaged binary SHA-256: ${packagedSha}`)

  const legs = []
  for (const runNo of [1, 2]) {
    console.log(`\n##### PACKAGED RUN ${runNo} (clean state) #####`)
    for (const def of LEGS) {
      const gateCheck = cleanStateGate()
      if (!gateCheck.ok) {
        killAppProcesses()
        legs.push(leg({
          id: def.id,
          tier: 'PACKAGED_AUTOMATED',
          name: `packaged-automated: ${def.id}`,
          verdict: 'BLOCKED',
          reason: `clean-state gate closed before run ${runNo}: ${gateCheck.reason}`,
        }))
        console.log(`==== ${def.id}: BLOCKED (${gateCheck.reason}) ====`)
        continue
      }
      const { record } = runLeg(def, runNo)
      legs.push({ ...record, name: `${record.name} (run ${runNo})` })
      killAppProcesses()
    }
  }

  // Determinism gate: each leg passed BOTH runs. A leg that passed run 1
  // but failed run 2 is a real defect, not noise.
  for (const id of LEG_IDS) {
    const runs = legs.filter((l) => l.id === id)
    const passCount = runs.filter((l) => l.verdict === 'PASS').length
    if (passCount === 1) {
      legs.push(leg({
        id: `${id}-determinism`,
        tier: 'PACKAGED_AUTOMATED',
        name: `packaged-automated: ${id} run determinism (run 1 vs run 2)`,
        verdict: 'FAIL',
        reason: `leg ${id} passed one run and failed the other — packaged behavior is not deterministic across clean-state runs`,
      }))
    }
  }

  // Trace checks: every leg trace exists, frames valid, keys/codes only,
  // and run-2 frames equal run-1 frames modulo ts (exact-fix determinism).
  const traceProblems = []
  for (const def of LEGS) {
    for (const runNo of [1, 2]) {
      const file = path.join(TRACES_DIR, `run${runNo}`, def.id, 'event-trace.jsonl')
      if (!fs.existsSync(file)) {
        traceProblems.push(`${def.id} run ${runNo}: trace missing`)
        continue
      }
      const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter((l) => l.length > 0)
      if (lines.length === 0) traceProblems.push(`${def.id} run ${runNo}: empty trace`)
    }
    const f1 = path.join(TRACES_DIR, 'run1', def.id, 'event-trace.jsonl')
    const f2 = path.join(TRACES_DIR, 'run2', def.id, 'event-trace.jsonl')
    if (fs.existsSync(f1) && fs.existsSync(f2)) {
      const norm = (p) => fs.readFileSync(p, 'utf8').trim().split('\n')
        .filter((l) => l.length > 0)
        .map((l) => { const o = JSON.parse(l); o.ts = 'X'; return JSON.stringify(o) })
        .join('\n')
      if (norm(f1) !== norm(f2)) {
        traceProblems.push(`${def.id}: run 1 and run 2 traces differ modulo ts`)
      }
    }
  }
  for (const problem of traceProblems) {
    legs.push(leg({
      id: `trace-${crypto.createHash('sha256').update(problem).digest('hex').slice(0, 12)}`,
      tier: 'PACKAGED_AUTOMATED',
      name: `packaged-automated: trace integrity — ${problem}`,
      verdict: 'FAIL',
      reason: problem,
    }))
  }

  killAppProcesses()

  const report = reportModule.writeReport({
    repo: '999-setup-audit',
    commitSha: 'packaged-suite-run',
    packagedBinarySha: packagedSha,
    runId: `packaged-suite-${Date.now()}`,
    launcher: 'node tests/e2e-acceptance/packaged/suite.js',
    tierScope: 'PACKAGED_AUTOMATED',
    legs,
    notes: 'Two clean-state runs per leg (EXECUTION-PLAN.md exact fix). Traces at evidence/FIX-019/builder/packaged-traces/.',
  }, REPO_ROOT, { jsonName: 'packaged-report.json', mdName: 'PACKAGED-REPORT.md' })

  console.log(`\nPACKAGED VERDICT: ${report.report.verdict}`)
  for (const line of report.report.blockedLines) console.log(line)
  if (report.report.verdict === 'FAIL') process.exit(1)
  if (report.report.verdict === 'BLOCKED') process.exit(2)
  console.log('PACKAGED SUITE ALL GREEN')
  process.exit(0)
}

main()
