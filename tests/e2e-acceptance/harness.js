'use strict'

/**
 * candice end-to-end nontechnical-user acceptance harness — shared helpers.
 *
 * Owned path: tests/e2e-acceptance/** (PROJECT-MANIFEST 9.2 WR-021, WS-50).
 *
 * WS-50 proves the E.1 acceptance criterion
 * (CONTROL/CHECKLIST.md): "a fresh user runs a supported skill, Candice
 * appears and reports setup checking, answers by voice and by type, and the
 * answer reaches the same Claude session." It walks the NONtechnical flow of
 * Master Spec sections 2-9 (first-run name ask, HOLD-TO-TALK + TYPE ANSWER +
 * Answer-in-Claude, the independent voice toggle, captions always, local-only
 * audio, no-second-AI, no-competing-memory) as a scripted, repeatable
 * walkthrough that a human nontechnical user (or a later interactive smoke
 * run) follows, with fail-closed automated assertions on every step.
 *
 * Convention (matches every sibling suite — tests/contract, tests/same-session,
 * tests/failure-matrix): plain CommonJS, plain `node`, ZERO dependencies, zero
 * network, no package-manager step. Every dependency lane is consumed
 * READ-ONLY through its owned glob (0C cross-lane rule — this lane never edits
 * them). TypeScript sources are imported directly: the repo requires Node
 * 22.18+ / 26 (type-stripping enabled; see the lane README) — the suite
 * fails with a clear message when the runtime cannot strip types.
 *
 * Skip discipline (E.1 WS-50 "honest skip markers"): a leg that needs a real
 * microphone, a real Windows desktop, or a real interactive Claude session
 * is RECORDED as skipped with the reason, and the suite still exits 0. A
 * skip is never silent and never claimed as tested.
 */

const path = require('path')
const fs = require('fs')

/** Repo root (tests/e2e-acceptance is 2 deep). */
const REPO_ROOT = path.join(__dirname, '..', '..')

/** WS-06/WS-16/WS-19/WS-20 app sources (read-only). */
const APP_SRC = path.join(REPO_ROOT, 'apps', 'candice-companion', 'src')
const APP_TAURI = path.join(REPO_ROOT, 'apps', 'candice-companion', 'src-tauri')

/** WS-02/03/04/05/37/38/39 plugin sources (read-only). */
const PLUGIN_ROOT = path.join(REPO_ROOT, 'plugins', 'candice-integration')

/** WS-31 bootstrap scripts (read-only). */
const BOOTSTRAP = path.join(REPO_ROOT, 'scripts', 'candice-bootstrap')

/** WS-36 skill references (read-only). */
const SKILL_ROOT = path.join(REPO_ROOT, '.claude', 'skills')
const SPEC_SKILL = path.join(SKILL_ROOT, 'spec-protocol', 'SKILL.md')
const COMPANION_REF = path.join(SKILL_ROOT, 'spec-protocol', 'references', 'candice-companion.md')
const QUESTION_CONTRACT_REF = path.join(
  SKILL_ROOT, 'spec-protocol', 'references', 'candice-question-contract.md'
)

/** WS-01 protocol schemas (read-only). */
const SCHEMAS = path.join(REPO_ROOT, 'packages', 'candice-protocol', 'schemas')

/** Reads a file; throws with a clear cross-lane message when absent. */
function mustRead(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (err) {
    throw new Error(`dependency file missing: ${file} (${err.message})`)
  }
}

/** Reads a JSON file; throws when absent or invalid. */
function readJson(file) {
  return JSON.parse(mustRead(file))
}

/** True when the file exists and is a non-empty readable file. */
function existsNonEmpty(file) {
  try {
    const st = fs.statSync(file)
    return st.isFile() && st.size > 0
  } catch (err) {
    return false
  }
}

/** Scans a directory tree (excluding node_modules/.git/target) and returns
 *  the relative file paths. */
function walk(dir) {
  const out = []
  const read = (d, prefix) => {
    let entries
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch (err) {
      return
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'target' || e.name === 'dist') continue
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isDirectory()) read(path.join(d, e.name), rel)
      else out.push(rel)
    }
  }
  read(dir, '')
  return out
}

/** Deterministic fixed clock for the stateful dependency modules. */
function fixedClock(iso) {
  return () => iso
}

/**
 * Fake Claude input surface (same-session seam). Records every submission so
 * the Answer-array path can prove the answer reached the SAME session id and
 * nothing else.
 */
class FakeClaudeInput {
  constructor() {
    this.submissions = [] // { sessionId, text, at }
  }
  submit({ sessionId, text }) {
    this.submissions.push({ sessionId, text, at: new Date().toISOString() })
    return { ok: true }
  }
  submittedCount() {
    return this.submissions.length
  }
}

/**
 * Fake companion front-channel for the WS-04 ask-user server: records
 * displayed questions and "spoken" (TTS) texts so the harness can prove
 * captions are always presented and secret questions are never read aloud.
 */
class FakeCompanionFront {
  constructor() {
    this.displayed = [] // question events displayed (caption source)
    this.spoken = [] // texts actually voiced
  }
  deliverQuestion(question) {
    this.displayed.push(question)
    // readAloud === false must never reach the speaker path.
    if (question.readAloud !== false) this.spoken.push(question.text)
    return { ok: true }
  }
}

module.exports = {
  REPO_ROOT,
  APP_SRC,
  APP_TAURI,
  PLUGIN_ROOT,
  BOOTSTRAP,
  SKILL_ROOT,
  SPEC_SKILL,
  COMPANION_REF,
  QUESTION_CONTRACT_REF,
  SCHEMAS,
  mustRead,
  readJson,
  existsNonEmpty,
  walk,
  fixedClock,
  FakeClaudeInput,
  FakeCompanionFront,
}
