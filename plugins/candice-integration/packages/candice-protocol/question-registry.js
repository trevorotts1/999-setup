'use strict'

// The registry is an authority boundary, not a convenience key list.  It is
// deliberately dependency-free so both the MCP process and integrations load
// the same immutable data on macOS and Windows.
const registry = require('./schemas/question-keys.json')

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

freeze(registry)
const active = new Map(registry.keys.map((entry) => [entry.key, entry]))
const retired = new Map(registry.retiredKeys.map((entry) => [entry.key, entry]))

function copy(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function lookup(questionKey, skill) {
  const entry = active.get(questionKey)
  if (!entry) {
    return retired.has(questionKey)
      ? { ok: false, code: 'retired-governed-question' }
      : { ok: false, code: 'unregistered-governed-question' }
  }
  if (skill !== undefined && entry.skill !== skill) return { ok: false, code: 'question-skill-mismatch' }
  return { ok: true, entry }
}

function activeEntries(skill) {
  return registry.keys.filter((entry) => !skill || entry.skill === skill).map(copy)
}

function canonicalQuestion({ sessionId, questionKey, skill, progress }) {
  const found = lookup(questionKey, skill)
  if (!found.ok) return found
  const e = found.entry
  const question = {
    schemaVersion: '1.0',
    sessionId,
    skill: e.skill,
    event: 'question',
    questionKey: e.key,
    text: e.display,
    answerKind: e.answerKind,
    allowedInputModes: copy(e.allowedInputModes),
    readAloud: e.privacy.readAloud,
    sensitivity: e.privacy.sensitivity,
    counted: e.count.counted,
    progress: progress || null,
    helpText: e.helpText,
    canGoBack: e.canGoBack,
  }
  if (e.options !== null) question.options = copy(e.options)
  if (e.validation !== null) question.validation = copy(e.validation)
  return { ok: true, question, registryVersion: registry.registryVersion }
}

function equal(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

// Compare the producer event to an event constructed by this module.  It does
// not expose producer-provided text/options as an authority override.
function verifyQuestion(event) {
  const found = lookup(event.questionKey, event.skill)
  if (!found.ok) return found
  const built = canonicalQuestion({
    sessionId: event.sessionId,
    questionKey: event.questionKey,
    skill: event.skill,
    progress: event.progress,
  })
  for (const field of ['skill', 'text', 'answerKind', 'allowedInputModes', 'readAloud', 'sensitivity', 'counted', 'helpText', 'canGoBack', 'options', 'validation']) {
    if (!equal(event[field], built.question[field])) return { ok: false, code: 'question-authority-mismatch', field }
  }
  return { ok: true, entry: found.entry, event: built.question, registryVersion: registry.registryVersion }
}

function verifyAnswer(answer) {
  const found = lookup(answer.questionKey)
  if (!found.ok) return found
  const e = found.entry
  if (answer.sensitivity !== undefined && answer.sensitivity !== e.privacy.sensitivity) {
    return { ok: false, code: 'answer-authority-mismatch', field: 'sensitivity' }
  }
  if (!e.allowedInputModes.includes(answer.inputMode)) {
    return { ok: false, code: 'answer-authority-mismatch', field: 'inputMode' }
  }
  return { ok: true, entry: e }
}

module.exports = Object.freeze({
  registryVersion: registry.registryVersion,
  lookup,
  activeEntries,
  canonicalQuestion,
  verifyQuestion,
  verifyAnswer,
})
