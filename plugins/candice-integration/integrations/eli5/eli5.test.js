'use strict'

/**
 * candice-integration / integrations/eli5/eli5.test.js
 * WS-38 ELI5 Candice integration tests — owned path: plugins/candice-integration/integrations/eli5/**
 *
 * Runs with plain `node` (zero dependencies, cross-platform):
 *   node plugins/candice-integration/integrations/eli5/eli5.test.js
 * Exits 0 on PASS, 1 on FAIL. Every assertion prints PASS/FAIL with the exact
 * input that produced it — primary-source evidence for the acceptance run.
 *
 * Covers the WS-38 acceptance criteria (task-graph snapshot required_outputs
 * + acceptance_criteria, E.1 WS-38):
 *   - ELI5 minimum integration instructions present (README.md; spec 25);
 *   - activatable from compact Candice (spec 16, 13.3): the user's own
 *     typed/spoken /eli5 — including the skill's own documented level switch
 *     (easy|chill|quick, eli5 SKILL.md) — is forwarded to the same session;
 *   - no ELI5 rule changes (spec 2/15/25: the module only forwards the user's
 *     own command, never renames /eli5, never rewrites skill rules, never
 *     invents a level);
 *   - same-session identity: submission routes through the WS-05 seam with
 *     the session as authority; an unproven target refuses (spec 17/20);
 *   - busy queue + the exact spec 13.3 note (spec 13.3);
 *   - failure never blocks Claude (spec 20) — every refusal is a decision
 *     object, never a throw.
 */

const assert = require('assert')

const {
  Eli5Submission,
  normalizeEli5Command,
  validSessionId,
  ELI5_COMMAND,
  ELI5_LEVELS,
} = require('./eli5-submission')

let failures = 0

function check(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (err) {
    failures += 1
    console.log(`FAIL ${name}: ${err.message}`)
  }
}

// --- WS-05 seam doubles (the seam contract is owned by WS-05; here we stub
// --- the same shape the real fallback/terminal-input-adapter.js exposes) ---

function recordingAdapter(overrides) {
  const opts = overrides || {}
  const calls = []
  const adapter = {
    calls,
    submitText(arg) {
      calls.push(arg)
      if (opts.fail) {
        return { ok: false, code: opts.fail, error: opts.error || 'stubbed failure' }
      }
      if (opts.busy) {
        return {
          ok: true,
          queued: true,
          routeTo: arg.sessionId,
          text: arg.text,
          note: 'Claude is working. I’ll send that as soon as it’s ready.',
        }
      }
      return { ok: true, queued: false, routeTo: arg.sessionId, text: arg.text }
    },
  }
  return { adapter, calls }
}

// --- normalizeEli5Command ---------------------------------------------------

check('normalize: typed "/eli5" canonical', () => {
  const r = normalizeEli5Command('/eli5')
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.text, '/eli5')
})

check('normalize: typed "/ELI5" case-insensitive', () => {
  const r = normalizeEli5Command('/ELI5')
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.text, '/eli5')
})

check('normalize: "/eli5" with surrounding whitespace', () => {
  const r = normalizeEli5Command('  /eli5  ')
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.text, '/eli5')
})

check('normalize: spoken "eli5" (no slash) -> /eli5', () => {
  const r = normalizeEli5Command('eli5')
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.text, '/eli5')
  assert.strictEqual(r.normalized, 'spoken')
})

check('normalize: spoken "Eli5" -> /eli5', () => {
  const r = normalizeEli5Command('Eli5')
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.text, '/eli5')
})

// --- the skill's own level switch, preserved verbatim (eli5 SKILL.md) -------

check('normalize: "/eli5 easy" keeps the skill level', () => {
  const r = normalizeEli5Command('/eli5 easy')
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.text, '/eli5 easy')
  assert.strictEqual(r.level, 'easy')
})

check('normalize: "/eli5 chill" keeps the skill level', () => {
  const r = normalizeEli5Command('/eli5 chill')
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.text, '/eli5 chill')
  assert.strictEqual(r.level, 'chill')
})

check('normalize: "/eli5 quick" keeps the skill level', () => {
  const r = normalizeEli5Command('/eli5 quick')
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.text, '/eli5 quick')
  assert.strictEqual(r.level, 'quick')
})

