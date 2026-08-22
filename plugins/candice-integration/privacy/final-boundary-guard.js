'use strict'

/**
 * candice-integration / privacy/final-boundary-guard.js
 * FIX-017 — the shared final-boundary privacy guard.
 *
 * Owned path: plugins/candice-integration/privacy/** (FIX-017 builder lane,
 * worktree candice/wt-tests-harness; base b54aec0).
 *
 * Contract (FIXES-AND-QC FIX-017 + evidence/FIX-017/audit/EXECUTION-PLAN.md):
 *
 *   - The TRUSTED pending registered question is the source of truth, never
 *     an echoed caller field. Callers pass the registered question KEY and
 *     SKILL plus a consent state; this module re-derives sensitivity and
 *     read-aloud policy from the versioned registry
 *     (packages/candice-protocol/question-registry.js) and fails closed on
 *     unknown, missing, retired, or cross-skill keys.
 *   - The decision is derived immediately before the caller performs any
 *     speech/audio/caption/log side effect. Every delivery path (TTS
 *     invocation, audio-file creation, caption render, logger, crash
 *     reporter, telemetry exporter) calls decideSpeech() first.
 *   - A refusal is a named non-sensitive status, never an error carrying
 *     payload text.
 *   - The decision object NEVER returns secret question or answer text.
 *
 * Decision table (EXECUTION-PLAN.md "Required privacy authority"):
 *
 *   sensitivity | speech | caption | log/persist/telemetry
 *   ------------|--------|---------|-----------------------
 *   normal      | allowed when consent+capability allow | allowed  | metadata only
 *   personal    | denied unless explicit opt-in        | allowed  | key/code only, no text
 *   secret      | always denied (even readAloud:true upstream) | redacted label | key/code only
 *
 * Consent model (v1): `consent` is an explicit caller-supplied object.
 * `consent.readAloudOptIn === true` is the ONLY opt-in for personal read-aloud.
 * `consent.captionOptIn === true` opts into caption display of personal text.
 * Secret captions always render as the fixed redacted label
 * `[redacted — secret answer]`, regardless of consent.
 *
 * Pure CommonJS, zero runtime dependencies (repo convention: sections
 * 12/17/27 — no package-manager step on the customer machine).
 */

const { lookup } = require('../../../packages/candice-protocol/question-registry')

const SENSITIVITIES = ['normal', 'personal', 'secret']

const REDACTED_SECRET_LABEL = '[redacted — secret answer]'

/**
 * decideSpeech — the one shared final-boundary decision.
 *
 * @param {object} input
 * @param {string} input.questionKey  registered question key (trusted authority)
 * @param {string} input.skill        owning skill (cross-skill keys fail closed)
 * @param {string} [input.callerSensitivity]  UNTRUSTED caller echo; used only
 *   for the replay/caller-override detection legs, never as authority
 * @param {boolean} [input.callerReadAloud]   UNTRUSTED upstream readAloud echo
 * @param {object} [input.consent]  explicit consent state
 * @param {boolean} [input.consent.readAloudOptIn]
 * @param {boolean} [input.consent.captionOptIn]
 * @returns {object} always { ok, decision, reason } — `decision` is one of
 *   'speak' | 'refuse-secret' | 'refuse-personal-no-consent' |
 *   'refuse-read-aloud-disabled' | 'refuse-unknown' | 'refuse-missing' |
 *   'refuse-cross-skill'; `ok` is true only for 'speak'. Never contains
 *   question/answer text.
 */
function decideSpeech(input) {
  const i = input || {}
  const key = i.questionKey
  const skill = i.skill
  if (typeof key !== 'string' || key.length === 0) {
    return { ok: false, decision: 'refuse-missing', reason: 'no registered question key' }
  }
  if (typeof skill !== 'string' || skill.length === 0) {
    return { ok: false, decision: 'refuse-missing', reason: 'no owning skill' }
  }
  const governed = lookup(key, skill)
  if (!governed.ok) {
    return { ok: false, decision: governed.code === 'question-skill-mismatch' ? 'refuse-cross-skill' : 'refuse-unknown', reason: governed.code }
  }
  return _decideFromEntry(governed.entry, {
    callerSensitivity: i.callerSensitivity,
    callerReadAloud: i.callerReadAloud,
    consent: i.consent,
  })
}

/**
 * _decideFromEntry — the pure decision core. Exposed for unit legs that feed
 * a corrupted/stale registry entry (missing sensitivity metadata) to prove
 * the fail-closed branch; production callers always use decideSpeech().
 *
 * Decision order (fail-closed precedence):
 *   1. missing sensitivity metadata  -> refuse-missing (never defaults open)
 *   2. secret                         -> refuse-secret (always, even with an
 *                                        erroneous upstream readAloud:true)
 *   3. personal without opt-in        -> refuse-personal-no-consent
 *   4. normal with registry readAloud:false -> refuse-read-aloud-disabled
 *                                        (the registry is the authority; a
 *                                        caller echo of readAloud:true never
 *                                        overrides it)
 *   5. caller echo contradicting the registry -> refuse-replayed-metadata
 *   6. otherwise                      -> speak
 *
 * @param {object} entry registry entry (question-keys.json row)
 * @param {object} [echoes] { callerSensitivity, callerReadAloud, consent }
 * @returns {object} decision object, never payload text
 */
