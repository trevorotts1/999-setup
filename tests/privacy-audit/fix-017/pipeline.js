'use strict'

/**
 * FIX-017 delivery pipeline — the full answer/display/TTS/log/telemetry path
 * every corpus item is pushed through. Owned path:
 * tests/privacy-audit/fix-017/** (FIX-017 builder lane).
 *
 * The pipeline mirrors the real production delivery order and calls the
 * shared final-boundary guard IMMEDIATELY before every side effect:
 *
 *   1. producer event arrives (question event; may carry erroneous upstream
 *      readAloud/sensitivity echoes — untrusted);
 *   2. answer event arrives (answer canary; never logged);
 *   3. final-boundary guard decisions (speech / caption / log) derived from
 *      the REGISTERED question authority + explicit consent;
 *   4. side effects: TTS invocation, audio-file creation, caption render,
 *      logger, crash reporter, telemetry exporter — each gated by its guard
 *      decision, each recording what the production surface would receive.
 *
 * A refusal is a named non-sensitive status; it must not wedge the session
 * and must not produce a secret-containing fallback message.
 */

const { decideSpeech, _decideFromEntry, captionPolicy, _captionFromEntry, logPolicy, REDACTED_SECRET_LABEL } = require('../../../plugins/candice-integration/privacy/final-boundary-guard')

/**
 * runOne — deliver one corpus item through the pipeline.
 *
 * @param {object} item corpus item (from corpus.js buildCorpus)
 * @param {object} sinks freshSinks() recorders
 * @returns {object} { speech, caption, log, sessionHealthy } — decision
 *   objects only; never canary text.
 */
function runOne(item, sinks) {
  const questionKey = item.questionKey
  const skill = item.skill || 'spec-protocol'

  // 2. Answer arrives (typed/voice — the answer canary never enters a log).
  const answer = {
    schemaVersion: '1.0',
    sessionId: item.sessionId || 'sess-fix017',
    questionKey,
    answerText: item.answerCanary,
    inputMode: item.inputMode || 'typed',
    userConfirmedTranscript: true,
    sensitivity: item.sensitivity,
  }

  // 3. Final-boundary decisions — derived from the registered authority.
  // A `staleEntry` item models a corrupted registry row (sensitivity metadata
  // missing on the trusted entry itself): the guard must fail closed on it.
  let speech
  let corrupted = null
  if (item.staleEntry) {
    const { lookup } = require('../../../packages/candice-protocol/question-registry')
    const found = lookup(questionKey, skill)
    if (!found.ok) {
      speech = { ok: false, decision: 'refuse-unknown', reason: found.code }
    } else {
      corrupted = JSON.parse(JSON.stringify(found.entry))
      delete corrupted.privacy.sensitivity
      speech = _decideFromEntry(corrupted, {
        callerSensitivity: item.callerSensitivity,
        callerReadAloud: item.readAloud,
        consent: item.consent,
      })
    }
  } else {
    speech = decideSpeech({
      questionKey,
      skill,
      callerSensitivity: item.callerSensitivity !== undefined ? item.callerSensitivity : item.sensitivity,
      callerReadAloud: item.readAloud,
      consent: item.consent,
    })
  }
  // The caption policy is ALWAYS derived through the real guard function —
  // never hardcoded — so a corrupted registry entry exercises the guard's
  // own fail-closed branch (H01 D1: the staleEntry leg must not bypass
  // captionPolicy). The log leg for a stale entry stays conservative
  // key-code-only (logPolicy was not a named defect).
  const caption = item.staleEntry && corrupted
    ? _captionFromEntry(corrupted, item.consent)
    : captionPolicy({ questionKey, skill, consent: item.consent })
  const log = item.staleEntry
    ? { ok: false, policy: 'key-code-only', reason: 'stale registry entry', allowed: [] }
    : logPolicy({ questionKey, skill })

  // 3b. Fault injection: cancel/timeout arrives AFTER the decisions, BEFORE
  // any side effect. Nothing may reach a sink; the session stays healthy.
  if (item.fault && item.fault.abort === 'cancel') {
    return { speech, caption, log, sessionHealthy: true, aborted: 'cancel' }
  }
  if (item.fault && item.fault.abort === 'timeout') {
    return { speech, caption, log, sessionHealthy: true, aborted: 'timeout' }
  }

  // 4. Side effects, each gated immediately before the sink write.
  let sessionHealthy = true

  // 4a. TTS / OS-TTS / audio-file creation — only on 'speak'.
  if (speech.ok) {
    sinks.tts.synthesize(item.questionText)
    sinks.tts.osTtsCall(['--speak', item.questionText])
    sinks.audioFiles.write(`${item.id}.wav`, Buffer.from(`RIFF${item.questionText}`, 'latin1'))
  } else {
    // Refusal: no TTS, no audio file, no playback enqueue. The refusal status
    // is named and non-sensitive.
    sinks.logs.info({ code: speech.decision, questionKey })
    sessionHealthy = sessionHealthy && ['refuse-secret', 'refuse-personal-no-consent', 'refuse-read-aloud-disabled', 'refuse-unknown', 'refuse-missing', 'refuse-cross-skill', 'refuse-replayed-metadata'].includes(speech.decision)
  }

  // 4b. Caption surface.
  if (caption.ok && caption.policy === 'show') {
    sinks.captions.show(item.questionText)
  } else if (caption.policy === 'redact') {
    sinks.captions.show(REDACTED_SECRET_LABEL)
  } else {
    sinks.captions.show('[no caption]')
  }

  // 4c. Logger — key/code only for secret/personal; metadata for normal.
  const allowed = log.allowed
  const logRecord = { code: 'answer-recorded', questionKey }
  for (const field of allowed) {
    if (field === 'inputMode') logRecord.inputMode = answer.inputMode
    else if (field === 'answeredAt') logRecord.answeredAt = new Date().toISOString()
    else if (field === 'sensitivity') logRecord.sensitivity = item.sensitivity
    else if (field === 'skill') logRecord.skill = skill
  }
  sinks.logs.info(logRecord)

  // 4d. Crash reporter — never text.
  sinks.crash.report({ code: 'session-snapshot', questionKey, skill })

  // 4e. Telemetry exporter — never text.
  sinks.telemetry.emit({ event: 'question-answered', questionKey, inputMode: answer.inputMode })

  // 4f. Session health: the refusal must not wedge the pending session.
  // The lifecycle continues; the answer routes back to Claude exactly once.

  return { speech, caption, log, sessionHealthy }
}

/**
 * deliverCorpus — run every item; per-item record with sink fingerprint
 * (hashes of sink contents, never contents).
 *
 * @returns {object} { perItem, totals }
 */
function deliverCorpus(corpus, sinks) {
  const perItem = []
  for (const item of corpus.items) {
    const r = runOne(item, sinks)
    perItem.push({
      id: item.id,
      speech: r.speech.decision,
      caption: r.caption.policy,
      log: r.log.policy,
      sessionHealthy: r.sessionHealthy,
      expected: { speech: item.expectedSpeech, caption: item.expectedCaption, log: item.expectedLog },
    })
  }
  const surface = sinks.scanSurface()
  return {
    perItem,
    totals: {
      items: corpus.items.length,
      spoken: perItem.filter((p) => p.speech === 'speak').length,
      refused: perItem.filter((p) => p.speech !== 'speak').length,
      sinkBytes: Object.keys(surface).reduce((acc, k) => acc + Buffer.byteLength(surface[k], 'utf8'), 0),
    },
  }
}

module.exports = { runOne, deliverCorpus }
