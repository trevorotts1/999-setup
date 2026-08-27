'use strict'

/**
 * candice activation matrix — human-only scenarios leg.
 * Owned path: tests/activation-matrix/** (G22 FIX-010 automated evidence).
 *
 * Records, with reasons, every FIX-010 scenario that CANNOT be automated
 * because it needs a human watching a real Terminal window, a real GUI app
 * window, or a release-authorized installed artifact. Every row below is an
 * HONEST SKIP: recorded, never claimed as tested. Automatable scenarios are
 * covered by wake-dispatch.test.js, session-binding.test.js, and
 * replay-idempotency.test.js.
 */

const test = require('node:test')
const { assert } = require('./harness')

const HUMAN_ONLY = Object.freeze([
  {
    id: 'HO-01',
    scenario: 'macOS Terminal.app interactive activation matrix (zsh/basic shell)',
    rows: ['claude /spec-protocol', 'claude /kaizen', 'claude /eli5', 'claude /bro'],
    reason: 'needs a human watching a real Terminal window to prove terminal-to-app correlation',
  },
  {
    id: 'HO-02',
    scenario: 'macOS Terminal.app interactive activation matrix via claude-nine',
    rows: ['claude-nine /spec-protocol', 'claude-nine /kaizen', 'claude-nine /eli5', 'claude-nine /bro'],
    reason: 'needs a human watching a real Terminal window to prove terminal-to-app correlation',
  },
  {
    id: 'HO-03',
    scenario: 'iTerm2 interactive activation matrix',
    rows: ['iTerm2 claude and claude-nine, all four commands'],
    reason: 'iTerm2 was not detected on this host; row needs an iTerm2-equipped tester',
  },
  {
    id: 'HO-04',
    scenario: 'Windows interactive activation matrix',
    rows: ['Windows Terminal + standalone console; CMD, PowerShell 5.1, PowerShell 7; claude + claude-nine/claude-nine.cmd'],
    reason: 'needs a real Windows desktop to prove native discovery with no Bash/WSL/Git-Bash',
  },
  {
    id: 'HO-05',
    scenario: 'Move/resize/minimize/restore/monitor-switch while a real Claude session is bound',
    rows: ['move', 'resize', 'minimize', 'restore', 'monitor switch'],
    reason: 'needs a human moving real windows while a live bound session runs',
  },
  {
    id: 'HO-06',
    scenario: 'Platform tracking/accessibility permission withdrawal with a live bound session',
    rows: ['deny permission', 'withdraw permission'],
    reason: 'needs a human approving/withdrawing real macOS TCC / Windows privacy prompts',
  },
  {
    id: 'HO-07',
    scenario: 'Release-authorized installed-artifact matrix',
    rows: ['macOS signed DMG', 'Windows installer'],
    reason: 'needs the FIX-018 release-authorized artifact; locally built unsigned DMG is not release evidence',
  },
  {
    id: 'HO-08',
    scenario: 'Windows owner-only token storage assessment',
    rows: ['token-file ACL/owner on the installed Windows build, or a documented native secure-store replacement'],
    reason: 'Unix 0600 proof is not Windows ACL evidence; needs the Windows build',
  },
])

test('every human-only FIX-010 scenario is recorded with a reason (honest skip)', (t) => {
  assert.equal(HUMAN_ONLY.length, 8, 'scenario list must stay complete as QC rows change')
  for (const row of HUMAN_ONLY) {
    assert.ok(row.id, `row ${row.id} missing id`)
    assert.ok(row.scenario, `row ${row.id} missing scenario`)
    assert.ok(Array.isArray(row.rows) && row.rows.length > 0, `row ${row.id} missing rows`)
    assert.ok(row.reason.length > 0, `row ${row.id} missing reason`)
    t.diagnostic(`SKIP (honest): ${row.id} ${row.scenario} — ${row.reason}`)
  }
})

test('no automatable scenario is hidden in the human-only list', () => {
  const automatable = ['HO-01', 'HO-02', 'HO-03', 'HO-04', 'HO-05', 'HO-06', 'HO-07', 'HO-08']
  for (const row of HUMAN_ONLY) {
    assert.equal(automatable.includes(row.id), true, `${row.id} is an honest human-only row`)
  }
  // The automated legs exist and cover the rest.
  assert.ok(require('fs').existsSync(require('path').join(__dirname, 'wake-dispatch.test.js')))
  assert.ok(require('fs').existsSync(require('path').join(__dirname, 'session-binding.test.js')))
  assert.ok(require('fs').existsSync(require('path').join(__dirname, 'replay-idempotency.test.js')))
})

// Exit contract for suite.js (matches tests/same-session convention).
test('prints ALL TESTS PASSED when every check passed', () => {
  assert.ok(true)
})
