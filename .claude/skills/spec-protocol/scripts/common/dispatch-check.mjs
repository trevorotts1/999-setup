#!/usr/bin/env node
// dispatch-check.mjs — the Node twin of tools/dispatch-check.sh (finding E2; E6 step 2).
//
// Usage:
//   node dispatch-check.mjs <project> <units> <agents> <label> [dep=<reason>] [stages=<n>]
//                           [unit=<work item>] [run=<run id>]
//   node dispatch-check.mjs --selftest
//
// WHY A TWIN. On a Windows box without Git Bash there is no ledger.sh, no
// anchor.sh, and no width check — the skill's own text says every verdict there
// is UNDETERMINED. Node is guaranteed wherever Claude Code runs, so the gate,
// the tick, and the ledger are ported to it (SPEC decision 7, step 2). This file
// must answer with the SAME exit code as the bash tool for the same inputs; the
// selftest below runs the same numbered cases so the two can be compared.
//
// EXIT CODES (identical to tools/dispatch-check.sh)
//   0 PASS · 2 TOOLING FAILURE (undetermined, never a verdict) · 3 UNDER-WIDTH
//   4 REFUSED (bad label, or no "Parallelism Plan" heading) · 5 PADDED

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SELF = path.join(HERE, 'dispatch-check.mjs')
const SKILL_ROOT = path.resolve(HERE, '..', '..')
const LEDGER_SH = path.join(SKILL_ROOT, 'tools', 'ledger.sh')

const DEFAULT_STAGES = 4
const LABEL_RE = /\[[A-Za-z0-9.-]+ x[0-9]+\]/

function tooling(msg) {
  process.stderr.write(`DISPATCH-CHECK UNDETERMINED | tooling | ${msg}\n`)
  process.exit(2)
}
function refuse(msg) {
  process.stderr.write(`DISPATCH-CHECK REFUSED | ${msg}\n`)
  process.exit(4)
}
const isUint = (s) => /^[0-9]+$/.test(String(s))

// --- CLIENT_CAP, read from the Capacity Ledger and nowhere else -------------
export function parseClientCap(text) {
  const direct = text.match(/^[ \t]*CLIENT_CAP[ \t]*=[ \t]*([0-9]+)/m)
  if (direct) {
    const n = Number(direct[1])
    return n >= 1 && n <= 64 ? n : null
  }
  // Bracketed provenance marks carry digits of their own; strip them, then take
  // the LAST "= <n>" on a clientCap line. A line still holding the template
  // placeholder ("= <k>") yields NOTHING — never the 2 inside `max(2, …)`.
  const stripped = text.replace(/\[[^\]]*\]/g, '')
  for (const line of stripped.split('\n')) {
    if (!/clientcap/i.test(line)) continue
    const m = line.match(/=\s*([0-9]+)\s*$/)
    if (m) {
      const n = Number(m[1])
      return n >= 1 && n <= 64 ? n : null
    }
  }
  return null
}

export function hasParallelismPlan(text) {
  return (
    /^[ \t]*#{1,6}[ \t].*Parallelism Plan/m.test(text) ||
    /^[ \t]*(\*\*)?Parallelism Plan/m.test(text)
  )
}

// --- the counter anchor.sh reads for the pause and the ceiling --------------
function bumpState(statePath, delta) {
  const raw = fs.readFileSync(statePath, 'utf8')
  const doc = JSON.parse(raw)
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('state file root is not a JSON object')
  }
  if (doc.agents === null || typeof doc.agents !== 'object' || Array.isArray(doc.agents)) {
    doc.agents = {}
  }
  const cur = doc.agents.executions_total === undefined ? 0 : doc.agents.executions_total
  if (!Number.isInteger(cur)) throw new Error(`agents.executions_total is not an integer: ${JSON.stringify(cur)}`)
  doc.agents.executions_total = cur + delta
  const tmp = `${statePath}.tmp.${process.pid}`
  fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, statePath)
  return doc.agents.executions_total
}

