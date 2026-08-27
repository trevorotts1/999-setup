'use strict'

// Kaizen retains only its fixed order. The governed wording, privacy,
// validation, retry, and answer authority live once in question-keys.json.
const registry = require('../../../../packages/candice-protocol/question-registry')

const KAIZEN_SKILL = 'kaizen'
const KAIZEN_QUESTIONS = registry.activeEntries(KAIZEN_SKILL)
  .sort((a, b) => a.order - b.order)
  .map((entry) => Object.freeze({
    key: entry.key,
    order: entry.order,
    text: entry.display,
    answerKind: entry.answerKind,
    options: entry.options || undefined,
    counted: entry.count.counted,
    sensitivity: entry.privacy.sensitivity,
    readAloud: entry.privacy.readAloud,
    canGoBack: entry.canGoBack,
    helpText: entry.helpText,
  }))

const KAIZEN_BY_KEY = Object.freeze(Object.fromEntries(KAIZEN_QUESTIONS.map((q) => [q.key, q])))
const KAIZEN_ORDER = Object.freeze(KAIZEN_QUESTIONS.map((q) => q.key))

function questionEvent(key, sessionId, progress) {
  const built = registry.canonicalQuestion({ sessionId, questionKey: key, skill: KAIZEN_SKILL, progress })
  if (!built.ok) return { ok: false, code: built.code, error: 'no governed Kaizen question with that key' }
  return { ok: true, question: built.question }
}

module.exports = { KAIZEN_QUESTIONS, KAIZEN_BY_KEY, KAIZEN_ORDER, KAIZEN_SKILL, questionEvent }
