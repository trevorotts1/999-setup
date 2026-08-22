'use strict'

/**
 * candice-integration / mcp/ask-user/validate.js
 * WS-04 structured ask_user MCP path — owned path: plugins/candice-integration/mcp/**
 *
 * Field-level validation of the WS-01 contract schemas
 * (packages/candice-protocol/schemas/question-event.schema.json,
 * answer-event.schema.json — Master Spec sections 13.2, 14).
 *
 * Deliberately a hand-rolled validator with ZERO dependencies (sections
 * 12/17/27: no package-manager step on the customer machine). It mirrors the
 * schema keywords that matter for gate acceptance: required fields, types,
 * enums, patterns, bounds, uniqueness, and additionalProperties:false. The
 * authoritative full 2020-12 validation lives in the WS-41 contract suite
 * (ajv); this module is the runtime gate in front of candice.ask_user so an
 * invalid question is refused BEFORE it reaches the companion, and an answer
 * that does not match the contract is refused before it is recorded.
 *
 * Nothing here logs or stores answer text. Validation errors name the field
 * and the rule only.
 */

const SESSION_ID_RE = /^[\x21-\x7e]{1,128}$/ // WS-03 bridge contract: opaque printable ids
const QUESTION_KEY_RE = /^[A-Z][A-Z0-9_-]*$/
const SKILLS = ['spec-protocol', 'kaizen', 'eli5', 'bro']
const ANSWER_KINDS = ['free_text', 'single_choice', 'yes_no', 'confirm', 'mode_choice']
const INPUT_MODES = ['voice', 'typed', 'terminal']
const SENSITIVITIES = ['normal', 'secret', 'personal']
const questionRegistry = require('../../../../packages/candice-protocol/question-registry')

const MAX_TEXT_LENGTH = 4096
const MAX_SESSION_ID_LENGTH = 128

