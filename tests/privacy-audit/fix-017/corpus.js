'use strict'

/**
 * FIX-017 secret/private answer corpus + delivery-mode sinks.
 * Owned path: tests/privacy-audit/fix-017/** (FIX-017 builder lane, worktree
 * candice/wt-tests-harness; base b54aec0).
 *
 * Corpus rules (EXECUTION-PLAN.md "Secret/private answer corpus"):
 *   - Canary values are generated FRESH per run into a disposable temp dir;
 *     they are never tracked fixtures, never printed. The test records a
 *     canary hash and the artifact paths scanned — never the canary itself.
 *   - At least one canary per class: API/token material, personal answers,
 *     auth/recovery answers, sensitive project answers, and boundary
 *     mutations (secret with upstream readAloud:true, personal no consent,
 *     personal with consent, normal read-aloud on/off, missing sensitivity,
 *     replayed stale metadata).
 *   - Every corpus item carries a stable test id, sensitivity, consent state,
 *     expected speech decision, expected caption policy, expected log policy.
 *   - Answer-side canaries are carried alongside question text so an answer
 *     can never become speech/log/telemetry merely because the question was
 *     safe.
 *   - The disposable corpus dir is deleted in a finally block; the suites
 *     verify deletion after success, refusal, timeout, cancel, and restart.
 *
 * Sinks (delivery modes) — in-memory recorders shaped exactly like the real
 * production surfaces. The suites prove zero canary bytes reach any sink:
 *   - ttsSink: synthesized speech text + osTts invocation arguments
 *   - audioFileSink: audio files written (capture every byte written)
 *   - captionSink: caption DOM/accessibility text
 *   - logSink: structured logger lines
 *   - crashSink: crash-reporter payloads
 *   - telemetrySink: exported telemetry events
 *
 * Zero runtime dependencies, plain node.
 */

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

function sha256(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex')
}

/** One fresh random token per call — 32 hex chars from crypto.randomBytes. */
function freshSuffix() {
  return crypto.randomBytes(16).toString('hex')
}

/**
 * Build the disposable corpus. `opts.corpusDir` (optional) names the temp
 * root; default is a fresh mkdtemp under os.tmpdir(). The caller MUST
 * dispose via corpus.dispose() — the suites prove deletion after every leg.
 */
