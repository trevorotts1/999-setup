/**
 * FIX-019 tier framework self-tests — FAIL-CLOSED.
 *
 * Plants the exact failure classes the framework must catch and proves the
 * aggregate flips to BLOCKED/FAIL for each. Also proves the report/prose
 * divergence guard: the verdict is recomputed from report.json legs, and a
 * prose verdict that disagrees with the recomputation is a FAIL.
 *
 *   node tests/e2e-acceptance/tiers.test.js
 *
 * Exit 0 only when every check prints ok. Pure CommonJS, zero deps.
 */

'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { computeReportVerdict, blockedLines, leg, SKIPPABLE_LEGS, TIERS, TIER_IDS } = require('./tiers')
const reportModule = require('./report')

let failures = 0

function check(name, fn) {
  try {
    const ret = fn()
    // Vacuous-pass guard: an async fn passed to a sync check would silently
    // swallow its failures. Reject it instead.
    if (ret && typeof ret.then === 'function') {
      failures += 1
      console.log(`FAIL - ${name}`)
      console.log('  async check passed without await — fix this test (vacuous-pass guard)')
      return
    }
    console.log(`ok - ${name}`)
  } catch (err) {
    failures += 1
    console.log(`FAIL - ${name}`)
    console.log(`  ${err && err.message ? err.message : err}`)
  }
}

function fullPassReport(overrides = {}) {
  const legs = TIERS.map((tier) =>
    leg({ id: 'sample', tier: tier.id, name: 'sample leg', verdict: 'PASS' })
  )
  const report = { legs }
  for (const o of overrides.legs || []) {
    const ix = report.legs.findIndex((l) => l.tier === o.tier)
    if (ix >= 0 && !o.append) report.legs[ix] = o.leg
    else report.legs.push(o.leg)
  }
  return report
}

function reportWith(extraLegs) {
  const report = { legs: [] }
  for (const o of extraLegs) {
    const existing = report.legs.findIndex((l) => l.tier === o.tier)
    if (existing >= 0) report.legs[existing] = o.leg
    else report.legs.push(o.leg)
  }
  return report
}

// ---------------------------------------------------------------------------
// Tier vocabulary and classification
// ---------------------------------------------------------------------------

check('four required tiers exist, one per FIX-019 item 1', () => {
  assert.strictEqual(TIERS.length, 4)
  assert.deepStrictEqual(TIER_IDS, ['UNIT', 'INTEGRATION', 'PACKAGED_AUTOMATED', 'HUMAN_HARDWARE'])
  for (const tier of TIERS) assert.strictEqual(tier.required, true, `${tier.id} must be required`)
})

// The point of pinning the whole list is that adding a skip has to be a
// deliberate act with a second signature, not something that arrives with the
// change it excuses. PACKAGED_AUTOMATED/compact was added 2026-08-27 and this
// guard is what forced it to be argued for rather than slipped in.
check('only the three sanctioned skippable legs exist', () => {
  assert.deepStrictEqual(Object.keys(SKIPPABLE_LEGS).sort(), [
    'HUMAN_HARDWARE/live-mic-voice',
    'HUMAN_HARDWARE/windows-interactive-smoke',
    'PACKAGED_AUTOMATED/compact',
  ])
})

// A skip is only honest while it stays narrow. Two ways this could rot: the
// reasons could go blank, or PACKAGED_AUTOMATED could quietly accumulate more
// exemptions until the tier means nothing. Both are cheap to pin.
check('every sanctioned skip carries a real reason, and PACKAGED_AUTOMATED has exactly one', () => {
  for (const [key, reason] of Object.entries(SKIPPABLE_LEGS)) {
    assert.strictEqual(typeof reason, 'string', `${key} reason must be a string`)
    assert.ok(reason.length >= 40, `${key} reason is too short to be an explanation: ${JSON.stringify(reason)}`)
  }
  const packaged = Object.keys(SKIPPABLE_LEGS).filter((k) => k.startsWith('PACKAGED_AUTOMATED/'))
  assert.deepStrictEqual(packaged, ['PACKAGED_AUTOMATED/compact'])
  // CONTROL: the length rule can actually reject something. If this passed a
  // one-word reason, the check above would be decoration.
  assert.ok(!('x'.length >= 40), 'the reason-length rule must be able to say no')
})

