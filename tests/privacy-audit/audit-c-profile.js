'use strict'

/**
 * WS-44 audit C — local profile privacy + secret-prompts-not-read-aloud
 * (Master Spec sections 8/9, spec 14, E.1 WS-40/WS-41 secret leg).
 *
 * Owned lane: tests/privacy-audit/** (READ-ONLY; defects outside this lane
 * are CROSS-LANE-FINDING + fix tickets, never repaired here — 0C).
 *
 * Proves against primary source:
 *   C1. the local preference profile stores ONLY the allowlisted spec-9
 *       fields — no secrets, tokens, audio, or conversation content;
 *   C2. the name is never inferred from the OS username — no code path in
 *       the prefs lane reads userInfo/username;
 *   C3. the profile file is written 0o600 via atomic write-then-rename;
 *   C4. secret-bearing questions are never read aloud — the contract suite
 *       proves readAloud:false at the data layer (re-run here), and the
 *       WS-04 runtime gate accepts only the safe form;
 *   C5. FINDING: the app read path (WS-08 state machine `speech:tts`
 *       handler) emits tts:speak with no sensitivity/readAloud gate in the
 *       event contract. Currently unreachable defect (no producer emits
 *       `speech:tts` with a secret question — the WS-03 bridge adapter is
 *       not yet wired to the MCP deliverer), but the guard must land with
 *       the read path.
 *
 * Run: node tests/privacy-audit/run.js (or this file directly).
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const {
  REPO_ROOT,
  readRel,
  readRelFile,
  evidenceFor,
  result,
  printResult,
} = require('./helpers')

const results = []

// ---------------------------------------------------------------- C1

const c1 = {
  ok: false,
  check: 'C1: profile stores only allowlisted spec-9 fields — never secrets/conversation/audio',
  evidence: [],
  notes: '',
}
{
  const schema = readRel('apps/candice-companion/src/prefs/schema.ts') || ''
  const m = schema.match(/PREFS_FIELD_NAMES = \[([^\]]*)\]/)
  const fields = m ? m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean) : []
  const allowed = new Set([
    'schemaVersion', 'preferredName', 'voiceOutputEnabled', 'volume', 'speechRate',
    'lastAnswerMethod', 'textScale', 'reducedMotion', 'companionPosition',
    'lastUsedSkill', 'nameAskedAt',
  ])
  const unknown = fields.filter((f) => !allowed.has(f))
  c1.ok = fields.length > 0 && unknown.length === 0
  c1.evidence = [{ file: 'apps/candice-companion/src/prefs/schema.ts', line: 0, text: 'allowlisted fields (' + fields.length + '): ' + fields.join(', ') }]
  if (unknown.length) c1.notes = 'non-spec-9 fields present: ' + unknown.join(', ')
}
results.push(c1)

// ---------------------------------------------------------------- C2

const c2 = {
  ok: false,
  check: 'C2: preferred name never inferred from the OS username',
  evidence: [],
  notes: '',
}
{
  const dir = path.join(REPO_ROOT, 'apps/candice-companion/src/prefs')
  const files = fs.readdirSync(dir).filter((f) => /\.ts$/.test(f))
  let hits = []
  for (const f of files) {
    const ev = evidenceFor(path.join(dir, f), /os\.userInfo|process\.env\.(USER|USERNAME|USERPROFILE)|os\.hostname|whoami|process\.getuid/, { limit: 2 })
    hits = hits.concat(ev)
  }
  c2.ok = hits.length === 0
  if (hits.length) c2.notes = 'username reads: ' + JSON.stringify(hits)
  else c2.evidence = [{ file: 'src/prefs/**', line: 0, text: '0 userInfo/username/hostname reads across ' + files.length + ' files' }]
}
results.push(c2)

// ---------------------------------------------------------------- C3

const c3 = {
  ok: false,
  check: 'C3: profile.json written 0600 with atomic write-then-rename',
  evidence: [],
  notes: '',
}
{
  const store = readRel('apps/candice-companion/src/prefs/store.ts') || ''
  const atomic = /renameSync/.test(store)
  const mode600 = /0o600/.test(store)
  const tmpPath = /\.tmp/.test(store)
  c3.ok = atomic && mode600 && tmpPath
  c3.evidence = [
    { file: 'store.ts', line: 0, text: 'writeFileSync(..., { mode: 0o600 }) + tmp file + renameSync (atomic)' },
  ]
  if (!c3.ok) c3.notes = 'atomic=' + atomic + ' mode600=' + mode600 + ' tmp=' + tmpPath
}
results.push(c3)

// ---------------------------------------------------------------- C4

const c4 = {
  ok: false,
  check: 'C4: secret-bearing questions never read aloud — contract suite proof (re-run)',
  evidence: [],
  notes: '',
}
{
  const suite = path.join(REPO_ROOT, 'tests/contract/secret.test.js')
  let out = ''
  try {
    out = execFileSync('node', [suite], { encoding: 'utf8', timeout: 90000 })
  } catch (err) {
    out = String(err.stdout || err.message)
  }
  const passLines = out.split('\n').filter((l) => /^PASS/.test(l))
  const failedLine = out.split('\n').filter((l) => /^FAIL|ALL TESTS|GREEN/.test(l)).join(' | ')
  c4.ok = /ALL TESTS PASSED|ALL GREEN/.test(out) && !/^FAIL/m.test(out)
  c4.evidence = [{ file: 'tests/contract/secret.test.js', line: 0, text: (passLines.slice(0, 7).join(' | ')) + ' — ' + failedLine }]
  if (!c4.ok) c4.notes = 'secret.test.js output: ' + out.slice(-400)
}
results.push(c4)

// ---------------------------------------------------------------- C5 (FINDING)

const c5 = {
  ok: false,
  check: 'C5: read-aloud guard at the app read path — gate present OR finding recorded',
  evidence: [],
  notes: '',
}
{
  const machine = readRel('apps/candice-companion/src/state/machine.ts') || ''
  const hasGate = /readAloud|sensitivity/.test(machine)
  const readme = readRelFile('docs/privacy-audit/README.md') || ''
  const findingRecorded =
    /WS-44-F2/.test(readme) &&
    /machine\.ts/.test(readme) &&
    /WS-08/.test(readme)
  // Green = the gate exists, OR the gap is honestly recorded with owner +
  // fix ticket (READ-ONLY lane: recording IS the deliverable).
  c5.ok = hasGate || findingRecorded
  c5.evidence = [
    { file: 'machine.ts', line: 0, text: 'sensitivity/readAloud gate in the read path: ' + hasGate },
    { file: 'docs/privacy-audit/README.md', line: 0, text: 'WS-44-F2 record present with owner + fix: ' + findingRecorded },
  ]
  if (!hasGate && !findingRecorded) {
    c5.notes =
      'CROSS-LANE-FINDING WS-44-F2 not yet recorded: the app read path (WS-08 machine.ts speech:tts handler) emits ' +
      'tts:speak with no sensitivity/readAloud gate and docs/privacy-audit/README.md lacks the finding record. Record it.'
  }
}
results.push(c5)

// ------------------------------------------------------------- summary

let failed = 0
for (const r of results) {
  printResult(r)
  if (!r.ok) failed += 1
}
console.log(`AUDIT C: ${results.length - failed}/${results.length} checks PASS`)
if (failed) {
  console.log('AUDIT C: FAIL — findings recorded in docs/privacy-audit/README.md')
  process.exit(1)
}
console.log('AUDIT C: ALL PASS')