function _decideFromEntry(entry, echoes) {
  const e = entry || {}
  const privacy = e.privacy || {}
  const sensitivity = privacy.sensitivity

  if (!SENSITIVITIES.includes(sensitivity)) {
    // Unknown/missing sensitivity metadata fails closed.
    return { ok: false, decision: 'refuse-missing', reason: 'registry sensitivity missing' }
  }

  if (sensitivity === 'secret') {
    return { ok: false, decision: 'refuse-secret', reason: 'secret answers are never spoken' }
  }

  if (sensitivity === 'personal') {
    const optIn = !!(echoes && echoes.consent && echoes.consent.readAloudOptIn === true)
    if (!optIn) {
      return { ok: false, decision: 'refuse-personal-no-consent', reason: 'personal read-aloud requires explicit user opt-in' }
    }
  }

  // The registry readAloud flag is the authority for normal keys: a normal
  // question registered readAloud:false must never be spoken, and a caller
  // echo of readAloud:true cannot override it. (For secret the secret-first
  // precedence already refused; for personal the opt-in gate above governs.)
  if (sensitivity === 'normal' && privacy.readAloud === false) {
    return { ok: false, decision: 'refuse-read-aloud-disabled', reason: 'registry readAloud:false forbids speech' }
  }

  // A caller SENSITIVITY echo that contradicts the registry is a replay/override
  // defect: refuse speech and name the defect by code, never by payload text.
  if (echoes && echoes.callerSensitivity !== undefined && echoes.callerSensitivity !== sensitivity) {
    return { ok: false, decision: 'refuse-replayed-metadata', reason: 'caller sensitivity contradicts the registry' }
  }

  return { ok: true, decision: 'speak', reason: sensitivity === 'personal' ? 'personal read-aloud opted in' : 'normal read-aloud allowed' }
}

/**
 * captionPolicy — what the caption surface may show for the pending question.
 * Secret captions are ALWAYS the fixed redacted label; personal captions
 * require explicit caption opt-in; normal captions are allowed. Missing or
 * unknown sensitivity metadata fails closed (deny) — the same entry that
 * decideSpeech refuses must never be shown as a caption. Never returns
 * question text (the caller's caption renderer already holds it; this policy
 * only gates whether it may be shown).
 *
 * @returns {object} { ok, policy, reason } with policy one of
 *   'show' | 'redact' | 'deny'.
 */
function captionPolicy(input) {
  const i = input || {}
  const key = i.questionKey
  const skill = i.skill
  if (typeof key !== 'string' || key.length === 0 || typeof skill !== 'string' || skill.length === 0) {
    return { ok: false, policy: 'deny', reason: 'no registered question key or skill' }
  }
  const governed = lookup(key, skill)
  if (!governed.ok) {
    return { ok: false, policy: 'deny', reason: governed.code }
  }
  return _captionFromEntry(governed.entry, i.consent)
}

/**
 * _captionFromEntry — the pure caption decision core. Exposed for unit legs
 * that feed a corrupted/stale registry entry (missing or unknown sensitivity
 * metadata) to prove the caption surface fails closed exactly like
 * decideSpeech; production callers always use captionPolicy().
 *
 * @param {object} entry registry entry (question-keys.json row)
 * @param {object} [consent] { captionOptIn }
 * @returns {object} { ok, policy, reason } — policy 'show' | 'redact' | 'deny'
 */
function _captionFromEntry(entry, consent) {
  const e = entry || {}
  const privacy = e.privacy || {}
  const sensitivity = privacy.sensitivity
  if (!SENSITIVITIES.includes(sensitivity)) {
    // Missing/unknown sensitivity metadata fails closed on the caption
    // surface too — never defaults to 'show'.
    return { ok: false, policy: 'deny', reason: 'registry sensitivity missing' }
  }
  if (sensitivity === 'secret') {
    return { ok: true, policy: 'redact', reason: 'fixed redacted label only', label: REDACTED_SECRET_LABEL }
  }
  if (sensitivity === 'personal') {
    const optIn = !!(consent && consent.captionOptIn === true)
    return optIn
      ? { ok: true, policy: 'show', reason: 'personal caption opted in' }
      : { ok: false, policy: 'deny', reason: 'personal caption requires explicit user opt-in' }
  }
  return { ok: true, policy: 'show', reason: 'normal caption allowed' }
}

/**
 * logPolicy — what the logger/crash/telemetry/persistence sinks may receive
 * for the pending question and its answer.
 *
 * @returns {object} { ok, policy, reason, allowed } with policy one of
 *   'key-code-only' (never question/answer text) or 'metadata-only' (existing
 *   contract permits text only where it explicitly says so — this module
 *   still refuses text). `allowed` lists the exact non-secret field names the
 *   sink may persist.
 */
function logPolicy(input) {
  const i = input || {}
  const key = i.questionKey
  const skill = i.skill
  if (typeof key !== 'string' || key.length === 0 || typeof skill !== 'string' || skill.length === 0) {
    return { ok: false, policy: 'key-code-only', reason: 'no registered question key or skill', allowed: [] }
  }
  const governed = lookup(key, skill)
  if (!governed.ok) {
    return { ok: false, policy: 'key-code-only', reason: governed.code, allowed: [] }
  }
  const privacy = governed.entry.privacy || {}
  const sensitivity = privacy.sensitivity || 'normal'
  if (sensitivity === 'normal') {
    return { ok: true, policy: 'metadata-only', reason: 'metadata only; no text', allowed: ['questionKey', 'skill', 'sensitivity', 'counted', 'inputMode', 'answeredAt'] }
  }
  return { ok: true, policy: 'key-code-only', reason: 'key/code only', allowed: ['questionKey', 'skill', 'sensitivity', 'inputMode', 'answeredAt'] }
}

/** The fixed caption text used for every secret question. */
const SECRET_CAPTION = REDACTED_SECRET_LABEL

module.exports = {
  decideSpeech,
  _decideFromEntry,
  captionPolicy,
  _captionFromEntry,
  logPolicy,
  REDACTED_SECRET_LABEL,
  SECRET_CAPTION,
}