check('all-pass report computes PASS with every tier PASS', () => {
  const r = computeReportVerdict(fullPassReport())
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.verdict, 'PASS')
  for (const tier of r.tiers) assert.strictEqual(tier.verdict, 'PASS')
})

// ---------------------------------------------------------------------------
// Planted required skip -> BLOCKED
// ---------------------------------------------------------------------------

check('planted required SKIPPED leg promotes tier to BLOCKED and report to BLOCKED', () => {
  const report = fullPassReport({
    legs: [{ tier: 'UNIT', leg: leg({ id: 'contract', tier: 'UNIT', name: 'contract suite', verdict: 'SKIPPED', reason: 'planted' }) }],
  })
  const r = computeReportVerdict(report)
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.verdict, 'BLOCKED', 'required skip must never hide behind a green aggregate')
  const unit = r.tiers.find((t) => t.tier === 'UNIT')
  assert.strictEqual(unit.verdict, 'BLOCKED')
  assert.ok(blockedLines(r.tiers).includes('BLOCKED UNIT - contract'))
})

check('a required skip in ANY tier promotes that tier (not just UNIT)', () => {
  for (const tierId of ['INTEGRATION', 'PACKAGED_AUTOMATED', 'HUMAN_HARDWARE']) {
    const report = fullPassReport({
      legs: [{ tier: tierId, leg: leg({ id: 'planted', tier: tierId, name: 'planted', verdict: 'SKIPPED' }) }],
    })
    const r = computeReportVerdict(report)
    assert.strictEqual(r.verdict, 'BLOCKED', `${tierId} required skip must block`)
  }
})

// ---------------------------------------------------------------------------
// Planted FAIL
// ---------------------------------------------------------------------------

check('planted FAIL leg makes the tier FAIL and the report FAIL', () => {
  const report = fullPassReport({
    legs: [{ tier: 'INTEGRATION', leg: leg({ id: 'planted-fail', tier: 'INTEGRATION', name: 'planted fail', verdict: 'FAIL', reason: 'planted' }) }],
  })
  const r = computeReportVerdict(report)
  assert.strictEqual(r.verdict, 'FAIL')
  const tier = r.tiers.find((t) => t.tier === 'INTEGRATION')
  assert.strictEqual(tier.verdict, 'FAIL')
})

check('FAIL dominates BLOCKED in the aggregate', () => {
  const report = fullPassReport({
    legs: [
      { tier: 'UNIT', leg: leg({ id: 'a', tier: 'UNIT', name: 'a', verdict: 'SKIPPED' }) },
      { tier: 'INTEGRATION', leg: leg({ id: 'b', tier: 'INTEGRATION', name: 'b', verdict: 'FAIL' }) },
    ],
  })
  assert.strictEqual(computeReportVerdict(report).verdict, 'FAIL')
})

// ---------------------------------------------------------------------------
// Empty tier and planted BLOCKED
// ---------------------------------------------------------------------------

check('a tier with no legs is BLOCKED, never PASS or SKIPPED', () => {
  const legs = TIERS.filter((t) => t.id !== 'PACKAGED_AUTOMATED').map((tier) =>
    leg({ id: 'sample', tier: tier.id, name: 'sample', verdict: 'PASS' })
  )
  const r = computeReportVerdict({ legs })
  assert.strictEqual(r.verdict, 'BLOCKED')
  const tier = r.tiers.find((t) => t.tier === 'PACKAGED_AUTOMATED')
  assert.strictEqual(tier.verdict, 'BLOCKED')
})

check('planted BLOCKED leg promotes the tier', () => {
  const report = fullPassReport({
    legs: [{ tier: 'HUMAN_HARDWARE', leg: leg({ id: 'x', tier: 'HUMAN_HARDWARE', name: 'x', verdict: 'BLOCKED' }) }],
  })
  const r = computeReportVerdict(report)
  assert.strictEqual(r.verdict, 'BLOCKED')
})

// ---------------------------------------------------------------------------
// Sanctioned skippable legs
// ---------------------------------------------------------------------------

