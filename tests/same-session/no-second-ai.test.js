'use strict'

/**
 * candice same-session suite — E.1 WS-42 leg 2: NO second independent AI
 * conversation is created — owned path: tests/same-session/**
 *
 * Master Spec section 2 (the no-second-AI-conversation invariant): Candice is
 * the face, voice, ears, and lightweight UI; the ACTIVE Claude session and the
 * invoked skill remain the brain, rules, memory, and source of truth. Candice
 * never creates a second independent AI conversation, never maintains a
 * competing project memory, and never rewrites question order or rules.
 *
 * Two provable halves:
 *
 *   (a) The WS-02 plugin contract + WS-36 skill docs STATE the invariant and
 *       the same-session rule. Grepped byte-exact against the owned files
 *       (read-only), so a later edit that silently drops the invariant fails
 *       this suite.
 *
 *   (b) The shipped code ENFORCES the invariant. The Candice-side seams that
 *       would be the only places a second conversation could start or a
 *       question could be re-ordered — the WS-04 MCP server, the WS-05
 *       fallback, the WS-03 lifecycle — are proven here to own NO model
 *       conversation, NO prompt synthesis, NO question mutation:
 *         - server.js/fallback modules contain no provider/model keys
 *           (no ANTHROPIC_*, no API tokens, no model-id constants),
 *           nothing that could start an independent LLM call;
 *         - fallbackQuestion returns the SAME text it received (byte-equal,
 *           no reword/renumber) — the question is asked "normally in Claude";
 *         - the fallback prompt instructs the SAME session input surface,
 *           never a new conversation;
 *         - the MCP server refuses when the companion is unavailable and
 *           tells the skill to ask the same question in Claude normally —
 *           the Claude session is the only brain, always.
 *
 * Pure CommonJS, zero dependencies, cross-platform:
 *   node tests/same-session/no-second-ai.test.js
 */

const assert = require('assert')
const fs = require('fs')
const harness = require('./harness')

let failures = 0

function check(name, fn) {
  try {
    fn()
    console.log(`ok - ${name}`)
  } catch (err) {
    failures += 1
    console.log(`FAIL - ${name}`)
    console.log(`  ${err && err.message ? err.message : err}`)
  }
}

const deps = harness.loadDeps()
const skill = fs.readFileSync(harness.SPEC_SKILL, 'utf8')
const companion = fs.readFileSync(harness.COMPANION_REF, 'utf8')
const contractRef = fs.readFileSync(harness.QUESTION_CONTRACT_REF, 'utf8')
const pluginJson = harness.readJson(harness.PLUGIN_ROOT + '/.claude-plugin/plugin.json')
const hooks = harness.readJson(harness.PLUGIN_ROOT + '/hooks/hooks.json')

// ---------------------------------------------------------------------------
// (a) The invariant is stated in the shipped contract surfaces
// ---------------------------------------------------------------------------

check('SKILL.md states the no-second-AI-conversation invariant', () => {
  assert.ok(skill.includes('She never creates a second AI conversation'), 'SKILL.md must say Candice never creates a second AI conversation')
  assert.ok(skill.includes('remain the brain, rules,'), 'SKILL.md must name the skill as the brain/rules')
  assert.ok(skill.includes('memory, and source of truth'), 'SKILL.md must name the skill as source of truth')
})

check('companion reference states the invariant and the same-session rule', () => {
  assert.ok(companion.includes('She never creates a second AI conversation'), 'candice-companion.md must state the invariant')
  assert.ok(companion.includes('without double-counting'), 'candice-companion.md must state the no-double-count rule')
  assert.ok(companion.includes('the same session'), 'candice-companion.md must say answers return to the same session')
})

check('question contract reference keeps the single-session answer rule', () => {
  assert.ok(contractRef.includes('same session'), 'candice-question-contract.md must bind answers to the same session')
})

check('plugin.json declares Candice is the interface, never a second brain', () => {
  assert.ok(pluginJson.description.includes('never creates a second AI conversation'), 'plugin.json must state the no-second-AI invariant')
  assert.ok(pluginJson.description.includes('remain the brain, rules, memory, and source of truth'), 'plugin.json must name the session/skill as the brain')
  assert.ok(pluginJson.description.includes('never modifies the question order'), 'plugin.json must state the question-order invariant')
})

check('wake hooks bind to the FOUR supported commands only, all async', () => {
  const expansions = hooks.hooks.UserPromptExpansion
  assert.ok(Array.isArray(expansions) && expansions.length === 4, 'exactly four UserPromptExpansion matchers')
  const matchers = expansions.map((e) => e.matcher).sort()
  assert.deepStrictEqual(matchers, ['bro', 'eli5', 'kaizen', 'spec-protocol'], 'the four supported slash commands only')
  for (const e of expansions) {
    for (const h of e.hooks) {
      assert.strictEqual(h.async, true, 'hooks are async — never block the skill')
    }
  }
  assert.ok(Array.isArray(hooks.hooks.SessionStart), 'SessionStart hook exists (bind on session start)')
})

// ---------------------------------------------------------------------------
// (b) The shipped seams cannot hold a second conversation
// ---------------------------------------------------------------------------

