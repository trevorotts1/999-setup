'use strict'

/**
 * FIX-019 acceptance-tier framework — four-tier model, machine-readable
 * verdicts. Owned path: tests/e2e-acceptance/** (FIX-019 implementation lane).
 *
 * Replaces the WS-50 flat-suite convention ("a leg that prints SKIP still
 * exits 0 and the suite sums legs to green") with tiers whose verdicts are
 * computed mechanically from a machine-readable report, never from prose
 * (FIX-019 exact fix items 1-2):
 *
 *   UNIT               — pure function/state-machine behavior, zero I/O.
 *   INTEGRATION        — real process, real IPC, real files, no GUI.
 *   PACKAGED_AUTOMATED — the built .app driven headlessly through the real
 *                        AskUserServer + LocalCompanionBridge pair.
 *   HUMAN_HARDWARE     — real terminal, real Claude, real human.
 *
 * Mandatory verdict vocabulary: PASS | FAIL | BLOCKED | SKIPPED. A required
 * leg recorded SKIPPED mechanically promotes its tier to BLOCKED; BLOCKED in
 * any required tier fails FIX-019 QC regardless of how many legs passed.
 *
 * Pure CommonJS, zero dependencies, no network (repo convention, sections
 * 12/17/27; matches tests/contract and tests/same-session suites).
 */

const VERDICTS = Object.freeze(['PASS', 'FAIL', 'BLOCKED', 'SKIPPED'])

/** Four tiers in FIX-019 exact-fix item 1. Every tier is REQUIRED. */
const TIERS = Object.freeze([
  {
    id: 'UNIT',
    label: 'unit',
    required: true,
    description: 'pure function/state-machine behavior, zero I/O, hermetic',
  },
  {
    id: 'INTEGRATION',
    label: 'integration',
    required: true,
    description: 'real process, real IPC, real files, no GUI',
  },
  {
    id: 'PACKAGED_AUTOMATED',
    label: 'packaged-automated',
    required: true,
    description: 'built .app binary driven headlessly, real server/bridge',
  },
  {
    id: 'HUMAN_HARDWARE',
    label: 'human/hardware',
    required: true,
    description: 'real terminal, real Claude, real packaged app, real human',
  },
])

const TIER_IDS = Object.freeze(TIERS.map((t) => t.id))

/**
 * Legs that may be honestly SKIPPED without promoting the tier to BLOCKED.
 * Every leg not listed here is REQUIRED. Keyed `${tierId}/${legId}`.
 *
 * Optional legs (FIX-019 plan, HUMAN/HARDWARE tier only):
 *   - live-mic voice answers (no operator-approved voice hardware; typed
 *     answers remain required);
 *   - Windows interactive smoke (owned by FIX-018/WS-46 matrix).
 * No other skip is valid in any tier.
 */
const SKIPPABLE_LEGS = Object.freeze({
  'HUMAN_HARDWARE/live-mic-voice': 'no operator-approved voice hardware available; typed answers still required',
  'HUMAN_HARDWARE/windows-interactive-smoke': 'owned by FIX-018/WS-46 matrix, not FIX-019',
})

/**
 * Validates a leg record. Returns { ok, error, record } — the record is the
 * input normalized to the canonical shape (never trusts unknown fields).
 */
function validateLeg(leg) {
  if (!leg || typeof leg !== 'object' || Array.isArray(leg)) {
    return { ok: false, error: 'leg must be an object' }
  }
  if (typeof leg.id !== 'string' || leg.id.length === 0) {
    return { ok: false, error: 'leg.id must be a non-empty string' }
  }
  if (!TIER_IDS.includes(leg.tier)) {
    return { ok: false, error: `leg.tier must be one of ${TIER_IDS.join(', ')} (got ${JSON.stringify(leg.tier)})` }
  }
  if (!VERDICTS.includes(leg.verdict)) {
    return { ok: false, error: `leg.verdict must be one of ${VERDICTS.join(', ')} (got ${JSON.stringify(leg.verdict)})` }
  }
  if (typeof leg.name !== 'string' || leg.name.length === 0) {
    return { ok: false, error: 'leg.name must be a non-empty string' }
  }
  if (leg.reason !== undefined && leg.reason !== null && typeof leg.reason !== 'string') {
    return { ok: false, error: 'leg.reason must be a string or null when present' }
  }
  const required = !Object.prototype.hasOwnProperty.call(SKIPPABLE_LEGS, `${leg.tier}/${leg.id}`)
  const record = {
    id: leg.id,
    tier: leg.tier,
    name: leg.name,
    verdict: leg.verdict,
    required,
    skippableReason: required ? null : SKIPPABLE_LEGS[`${leg.tier}/${leg.id}`],
    reason: leg.reason || null,
  }
  return { ok: true, record }
}