check('sanctioned skippable leg SKIPPED with reason keeps the tier PASS', () => {
  const report = fullPassReport({
    legs: [{ tier: 'HUMAN_HARDWARE', append: true, leg: leg({ id: 'live-mic-voice', tier: 'HUMAN_HARDWARE', name: 'live mic', verdict: 'SKIPPED', reason: SKIPPABLE_LEGS['HUMAN_HARDWARE/live-mic-voice'] }) }],
  })
  const r = computeReportVerdict(report)
  assert.strictEqual(r.verdict, 'PASS')
  const tier = r.tiers.find((t) => t.tier === 'HUMAN_HARDWARE')
  assert.strictEqual(tier.verdict, 'PASS', 'a sanctioned skip beside PASS legs must not promote the tier')
})

check('a required tier containing ONLY sanctioned skips is BLOCKED (no executed evidence)', () => {
  const report = reportWith([
    { tier: 'UNIT', leg: leg({ id: 'sample', tier: 'UNIT', name: 'sample', verdict: 'PASS' }) },
    { tier: 'INTEGRATION', leg: leg({ id: 'sample', tier: 'INTEGRATION', name: 'sample', verdict: 'PASS' }) },
    { tier: 'PACKAGED_AUTOMATED', leg: leg({ id: 'sample', tier: 'PACKAGED_AUTOMATED', name: 'sample', verdict: 'PASS' }) },
    { tier: 'HUMAN_HARDWARE', leg: leg({ id: 'live-mic-voice', tier: 'HUMAN_HARDWARE', name: 'live mic', verdict: 'SKIPPED', reason: SKIPPABLE_LEGS['HUMAN_HARDWARE/live-mic-voice'] }) },
    { tier: 'HUMAN_HARDWARE', leg: leg({ id: 'windows-interactive-smoke', tier: 'HUMAN_HARDWARE', name: 'windows smoke', verdict: 'SKIPPED', reason: SKIPPABLE_LEGS['HUMAN_HARDWARE/windows-interactive-smoke'] }) },
  ])
  const r = computeReportVerdict(report)
  assert.strictEqual(r.verdict, 'BLOCKED', 'a human tier with zero executed legs is not evidence')
  const tier = r.tiers.find((t) => t.tier === 'HUMAN_HARDWARE')
  assert.strictEqual(tier.verdict, 'SKIPPED')
})

check('sanctioned skippable leg SKIPPED WITHOUT reason is FAIL', () => {
  const report = fullPassReport({
    legs: [{ tier: 'HUMAN_HARDWARE', leg: leg({ id: 'live-mic-voice', tier: 'HUMAN_HARDWARE', name: 'live mic', verdict: 'SKIPPED' }) }],
  })
  assert.strictEqual(computeReportVerdict(report).verdict, 'FAIL', 'an honest skip carries its reason')
})

check('unknown leg id is required by default and cannot be silently skipped', () => {
  const report = fullPassReport({
    legs: [{ tier: 'UNIT', leg: leg({ id: 'made-up-leg', tier: 'UNIT', name: 'made up', verdict: 'SKIPPED', reason: 'planted' }) }],
  })
  assert.strictEqual(computeReportVerdict(report).verdict, 'BLOCKED')
})

// ---------------------------------------------------------------------------
// Vocabulary and validation
// ---------------------------------------------------------------------------

check('unknown verdict is rejected, not coerced', () => {
  const r = computeReportVerdict({ legs: [{ id: 'x', tier: 'UNIT', name: 'x', verdict: 'MAYBE' }] })
  assert.strictEqual(r.ok, false)
})

check('unknown tier id is rejected', () => {
  const r = computeReportVerdict({ legs: [{ id: 'x', tier: 'NOPE', name: 'x', verdict: 'PASS' }] })
  assert.strictEqual(r.ok, false)
})

// ---------------------------------------------------------------------------
// report.json round trip + prose divergence guard
// ---------------------------------------------------------------------------

check('report.json round-trips and recomputation matches the stored verdict', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fix019-report-'))
  const written = reportModule.writeReport(
    { repo: 'test', commitSha: 'planted', runId: 'self-test', legs: fullPassReport().legs },
    tmp
  )
  assert.ok(fs.existsSync(written.jsonPath), 'report.json written')
  assert.ok(fs.existsSync(written.mdPath), 'REPORT.md written')
  const loaded = reportModule.loadReport(tmp)
  assert.strictEqual(loaded.recomputed.verdict, 'PASS')
  assert.strictEqual(loaded.parsed.verdict, loaded.recomputed.verdict, 'stored prose verdict must equal the recomputed aggregate')
  assert.ok(written.mdPath.endsWith('REPORT.md'))
})