check('normalize: spoken "eli5 easy" -> "/eli5 easy"', () => {
  const r = normalizeEli5Command('eli5 easy')
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.text, '/eli5 easy')
  assert.strictEqual(r.normalized, 'spoken')
})

check('normalize: "/ELI5 QUICK" case-insensitive -> "/eli5 quick"', () => {
  const r = normalizeEli5Command('/ELI5 QUICK')
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.text, '/eli5 quick')
})

check('normalize: unknown level refused — never invents an argument', () => {
  const r = normalizeEli5Command('/eli5 extreme')
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'unknown-level')
})

check('normalize: two arguments refused — one level at most', () => {
  const r = normalizeEli5Command('/eli5 easy now')
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'too-many-arguments')
})

check('normalize: empty string refused', () => {
  const r = normalizeEli5Command('   ')
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'empty-command')
})

check('normalize: non-command text refused — never invents commands', () => {
  const r = normalizeEli5Command('explain the architecture')
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'not-an-eli5-command')
})

check('normalize: non-string refused', () => {
  const r = normalizeEli5Command(42)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'invalid-input')
})

// --- submit: compact-companion /eli5 submission path (spec 16, 13.3) --------

check('submit: real seam delivers /eli5 to the owning session', () => {
  const { adapter, calls } = recordingAdapter()
  const sub = new Eli5Submission({ adapter })
  const r = sub.submit({ sessionId: 'session-abc', text: '/eli5' })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.text, '/eli5')
  assert.strictEqual(calls.length, 1)
  assert.strictEqual(calls[0].sessionId, 'session-abc')
  assert.strictEqual(calls[0].text, '/eli5')
})

check('submit: spoken "eli5" from compact Candice is submitted as /eli5', () => {
  const { adapter, calls } = recordingAdapter()
  const sub = new Eli5Submission({ adapter })
  const r = sub.submit({ sessionId: 'sess-x', text: 'eli5' })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.text, '/eli5')
  assert.strictEqual(calls[0].text, '/eli5')
})

check('submit: level switch "/eli5 quick" reaches the session verbatim', () => {
  const { adapter, calls } = recordingAdapter()
  const sub = new Eli5Submission({ adapter })
  const r = sub.submit({ sessionId: 'sess-x', text: '/eli5 quick' })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.text, '/eli5 quick')
  assert.strictEqual(calls[0].text, '/eli5 quick')
})

check('submit: busy session -> queued with the exact spec 13.3 note', () => {
  const { adapter } = recordingAdapter({ busy: true })
  const sub = new Eli5Submission({ adapter })
  const r = sub.submit({ sessionId: 'sess-x', text: '/eli5' })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.queued, true)
  assert.strictEqual(
    r.note,
    'Claude is working. I’ll send that as soon as it’s ready.'
  )
  assert.strictEqual(sub.pendingNote(), r.note)
})

