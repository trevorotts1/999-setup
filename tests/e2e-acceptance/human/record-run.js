'use strict'

/**
 * FIX-019 human/hardware record-run — turns filled trace templates into the
 * HUMAN_HARDWARE tier report. Owned path: tests/e2e-acceptance/human/**.
 *
 *   node tests/e2e-acceptance/human/record-run.js \
 *     --runs <filled-default-claude.json> <filled-default-claude-nine.json> \
 *     <filled-advanced-claude.json> <filled-advanced-claude-nine.json> \
 *     [--skips live-mic-voice,windows-interactive-smoke]
 *
 * Reads each filled trace-template.json copy (see human/trace-template.json),
 * validates every frame against the event-trace contract — twelve eventKind
 * values, questionKey from the active question inventory only, inputMode
 * voice|typed|terminal, no extra fields (keys and codes only, FIX-017
 * boundary) — and writes evidence/FIX-019/builder/human-report.json (+
 * HUMAN-REPORT.md) with tierScope HUMAN_HARDWARE.
 *
 * Exit code is mechanical, never prose:
 *   0 = every required human leg PASS
 *   1 = any required leg FAIL
 *   2 = BLOCKED (no runs supplied, or a required leg recorded SKIPPED)
 */

const fs = require('fs')
const path = require('path')
const { leg, SKIPPABLE_LEGS } = require('../tiers')
const reportModule = require('../report')
const { EVENT_KINDS } = require('../packaged/packaged-driver')

const REPO_ROOT = path.join(__dirname, '..', '..', '..')
const INVENTORY = JSON.parse(fs.readFileSync(
  path.join(REPO_ROOT, 'packages', 'candice-protocol', 'schemas', 'question-inventory.json'), 'utf8'))

const ACTIVE_KEYS = new Set(
  INVENTORY.records.filter((r) => r.status === 'active').map((r) => r.key)
)
const RETIRED_KEYS = new Set(
  INVENTORY.records.filter((r) => r.status !== 'active').map((r) => r.key)
)

const RUN_LEG_IDS = [
  'default-mode-claude', 'default-mode-claude-nine',
  'advanced-mode-claude', 'advanced-mode-claude-nine',
]
const CROSS_RUN_LEG_IDS = [
  'clarification-loop', 'ceiling-count', 'input-mode-per-question', 'final-write-through',
]
const FRAME_FIELDS = ['runId', 'launcher', 'sessionId', 'questionKey', 'inputMode', 'eventKind', 'ts']
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

function argList(name) {
  const ix = process.argv.indexOf(name)
  if (ix < 0) return []
  const out = []
  for (let i = ix + 1; i < process.argv.length; i += 1) {
    if (process.argv[i].startsWith('--')) break
    out.push(process.argv[i])
  }
  return out
}

function validateTemplate(t, file) {
  const problems = []
  if (!t || typeof t !== 'object') return [`${file}: not an object`]
  if (typeof t.runId !== 'string' || t.runId.length === 0) problems.push(`${file}: runId missing`)
  if (!['claude', 'claude-nine'].includes(t.launcher)) problems.push(`${file}: launcher must be claude or claude-nine`)
  if (!['default', 'advanced'].includes(t.mode)) problems.push(`${file}: mode must be default or advanced`)
  if (typeof t.sessionId !== 'string' || t.sessionId.length === 0) problems.push(`${file}: sessionId missing`)
  if (!Array.isArray(t.frames) || t.frames.length === 0) {
    problems.push(`${file}: frames array missing or empty`)
  } else {
    for (const [ix, f] of t.frames.entries()) {
      if (!f || typeof f !== 'object') {
        problems.push(`${file}: frame ${ix} not an object`); continue
      }
      for (const key of Object.keys(f)) {
        if (!FRAME_FIELDS.includes(key)) problems.push(`${file}: frame ${ix} carries forbidden field "${key}" (keys and codes only)`)
      }
      if (!EVENT_KINDS.includes(f.eventKind)) {
        problems.push(`${file}: frame ${ix} eventKind ${JSON.stringify(f.eventKind)} not in the twelve-value vocabulary`)
      }
      if (f.questionKey !== null && typeof f.questionKey !== 'string') {
        problems.push(`${file}: frame ${ix} questionKey must be a string or null`)
      } else if (f.questionKey !== null && RETIRED_KEYS.has(f.questionKey)) {
        problems.push(`${file}: frame ${ix} uses retired questionKey ${f.questionKey}`)
      } else if (f.questionKey !== null && !ACTIVE_KEYS.has(f.questionKey)) {
        problems.push(`${file}: frame ${ix} questionKey ${f.questionKey} not in the active question inventory`)
      }
      if (f.inputMode !== null && !['voice', 'typed', 'terminal'].includes(f.inputMode)) {
        problems.push(`${file}: frame ${ix} inputMode ${JSON.stringify(f.inputMode)} invalid`)
      }
      if (typeof f.ts !== 'string' || !ISO_RE.test(f.ts)) problems.push(`${file}: frame ${ix} ts not ISO-8601`)
    }
  }
  if (!Array.isArray(t.countedSequence)) problems.push(`${file}: countedSequence must be an array`)
  else {
    for (const [ix, k] of t.countedSequence.entries()) {
      if (RETIRED_KEYS.has(k)) problems.push(`${file}: countedSequence ${ix} uses retired key ${k}`)
      else if (!ACTIVE_KEYS.has(k)) problems.push(`${file}: countedSequence ${ix} key ${k} not in the active inventory`)
    }
  }
  const wt = t.finalWriteThrough
  if (!wt || typeof wt !== 'object') problems.push(`${file}: finalWriteThrough missing`)
  else {
    if (typeof wt.documentPath !== 'string' || wt.documentPath.length === 0) problems.push(`${file}: finalWriteThrough.documentPath missing`)
    if (wt.verified !== true) problems.push(`${file}: finalWriteThrough.verified not true (read the files first)`)
  }
  return problems
}