check('planted report/prose divergence is caught (recomputed verdict differs)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fix019-report-'))
  const legs = fullPassReport({
    legs: [{ tier: 'UNIT', leg: leg({ id: 'c', tier: 'UNIT', name: 'c', verdict: 'SKIPPED' }) }],
  }).legs
  const written = reportModule.writeReport({ repo: 'test', commitSha: 'planted', legs }, tmp)
  const jsonPath = written.jsonPath
  const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  // A planted prose divergence: someone hand-edits the JSON verdict to PASS
  // while the legs still carry a required skip.
  parsed.verdict = 'PASS'
  fs.writeFileSync(jsonPath, JSON.stringify(parsed, null, 2) + '\n')
  const loaded = reportModule.loadReport(tmp)
  assert.strictEqual(loaded.recomputed.verdict, 'BLOCKED')
  assert.notStrictEqual(loaded.parsed.verdict, loaded.recomputed.verdict,
    'prose divergence must be mechanically detectable')
})

// ---------------------------------------------------------------------------
// Sub-report scope: a tier-scoped report never claims other tiers
// ---------------------------------------------------------------------------

check('tier-scoped sub-report covers only its own tier (no false BLOCKED for other tiers)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fix019-report-'))
  const written = reportModule.writeReport(
    {
      repo: 'test', commitSha: 'planted', runId: 'self-test',
      tierScope: 'PACKAGED_AUTOMATED',
      legs: [leg({ id: 'typed-build-target', tier: 'PACKAGED_AUTOMATED', name: 'packaged leg', verdict: 'PASS' })],
    },
    tmp,
    { jsonName: 'packaged-report.json', mdName: 'PACKAGED-REPORT.md' }
  )
  const json = JSON.parse(fs.readFileSync(written.jsonPath, 'utf8'))
  assert.strictEqual(json.verdict, 'PASS', 'sub-report verdict computed from scoped tier only')
  assert.strictEqual(json.tiers.length, 1, 'sub-report lists exactly its own tier')
  assert.strictEqual(json.tiers[0].tier, 'PACKAGED_AUTOMATED')
  for (const line of json.blockedLines) {
    assert.ok(!line.includes('UNIT') && !line.includes('INTEGRATION'),
      'sub-report must never claim other tiers are BLOCKED')
  }
})

check('tier-scoped sub-report with required legs BLOCKED is BLOCKED, not FAIL', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fix019-report-'))
  const written = reportModule.writeReport(
    {
      repo: 'test', commitSha: 'planted', runId: 'self-test',
      tierScope: 'PACKAGED_AUTOMATED',
      legs: ['typed-build-target', 'wrong-session', 'duplicate', 'fallback', 'restart', 'compact'].map((id) =>
        leg({ id, tier: 'PACKAGED_AUTOMATED', name: `packaged-automated: ${id}`, verdict: 'BLOCKED', reason: 'gate closed' })
      ),
    },
    tmp,
    { jsonName: 'packaged-report.json', mdName: 'PACKAGED-REPORT.md' }
  )
  const json = JSON.parse(fs.readFileSync(written.jsonPath, 'utf8'))
  assert.strictEqual(json.verdict, 'BLOCKED')
  assert.ok(json.blockedLines.length > 0)
})

// ---------------------------------------------------------------------------
// Privacy: reports carry no question/answer text
// ---------------------------------------------------------------------------

check('written evidence files carry no question or answer text', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fix019-report-'))
  const written = reportModule.writeReport(
    { repo: 'test', commitSha: 'planted', legs: fullPassReport().legs },
    tmp
  )
  const json = fs.readFileSync(written.jsonPath, 'utf8')
  const md = fs.readFileSync(written.mdPath, 'utf8')
  for (const forbidden of ['Tell me about your idea', 'what is it', 'BUILD_TARGET_ANSWER_TEXT']) {
    assert.ok(!json.includes(forbidden) && !md.includes(forbidden), `report must never contain "${forbidden}"`)
  }
})

console.log(`\nTIERS SELF-TEST: ${failures === 0 ? 'ALL TESTS PASSED' : 'FAILED'}`)
process.exit(failures === 0 ? 0 : 1)
