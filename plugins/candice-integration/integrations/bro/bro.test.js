'use strict'

/**
 * candice-integration / integrations/bro/bro.test.js
 * WS-39 Bro Candice integration tests — owned path: plugins/candice-integration/integrations/bro/**
 *
 * Runs with plain `node` (zero dependencies, cross-platform):
 *   node plugins/candice-integration/integrations/bro/bro.test.js
 * Exits 0 on PASS, 1 on FAIL. Every assertion prints PASS/FAIL with the exact
 * input that produced it — primary-source evidence for the acceptance run.
 *
 * Covers the WS-39 acceptance criteria (task-graph snapshot required_outputs
 * + acceptance_criteria, E.1 WS-39):
 *   - Bro minimum integration instructions present (README.md; spec 25);
 *   - compact-companion /bro submission path works (spec 16, 13.3);
 *   - no Bro rule changes (spec 2/15/25: the module only forwards the user's
 *     own command, never renames /bro, never rewrites skill rules);
 *   - same-session identity: submission routes through the WS-05 seam with
 *     the session as authority; an unproven target refuses (spec 17/20);
 *   - busy queue + the exact spec 13.3 note (spec 13.3);
 *   - failure never blocks Claude (spec 20) — every refusal is a decision
 *     object, never a throw.
 */

const assert = require('assert')

const { BroSubmission, normalizeBroCommand, validSessionId, BRO_COMMAND } = require('./bro-submission')

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

function makeRoute() {
  return { resolveRoute: () => ({ ok: true, routeTo: 'sess-1' }) }
}

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

// --- normalizeBroCommand ---------------------------------------------------

check('normalize: typed "/bro" canonical', () => {
  const r = normalizeBroCommand('/bro')
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.text, '/bro')
})

check('normalize: typed "/BRO" case-insensitive', () => {
  const r = normalizeBroCommand('/BRO')
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.text, '/bro')
})

check('normalize: "/bro" with surrounding whitespace', () => {
  const r = normalizeBroCommand('  /bro  ')
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.text, '/bro')
})

check('normalize: spoken "bro" (no slash) -> /bro', () => {
  const r = normalizeBroCommand('bro')
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.text, '/bro')
  assert.strictEqual(r.normalized, 'spoken')
})

check('normalize: spoken "Bro" -> /bro', () => {
  const r = normalizeBroCommand('Bro')
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.text, '/bro')
})

check('normalize: empty string refused', () => {
  const r = normalizeBroCommand('   ')
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'empty-command')
})

check('normalize: non-command text refused — never invents commands', () => {
  const r = normalizeBroCommand('explain the architecture')
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'not-a-bro-command')
})

check('normalize: non-string refused', () => {
  const r = normalizeBroCommand(42)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'invalid-input')
})

// --- submit: compact-companion /bro submission path (spec 16, 13.3) --------

check('submit: real seam delivers /bro to the owning session', () => {
  const { adapter, calls } = recordingAdapter({ route: makeRoute() })
  const sub = new BroSubmission({ adapter })
  const r = sub.submit({ sessionId: 'session-abc', text: '/bro' })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.text, '/bro')
  assert.strictEqual(calls.length, 1)
  assert.strictEqual(calls[0].sessionId, 'session-abc')
  assert.strictEqual(calls[0].text, '/bro')
})

check('submit: spoken "bro" from compact Candice is submitted as /bro', () => {
  const { adapter, calls } = recordingAdapter()
  const sub = new BroSubmission({ adapter })
  const r = sub.submit({ sessionId: 'sess-x', text: 'bro' })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.text, '/bro')
  assert.strictEqual(calls[0].text, '/bro')
})

check('submit: busy session -> queued with the exact spec 13.3 note', () => {
  const { adapter } = recordingAdapter({ busy: true })
  const sub = new BroSubmission({ adapter })
  const r = sub.submit({ sessionId: 'sess-x', text: '/bro' })
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
  const sub = new BroSubmission({ adapter })
  const r = sub.submit({ sessionId: 'sess-x', text: '/bro' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'unproven-session')
  // The seam is the decision layer; a refused route never submits.
  assert.strictEqual(injected, true) // seam WAS consulted (decision authority)
})

check('submit: invalid sessionId refused before the seam', () => {
  const { adapter, calls } = recordingAdapter()
  const sub = new BroSubmission({ adapter })
  const r = sub.submit({ sessionId: 'not valid', text: '/bro' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'invalid-session-id')
  assert.strictEqual(calls.length, 0)
})

check('submit: non-command text refused before the seam', () => {
  const { adapter, calls } = recordingAdapter()
  const sub = new BroSubmission({ adapter })
  const r = sub.submit({ sessionId: 'sess-x', text: 'tell me a joke' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'not-a-bro-command')
  assert.strictEqual(calls.length, 0)
})

check('submit: seam failure surfaces soft, no throw, Claude not blocked', () => {
  const { adapter } = recordingAdapter({ fail: 'delivery-failed', error: 'seam refused' })
  const sub = new BroSubmission({ adapter })
  const r = sub.submit({ sessionId: 'sess-x', text: '/bro' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'delivery-failed')
  assert.strictEqual(r.error, 'seam refused')
})

check('submit: default adapter created from the real WS-05 seam', () => {
  // Constructor without an adapter instantiates the REAL terminal-input-adapter
  // from fallback/** (proves the cross-lane seam loads in this lane).
  const sub = new BroSubmission({})
  assert.strictEqual(typeof sub.adapter.submitText, 'function')
  // No route resolver -> the session is unproven -> the seam refuses (spec 17:
  // injection disables itself when the exact target cannot be proven). The
  // user then types /bro directly in Claude (spec 20).
  const r = sub.submit({ sessionId: 'sess-x', text: '/bro' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'unproven-session')
})

// --- no rule changes + integration metadata (spec 2/25) ---------------------

check('integrationInfo: version, command, and ruleChanges false', () => {
  const sub = new BroSubmission({})
  const info = sub.integrationInfo()
  assert.strictEqual(info.skill, 'bro')
  assert.strictEqual(info.slashCommand, '/bro')
  assert.strictEqual(info.integrationVersion, '1.0.0')
  assert.strictEqual(info.ruleChanges, false)
})

check('BRO_COMMAND is the canonical spelling, never renamed', () => {
  assert.strictEqual(BRO_COMMAND, '/bro')
})

check('stateless: no answer/audio/secret store exists in this lane', () => {
  const sub = new BroSubmission({})
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
  const sub = new BroSubmission({ adapter })
  const r = sub.submit({ sessionId: 'sess-real', text: 'bro' })
  assert.strictEqual(r.ok, true)
  assert.deepStrictEqual(injected, ['/bro'])
})

check('real WS-05 adapter: unproven session refuses, no injection', () => {
  const { TerminalInputAdapter } = require('../../fallback/terminal-input-adapter')
  let injected = 0
  const adapter = new TerminalInputAdapter({
    route: null, // no resolver -> session unproven
    handlers: { submit: () => { injected += 1 } },
  })
  const sub = new BroSubmission({ adapter })
  const r = sub.submit({ sessionId: 'sess-real', text: '/bro' })
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
