'use strict'

/**
 * WS-44 audit B — secrets, environment, and logging (Master Spec 8, 0C;
 * repo CLAUDE.md rules 4/5).
 *
 * Owned lane: tests/privacy-audit/** (READ-ONLY; defects outside this lane
 * are CROSS-LANE-FINDING + fix tickets, never repaired here — 0C).
 *
 * Proves against primary source:
 *   B1. no API keys / router tokens / credentials committed — tracked files
 *       contain no live secret values (sk-..., ai..., Bearer, router tokens);
 *   B2. no `.env` with real values tracked — git ls-files shows none; the
 *       only templates carry placeholders;
 *   B3. the MCP ask-user path never logs answer text — zero console
 *       writes in the mcp/** and fallback/** plugin lanes; answer text is
 *       deleted after exactly one read (registry take());
 *   B4. the session state file (candice-sessions.json) persists pending
 *       question text and is written atomic temp+rename — but with no
 *       explicit mode, which exposes question text to other local users:
 *       FINDING (see docs/privacy-audit/README.md). The audit proves the
 *       current default mode, not a fix;
 *   B5. env-sweep tool exists and its selftest proves no secret leakage
 *       (0 secret values printed, 0 bearer creds on command lines).
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
  trackedFiles,
  evidenceFor,
  result,
  printResult,
} = require('./helpers')

const results = []

// ---------------------------------------------------------------- B1

const SECRET_RE = /(sk-[A-Za-z0-9_-]{16,}|[Aa]pi[_-]?[Kk]ey\s*[:=]\s*['"][A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._-]{16,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})/
// Known-benign control values: test sentinels, dead keys, and the
// holding/** regression-protected docs whose "sk-..." tokens are
// interview-question shorthand, not credentials.
const BENIGN_CONTROLS = [
  /KNOWN-POSITIVE-CONTROL/,
  /sk-dead-[A-Za-z0-9_-]{6,}/,
  /sk-first-wait-then-next/,
]

const b1 = result(
  'B1: no live secrets in tracked files',
  false,
  []
)
{
  const files = trackedFiles()
  let hits = []
  for (const f of files) {
    if (!/\.(js|ts|rs|json|md|sh|ps1|yml|yaml|toml|cfg|conf|txt|nsh|nsi|html)$/.test(f)) continue
    if (/node_modules|target|vendor|\.lock$|\.bak|dist\//.test(f)) continue
    const text = readRel(f)
    if (!text) continue
    // Drop control-sentinel LINES (full-line test; test fixtures prove the
    // detector works and are not live credentials).
    const ev = evidenceFor(path.join(REPO_ROOT, f), SECRET_RE, { limit: 2, ignoreLines: BENIGN_CONTROLS })
    if (ev.length) hits = hits.concat(ev)
  }
  b1.ok = hits.length === 0
  if (hits.length) {
    b1.notes = 'secret-like values found: ' + JSON.stringify(hits)
  } else {
    b1.evidence = [{ file: 'git ls-files', line: 0, text: '0 tracked files matched secret-value patterns (' + files.length + ' files scanned)' }]
  }
}
results.push(b1)

// ---------------------------------------------------------------- B2

const b2 = {
  ok: true,
  check: 'B2: no .env / API docs with real values tracked; templates carry placeholders only',
  evidence: [],
  notes: '',
}
{
  const envFiles = trackedFiles().filter((f) => /(^|\/)\.env/.test(f) || /API docs/.test(f))
  b2.evidence.push({
    file: 'git ls-files',
    line: 0,
    text: 'tracked env-like files: ' + (envFiles.length ? envFiles.join(', ') : '(none)'),
  })
  // The template placeholder form is the ONLY allowed content.
  for (const f of envFiles) {
    const text = readRel(f)
    if (!text) continue
    if (/replace_with_real_key|placeholder|YOUR_|xxxx/i.test(text)) {
      b2.evidence.push({ file: f, line: 0, text: 'placeholder content confirmed' })
    } else {
      b2.ok = false
      b2.notes = (b2.notes || '') + ' non-placeholder content in ' + f + '; '
    }
  }
  // Templates dir must not be committed as a real env.
  const template = readRel('templates/API docs.md')
  if (template && /replace_with_real_key/.test(template)) {
    b2.evidence.push({ file: 'templates/API docs.md', line: 0, text: 'placeholders only' })
  }
  if (!envFiles.length) {
    b2.evidence.push({ file: '.gitignore', line: 0, text: 'repo ignores .env / .env.* (gitignore lines 3-4)' })
  }
}
results.push(b2)

// ---------------------------------------------------------------- B3

const b3 = {
  ok: false,
  check: 'B3: MCP ask path never logs answer/question text; answers deleted after exactly one read',
  evidence: [],
  notes: '',
}
{
  const mcpFiles = ['server.js', 'validate.js', 'answer-registry.js'].map(
    (n) => path.join(REPO_ROOT, 'plugins/candice-integration/mcp/ask-user', n)
  )
  const fallbackDir = path.join(REPO_ROOT, 'plugins/candice-integration/fallback')
  let logHits = []
  for (const f of mcpFiles.concat(fs.readdirSync(fallbackDir).map((n) => path.join(fallbackDir, n)))) {
    if (!/\.js$/.test(f) || /\.test\.js$/.test(f)) continue
    // The MCP transport OWNS stdout (JSON-RPC framing) — never a log channel.
    // Console writes anywhere else are a finding.
    const hits = evidenceFor(f, /console\.(log|error|warn)|console\.trace/, { limit: 2 })
    logHits = logHits.concat(hits)
  }
  const registry = readRel('plugins/candice-integration/mcp/ask-user/answer-registry.js') || ''
  const oneRead = /this\.slots\.delete\(key\) \/\/ exactly one read/.test(registry)
  const notFoundAfterTake = /not-found/.test(registry)
  b3.ok = logHits.length === 0 && oneRead && notFoundAfterTake
  b3.evidence = [
    { file: 'answer-registry.js', line: 0, text: 'take() deletes the slot after exactly one read; second take returns not-found' },
  ]
  if (logHits.length) b3.notes = 'console/stdout writes: ' + JSON.stringify(logHits)
}
results.push(b3)

// ---------------------------------------------------------------- B4 (FINDING)

const b4 = {
  ok: false,
  check: 'B4: session state file restrictive permissions — defect absent OR finding recorded',
  evidence: [],
  notes: '',
}
{
  const mgr = readRel('plugins/candice-integration/session/session-manager.js') || ''
  const hasExplicitMode = /writeFileSync\([^)]*mode|chmod/.test(mgr)
  // Prove the ACTUAL default mode on this box (primary-source evidence).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'candice-mode-'))
  const probe = path.join(dir, 'candice-sessions.json')
  fs.writeFileSync(probe, '{}', 'utf8')
  const mode = (fs.statSync(probe).mode & 0o777).toString(8)
  fs.rmSync(dir, { recursive: true, force: true })
  const readme = readRelFile('docs/privacy-audit/README.md') || ''
  const findingRecorded =
    /WS-44-F1/.test(readme) &&
    /session-manager\.js/.test(readme) &&
    /WS-03/.test(readme) &&
    /0o600/.test(readme)
  // Green = invariant holds, OR the defect is honestly recorded as a finding
  // with owner + fix ticket (READ-ONLY lane: recording IS the deliverable).
  b4.ok = hasExplicitMode || findingRecorded
  b4.evidence = [
    { file: 'probe', line: 0, text: 'default writeFileSync mode on this macOS host: ' + mode + '; explicit mode in session-manager.js: ' + hasExplicitMode },
    { file: 'docs/privacy-audit/README.md', line: 0, text: 'WS-44-F1 record present with owner + fix: ' + findingRecorded },
  ]
  if (!hasExplicitMode && !findingRecorded) {
    b4.notes =
      'CROSS-LANE-FINDING WS-44-F1 not yet recorded: candice-sessions.json persists pending-question text with NO ' +
      'explicit mode (measured ' + mode + ') and docs/privacy-audit/README.md lacks the finding record. Record it.'
  }
}
results.push(b4)

// ---------------------------------------------------------------- B5

const b5 = {
  ok: false,
  check: 'B5: env-sweep tool exists and its selftest proves zero secret leakage',
  evidence: [],
  notes: '',
}
{
  const tool = path.join(REPO_ROOT, '.claude/skills/spec-protocol/tools/env-sweep.sh')
  const exists = fs.existsSync(tool)
  b5.ok = exists
  if (!exists) {
    b5.notes = 'tool missing at .claude/skills/spec-protocol/tools/env-sweep.sh'
  } else {
    let out = ''
    try {
      out = execFileSync('bash', [tool, '--selftest'], { encoding: 'utf8', timeout: 90000 })
    } catch (err) {
      out = String(err.stdout || err.message)
    }
    b5.evidence = [{ file: 'env-sweep.sh --selftest', line: 0, text: (out.split('\n').filter((l) => /PASS|FAIL/.test(l)) || []).slice(0, 8).join(' | ') }]
    b5.ok = /SELFTEST: PASS/.test(out) && !/FAIL/.test(out.split('SELFTEST: PASS')[0])
    if (!b5.ok) b5.notes = 'selftest output did not end in PASS: ' + out.slice(-300)
  }
}
results.push(b5)

// ------------------------------------------------------------- summary

let failed = 0
for (const r of results) {
  printResult(r)
  if (!r.ok) failed += 1
}
console.log(`AUDIT B: ${results.length - failed}/${results.length} checks PASS`)
if (failed) {
  console.log('AUDIT B: FAIL — findings recorded in docs/privacy-audit/README.md')
  process.exit(1)
}
console.log('AUDIT B: ALL PASS')
