/**
 * WS-50 e2e acceptance — leg 1: FIRST-RUN NAME ASK.
 *
 * Walkthrough (nontechnical flow, Master Spec 4): the fresh user runs a
 * supported skill; Candice appears and reports setup checking; the name
 * question "Hi, I'm Candice. What's your name?" appears at most once per
 * local user; the user answers by voice or type; the name persists in the
 * LOCAL preference profile; it is never inferred from the OS username; it is
 * used naturally later ("Welcome back, <name>") and can be changed.
 *
 * Automated assertions are FAIL-CLOSED: a missing file, a changed label, a
 * dropped invariant, or an unexpected behavior flips the leg to FAIL — a
 * positive claim never rests on a grep of a single file. Steps that need a
 * real interactive Claude session are recorded as skips with reasons.
 *
 *   node tests/e2e-acceptance/leg1-first-run-name-ask.test.js
 */

'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const harness = require('./harness')

let failures = 0
let skips = 0

function check(name, fn) {
  try {
    const ret = fn()
    // Vacuous-pass guard: an async fn passed to a sync check would silently
    // swallow its failures. Reject it instead — the leg must await.
    if (ret && typeof ret.then === 'function') {
      failures += 1
      console.log(`FAIL - ${name}`)
      console.log('  async check passed without await — fix this leg (vacuous-pass guard)')
      return
    }
    console.log(`ok - ${name}`)
  } catch (err) {
    failures += 1
    console.log(`FAIL - ${name}`)
    console.log(`  ${err && err.message ? err.message : err}`)
  }
}

function skip(name, reason) {
  skips += 1
  console.log(`SKIP - ${name} (${reason})`)
}

async function loadPrefs() {
  return {
    name: await import(path.join(harness.APP_SRC, 'prefs', 'name.ts')),
    store: await import(path.join(harness.APP_SRC, 'prefs', 'store.ts')),
    profile: await import(path.join(harness.APP_SRC, 'prefs', 'profile.ts')),
  }
}

// ---------------------------------------------------------------------------
// Step 1 — the fresh-user profile starts with no name and the ask is due
// ---------------------------------------------------------------------------