function bad(field, rule) {
  return { ok: false, code: 'invalid-question', field, rule }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function checkString(value, maxLength) {
  return typeof value === 'string' && value.length >= 1 && value.length <= maxLength
}

/**
 * validateQuestionEvent — field-level check against question-event.schema.json.
 *
 * @param {unknown} event the candidate question event
 * @returns {{ok:true, event:object}|{ok:false, code, field, rule}} ok:false
 *   carries exactly one first failure; the tool fails soft on any failure.
 */
function validateQuestionEvent(event) {
  if (!isPlainObject(event)) return bad('question', 'must be an object')
  if (event.schemaVersion !== '1.0') return bad('schemaVersion', 'must be the string "1.0"')
  if (event.event !== 'question') return bad('event', 'must be the string "question"')
  if (!SESSION_ID_RE.test(event.sessionId)) {
    return bad('sessionId', `must be a 1..${MAX_SESSION_ID_LENGTH} char printable string`)
  }
  if (!SKILLS.includes(event.skill)) {
    return bad('skill', 'must be one of spec-protocol, kaizen, eli5, bro')
  }
  if (typeof event.questionKey !== 'string' || !QUESTION_KEY_RE.test(event.questionKey)) {
    return bad('questionKey', 'must match ^[A-Z][A-Z0-9_-]*$')
  }
  if (!checkString(event.text, MAX_TEXT_LENGTH)) {
    return bad('text', 'must be a non-empty string of at most 4096 chars')
  }
  if (!ANSWER_KINDS.includes(event.answerKind)) {
    return bad('answerKind', 'must be one of free_text, single_choice, yes_no, confirm, mode_choice')
  }
  if (
    !Array.isArray(event.allowedInputModes) ||
    event.allowedInputModes.length < 1 ||
    !event.allowedInputModes.every((m) => INPUT_MODES.includes(m)) ||
    new Set(event.allowedInputModes).size !== event.allowedInputModes.length
  ) {
    return bad('allowedInputModes', 'must be a non-empty unique array of voice|typed|terminal')
  }
  if (typeof event.readAloud !== 'boolean') return bad('readAloud', 'must be a boolean')
  if (!SENSITIVITIES.includes(event.sensitivity)) {
    return bad('sensitivity', 'must be one of normal, secret, personal')
  }
  if (typeof event.counted !== 'boolean') return bad('counted', 'must be a boolean')
  if (typeof event.canGoBack !== 'boolean') return bad('canGoBack', 'must be a boolean')
  if (event.progress !== null && event.progress !== undefined) {
    const p = event.progress
    if (
      !isPlainObject(p) ||
      !Number.isInteger(p.current) ||
      p.current < 1 ||
      !Number.isInteger(p.ceiling) ||
      p.ceiling < 1 ||
      (p.shortcut !== null && p.shortcut !== undefined && !Number.isInteger(p.shortcut)) ||
      Object.keys(p).some((k) => !['current', 'ceiling', 'shortcut'].includes(k))
    ) {
      return bad('progress', 'must be null or { current>=1, ceiling>=1, shortcut:int|null }')
    }
  }
  if (event.helpText !== null && event.helpText !== undefined && typeof event.helpText !== 'string') {
    return bad('helpText', 'must be a string or null')
  }
  if (event.options !== null && event.options !== undefined) {
    if (
      !Array.isArray(event.options) ||
      event.options.some((o) => typeof o !== 'string' || o.length < 1) ||
      new Set(event.options).size !== event.options.length
    ) {
      return bad('options', 'must be null or a unique array of non-empty strings')
    }
  }
  if (event.validation !== null && event.validation !== undefined) {
    const v = event.validation
    if (
      !isPlainObject(v) ||
      Object.keys(v).some((k) => !['minLength', 'maxLength', 'pattern', 'requiredText'].includes(k)) ||
      (v.minLength !== undefined && (!Number.isInteger(v.minLength) || v.minLength < 0)) ||
      (v.maxLength !== undefined && (!Number.isInteger(v.maxLength) || v.maxLength < 1)) ||
      (v.pattern !== undefined && typeof v.pattern !== 'string') ||
      (v.requiredText !== undefined && typeof v.requiredText !== 'string')
    ) {
      return bad('validation', 'invalid validation object')
    }
  }
  for (const key of Object.keys(event)) {
    if (!ALLOWED_QUESTION_FIELDS.includes(key)) {
      return bad(key, 'additionalProperties:false (unknown field)')
    }
  }
  // A structurally valid object is still not deliverable unless every
  // authority-bearing field was produced by the versioned registry.
  const authority = questionRegistry.verifyQuestion(event)
  if (!authority.ok) return bad(authority.field || 'questionKey', authority.code)
  return { ok: true, event: authority.event, registryVersion: authority.registryVersion }
}

const ALLOWED_QUESTION_FIELDS = [
  'schemaVersion',
  'sessionId',
  'skill',
  'event',
  'questionKey',
  'text',
  'answerKind',
  'allowedInputModes',
  'readAloud',
  'sensitivity',
  'counted',
  'progress',
  'helpText',
  'options',
  'validation',
  'canGoBack',
]

/**
 * validateAnswerEvent — field-level check against answer-event.schema.json,
 * plus the runtime accept rule: userConfirmedTranscript must be true (a voice
 * transcription is never submitted until the user confirms; typed answers are
 * confirmed by typing — both arrive with true, answer.schema.json).
 *
 * @param {unknown} answer candidate answer event received from the surface
 * @returns {{ok:true, answer:object}|{ok:false, code, field, rule}}
 */
function validateAnswerEvent(answer) {
  if (!isPlainObject(answer)) return { ok: false, code: 'invalid-answer', field: 'answer', rule: 'must be an object' }
  if (answer.schemaVersion !== '1.0') {
    return { ok: false, code: 'invalid-answer', field: 'schemaVersion', rule: 'must be the string "1.0"' }
  }
  if (!SESSION_ID_RE.test(answer.sessionId)) {
    return { ok: false, code: 'invalid-answer', field: 'sessionId', rule: 'invalid session id' }
  }
  if (typeof answer.questionKey !== 'string' || !QUESTION_KEY_RE.test(answer.questionKey)) {
    return { ok: false, code: 'invalid-answer', field: 'questionKey', rule: 'must match ^[A-Z][A-Z0-9_-]*$' }
  }
  if (!checkString(answer.answerText, MAX_TEXT_LENGTH)) {
    return { ok: false, code: 'invalid-answer', field: 'answerText', rule: 'must be a non-empty string of at most 4096 chars' }
  }
  if (!INPUT_MODES.includes(answer.inputMode)) {
    return { ok: false, code: 'invalid-answer', field: 'inputMode', rule: 'must be one of voice, typed, terminal' }
  }
  if (typeof answer.userConfirmedTranscript !== 'boolean') {
    return { ok: false, code: 'invalid-answer', field: 'userConfirmedTranscript', rule: 'must be a boolean' }
  }
  if (answer.userConfirmedTranscript !== true) {
    return {
      ok: false,
      code: 'not-confirmed',
      field: 'userConfirmedTranscript',
      rule: 'a voice transcription is never submitted until the user confirms (USE ANSWER); typed answers set it true',
    }
  }
  if (answer.cancelled !== undefined && typeof answer.cancelled !== 'boolean') {
    return { ok: false, code: 'invalid-answer', field: 'cancelled', rule: 'must be a boolean' }
  }
  if (answer.sensitivity !== undefined && !SENSITIVITIES.includes(answer.sensitivity)) {
    return { ok: false, code: 'invalid-answer', field: 'sensitivity', rule: 'must be one of normal, secret, personal' }
  }
  if (answer.answeredAt !== undefined) {
    if (typeof answer.answeredAt !== 'string' || Number.isNaN(Date.parse(answer.answeredAt))) {
      return { ok: false, code: 'invalid-answer', field: 'answeredAt', rule: 'must be an ISO date-time string' }
    }
  }
  for (const key of Object.keys(answer)) {
    if (!ALLOWED_ANSWER_FIELDS.includes(key)) {
      return { ok: false, code: 'invalid-answer', field: key, rule: 'additionalProperties:false (unknown field)' }
    }
  }
  const authority = questionRegistry.verifyAnswer(answer)
  if (!authority.ok) {
    return { ok: false, code: 'invalid-answer', field: authority.field || 'questionKey', rule: authority.code }
  }
  return { ok: true, answer }
}

const ALLOWED_ANSWER_FIELDS = [
  'schemaVersion',
  'sessionId',
  'questionKey',
  'answerText',
  'inputMode',
  'userConfirmedTranscript',
  'cancelled',
  'sensitivity',
  'answeredAt',
]

module.exports = {
  validateQuestionEvent,
  validateAnswerEvent,
  SESSION_ID_RE,
  QUESTION_KEY_RE,
}
