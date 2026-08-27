'use strict'

/**
 * FIX-019 packaged-automated sub-runner (plan defect D3 fix: the plan
 * names `tests/e2e-acceptance/packaged/suite.js` as the packaged runner).
 * Owned path: tests/e2e-acceptance/packaged/**.
 *
 *   node tests/e2e-acceptance/packaged/suite.js
 *
 * Runs the eight packaged legs (typed BUILD_TARGET, wrong-session,
 * duplicate, fallback, restart, compact, speech-assets, speech-keyboard)
 * against the real packaged binary + real AskUserServer + real
 * LocalCompanionBridge (exact FIX-011 recheck pattern), writes the
 * PACKAGED_AUTOMATED tier report to
 * evidence/FIX-019/builder/packaged-report.json, and exits mechanically:
 *
 *   0 = every required packaged leg PASS
 *   1 = any leg FAIL
 *   2 = BLOCKED (environment gate closed, or a required leg BLOCKED)
 *
 * `compact` is registered in tiers.js SKIPPABLE_LEGS: the surface it drives
 * is not mounted in this release, so it records SKIPPED with that reason
 * rather than BLOCKED. It still runs on both passes and still appears in the
 * report — a non-required leg that records SKIPPED with no reason is a FAIL.
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
const { leg, SKIPPABLE_LEGS } = require('../tiers')
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
  // QFIX-q2 (Q-05 step 4 + Q-02 step 6): post-bundle speech-asset delivery
  // and the installed-app keyboard path.
  //
  // speech-assets inspects the bundle on disk. It never asks a question, so
  // it emits no event-trace frames and none can be demanded of it. The
  // exemption is checked below against the leg's own source, so it cannot
  // quietly start covering a leg that DOES ask and simply stopped tracing.
  { id: 'speech-assets', file: 'packaged-speech-assets.test.js', emitsTrace: false },
  { id: 'speech-keyboard', file: 'packaged-speech-keyboard.test.js' },
]

const LEG_IDS = LEGS.map((l) => l.id)

/**
 * Empty this leg's evidence directory for this run and return its path.
 *
 * Called for EVERY leg, including one the clean-state gate turns away. A
 * blocked leg produces no evidence, so anything left in its directory is a
 * previous invocation's — and leaving it there is how a blocked run comes to
 * read as a passing one.
 */
function resetTraceDir(def, runNo) {
  const traceDir = path.join(TRACES_DIR, `run${runNo}`, def.id)
  // Reset, not mkdir. `appendTrace` appends, and this directory is committed
  // evidence that survives between invocations — so without a reset every
  // suite run stacked its frames on top of every previous run's. The
  // committed traces held frames from 2026-08-26 recorded against a build in
  // /private/tmp/candice-integration, sitting inside evidence for a run made
  // today from this checkout. Two consequences, both bad:
  //
  //   1. The run-1 vs run-2 comparison below was comparing two accumulated
  //      histories, so a leg that emitted a different number of frames in
  //      some past invocation could never match again. That is what "compact
  //      15 vs 14" and "speech-keyboard 15 vs 16" were: old runs, not drift.
  //   2. A failing run inherited a passing run's evidence. A directory could
  //      read as a pass on artifacts no run in it ever produced.
  //
  // Clearing costs nothing: every file here is written by the leg about to
  // run. Recursive removal is scoped to TRACES_DIR/run<N>/<leg-id>, all three
  // segments computed here, none of them from input.
  fs.rmSync(traceDir, { recursive: true, force: true })
  fs.mkdirSync(traceDir, { recursive: true })
  // CONTROL: prove the reset actually emptied it. If rmSync silently no-ops
  // (wrong path, permissions), stale frames would flow straight back into
  // evidence and the comparison below would go back to being meaningless.
  const leftovers = fs.readdirSync(traceDir)
  if (leftovers.length > 0) {
    throw new Error(
      `trace dir ${traceDir} still holds ${leftovers.length} file(s) after reset: ${leftovers.join(', ')}`,
    )
  }
  return traceDir
}

