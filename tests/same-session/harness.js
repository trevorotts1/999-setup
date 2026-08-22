'use strict'

/**
 * candice same-session suite — shared harness — owned path: tests/same-session/**
 *
 * WS-42 same-session Claude + Claude-Nine test suite. Resolves the dependency
 * lanes (WS-02 plugin, WS-03 session, WS-04 MCP ask-user, WS-05 fallback,
 * WS-36 Spec Protocol SKILL.md) purely READ-ONLY from their owned globs
 * (0C cross-lane rule — this lane never edits them). No vendored code, no
 * npm, no network: everything used here is plain Node built-ins (assert,
 * fs, path, crypto) plus the repo's own zero-dependency plugin modules.
 */

const path = require('path')
const fs = require('fs')

/** Absolute path of the repo worktree root (tests/same-session is 2 deep). */
const REPO_ROOT = path.join(__dirname, '..', '..')

/** Absolute path of the candice-integration plugin root (WS-02/03/04/05 owned). */
const PLUGIN_ROOT = path.join(REPO_ROOT, 'plugins', 'candice-integration')

/** Absolute path of the Spec Protocol SKILL.md (WS-36 owned). */
const SPEC_SKILL = path.join(
  REPO_ROOT, '.claude', 'skills', 'spec-protocol', 'SKILL.md'
)

/** Absolute path of the candice companion reference (WS-36 owned). */
const COMPANION_REF = path.join(
  REPO_ROOT, '.claude', 'skills', 'spec-protocol', 'references', 'candice-companion.md'
)

/** Absolute path of the candice question contract reference (WS-36 owned). */
const QUESTION_CONTRACT_REF = path.join(
  REPO_ROOT, '.claude', 'skills', 'spec-protocol', 'references', 'candice-question-contract.md'
)

/** Loads the dependency-lane modules the suite drives (read-only requires). */
function loadDeps() {
  return {
    SessionManager: require(path.join(PLUGIN_ROOT, 'session', 'session-manager.js')).SessionManager,
    BindingBridge: require(path.join(PLUGIN_ROOT, 'session', 'bridge', 'binding-bridge.js')).BindingBridge,
    SessionLifecycle: require(path.join(PLUGIN_ROOT, 'session', 'session-lifecycle.js')).SessionLifecycle,
    FallbackCoordinator: require(path.join(PLUGIN_ROOT, 'fallback', 'fallback-coordinator.js')).FallbackCoordinator,
    DoubleCountGuard: require(path.join(PLUGIN_ROOT, 'fallback', 'double-count-guard.js')).DoubleCountGuard,
    TerminalInputAdapter: require(path.join(PLUGIN_ROOT, 'fallback', 'terminal-input-adapter.js')).TerminalInputAdapter,
    AskUserServer: require(path.join(PLUGIN_ROOT, 'mcp', 'ask-user', 'server.js')).AskUserServer,
    AnswerSlotRegistry: require(path.join(PLUGIN_ROOT, 'mcp', 'ask-user', 'answer-registry.js')).AnswerSlotRegistry,
  }
}

/** Reads a JSON file (hooks.json / .mcp.json / plugin.json) — throws if absent. */
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** True when the file exists and is a non-empty readable text file. */
function existsNonEmpty(file) {
  try {
    const st = fs.statSync(file)
    return st.isFile() && st.size > 0
  } catch (err) {
    return false
  }
}

/** Deterministic clock for the stateful dependency modules. */
function fixedClock(iso) {
  return () => iso
}

/** Minimal in-memory fake of a Claude input surface (the same-session seam). */
class FakeClaudeInput {
  constructor() {
    this.submissions = [] // { sessionId, text, at }
  }
  submit({ sessionId, text }) {
    this.submissions.push({ sessionId, text, at: new Date().toISOString() })
    return true
  }
  submittedCount() {
    return this.submissions.length
  }
}

module.exports = {
  REPO_ROOT,
  PLUGIN_ROOT,
  SPEC_SKILL,
  COMPANION_REF,
  QUESTION_CONTRACT_REF,
  loadDeps,
  readJson,
  existsNonEmpty,
  fixedClock,
  FakeClaudeInput,
}