function main() {
  const runFiles = argList('--runs')
  const skips = argList('--skips').join(',').split(',').filter((s) => s.length > 0)

  const legs = []
  const runChecks = new Map() // `${mode}-${launcher}` -> {problems, template}

  for (const file of runFiles) {
    let t = null
    try {
      t = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (err) {
      legs.push(leg({
        id: `unreadable-${path.basename(file).replace(/[^a-z0-9-]/gi, '')}`,
        tier: 'HUMAN_HARDWARE',
        name: `human/hardware: unreadable run file ${file}`,
        verdict: 'FAIL',
        reason: `cannot read run file: ${err.message}`,
      }))
      continue
    }
    const problems = validateTemplate(t, file)
    const key = `${t && t.mode}-mode-${t && t.launcher}`
    runChecks.set(key, { problems, template: t, file })
    legs.push(leg({
      id: key,
      tier: 'HUMAN_HARDWARE',
      name: `human/hardware: ${key} interview`,
      verdict: problems.length === 0 ? 'PASS' : 'FAIL',
      reason: problems.length === 0 ? undefined : problems.join('; '),
    }))
  }

  // Every required run leg must exist; a missing run is a required skip.
  for (const id of RUN_LEG_IDS) {
    if (!runChecks.has(id)) {
      legs.push(leg({
        id,
        tier: 'HUMAN_HARDWARE',
        name: `human/hardware: ${id} interview`,
        verdict: 'SKIPPED',
        reason: `no filled trace template supplied for ${id}`,
      }))
    }
  }

  const runs = [...runChecks.values()].filter((r) => r.problems.length === 0)

  // Cross-run legs operate on validated runs only (D2): a run whose template
  // failed validation is already recorded as its own FAIL leg and must not
  // contribute frames — or crash the loops on a missing frames array. With
  // zero validated runs there is no interview evidence at all: the leg is
  // BLOCKED, never a vacuous PASS (D1).
  const NO_EVIDENCE = 'no interview runs supplied — no evidence for cross-run checks'
  function crossRunLeg(id, name, check) {
    if (runs.length === 0) {
      return leg({ id, tier: 'HUMAN_HARDWARE', name, verdict: 'BLOCKED', reason: NO_EVIDENCE })
    }
    for (const r of runs) {
      if (!Array.isArray(r.template.frames) || r.template.frames.length === 0) {
        return leg({
          id, tier: 'HUMAN_HARDWARE', name, verdict: 'BLOCKED',
          reason: `run ${r.template.mode}-mode-${r.template.launcher} carries no frames array — no evidence for ${id}`,
        })
      }
    }
    const problems = check(runs)
    return leg({
      id, tier: 'HUMAN_HARDWARE', name,
      verdict: problems.length === 0 ? 'PASS' : 'FAIL',
      reason: problems.length === 0 ? undefined : problems.join('; '),
    })
  }

  // clarification-loop: every supplied valid run carries clarification-asked
  // AND clarification-returned frames (spec 15 round trip).
  legs.push(crossRunLeg(
    'clarification-loop',
    'human/hardware: clarification round trip returns to the pending governed question (spec 15)',
    (rs) => {
      const missing = []
      for (const r of rs) {
        const kinds = new Set(r.template.frames.map((f) => f.eventKind))
        if (!kinds.has('clarification-asked') || !kinds.has('clarification-returned')) {
          missing.push(`${r.template.mode}-${r.template.launcher}`)
        }
      }
      return missing.length === 0 ? [] : [`clarification frames missing in: ${missing.join(', ')}`]
    }
  ))

  // ceiling-count: mode question first (BUILD_TARGET), DEFAULT MODE wall of
  // nine, ADVANCED MODE wall of the target table row (Website = 32 — the
  // runbook pins the Website brief). QC replays the full sequence against
  // the interview.md oracle; this leg checks the two mechanical walls.
  legs.push(crossRunLeg(
    'ceiling-count',
    'human/hardware: counted sequence respects the mode wall and R1-first order',
    (rs) => {
      const problems = []
      for (const r of rs) {
        const seq = r.template.countedSequence
        const label = `${r.template.mode}-mode-${r.template.launcher}`
        if (seq.length === 0) { problems.push(`${label}: countedSequence empty`); continue }
        if (seq[0] !== 'BUILD_TARGET') problems.push(`${label}: first counted question is ${seq[0]}, expected BUILD_TARGET (mode question first, R1)`)
        if (r.template.mode === 'default' && seq.length > 9) {
          problems.push(`${label}: DEFAULT MODE counted ${seq.length} questions — crosses the R6 wall of nine`)
        }
        if (r.template.mode === 'advanced' && seq.length > 32) {
          problems.push(`${label}: ADVANCED MODE counted ${seq.length} questions — crosses the Website row (32)`)
        }
      }
      return problems
    }
  ))

  // input-mode-per-question: every answer-submitted frame carries exactly
  // one of voice|typed, and no question records two input modes.
  legs.push(crossRunLeg(
    'input-mode-per-question',
    'human/hardware: one input mode per question, recorded per answer',
    (rs) => {
      const problems = []
      for (const r of rs) {
        const label = `${r.template.mode}-mode-${r.template.launcher}`
        const answered = r.template.frames.filter((f) => f.eventKind === 'answer-submitted')
        for (const f of answered) {
          if (!['voice', 'typed'].includes(f.inputMode)) {
            problems.push(`${label}: answer-submitted frame with inputMode ${JSON.stringify(f.inputMode)}`)
          }
        }
        const byKey = new Map()
        for (const f of answered) {
          if (!byKey.has(f.questionKey)) byKey.set(f.questionKey, new Set())
          byKey.get(f.questionKey).add(f.inputMode)
        }
        for (const [k, modes] of byKey) {
          if (modes.size > 1) problems.push(`${label}: question ${k} answered in multiple input modes`)
        }
      }
      return problems
    }
  ))

  // final-write-through: every supplied valid run verified its documents.
  legs.push(crossRunLeg(
    'final-write-through',
    'human/hardware: final write-through document exists and was verified',
    (rs) => {
      const problems = []
      for (const r of rs) {
        const wt = r.template.finalWriteThrough
        const label = `${r.template.mode}-mode-${r.template.launcher}`
        if (wt.verified !== true) problems.push(`${label}: write-through not verified`)
        if (typeof wt.documentPath !== 'string' || wt.documentPath.length === 0) {
          problems.push(`${label}: documentPath missing`)
        } else if (!fs.existsSync(wt.documentPath)) {
          problems.push(`${label}: documentPath does not exist: ${wt.documentPath}`)
        }
      }
      return problems
    }
  ))

  // Sanctioned skips only. Any other skip name is an unknown leg — never
  // silently accepted.
  for (const name of skips) {
    const key = `HUMAN_HARDWARE/${name}`
    if (!Object.prototype.hasOwnProperty.call(SKIPPABLE_LEGS, key)) {
      legs.push(leg({
        id: `unknown-skip-${name.replace(/[^a-z0-9-]/gi, '')}`,
        tier: 'HUMAN_HARDWARE',
        name: `human/hardware: unknown skip ${name}`,
        verdict: 'FAIL',
        reason: `skip name ${name} has no sanctioned reason in SKIPPABLE_LEGS`,
      }))
      continue
    }
    legs.push(leg({
      id: name,
      tier: 'HUMAN_HARDWARE',
      name: `human/hardware: ${name}`,
      verdict: 'SKIPPED',
      reason: SKIPPABLE_LEGS[key],
    }))
  }

  const report = reportModule.writeReport({
    repo: '999-setup-audit',
    commitSha: 'human-run-record',
    runId: `human-${Date.now()}`,
    launcher: 'node tests/e2e-acceptance/human/record-run.js',
    tierScope: 'HUMAN_HARDWARE',
    legs,
    notes: `Human runs supplied: ${runs.length} valid of ${runFiles.length} supplied. Required run legs: ${RUN_LEG_IDS.join(', ')}. QC replays countedSequence against interview.md ceiling arithmetic.`,
  }, REPO_ROOT, { jsonName: 'human-report.json', mdName: 'HUMAN-REPORT.md' })

  console.log(`HUMAN VERDICT: ${report.report.verdict}`)
  for (const line of report.report.blockedLines) console.log(line)
  if (report.report.verdict === 'FAIL') process.exit(1)
  if (report.report.verdict === 'BLOCKED') process.exit(2)
  console.log('HUMAN SUITE ALL GREEN')
  process.exit(0)
}

main()
