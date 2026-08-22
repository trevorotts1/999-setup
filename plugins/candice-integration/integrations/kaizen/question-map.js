'use strict'

/**
 * candice-integration / integrations/kaizen/question-map.js
 * WS-37 Kaizen integration — owned path: plugins/candice-integration/integrations/kaizen/**
 *
 * The stable Kaizen question registry fragment (candice-question-contract.md
 * §4: kaizen keys are owned by their integration lane; the registry FILE is
 * WS-01-owned, this fragment is the proposal source).
 *
 * Contract: question-event.schema.json schemaVersion 1.0, skill "kaizen".
 * Order is FIXED — the Kaizen Recipe asks Target, Location, Better, Scope,
 * Permission, Proof, Interval in that order (Kaizen onboarding.md §The Kaizen
 * Recipe). Interval is asked LAST on purpose; the approval confirmation
 * follows the Recipe and is uncounted.
 *
 * Question text is taken verbatim from the Kaizen skill's own onboarding
 * reference — Candice surfaces the skill's wording; she never rewrites it
 * (Master Spec 15, E.1 WS-37 "Candice surfaces only").
 *
 * answerKind values come from the question-event schema enum:
 * free_text | single_choice | yes_no | confirm | mode_choice.
 *
 * Counted flags: the Kaizen interview has no fixed numeric ceiling; the
 * contract treats the interview questions as counted:false — the ceiling is
 * "the seven Recipe pieces", not a configurable number, and the approval
 * question is a confirmation, not a Recipe piece. Progress is real state
 * only (spec 16 — never invented percentages).
 *
 * Every key: upper-snake, stable for the life of the contract, never
 * re-asked once answered (spec 14).
 */

const KAIZEN_SKILL = 'kaizen'

/**
 * The seven Recipe questions + the Contract approval confirmation, in fixed
 * order. `order` is the authoritative ordinal — consumers must deliver in
 * this order and must never renumber (invariants.js enforces).
 */
const KAIZEN_QUESTIONS = [
  {
    key: 'KAZEN_TARGET',
    order: 1,
    text: 'What are we trying to make better? It can be an app, website, funnel, process, document, automation, or something else.',
    answerKind: 'free_text',
    counted: false,
    sensitivity: 'normal',
    readAloud: true,
    canGoBack: false,
    helpText: 'A sentence or two is plenty. If you do not know the technical category, I will infer it and confirm.',
  },
  {
    key: 'KAZEN_LOCATION',
    order: 2,
    text: 'Where can I find it so I know where to work?',
    answerKind: 'free_text',
    counted: false,
    sensitivity: 'normal',
    readAloud: true,
    canGoBack: false,
    helpText: 'Current folder, GitHub repo, a URL, a hosted platform, or a local document. "I do not know" is fine — I can look at the current folder and tell you what I find.',
  },
  {
    key: 'KAZEN_BETTER',
    order: 3,
    text: 'What would you especially like me to make better? This helps me aim, but it does not limit what I can notice.',
    answerKind: 'free_text',
    counted: false,
    sensitivity: 'normal',
    readAloud: true,
    canGoBack: false,
    helpText: 'Examples: easier to use, fewer bugs, faster, safer, better design, better sales. Or "I\'m not sure — help me decide."',
  },
  {
    key: 'KAZEN_SCOPE',
    order: 4,
    text: 'How much should I work on each time? I usually recommend about 3 to 7 useful things. Five is a good starting point.',
    answerKind: 'single_choice',
    options: ['3', '4', '5', '6', '7', "I don't know"],
    counted: false,
    sensitivity: 'normal',
    readAloud: true,
    canGoBack: false,
    helpText: 'Five is the recommended default. Critical findings may displace lower-priority items, but a cycle never silently exceeds the chosen scope.',
  },
  {
    key: 'KAZEN_PERMISSION',
    order: 5,
    text: 'Would you like me to only tell you what I recommend, or may I safely make and test improvements for you too?',
    answerKind: 'single_choice',
    options: ['Mode A — Recommend only', 'Mode B — Improve safely (recommended)', 'Mode C — Custom'],
    counted: false,
    sensitivity: 'normal',
    readAloud: true,
    canGoBack: false,
    helpText: 'Mode A inspects and reports without modifying. Mode B is the recommended default: branch, change, test, revert failures, commit to a non-production branch, stop before merge or deploy.',
  },
  {
    key: 'KAZEN_PROOF',
    order: 6,
    text: 'How can we check that the change really helped instead of just looking different?',
    answerKind: 'free_text',
    counted: false,
    sensitivity: 'normal',
    readAloud: true,
    canGoBack: false,
    helpText: 'You do not have to know the answer — I will recommend proof based on the target type: tests and a build for an app, a live flow check for a website, and so on.',
  },
  {
    key: 'KAZEN_INTERVAL',
    order: 7,
    text: 'How often should I come back and check this again?',
    answerKind: 'single_choice',
    options: ['Every 20 minutes', 'Every hour', 'Every day', 'Every week', 'Every 30 days', 'Once a quarter', "I don't know"],
    counted: false,
    sensitivity: 'normal',
    readAloud: true,
    canGoBack: true,
    helpText: 'Asked last on purpose — the answer depends on what we are improving and where it lives. "I don\'t know" is valid; I will infer and you can correct me.',
  },
  {
    key: 'KAZEN_CONTRACT_APPROVAL',
    order: 8,
    text: 'This is your Kaizen Contract. Do you approve it?',
    answerKind: 'confirm',
    counted: false,
    sensitivity: 'normal',
    readAloud: true,
    canGoBack: true,
    helpText: 'Nothing runs on a schedule until you approve. If you want changes, I revise the Contract and ask again.',
  },
]

/**
 * questionEvent(key, sessionId, progress) — build a schema-conformant
 * question event for a Kaizen key. progress is real interview state only
 * ({current, ceiling, shortcut}); null until the run supplies it. The skill
 * side passes the opaque Claude session id — routing authority, never a
 * window (spec 17).
 */
function questionEvent(key, sessionId, progress) {
  const q = KAIZEN_BY_KEY[key]
  if (!q) {
    return {
      ok: false,
      code: 'unknown-key',
      error: `no Kaizen question with key ${key}`,
    }
  }
  const event = {
    schemaVersion: '1.0',
    sessionId,
    skill: 'kaizen',
    event: 'question',
    questionKey: q.key,
    text: q.text,
    answerKind: q.answerKind,
    allowedInputModes: ['voice', 'typed', 'terminal'],
    readAloud: q.readAloud !== false,
    sensitivity: q.sensitivity,
    counted: !!q.counted,
    progress: progress || null,
    helpText: q.helpText || null,
    canGoBack: !!q.canGoBack,
  }
  if (Array.isArray(q.options)) {
    event.options = q.options
  }
  return { ok: true, question: event }
}

const KAIZEN_BY_KEY = Object.create(null)
for (const q of KAIZEN_QUESTIONS) {
  KAIZEN_BY_KEY[q.key] = q
}

/** Fixed delivery order: the authoritative sequence, never renumbered. */
const KAIZEN_ORDER = KAIZEN_QUESTIONS.map((q) => q.key)

module.exports = {
  KAIZEN_QUESTIONS,
  KAIZEN_BY_KEY,
  KAIZEN_ORDER,
  KAIZEN_SKILL,
  questionEvent,
}