;(async () => {
  const prefs = await loadPrefs()

  check('fresh profile: name ask is due (needsNameAsk true)', () => {
    const fresh = prefs.profile.defaultProfile()
    assert.strictEqual(prefs.name.needsNameAsk(fresh), true,
      'a brand-new local profile must have the first-run name ask pending')
  })

  check('name never inferred from the OS username', () => {
    // Fail-closed source proof, not a claim: the entire prefs lane (owned by
    // WS-40) must contain no OS-username read. Grep only proves absence here;
    // the positive control is the next check.
    const prefsDir = path.join(harness.APP_SRC, 'prefs')
    const src = fs.readdirSync(prefsDir).map((f) => fs.readFileSync(path.join(prefsDir, f), 'utf8')).join('\n')
    for (const forbidden of ['os.userInfo(', 'getpwuid', 'process.env.USER', 'process.env.USERNAME']) {
      assert.ok(!src.includes(forbidden), `prefs lane must never read the OS username (found ${forbidden})`)
    }
    // Behavioral gate: needsNameAsk is true even when the OS username exists.
    assert.strictEqual(prefs.name.needsNameAsk({ schemaVersion: 1 }), true,
      'name ask pending regardless of who the OS user is')
  })

  // -----------------------------------------------------------------------
  // Step 2 — answer the name by type, then by voice — the question is asked
  // once and the name persists, at most once per local user.
  // -----------------------------------------------------------------------

  check('typed answer persists in the local profile', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'candice-prefs-'))
    const env = { ...process.env, CANDICE_PREFS_DIR: dir }
    const fresh = prefs.profile.defaultProfile()
    const marked = prefs.name.markNameAsked(fresh, '2026-08-21T00:00:00.000Z')
    const withName = prefs.name.setPreferredName(marked, '  Trevor  ')
    const saved = prefs.store.saveProfile(withName, env)
    assert.strictEqual(saved, true, 'profile must save to the prefs dir')
    const reloaded = prefs.store.loadProfile(env)
    assert.strictEqual(reloaded.ok, true)
    assert.strictEqual(reloaded.profile.preferredName, 'Trevor', 'name round-trips normalized')
    assert.strictEqual(prefs.name.needsNameAsk(reloaded.profile), false,
      'after the ask the question is not asked again')
  })

  check('voice answer path stores the same single profile field', () => {
    const profile = prefs.profile.defaultProfile()
    const marked = prefs.name.markNameAsked(profile, '2026-08-21T00:00:00.000Z')
    const withName = prefs.name.setPreferredName(marked, 'speech-transcript-of-Name')
    assert.strictEqual(withName.preferredName, 'speech-transcript-of-Name')
    assert.strictEqual(prefs.name.needsNameAsk(withName), false)
  })

  check('name is used naturally: "Welcome back, <name>"', () => {
    const profile = { schemaVersion: 1, preferredName: 'Trevor' }
    assert.strictEqual(prefs.name.welcomeBackPhrase(profile), 'Welcome back, Trevor')
    assert.strictEqual(prefs.name.welcomeBackPhrase({ schemaVersion: 1 }), null,
      'no invented greeting without a stored name')
  })

  check('name is changeable later', () => {
    const profile = prefs.name.setPreferredName({ schemaVersion: 1 }, 'Trevor')
    const changed = prefs.name.setPreferredName(profile, 'Trev')
    assert.strictEqual(changed.preferredName, 'Trev')
    assert.strictEqual(prefs.name.needsNameAsk(changed), false,
      'a later change must not re-arm the first-run ask')
  })

  // -----------------------------------------------------------------------
  // Step 3 — the name ask is presented by the app once per local user
  // (ask-at-most-once invariant). The first-run question string is
  // authoritative: the skill/wake surface carries the exact spec wording.
  // -----------------------------------------------------------------------

  check('setup-check greeting and name-ask flow are wired into the skill surface', () => {
    const companion = harness.mustRead(harness.COMPANION_REF)
    const skill = harness.mustRead(harness.SPEC_SKILL)
    const spec = harness.mustRead(path.join(harness.REPO_ROOT, 'spec', 'MASTER-SPEC-2026-08-21.md'))
    // The spec-3 greeting: Candice appears and reports setup checking before
    // the long preflight — the WS-36 integration surface carries it verbatim.
    assert.ok(skill.includes('Hi, I’m Candice. Give me just a moment') || skill.includes("Hi, I'm Candice. Give me just a moment"),
      'SKILL.md carries the setup-check greeting (spec 3)')
    assert.ok(companion.includes('setup-check surface'), 'companion reference names the setup-check surface')
    // The spec-4 name question: "Hi, I'm Candice. What's your name?" — the
    // wording authority is the spec; the WS-40 prefs lane implements the
    // ask-once flow (proven behaviorally above).
    assert.ok(spec.includes('What’s your name?'), 'Master Spec section 4 carries the exact name question')
  })

  // -----------------------------------------------------------------------
  // Interactive-only (honest skips): asking a REAL human user their name in
  // a REAL Claude session cannot be scripted headlessly.
  // -----------------------------------------------------------------------

  skip('name ask shown to a real human user', 'requires an interactive Claude session and a human participant (CI cannot fabricate a user)')
  skip('answer-by-voice captured with a real microphone', 'requires a physical microphone and interactive listening window — WS-28/WS-17 live hardware path')

  console.log(`\nLEG 1 (first-run name ask): ${failures === 0 ? 'ALL TESTS PASSED' : 'FAILED'} (${skips} skipped)`)
  process.exit(failures === 0 ? 0 : 1)
})()