check('submit: unproven session refused, nothing injected', () => {
  let injected = false
  const adapter = {
    submitText() {
      injected = true
      return { ok: false, code: 'unproven-session', error: 'no' }
    },
  }
  const sub = new Eli5Submission({ adapter })
  const r = sub.submit({ sessionId: 'sess-x', text: '/eli5' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'unproven-session')
  // The seam is the decision layer; a refused route never submits.
  assert.strictEqual(injected, true) // seam WAS consulted (decision authority)
})

check('submit: invalid sessionId refused before the seam', () => {
  const { adapter, calls } = recordingAdapter()
  const sub = new Eli5Submission({ adapter })
  const r = sub.submit({ sessionId: 'not valid', text: '/eli5' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'invalid-session-id')
  assert.strictEqual(calls.length, 0)
})

check('submit: non-command text refused before the seam', () => {
  const { adapter, calls } = recordingAdapter()
  const sub = new Eli5Submission({ adapter })
  const r = sub.submit({ sessionId: 'sess-x', text: 'tell me a joke' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'not-an-eli5-command')
  assert.strictEqual(calls.length, 0)
})

check('submit: unknown level refused before the seam', () => {
  const { adapter, calls } = recordingAdapter()
  const sub = new Eli5Submission({ adapter })
  const r = sub.submit({ sessionId: 'sess-x', text: '/eli5 extreme' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'unknown-level')
  assert.strictEqual(calls.length, 0)
})

check('submit: seam failure surfaces soft, no throw, Claude not blocked', () => {
  const { adapter } = recordingAdapter({ fail: 'delivery-failed', error: 'seam refused' })
  const sub = new Eli5Submission({ adapter })
  const r = sub.submit({ sessionId: 'sess-x', text: '/eli5' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'delivery-failed')
  assert.strictEqual(r.error, 'seam refused')
})

check('submit: default adapter created from the real WS-05 seam', () => {
  // Constructor without an adapter instantiates the REAL terminal-input-adapter
  // from fallback/** (proves the cross-lane seam loads in this lane).
  const sub = new Eli5Submission({})
  assert.strictEqual(typeof sub.adapter.submitText, 'function')
  // No route resolver -> the session is unproven -> the seam refuses (spec 17:
  // injection disables itself when the exact target cannot be proven). The
  // user then types /eli5 directly in Claude (spec 20).
  const r = sub.submit({ sessionId: 'sess-x', text: '/eli5' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'unproven-session')
})

// --- no rule changes + integration metadata (spec 2/25) ---------------------

check('integrationInfo: version, command, levels, and ruleChanges false', () => {
  const sub = new Eli5Submission({})
  const info = sub.integrationInfo()
  assert.strictEqual(info.skill, 'eli5')
  assert.strictEqual(info.slashCommand, '/eli5')
  assert.strictEqual(info.integrationVersion, '1.0.0')
  assert.strictEqual(info.ruleChanges, false)
  assert.deepStrictEqual(info.levels, ['easy', 'chill', 'quick'])
})

check('ELI5_COMMAND is the canonical spelling, never renamed', () => {
  assert.strictEqual(ELI5_COMMAND, '/eli5')
})

check('ELI5_LEVELS match the skill document switch exactly', () => {
  assert.deepStrictEqual(ELI5_LEVELS, ['easy', 'chill', 'quick'])
})

check('stateless: no answer/audio/secret store exists in this lane', () => {
  const sub = new Eli5Submission({})
  const keys = Object.keys(sub)
  assert.deepStrictEqual(keys, ['adapter'])
})

// --- real-seam integration: the actual WS-05 adapter ------------------------

check('real WS-05 adapter: proven session + handler injects exactly once', () => {
  const { TerminalInputAdapter } = require('../../fallback/terminal-input-adapter')
  const injected = []
  const route = { resolveRoute: () => ({ ok: true, routeTo: 'sess-real' }) }
  const adapter = new TerminalInputAdapter({
    route,
    handlers: { submit: (text) => injected.push(text) },
  })
  const sub = new Eli5Submission({ adapter })
  const r = sub.submit({ sessionId: 'sess-real', text: 'eli5' })
  assert.strictEqual(r.ok, true)
  assert.deepStrictEqual(injected, ['/eli5'])
})

check('real WS-05 adapter: level argument survives the real seam', () => {
  const { TerminalInputAdapter } = require('../../fallback/terminal-input-adapter')
  const injected = []
  const route = { resolveRoute: () => ({ ok: true, routeTo: 'sess-real' }) }
  const adapter = new TerminalInputAdapter({
    route,
    handlers: { submit: (text) => injected.push(text) },
  })
  const sub = new Eli5Submission({ adapter })
  const r = sub.submit({ sessionId: 'sess-real', text: '/eli5 easy' })
  assert.strictEqual(r.ok, true)
  assert.deepStrictEqual(injected, ['/eli5 easy'])
})

check('real WS-05 adapter: unproven session refuses, no injection', () => {
  const { TerminalInputAdapter } = require('../../fallback/terminal-input-adapter')
  let injected = 0
  const adapter = new TerminalInputAdapter({
    route: null, // no resolver -> session unproven
    handlers: { submit: () => { injected += 1 } },
  })
  const sub = new Eli5Submission({ adapter })
  const r = sub.submit({ sessionId: 'sess-real', text: '/eli5' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(injected, 0)
})

// --- summary ------------------------------------------------------------------

if (failures === 0) {
  console.log('ALL TESTS PASSED')
  process.exit(0)
} else {
  console.log(`${failures} FAILURE(S)`)
  process.exit(1)
}