function withLock(target, fn) {
  const dir = `${target}.lock.d`
  const deadline = Date.now() + 20000
  for (;;) {
    try {
      fs.mkdirSync(dir)
      break
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      if (Date.now() > deadline) {
        throw new Error(`could not acquire ${dir} within 20s — inspect its owner file before removing it`)
      }
      let lockStat
      try { lockStat = fs.statSync(dir) } catch { /* holder released it mid-check */ }
      if (lockStat && Date.now() - lockStat.mtimeMs > 60000) {
        // Age alone proves neither that a prior writer is gone nor that this
        // process owns its recovery.  The legacy state format has no stable
        // workflow/AgentTeam identity, so reclaiming this lock would risk a
        // second writer.  Leave it for identity-aware reconciliation.
        throw new Error(`state lock ${dir} is older than 60s but its live owner identity cannot be verified; leave it intact and reconcile before retrying`)
      }
      execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},250)'], { stdio: 'ignore' })
    }
  }
  try {
    fs.writeFileSync(path.join(dir, 'owner'), `pid=${process.pid}\n`, 'utf8')
  } catch { /* the owner note is a courtesy, never the lock itself */ }
  try {
    return fn()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// --- the dispatch-log row ---------------------------------------------------
// Through tools/ledger.sh where a shell can run it (its lock is the one every
// other writer respects); natively, under the same lock discipline, where it
// cannot — a Windows box has no bash, and an unlogged dispatch is worse than a
// second implementation of an append.
function writeRow(project, row) {
  const file = path.join(project, 'CONTROL', 'dispatch-log.md')
  if (process.platform !== 'win32' && fs.existsSync(LEDGER_SH)) {
    const r = spawnSync('bash', [LEDGER_SH, project, 'CONTROL/dispatch-log.md', row], { encoding: 'utf8' })
    if (r.status === 0) return 'ledger.sh'
    if (r.error === undefined && r.status !== null) {
      throw new Error(`ledger.sh failed (rc=${r.status}): ${(r.stderr || '').trim()}`)
    }
    // bash itself did not run (ENOENT): fall through to the native writer.
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  withLock(file, () => {
    const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
    const tmp = `${file}.tmp.${process.pid}`
    fs.writeFileSync(tmp, `${prev}${row}\n`, 'utf8')
    fs.renameSync(tmp, file)
  })
  return 'native'
}

// tools/dispatch-check.sh's derive_phase, reduced to the one question D3 asks:
// is the phase research? phase= wins; otherwise "research" is the first word of
// the bash PHASE_WORDS priority list, so its presence as a word in the label or
// unit (the [<model> xN] bracket stripped) decides it.
export function isResearch(phase, label, unit) {
  if (phase) return phase === 'research'
  const words = `${label} ${unit}`.toLowerCase().replace(/\[[^\]]*\]/g, '').split(/[^a-z]+/)
  return words.includes('research')
}

// ---------------------------------------------------------------------------
export function runCheck(argv) {
  if (argv.length < 4) {
    tooling(`usage: dispatch-check.mjs <project> <units> <agents> <label> [dep=<reason>] [stages=<n>] — got ${argv.length} argument(s)`)
  }
  const [project, unitsRaw, agentsRaw, label] = argv
  let dep = ''
  let stages = process.env.DISPATCH_STAGES || String(DEFAULT_STAGES)
  let unit = ''
  let runId = 'pending'
  let phase = ''
  for (const a of argv.slice(4)) {
    if (a.startsWith('dep=')) dep = a.slice(4)
    else if (a.startsWith('stages=')) stages = a.slice(7)
    else if (a.startsWith('unit=')) unit = a.slice(5)
    else if (a.startsWith('run=')) runId = a.slice(4)
    else if (a.startsWith('phase=')) phase = a.slice(6)
    else tooling(`unrecognised argument '${a}' — the optional arguments are dep=, stages=, unit=, run=, phase=`)
  }
  if (!isUint(unitsRaw)) tooling(`units must be a non-negative integer, got '${unitsRaw}'`)
  if (!isUint(agentsRaw)) tooling(`agents must be a non-negative integer, got '${agentsRaw}'`)
  if (!isUint(stages)) tooling(`stages must be a non-negative integer, got '${stages}'`)
  const units = Number(unitsRaw)
  const agents = Number(agentsRaw)
  const stageN = Number(stages)
  if (units < 1) tooling('units=0 — a dispatch of nothing is not a dispatch')
  if (agents < 1) tooling('agents=0 — a dispatch of nothing is not a dispatch')
  if (stageN < 1) tooling('stages=0 — the padding ceiling would be zero')
  if (!fs.existsSync(project) || !fs.statSync(project).isDirectory()) {
    tooling(`project directory does not exist: ${project}`)
  }

  // A supplied profile binds canonical state and its own packet checker.  This
  // legacy helper must never synthesize CONTROL state beside it: send callers
  // to the adapter (or fail loudly), rather than silently forking counters.
  if (fs.existsSync(path.join(project, '.spec-protocol.json'))) {
    tooling(`profile-owned project: refusing legacy mutation; invoke tools/project-profile.mjs dispatch ${JSON.stringify(project)} with the original arguments`)
  }

  const ledgerMd = path.join(project, 'CAPACITY-LEDGER.md')
  const planMd = path.join(project, 'CONTROL', 'EXECUTION-PLAN.md')
  const stateJson = path.join(project, 'CONTROL', 'project_state.json')

  // The research reader (D3, the bash tool's twin): one agent, phase research
  // (phase= or the phase word in the label/unit), no build label. It fires at
  // step 3.5, before the Capacity Ledger and the Parallelism Plan exist, so
  // neither is required of it; it is still booked, at width 1.
  const reader = agents === 1 && !/build/i.test(label) && isResearch(phase, label, unit)
  let cap
  let capShown
  if (reader && !fs.existsSync(ledgerMd)) {
    cap = 1
    capShown = 'reader-exempt'
    process.stderr.write('DISPATCH-CHECK NOTE | research reader (agents=1, phase=research, no build label) — no Capacity Ledger or Parallelism Plan is required of it; booked at width 1\n')
  } else {
    if (!fs.existsSync(ledgerMd)) {
      tooling(`no Capacity Ledger at ${ledgerMd} — CLIENT_CAP is UNDETERMINED (that file is the only source this gate reads; the environment is never one). Write it at step 6.5 with tools/width.sh.`)
    }
    let ledgerText
    try {
      ledgerText = fs.readFileSync(ledgerMd, 'utf8')
    } catch (e) {
      tooling(`Capacity Ledger is unreadable: ${ledgerMd} (${e.message})`)
    }
    cap = parseClientCap(ledgerText)
    if (cap === null) {
      tooling(`CLIENT_CAP does not parse from ${ledgerMd} — looked for 'CLIENT_CAP=<n>' and for a clientCap line ending in '= <n>'. An unfilled template placeholder is not a number; fill the ledger.`)
    }
    capShown = cap
  }

  let planText = ''
  try {
    planText = fs.readFileSync(planMd, 'utf8')
  } catch { planText = '' }
  if (!reader && !hasParallelismPlan(planText)) {
    refuse(`no 'Parallelism Plan' heading in ${planMd} — no Parallelism Plan, no dispatch (references/execution-architecture.md). Write step 12.7's plan first; it is the document this dispatch has to cite.`)
  }

  if (!LABEL_RE.test(label)) {
    refuse(`label '${label}' does not carry ${LABEL_RE.source} — every dispatch row and every tree name states its seat and its count, e.g. '[Opus x10] build wave-2'. An unlabelled tree is an invisible worker.`)
  }
  const labelN = label.match(/\[[A-Za-z0-9.-]+ x([0-9]+)\]/)
  if (labelN && Number(labelN[1]) !== agents) {
    process.stderr.write(`DISPATCH-CHECK WARNING | label says x${labelN[1]} but agents=${agents} — the tree name will not match what ran\n`)
  }

  const floor = Math.min(units, cap)
  if (agents < floor) {
    if (!dep) {
      process.stderr.write(
        `DISPATCH-CHECK UNDER-WIDTH | units=${units} cap=${cap} floor=${floor} agents=${agents} | ` +
        `pass every dispatchable unit: re-author this dispatch at ${floor} agents, or give the wave dependency that makes it narrower as dep=<reason> (a dependency is a reason; a hunch is not).\n`,
      )
      process.exit(3)
    }
    process.stderr.write(`DISPATCH-CHECK NOTE | narrower than the floor by a stated dependency | floor=${floor} agents=${agents} dep=${dep}\n`)
  }

  const padCeiling = units * stageN
  if (agents > padCeiling) {
    process.stderr.write(
      `DISPATCH-CHECK PADDED | units=${units} stages=${stageN} ceiling=${padCeiling} agents=${agents} | ` +
      'more seats than the work has stages to put them in. Either the unit count is wrong (split the work into real units) or the agent count was inflated to clear the floor.\n',
    )
    process.exit(5)
  }

  let total
  if (fs.existsSync(stateJson)) {
    try {
      total = withLock(stateJson, () => bumpState(stateJson, agents))
    } catch (e) {
      tooling(`could not increment agents.executions_total in ${stateJson}: ${e.message}. Nothing was written; the dispatch is not gated.`)
    }
  } else {
    try {
      fs.mkdirSync(path.dirname(stateJson), { recursive: true })
      const tmp = `${stateJson}.tmp.${process.pid}`
      fs.writeFileSync(tmp, `${JSON.stringify({ schema: 'spec-protocol/project-state@1', run_status: 'RUNNING', agents: { executions_total: agents } }, null, 2)}\n`, 'utf8')
      fs.renameSync(tmp, stateJson)
      total = agents
      process.stderr.write(`DISPATCH-CHECK NOTE | created ${stateJson} — it did not exist; the executions counter starts at this dispatch\n`)
    } catch (e) {
      tooling(`could not create ${stateJson} — the 200-pause counter has nowhere to live (${e.message})`)
    }
  }

  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const workItem = unit || `${units}-units`
  const row = `${ts} | ${workItem} | dispatch | ${label} | run=${runId} | units=${units} | agents=${agents} | cap=${capShown} | floor=${floor} | stages=${stageN} | dep=${dep || 'none'} | executions_total=${total}`
  try {
    writeRow(project, row)
  } catch (e) {
    // Put the counter back: a counter ahead of the log is exactly the drift
    // anchor.sh's budget audit exists to catch.
    try {
      if (fs.existsSync(stateJson)) withLock(stateJson, () => bumpState(stateJson, -agents))
    } catch {
      process.stderr.write(`DISPATCH-CHECK WARNING | could not roll back agents.executions_total (+${agents}) in ${stateJson} — reconcile it by hand against CONTROL/dispatch-log.md\n`)
    }
    tooling(`could not write CONTROL/dispatch-log.md: ${e.message}`)
  }

  process.stdout.write(
    `DISPATCH-CHECK PASS | project=${project} | units=${units} | agents=${agents} | cap=${capShown} | floor=${floor} | ceiling=${padCeiling} | label=${label} | dep=${dep || 'none'} | executions_total=${total}\n`,
  )
  process.exit(0)
}

// ---------------------------------------------------------------------------
// The selftest — the same numbered cases the bash tool runs, so the two can be
// compared exit code for exit code.
// ---------------------------------------------------------------------------
function selftest() {
  let fails = 0
  const report = (n, name, ok, detail) => {
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${String(n).padEnd(2)} ${name.padEnd(28)} ${detail}\n`)
    if (!ok) fails += 1
  }
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-check-mjs-selftest.'))
  const run = (args, cwd) => {
    const r = spawnSync(process.execPath, [SELF, ...args], { encoding: 'utf8', cwd: cwd || T })
    return { rc: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }
  }
  const P = path.join(T, 'proj')
  fs.mkdirSync(path.join(P, 'CONTROL'), { recursive: true })
  fs.writeFileSync(path.join(P, 'CAPACITY-LEDGER.md'), 'CLIENT_CAP=10\nBROWSER_CAP=12\nWORKFLOW_CEILING=50\n')
  fs.writeFileSync(path.join(P, 'CONTROL', 'EXECUTION-PLAN.md'), '# Execution plan\n\n## Parallelism Plan\n\nwave 2: 10 units, one tree.\n')
  fs.writeFileSync(path.join(P, 'CONTROL', 'project_state.json'), '{\n  "schema": "spec-protocol/project-state@1",\n  "agents": { "executions_total": 0 }\n}\n')
  const total = () => JSON.parse(fs.readFileSync(path.join(P, 'CONTROL', 'project_state.json'), 'utf8')).agents.executions_total

  // 0 — the parser's known-positive control, on both accepted shapes
  const capA = parseClientCap('CLIENT_CAP=10\n')
  const capB = parseClientCap('clientCap = max(2, min(harness_cap, ram_cap)) = 10   [MEASURED sysctl-hw.ncpu 2026-09-07T00:00:00Z]\n')
  const capC = parseClientCap('clientCap = max(2, min(harness_cap, ram_cap)) = <k>   [MEASURED <i> <t>]\n')
  report(0, 'cap-parser-controls', capA === 10 && capB === 10 && capC === null,
    `CLIENT_CAP=10 -> ${capA}; the measured template line -> ${capB}; the unfilled placeholder -> ${capC} (want 10, 10, null)`)

  let r = run([P, '10', '10', '[Opus x10] build wave-2'])
  report(1, 'at-cap-passes', r.rc === 0 && total() === 10, `rc=${r.rc} (want 0); executions_total 0 → ${total()} (want 10)`)

  r = run([P, '10', '3', '[Opus x3] build wave-2'])
  report(2, 'under-width-refused', r.rc === 3 && /UNDER-WIDTH/.test(r.out), `rc=${r.rc} (want 3)`)
  report(3, 'refusal-does-not-count', total() === 10, `executions_total still ${total()} (want 10)`)

  r = run([P, '4', '40', '[Opus x40] build wave-2'])
  report(4, 'padding-refused', r.rc === 5 && /PADDED/.test(r.out), `rc=${r.rc} (want 5; ceiling = 4 × 4 = 16)`)

  r = run([P, '10', '3', '[Opus x3] build wave-2', 'dep=WI-04 must land before the other 7 units unblock'])
  report(5, 'dep-reason-allows', r.rc === 0 && total() === 13, `rc=${r.rc} (want 0); executions_total 10 → ${total()} (want 13)`)

  const rows = fs.readFileSync(path.join(P, 'CONTROL', 'dispatch-log.md'), 'utf8')
    .split('\n').filter((l) => /^\s*(- )?\d{4}-\d{2}-\d{2}[^|]*\|[^|]*\|/.test(l)).length
  report(6, 'rows-are-censusable', rows === 2, `anchor.sh's dispatch-census regex counts ${rows} rows (want 2)`)

  r = run([P, '10', '10', 'Opus x10 build wave-2'])
  report(7, 'bad-label-refused', r.rc === 4, `rc=${r.rc} (want 4)`)

  const P2 = path.join(T, 'proj-noplan')
  fs.mkdirSync(path.join(P2, 'CONTROL'), { recursive: true })
  fs.writeFileSync(path.join(P2, 'CAPACITY-LEDGER.md'), 'CLIENT_CAP=10\n')
  fs.writeFileSync(path.join(P2, 'CONTROL', 'EXECUTION-PLAN.md'), '# Execution plan\n\nno plan section here.\n')
  r = run([P2, '10', '10', '[Opus x10] build wave-2'])
  report(8, 'no-plan-refused', r.rc === 4, `rc=${r.rc} (want 4)`)

  const P3 = path.join(T, 'proj-realledger')
  fs.mkdirSync(path.join(P3, 'CONTROL'), { recursive: true })
  fs.writeFileSync(path.join(P3, 'CAPACITY-LEDGER.md'),
    '# CAPACITY LEDGER — fixture\nCores: 12 · RAM: 24 GB\nclientCap = max(2, min(harness_cap, ram_cap)) = 10   [MEASURED sysctl-hw.ncpu 2026-09-07T00:00:00Z]\n')
  fs.writeFileSync(path.join(P3, 'CONTROL', 'EXECUTION-PLAN.md'), '## Parallelism Plan\n\nwave 1.\n')
  r = run([P3, '10', '9', '[Opus x9] build wave-1'])
  report(9, 'template-line-parses', r.rc === 3, `rc=${r.rc} (want 3 — cap 10, floor 10 > 9; a mis-parse to 2 would have exited 0)`)
  report(10, 'no-state-on-refusal', !fs.existsSync(path.join(P3, 'CONTROL', 'project_state.json')),
    'a refused dispatch created no project_state.json')

  const P4 = path.join(T, 'proj-placeholder')
  fs.mkdirSync(path.join(P4, 'CONTROL'), { recursive: true })
  fs.writeFileSync(path.join(P4, 'CAPACITY-LEDGER.md'), 'clientCap = max(2, min(harness_cap, ram_cap)) = <k>   [MEASURED <i> <t>]\n')
  fs.writeFileSync(path.join(P4, 'CONTROL', 'EXECUTION-PLAN.md'), '## Parallelism Plan\n')
  r = run([P4, '10', '10', '[Opus x10] build wave-2'])
  report(11, 'placeholder-undetermined', r.rc === 2 && /CLIENT_CAP does not parse/.test(r.out),
    `rc=${r.rc} (want 2, NOT a cap of 2 read out of max(2, …))`)

  const P5 = path.join(T, 'proj-noledger')
  fs.mkdirSync(path.join(P5, 'CONTROL'), { recursive: true })
  fs.writeFileSync(path.join(P5, 'CONTROL', 'EXECUTION-PLAN.md'), '## Parallelism Plan\n')
  r = run([P5, '10', '10', '[Opus x10] build wave-2'])
  report(12, 'missing-ledger-named', r.rc === 2 && r.out.includes(path.join(P5, 'CAPACITY-LEDGER.md')),
    `rc=${r.rc} (want 2) and the message names the exact path it read`)

  r = run([path.join(T, 'does-not-exist'), '10', '10', '[Opus x10] x'])
  report(13, 'missing-project-named', r.rc === 2, `rc=${r.rc} (want 2)`)

  const P6 = path.join(T, 'profile-owned')
  fs.mkdirSync(P6, { recursive: true })
  fs.writeFileSync(path.join(P6, '.spec-protocol.json'), '{"schema":"spec-protocol.project-profile/v1"}\n')
  r = run([P6, '1', '1', '[Opus x1] profile task'])
  report(14, 'profile-refuses-legacy-mutation', r.rc === 2 && /profile-owned project/.test(r.out),
    `rc=${r.rc} (want 2; legacy helper must not create CONTROL state)`)

  process.stdout.write('\n')
  if (fails === 0) {
    process.stdout.write('dispatch-check.mjs selftest: ALL PASS (15 checks)\n')
    return 0
  }
  process.stdout.write(`dispatch-check.mjs selftest: ${fails} FAILED — this gate is a BROKEN INSTRUMENT; do the width arithmetic by hand and say so in the ledger\n`)
  return 1
}

const ARGV = process.argv.slice(2)
if (ARGV[0] === '--selftest') process.exit(selftest())
else if (ARGV[0] === '--help' || ARGV[0] === '-h' || ARGV.length === 0) {
  process.stdout.write(fs.readFileSync(SELF, 'utf8').split('\n').slice(1, 11).join('\n') + '\n')
  process.exit(ARGV.length === 0 ? 2 : 0)
} else runCheck(ARGV)