function buildCorpus(opts) {
  const options = opts || {}
  const dir = options.corpusDir || fs.mkdtempSync(path.join(os.tmpdir(), 'fix017-'))
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })

  const s = freshSuffix()
  const apiToken = `sk-${s}`
  const bearer = `Bearer ${s}`
  const privateKey = `-----BEGIN OPENSSH PRIVATE KEY-----\n${s}${s}\n-----END OPENSSH PRIVATE KEY-----`
  const opaqueCredential = `cred-${s}-${freshSuffix()}`
  const name = `Test Person ${s.slice(0, 8)}`
  const phone = `+1-555-${s.slice(0, 10)}`
  const email = `person-${s.slice(0, 8)}@example.invalid`
  const address = `1${s.slice(0, 6)} Example St`
  const unicodePersonal = `Prénom: Zoë — 東京 ${s.slice(0, 8)} — «confidentiel»`
  const password = `p@ss-${s}-!${freshSuffix()}`
  const recoveryCode = `RC-${s}-${s.slice(0, 8)}`
  const oneTimeCode = `${s.slice(0, 6)}`
  const customerId = `CUST-${s}`
  const financialAmount = `$1${s.slice(0, 7)}`
  const repoUrl = `https://git.internal.example.invalid/team/private-${s.slice(0, 8)}`
  const incidentLabel = `INC-${s.slice(0, 12)}`

  const items = [
    // — class 1: API/token material —
    {
      id: 'C1A',
      kind: 'api-token',
      sensitivity: 'secret',
      readAloud: false,
      questionText: 'Paste your API token.',
      answerCanary: apiToken,
      consent: { readAloudOptIn: false, captionOptIn: false },
      expectedSpeech: 'refuse-secret',
      expectedCaption: 'redact',
      expectedLog: 'key-code-only',
    },
    {
      id: 'C1B',
      kind: 'bearer',
      sensitivity: 'secret',
      readAloud: false,
      questionText: 'Paste the bearer credential.',
      answerCanary: bearer,
      consent: { readAloudOptIn: false, captionOptIn: false },
      expectedSpeech: 'refuse-secret',
      expectedCaption: 'redact',
      expectedLog: 'key-code-only',
    },
    {
      id: 'C1C',
      kind: 'ssh-private-key',
      sensitivity: 'secret',
      readAloud: false,
      questionText: 'Paste your private key.',
      answerCanary: privateKey,
      consent: { readAloudOptIn: false, captionOptIn: false },
      expectedSpeech: 'refuse-secret',
      expectedCaption: 'redact',
      expectedLog: 'key-code-only',
    },
    {
      id: 'C1D',
      kind: 'opaque-credential',
      sensitivity: 'secret',
      readAloud: false,
      questionText: 'Paste the generated credential.',
      answerCanary: opaqueCredential,
      consent: { readAloudOptIn: false, captionOptIn: false },
      expectedSpeech: 'refuse-secret',
      expectedCaption: 'redact',
      expectedLog: 'key-code-only',
    },
    // — class 2: personal answers —
    {
      id: 'C2A',
      kind: 'personal-contact',
      sensitivity: 'personal',
      readAloud: false,
      questionText: 'What are your contact details?',
      answerCanary: `${name} ${phone} ${email} ${address}`,
      consent: { readAloudOptIn: false, captionOptIn: false },
      expectedSpeech: 'refuse-personal-no-consent',
      expectedCaption: 'deny',
      expectedLog: 'key-code-only',
    },
    {
      id: 'C2B',
      kind: 'personal-unicode',
      sensitivity: 'personal',
      readAloud: false,
      questionText: 'How should we address you?',
      answerCanary: unicodePersonal,
      consent: { readAloudOptIn: false, captionOptIn: false },
      expectedSpeech: 'refuse-personal-no-consent',
      expectedCaption: 'deny',
      expectedLog: 'key-code-only',
    },
    // — class 3: auth/recovery answers —
    {
      id: 'C3A',
      kind: 'password',
      sensitivity: 'secret',
      readAloud: false,
      questionText: 'Enter the vault password.',
      answerCanary: password,
      consent: { readAloudOptIn: false, captionOptIn: false },
      expectedSpeech: 'refuse-secret',
      expectedCaption: 'redact',
      expectedLog: 'key-code-only',
    },
    {
      id: 'C3B',
      kind: 'recovery-code',
      sensitivity: 'secret',
      readAloud: false,
      questionText: 'Enter the recovery code.',
      answerCanary: recoveryCode,
      consent: { readAloudOptIn: false, captionOptIn: false },
      expectedSpeech: 'refuse-secret',
      expectedCaption: 'redact',
      expectedLog: 'key-code-only',
    },
    {
      id: 'C3C',
      kind: 'one-time-code',
      sensitivity: 'secret',
      readAloud: false,
      questionText: 'Enter the one-time code.',
      answerCanary: oneTimeCode,
      consent: { readAloudOptIn: false, captionOptIn: false },
      expectedSpeech: 'refuse-secret',
      expectedCaption: 'redact',
      expectedLog: 'key-code-only',
    },
    // — class 4: sensitive project answers —
    {
      id: 'C4A',
      kind: 'customer-id',
      sensitivity: 'secret',
      readAloud: false,
      questionText: 'Which customer is affected?',
      answerCanary: customerId,
      consent: { readAloudOptIn: false, captionOptIn: false },
      expectedSpeech: 'refuse-secret',
      expectedCaption: 'redact',
      expectedLog: 'key-code-only',
    },
    {
      id: 'C4B',
      kind: 'financial-amount',
      sensitivity: 'secret',
      readAloud: false,
      questionText: 'What is the affected amount?',
      answerCanary: financialAmount,
      consent: { readAloudOptIn: false, captionOptIn: false },
      expectedSpeech: 'refuse-secret',
      expectedCaption: 'redact',
      expectedLog: 'key-code-only',
    },
    {
      id: 'C4C',
      kind: 'private-repo-url',
      sensitivity: 'secret',
      readAloud: false,
      questionText: 'Which private repository?',
      answerCanary: repoUrl,
      consent: { readAloudOptIn: false, captionOptIn: false },
      expectedSpeech: 'refuse-secret',
      expectedCaption: 'redact',
      expectedLog: 'key-code-only',
    },
    {
      id: 'C4D',
      kind: 'incident-label',
      sensitivity: 'secret',
      readAloud: false,
      questionText: 'What is the internal incident label?',
      answerCanary: incidentLabel,
      consent: { readAloudOptIn: false, captionOptIn: false },
      expectedSpeech: 'refuse-secret',
      expectedCaption: 'redact',
      expectedLog: 'key-code-only',
    },
    // — class 5: boundary mutations —
    {
      id: 'C5A',
      kind: 'secret-readaloud-true',
      sensitivity: 'secret',
      readAloud: true, // erroneous upstream
      questionText: 'Paste the secret value.',
      answerCanary: `secret-${s}`,
      consent: { readAloudOptIn: false, captionOptIn: false },
      expectedSpeech: 'refuse-secret',
      expectedCaption: 'redact',
      expectedLog: 'key-code-only',
    },
    {
      id: 'C5B',
      kind: 'personal-no-consent',
      sensitivity: 'personal',
      readAloud: true,
      questionText: 'What is your personal detail?',
      answerCanary: `personal-${s}`,
      consent: { readAloudOptIn: false, captionOptIn: false },
      expectedSpeech: 'refuse-personal-no-consent',
      expectedCaption: 'deny',
      expectedLog: 'key-code-only',
    },
    {
      id: 'C5C',
      kind: 'personal-explicit-consent',
      sensitivity: 'personal',
      readAloud: false,
      questionText: 'What name should I say?',
      answerCanary: `spoken-name-${s.slice(0, 8)}`,
      consent: { readAloudOptIn: true, captionOptIn: true },
      expectedSpeech: 'speak',
      expectedCaption: 'show',
      expectedLog: 'key-code-only',
    },
    {
      id: 'C5D',
      kind: 'normal-readaloud-on',
      sensitivity: 'normal',
      readAloud: true,
      questionText: 'Describe your idea.',
      answerCanary: `idea-${s.slice(0, 8)}`,
      consent: { readAloudOptIn: false, captionOptIn: false },
      expectedSpeech: 'speak',
      expectedCaption: 'show',
      expectedLog: 'metadata-only',
    },
    {
      id: 'C5E',
      kind: 'normal-readaloud-off',
      sensitivity: 'normal',
      readAloud: false,
      questionText: 'Describe your idea in text.',
      answerCanary: `idea-text-${s.slice(0, 8)}`,
      consent: { readAloudOptIn: false, captionOptIn: false },
      expectedSpeech: 'speak', // normal speech follows the read-aloud preference at the adapter; the guard allows
      expectedCaption: 'show',
      expectedLog: 'metadata-only',
    },
    {
      id: 'C5F',
      kind: 'missing-sensitivity',
      sensitivity: undefined,
      readAloud: false,
      staleEntry: true, // the registry entry itself lost its sensitivity metadata
      questionText: 'Question with missing sensitivity metadata.',
      answerCanary: `missing-${s}`,
      consent: { readAloudOptIn: false, captionOptIn: false },
      expectedSpeech: 'refuse-missing',
      expectedCaption: 'deny',
      expectedLog: 'key-code-only',
    },
    {
      id: 'C5G',
      kind: 'replayed-stale-metadata',
      sensitivity: 'secret',
      readAloud: false,
      callerSensitivity: 'normal', // stale/caller-overridden echo
      questionText: 'Replayed secret question.',
      answerCanary: `replayed-${s}`,
      consent: { readAloudOptIn: false, captionOptIn: false },
      // Secret-first precedence: the refusal names the registered sensitivity;
      // the contradictory echo never influences the decision code.
      expectedSpeech: 'refuse-secret',
      expectedCaption: 'redact',
      expectedLog: 'key-code-only',
    },
  ]

  // Every item also records the full canary SET it must never leak:
  // question text + answer canary (answer-side canaries included per plan).
  // questionKey/skill map each item onto its REGISTERED authority.
  for (const item of items) {
    item.questionKey = item.sensitivity === 'secret' ? 'SECRET_INPUT' : item.sensitivity === 'personal' ? 'PERSONAL_INPUT' : 'BUILD_TARGET'
    item.skill = 'spec-protocol'
    item.canaries = [item.questionText, item.answerCanary]
    item.hashes = item.canaries.map(sha256)
  }

  const allCanaries = []
  for (const item of items) {
    for (const c of item.canaries) if (!allCanaries.includes(c)) allCanaries.push(c)
  }

  const manifest = {
    corpusVersion: '1.0',
    createdAt: new Date().toISOString(),
    dir,
    itemCount: items.length,
    // Hashes only — never canary values.
    items: items.map((it) => ({
      id: it.id,
      kind: it.kind,
      sensitivity: it.sensitivity === undefined ? null : it.sensitivity,
      expectedSpeech: it.expectedSpeech,
      expectedCaption: it.expectedCaption,
      expectedLog: it.expectedLog,
      questionHash: sha256(it.questionText),
      answerHash: sha256(it.answerCanary),
    })),
  }

  // Write manifest to the disposable dir (hashes only) — proof of life for
  // the artifact scan (the scan must find the manifest but never a canary).
  fs.writeFileSync(path.join(dir, 'corpus-manifest.json'), JSON.stringify(manifest, null, 2), { encoding: 'utf8', mode: 0o600 })

  return {
    dir,
    items,
    manifest,
    allCanaries,
    dispose() {
      fs.rmSync(dir, { recursive: true, force: true })
    },
    /** True when the disposable dir is fully gone. */
    disposed() {
      return !fs.existsSync(dir)
    },
  }
}