/**
 * Computes the tier verdict from its leg records.
 *
 *   BLOCKED — any required leg is SKIPPED (a required skip mechanically
 *             promotes the tier) or any leg is BLOCKED.
 *   FAIL    — any required leg is FAIL, or a skippable leg recorded SKIPPED
 *             without its sanctioned reason.
 *   SKIPPED — every leg is SKIPPED and at least one leg exists (a tier with
 *             no evidence is BLOCKED, never SKIPPED).
 *   PASS    — every required leg is PASS; skippable legs are PASS or SKIPPED
 *             with reason.
 */
function computeTierVerdict(tierId, legs) {
  if (!TIER_IDS.includes(tierId)) {
    throw new Error(`unknown tier ${JSON.stringify(tierId)}`)
  }
  if (!Array.isArray(legs) || legs.length === 0) return 'BLOCKED'
  for (const leg of legs) {
    if (leg.verdict === 'BLOCKED') return 'BLOCKED'
    if (leg.required && leg.verdict === 'SKIPPED') return 'BLOCKED'
  }
  for (const leg of legs) {
    if (leg.verdict === 'FAIL') return 'FAIL'
    if (!leg.required && leg.verdict === 'SKIPPED' && !leg.reason) return 'FAIL'
  }
  if (legs.every((leg) => leg.verdict === 'SKIPPED')) return 'SKIPPED'
  return 'PASS'
}

/**
 * Computes the whole-report verdict. Every tier must exist and be computed;
 * a missing tier is BLOCKED. Returns
 *   { ok, verdict, tiers: [{ tier, required, verdict, legs }] }.
 */
function computeReportVerdict(report) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.legs)) {
    return { ok: false, error: 'report must be an object with a legs array' }
  }
  const byTier = new Map()
  for (const tier of TIERS) byTier.set(tier.id, [])
  const errors = []
  for (const leg of report.legs) {
    const check = validateLeg(leg)
    if (!check.ok) {
      errors.push(check.error)
      continue
    }
    const record = check.record
    if (leg.verdict === 'SKIPPED' && record.required) {
      // A required SKIPPED leg carries no exemption; note the promoted tier.
    }
    byTier.get(record.tier).push(record)
  }
  if (errors.length > 0) return { ok: false, error: errors.join('; ') }
  const tiers = TIERS.map((tier) => ({
    tier: tier.id,
    required: tier.required,
    verdict: computeTierVerdict(tier.id, byTier.get(tier.id)),
    legs: byTier.get(tier.id),
  }))
  let verdict = 'PASS'
  for (const tier of tiers) {
    // A required tier with only sanctioned skips has no executed evidence —
    // a required tier with no positive legs blocks FIX-019 QC.
    if (tier.required && tier.verdict === 'SKIPPED') verdict = 'BLOCKED'
    if (tier.verdict === 'BLOCKED' && verdict !== 'FAIL') verdict = 'BLOCKED'
    if (tier.verdict === 'FAIL') verdict = 'FAIL'
  }
  return { ok: true, verdict, tiers }
}

/**
 * The BLOCKED detail lines the suite must print (and QC must be able to
 * grep): one line per required leg recorded SKIPPED.
 */
function blockedLines(tiers) {
  const out = []
  for (const tier of tiers) {
    if (tier.verdict !== 'BLOCKED') continue
    for (const leg of tier.legs) {
      if (leg.required && leg.verdict === 'SKIPPED') {
        out.push(`BLOCKED ${tier.tier} - ${leg.id}`)
      }
      if (leg.verdict === 'BLOCKED') {
        out.push(`BLOCKED ${tier.tier} - ${leg.id}`)
      }
    }
    if (tier.legs.length === 0) out.push(`BLOCKED ${tier.tier} - no legs recorded`)
  }
  return out
}

/** Builds a leg record (canonical constructor for suites). */
function leg({ id, tier, name, verdict, reason }) {
  return { id, tier, name, verdict, reason: reason || undefined }
}

module.exports = {
  VERDICTS,
  TIERS,
  TIER_IDS,
  SKIPPABLE_LEGS,
  validateLeg,
  computeTierVerdict,
  computeReportVerdict,
  blockedLines,
  leg,
}