check('WS-04 MCP server carries no provider keys, no model, no prompt synthesis', () => {
  const serverSrc = fs.readFileSync(harness.PLUGIN_ROOT + '/mcp/ask-user/server.js', 'utf8')
  assert.ok(!serverSrc.includes('ANTHROPIC_API_KEY'), 'server must not reference a provider key')
  assert.ok(!serverSrc.includes('model'), 'server must reference no model id — no LLM call exists here')
  assert.ok(!serverSrc.includes('apiKey') && !serverSrc.includes('api_key'), 'server must hold no API key')
})

check('fallback path carries no provider keys and no LLM call either', () => {
  const coordinator = fs.readFileSync(harness.PLUGIN_ROOT + '/fallback/fallback-coordinator.js', 'utf8')
  const adapter = fs.readFileSync(harness.PLUGIN_ROOT + '/fallback/terminal-input-adapter.js', 'utf8')
  const guard = fs.readFileSync(harness.PLUGIN_ROOT + '/fallback/double-count-guard.js', 'utf8')
  for (const src of [coordinator, adapter, guard]) {
    assert.ok(!src.includes('ANTHROPIC_API_KEY'), 'no provider key in fallback code')
    assert.ok(!src.includes('apiKey') && !src.includes('api_key'), 'no API key constant in fallback code')
    // An LLM call would need a completion endpoint or a model id. Neither
    // exists anywhere in the fallback seam — it only routes text.
    assert.ok(!src.includes('completion'), 'no completion endpoint in fallback code')
    assert.ok(!src.includes('/v1/'), 'no provider API path in fallback code')
  }
})

check('fallbackQuestion redelivers the SAME text — no reword, no renumber', () => {
  const coordinator = new deps.FallbackCoordinator()
  const deferred = coordinator.fallbackQuestion({
    sessionId: 'session-x-1',
    questionKey: 'A7',
    text: 'Question number seven, exactly as governed.',
    helpText: 'help',
    allowedInputModes: ['voice', 'typed', 'terminal'],
  })
  assert.strictEqual(deferred.ok, true)
  assert.strictEqual(deferred.prompt.text, 'Question number seven, exactly as governed.', 'the exact same question text')
  assert.strictEqual(deferred.prompt.helpText, 'help', 'help text passes through untouched')
  assert.deepStrictEqual(deferred.prompt.allowedInputModes, ['voice', 'typed', 'terminal'], 'answer modes pass through untouched')
  assert.strictEqual(deferred.redelivered, false)
  // A repeat fallback of the same question is a redelivery, never a renumber
  // or a second slot (no double-count).
  const again = coordinator.fallbackQuestion({
    sessionId: 'session-x-1',
    questionKey: 'A7',
    text: 'Question number seven, exactly as governed.',
    helpText: 'help',
  })
  assert.strictEqual(again.ok, true)
  assert.strictEqual(again.redelivered, true, 'second display is a redelivery')
  assert.strictEqual(again.prompt.text, 'Question number seven, exactly as governed.', 'the text is unchanged across redelivery')
})

check('fallback routes to the owning session input, never its own conversation', () => {
  const submitted = []
  const bridge = {
    resolveRoute: ({ sessionId }) => ({ ok: true, routeTo: sessionId }),
  }
  const coordinator = new deps.FallbackCoordinator({
    adapterOpts: { route: bridge, handlers: { submit: (t) => submitted.push(t) } },
  })
  const delivery = coordinator.deliverToTerminal({
    sessionId: 'session-y-9',
    text: 'user typed this',
  })
  assert.strictEqual(delivery.ok, true)
  assert.strictEqual(delivery.routeTo, 'session-y-9', 'text is delivered to the owning session id')
  assert.deepStrictEqual(submitted, ['user typed this'], 'exactly the user text is injected, nothing synthesized')
})

check('MCP unavailable: the same question is asked in Claude normally, not a second conversation', async () => {
  const server = new deps.AskUserServer({ isCompanionReady: () => false })
  const result = await server.askUser({
    sessionId: 'session-z-1',
    question: {
      schemaVersion: '1.0',
      sessionId: 'session-z-1',
      skill: 'spec-protocol',
      event: 'question',
      questionKey: 'BUILD_TARGET',
      text: 'the governed question',
      answerKind: 'free_text',
      allowedInputModes: ['voice', 'typed', 'terminal'],
      readAloud: true,
      sensitivity: 'normal',
      counted: true,
      progress: null,
      helpText: 'help',
      canGoBack: true,
    },
  })
  assert.strictEqual(result.result.isError, true)
  const text = result.result.content[0].text
  assert.ok(text.includes('ask the same question in Claude normally'), 'the skill is instructed to ask the same question in Claude')
  assert.ok(text.includes('companion is unavailable'), 'the reason is surfaced')
})

// ---------------------------------------------------------------------------
// 10m sanity: nothing in the candice plugin opens a second process with a
// provider conversation (the wake hook launches the companion UI only).
// ---------------------------------------------------------------------------

check('wake script launches the companion UI, never a model conversation', () => {
  const wake = fs.readFileSync(harness.PLUGIN_ROOT + '/bin/wake-candice.sh', 'utf8')
  assert.ok(wake.includes('--wake'), 'companion is launched with --wake only')
  // The wake handler resolves ONE launch command (the companion UI). It
  // contains no "claude" reference at all — it never starts a Claude process,
  // which is exactly the no-second-conversation proof.
  assert.ok(!wake.includes('claude'), 'the wake handler never mentions, launches, or routes to Claude')
})

if (failures > 0) {
  console.log(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL TESTS PASSED')