/**
 * fresh sinks — in-memory delivery-mode recorders. Each sink keeps only what
 * the production surface would receive; the scan compares sink contents
 * against the canary set byte-for-byte.
 */
function freshSinks() {
  const tts = {
    calls: [], // { text } — synthesized text (production TTS invocation args)
    synthesize(text, extra) {
      const record = { text: String(text) }
      if (extra !== undefined) record.extra = JSON.parse(JSON.stringify(extra))
      tts.calls.push(record)
    },
    osTtsCall(args) {
      tts.calls.push({ text: '', osTtsArgs: JSON.parse(JSON.stringify(args || [])) })
    },
    bytes() {
      return tts.calls.map((c) => JSON.stringify(c)).join('\n')
    },
  }

  const audioFiles = {
    written: [], // { path, bytes } — every byte a real audio-file writer would persist
    write(filePath, bytes) {
      audioFiles.written.push({ path: String(filePath), bytes: Buffer.from(bytes) })
    },
    bytes() {
      return audioFiles.written.map((w) => w.bytes.toString('latin1')).join('')
    },
  }

  const captions = {
    shown: [], // { text } — caption DOM/accessibility text
    show(text) {
      captions.shown.push({ text: String(text) })
    },
    text() {
      return captions.shown.map((s) => s.text).join('\n')
    },
  }

  const logs = {
    lines: [], // structured logger lines
    info(line) {
      logs.lines.push(JSON.parse(JSON.stringify(line)))
    },
    bytes() {
      return logs.lines.map((l) => JSON.stringify(l)).join('\n')
    },
  }

  const crash = {
    payloads: [], // crash-reporter payloads
    report(payload) {
      crash.payloads.push(JSON.parse(JSON.stringify(payload)))
    },
    bytes() {
      return crash.payloads.map((p) => JSON.stringify(p)).join('\n')
    },
  }

  const telemetry = {
    events: [], // exported telemetry events
    emit(event) {
      telemetry.events.push(JSON.parse(JSON.stringify(event)))
    },
    bytes() {
      return telemetry.events.map((e) => JSON.stringify(e)).join('\n')
    },
  }

  /** The combined scan surface: every byte every sink recorded. */
  function scanSurface() {
    return {
      tts: tts.bytes(),
      audioFiles: audioFiles.bytes(),
      captions: captions.text(),
      logs: logs.bytes(),
      crash: crash.bytes(),
      telemetry: telemetry.bytes(),
    }
  }

  return { tts, audioFiles, captions, logs, crash, telemetry, scanSurface }
}

module.exports = { buildCorpus, freshSinks, sha256 }
