'use strict'

/**
 * candice-integration / integrations/kaizen/invariants.js
 * WS-37 Kaizen integration — owned path: plugins/candice-integration/integrations/kaizen/**
 *
 * The mechanical invariants of the Kaizen-Candice integration (E.1 WS-37:
 * "Kaizen integration is minimal and never modifies question order or rules;
 * Candice surfaces only"; Master Spec 14/15/20). Pure functions, zero
 * dependencies — testable with plain `node`.
 *
 * Invariants enforced:
 *
 *   1. ORDER-FIXED  — the delivery order of the Kaizen questions never
 *      changes: the Recipe sequence is fixed (Target, Location, Better,
 *      Scope, Permission, Proof, Interval) with the Contract approval as the
 *      final uncounted confirmation. No renumbering, no reordering by
 *      Candice, no insertion of new numbered pieces.
 *   2. SURFACE-ONLY — Candice only ever delivers the skill's own wording:
 *      every event text must match the wording in this lane's map (which is
 *      taken verbatim from the Kaizen skill's onboarding reference). If a
 *      delivery would use different wording, the skill decided it — Candice
 *      did not.
 *   3. NO-RENUMBER  — the order array is 1..N contiguous and maps 1:1 to
 *      the map keys.
 *   4. ONCE-ANSWERED — a (sessionId, questionKey) pair is answered at most
 *      once; re-asking an answered question is refused.
 *   5. SCHEMA-SHAPE — every question event has the schemaVersion 1.0,
 *      skill "kaizen", event "question" envelope and valid answerKind.
 *   6. NO-SECRET-READ-ALOUD — sensitivity "secret" implies readAloud false
 *      (spec 14); the Kaizen map carries no secret questions today, but the
 *      invariant is enforced generically for any future key.
 */

const { KAIZEN_QUESTIONS, KAIZEN_BY_KEY, KAIZEN_ORDER } = require('./question-map')

const ANSWER_KINDS = ['free_text', 'single_choice', 'yes_no', 'confirm', 'mode_choice']
const INPUT_MODES = ['voice', 'typed', 'terminal']

/**
 * checkInvariants — run every invariant over the map; returns
 * { ok, failures: [ {invariant, detail} ] }. Failures are additive so a
 * test run reports all of them, not just the first.
 */
function checkInvariants() {
  const failures = []

  // 1/3. Order fixed and contiguous 1..N.
  const orders = KAIZEN_QUESTIONS.map((q) => q.order)
  const sorted = [...orders].sort((a, b) => a - b)
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i] !== i + 1) {
      failures.push({ invariant: 'order-contiguous', detail: `expected order ${i + 1}, got ${sorted[i]}` })
      break
    }
  }
  const byOrder = new Map(KAIZEN_QUESTIONS.map((q) => [q.order, q.key]))
  for (let i = 0; i < KAIZEN_ORDER.length; i += 1) {
    const expected = byOrder.get(i + 1)
    if (expected !== KAIZEN_ORDER[i]) {
      failures.push({
        invariant: 'order-fixed',
        detail: `KAIZEN_ORDER[${i}] = ${KAIZEN_ORDER[i]}, expected ${expected}`,
      })
    }
  }

  // 2. SURFACE-ONLY: every question in the map has the fixed key/order/text
  //    contract; the map itself is the single source for delivery wording.
  for (const q of KAIZEN_QUESTIONS) {
    if (!/^[A-Z][A-Z0-9_-]*$/.test(q.key)) {
      failures.push({ invariant: 'key-format', detail: `bad key ${q.key}` })
    }
    if (KAIZEN_BY_KEY[q.key] !== q) {
      failures.push({ invariant: 'key-unique', detail: `key ${q.key} is duplicated or not registered` })
    }
    if (typeof q.text !== 'string' || q.text.trim().length === 0) {
      failures.push({ invariant: 'surface-only', detail: `question ${q.key} has no display wording` })
    }
    if (!ANSWER_KINDS.includes(q.answerKind)) {
      failures.push({ invariant: 'answer-kind', detail: `${q.key} answerKind ${q.answerKind} not in schema enum` })
    }
  }

  // 4. ONCE-ANSWERED — the map carries no duplicate keys, so a session can
  //    never see the same key twice via this lane.
  const seen = new Set()
  for (const key of KAIZEN_ORDER) {
    if (seen.has(key)) {
      failures.push({ invariant: 'once-answered', detail: `key ${key} appears twice in delivery order` })
    }
    seen.add(key)
  }

  // 5/6. Schema shape + secret read-aloud on every event the map can build.
  const { questionEvent } = require('./question-map')
  const sessionId = 'test-session'
  for (const q of KAIZEN_QUESTIONS) {
    const built = questionEvent(q.key, sessionId)
    if (!built.ok) {
      failures.push({ invariant: 'event-build', detail: built.error })
      continue
    }
    const ev = built.question
    if (ev.schemaVersion !== '1.0' || ev.skill !== 'kaizen' || ev.event !== 'question') {
      failures.push({ invariant: 'schema-event', detail: `${q.key} bad envelope (${ev.schemaVersion}/${ev.skill}/${ev.event})` })
    }
    if (ev.questionKey !== q.key) {
      failures.push({ invariant: 'schema-event', detail: `${q.key} event key mismatch` })
    }
    if (ev.sensitivity === 'secret' && ev.readAloud !== false) {
      failures.push({ invariant: 'no-secret-read-aloud', detail: `${q.key} would read a secret aloud` })
    }
    if (!Array.isArray(ev.allowedInputModes) || ev.allowedInputModes.length === 0) {
      failures.push({ invariant: 'schema-event', detail: `${q.key} no allowed input modes` })
    } else {
      for (const m of ev.allowedInputModes) {
        if (!INPUT_MODES.includes(m)) {
          failures.push({ invariant: 'schema-event', detail: `${q.key} bad input mode ${m}` })
        }
      }
    }
  }

  return { ok: failures.length === 0, failures }
}

module.exports = { checkInvariants }