function runLeg(def, runNo, traceDir) {
  const file = path.join(__dirname, def.file)
  const result = spawnSync(process.execPath, [file, '--app', PACKAGED_BINARY, '--trace-dir', traceDir], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 240000,
  })
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  // Exit 2 means "this leg did not run to a verdict". Which word that
  // deserves depends on WHY, and tiers.js already draws the line: BLOCKED is
  // "the environment stopped me", SKIPPED-with-a-reason on a non-required
  // leg is "deliberately out of scope for this release". A leg registered in
  // SKIPPABLE_LEGS has already had that decision made and written down, so
  // it gets the second word and carries the registered reason -- not a bare
  // `leg exited 2`, which explains nothing to whoever reads the report.
  //
  // This is not the gate going soft. The leg still runs on both passes, still
  // appears in the report, and a non-required leg that records SKIPPED with
  // NO reason is a FAIL by tiers.js -- so the exemption cannot be claimed
  // silently. Only a leg someone has named in SKIPPABLE_LEGS, with a reason
  // attached, is tolerated.
  const skipReason = SKIPPABLE_LEGS[`PACKAGED_AUTOMATED/${def.id}`]
  let verdict
  if (result.status === 0) verdict = 'PASS'
  else if (result.status === 2) verdict = skipReason ? 'SKIPPED' : 'BLOCKED'
  else verdict = 'FAIL'
  console.log(`==== ${def.id}: ${verdict} ====`)
  process.stdout.write(output)
  if (!output.endsWith('\n')) process.stdout.write('\n')
  return {
    record: leg({
      id: def.id,
      tier: 'PACKAGED_AUTOMATED',
      name: `packaged-automated: ${def.id}`,
      verdict,
      reason: verdict === 'PASS' ? undefined
        : verdict === 'SKIPPED' ? skipReason
        : `leg exited ${result.status}`,
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
      // Before the gate, not after it. A leg that never runs must not keep a
      // previous invocation's evidence sitting in its directory.
      const traceDir = resetTraceDir(def, runNo)
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
      const { record } = runLeg(def, runNo, traceDir)
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
    if (def.emitsTrace === false) {
      // The exemption is only honest while the leg really has no round trip
      // to trace. Read its source and refuse the exemption the moment it
      // gains one — otherwise "no trace expected" silently becomes cover for
      // "trace stopped being written".
      const source = fs.readFileSync(path.join(__dirname, def.file), 'utf8')
      if (/\baskUser\s*\(/.test(source) || /\bappendTrace\s*\(/.test(source)) {
        traceProblems.push(
          `${def.id}: declared emitsTrace:false but its source asks a question or appends frames — the exemption is stale`,
        )
      }
      // CONTROL: the same read must be able to SEE a round trip, or the
      // check above passes because the file was unreadable or the pattern
      // never matches anything. Point it at a leg that definitely has one.
      const control = fs.readFileSync(path.join(__dirname, 'packaged-BUILD_TARGET.test.js'), 'utf8')
      if (!/\baskUser\s*\(/.test(control)) {
        traceProblems.push(
          'exemption control failed: packaged-BUILD_TARGET.test.js does not read as asking a question, so the emitsTrace check cannot detect one',
        )
      }
      continue
    }
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
      // `ts` was the only field normalised, so this comparison could never
      // succeed: `sessionId` is minted per run by design, and `runId` embeds a
      // timestamp. Measured across the five legs whose frame counts match,
      // those two fields were the ONLY difference — the check was reporting a
      // determinism failure on every leg, every run, since it was written, and
      // in doing so hid the two legs that really do differ.
      //
      // Erasing them outright would go too far the other way: "run 2 used two
      // sessions where run 1 used one" is exactly the kind of drift this is
      // for. So each id is replaced by a STABLE ALIAS in order of first
      // appearance. Identity and reuse structure are preserved; only the
      // literal value, which cannot repeat across clean-state runs, is not.
      const norm = (p) => {
        const aliases = new Map()
        const alias = (prefix, value) => {
          if (value === undefined || value === null) return value
          const key = `${prefix}:${value}`
          if (!aliases.has(key)) aliases.set(key, `${prefix}${aliases.size + 1}`)
          return aliases.get(key)
        }
        return fs.readFileSync(p, 'utf8').trim().split('\n')
          .filter((l) => l.length > 0)
          .map((l) => {
            const o = JSON.parse(l)
            o.ts = 'X'
            if ('sessionId' in o) o.sessionId = alias('S', o.sessionId)
            if ('runId' in o) o.runId = alias('R', o.runId)
            return JSON.stringify(o)
          })
          .join('\n')
      }
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
