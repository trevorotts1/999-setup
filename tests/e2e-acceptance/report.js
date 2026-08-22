'use strict'

/**
 * FIX-019 machine-readable report writer + human renderer.
 * Owned path: tests/e2e-acceptance/** (FIX-019 implementation lane).
 *
 * Writes the tier aggregate to `report.json` and a human-readable
 * `REPORT.md` under the evidence dir (evidence/FIX-019/builder/). The QC
 * procedure recomputes the aggregate from the JSON, never from prose, so
 * the JSON is the authoritative record.
 *
 * Privacy boundary (FIX-017 rule, plan conflict-resolution): reports and
 * traces never contain question text, answer text, secret content, tokens,
 * or raw audio — question keys and codes only.
 *
 * Pure CommonJS, zero dependencies.
 */

const fs = require('fs')
const path = require('path')
const { TIERS, TIER_IDS, computeReportVerdict, computeTierVerdict, blockedLines, validateLeg } = require('./tiers')

/** Evidence output root: <repo>/evidence/FIX-019/builder. */
function evidenceDir(repoRoot) {
  return path.join(repoRoot, 'evidence', 'FIX-019', 'builder')
}

/**
 * Builds the full report object. `payload` carries:
 *   { repo, commitSha, packagedBinarySha, runId, launcher, tierScope,
 *     tiers: [ { tier, verdict, legs } ], notes }
 * `tierScope` (sub-runners only): when set to one tier id, the report
 * covers ONLY that tier — the verdict and tiers array are computed from
 * that tier's legs alone, never claiming verdicts about other tiers.
 * Unknown fields are dropped (never written to evidence).
 */
function buildReport(payload) {
  const source = payload || {}
  const repo = typeof source.repo === 'string' ? source.repo : null
  const commitSha = typeof source.commitSha === 'string' ? source.commitSha : null
  const packagedBinarySha = typeof source.packagedBinarySha === 'string' ? source.packagedBinarySha : null
  const runId = typeof source.runId === 'string' ? source.runId : null
  const launcher = typeof source.launcher === 'string' ? source.launcher : null
  const notes = typeof source.notes === 'string' ? source.notes : null
  const tierScope = TIER_IDS.includes(source.tierScope) ? source.tierScope : null
  const legs = Array.isArray(source.legs) ? source.legs : []
  let computed
  if (tierScope) {
    const records = []
    for (const leg of legs) {
      const check = validateLeg(leg)
      if (!check.ok) throw new Error(`report.js: ${check.error}`)
      records.push(check.record)
    }
    const tierVerdict = computeTierVerdict(tierScope, records)
    const aggregate = tierVerdict === 'SKIPPED' ? 'BLOCKED' : tierVerdict
    computed = {
      ok: true,
      verdict: aggregate,
      tiers: [{ tier: tierScope, required: true, verdict: tierVerdict, legs: records }],
    }
  } else {
    computed = computeReportVerdict({ legs })
  }
  if (!computed.ok) throw new Error(`report.js: ${computed.error}`)
  return {
    reportSchema: 'fix-019/1',
    generatedAt: new Date().toISOString(),
    repo,
    commitSha,
    packagedBinarySha,
    runId,
    launcher,
    verdict: computed.verdict,
    // The legs array is the authoritative recomputation source: QC
    // recomputes the aggregate from these records, never from prose.
    legs: computed.tiers.flatMap((tier) => tier.legs),
    tiers: computed.tiers.map((tier) => ({
      tier: tier.tier,
      required: tier.required,
      verdict: tier.verdict,
      legs: tier.legs.map((l) => ({
        id: l.id,
        name: l.name,
        verdict: l.verdict,
        required: l.required,
        reason: l.reason,
      })),
    })),
    blockedLines: blockedLines(computed.tiers),
    notes,
  }
}

/**
 * Writes report.json (authoritative) and REPORT.md (human render) into the
 * evidence dir. Sub-runners (packaged/human) pass `options.jsonName` so
 * their reports land beside the aggregate instead of overwriting it.
 * Returns the absolute paths of the files written.
 */
function writeReport(payload, repoRoot, options = {}) {
  const report = buildReport(payload)
  const dir = evidenceDir(repoRoot)
  fs.mkdirSync(dir, { recursive: true })
  const jsonName = typeof options.jsonName === 'string' ? options.jsonName : 'report.json'
  const mdName = typeof options.mdName === 'string' ? options.mdName : 'REPORT.md'
  const jsonPath = path.join(dir, jsonName)
  const mdPath = path.join(dir, mdName)
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8')
  fs.writeFileSync(mdPath, renderReport(report), 'utf8')
  return { jsonPath, mdPath, report }
}

/** Renders the human-readable markdown form of the report. */
function renderReport(report) {
  const lines = []
  lines.push('# FIX-019 e2e-acceptance report')
  lines.push('')
  lines.push(`- Verdict: **${report.verdict}**`)
  lines.push(`- Generated: ${report.generatedAt}`)
  if (report.repo) lines.push(`- Repository: ${report.repo}`)
  if (report.commitSha) lines.push(`- Commit SHA: ${report.commitSha}`)
  if (report.packagedBinarySha) lines.push(`- Packaged binary SHA-256: ${report.packagedBinarySha}`)
  if (report.runId) lines.push(`- Run id: ${report.runId}`)
  if (report.launcher) lines.push(`- Launcher: ${report.launcher}`)
  lines.push('')
  lines.push('## Tier verdicts')
  lines.push('')
  lines.push('| Tier | Required | Verdict | Legs |')
  lines.push('| --- | --- | --- | --- |')
  for (const tier of report.tiers) {
    lines.push(`| ${tier.tier} | ${tier.required ? 'yes' : 'no'} | **${tier.verdict}** | ${tier.legs.length} |`)
  }
  lines.push('')
  if (report.blockedLines && report.blockedLines.length > 0) {
    lines.push('## Blocked details')
    lines.push('')
    for (const line of report.blockedLines) lines.push(`- ${line}`)
    lines.push('')
  }
  lines.push('## Leg details')
  lines.push('')
  for (const tier of report.tiers) {
    lines.push(`### ${tier.tier} (${tier.verdict})`)
    lines.push('')
    for (const leg of tier.legs) {
      const req = leg.required ? 'required' : 'skippable'
      const reason = leg.reason ? ` — ${leg.reason}` : ''
      lines.push(`- [${leg.verdict}] (${req}) ${leg.id} — ${leg.name}${reason}`)
    }
    lines.push('')
  }
  if (report.notes) {
    lines.push('## Notes')
    lines.push('')
    lines.push(report.notes)
    lines.push('')
  }
  lines.push('---')
  lines.push('')
  lines.push('Authoritative aggregate: `report.json`. QC recomputes from the JSON, never from this prose.')
  return lines.join('\n') + '\n'
}

/** Loads a previously written report.json (QC-side recomputation entry). */
function loadReport(repoRoot) {
  const jsonPath = path.join(evidenceDir(repoRoot), 'report.json')
  const raw = fs.readFileSync(jsonPath, 'utf8')
  const parsed = JSON.parse(raw)
  const recomputed = computeReportVerdict({ legs: parsed.legs })
  return { parsed, recomputed }
}

module.exports = {
  evidenceDir,
  buildReport,
  writeReport,
  renderReport,
  loadReport,
}
