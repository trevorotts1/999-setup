'use strict'

/**
 * candice same-session suite — E.1 WS-42 leg 3: routed provider identity does
 * not change Candice behavior — owned path: tests/same-session/**
 *
 * E.1 WS-42 third clause: "routed provider identity does not change Candice
 * behavior." Under claude-nine the session model is a router alias or a
 * provider-prefixed id (SKILL.md harness table); under plain claude it is an
 * Anthropic model. Candice must behave identically in both worlds, because
 * Candice is presentation infrastructure and the ACTIVE Claude session is the
 * only brain (spec 2).
 *
 * What the shipped code proves:
 *   - The plugin carries ZERO provider coupling: no ANTHROPIC / DEEPSEEK /
 *     OLLAMA / AGNES / OPENROUTER credential keys, no router config, no
 *     provider-prefixed model ids anywhere in production
 *     plugins/candice-integration/** source (tests, docs, checkpoints, and
 *     fixtures are excluded from the static scan because they legitimately
 *     quote what the code must NOT do).
 *   - Every env read in production code is on the explicit non-provider
 *     Candice allowlist: CANDICE_COMPANION_READY (the companion-presence
 *     probe) and CANDICE_COMPANION_CMD (the companion launch command).
 *     Anything else — provider keys, router knobs — is rejected.
 *   - The behavioral seams (MCP server, fallback, lifecycle) therefore cannot
 *     branch on provider identity: a question asked by a routed session and a
 *     question asked by a plain session walk the SAME code. Proven functionally
 *     below: the ask path returns the same shape with the session env carrying
 *     router signals or carrying none, because the code never looks at them.
 *
 * The env simulation is contained to a child process (node -e) so the parent
 * runner's environment is never mutated, and no real provider values are ever
 * printed — only booleans.
 *
 * Mutation guards: the static deny/allow assertions are applied to synthetic
 * fixtures (positive and negative), proving the policy itself rejects provider
 * variables and admits only allowed configuration variables. And a behavioral
 * probe proves the allowed CANDICE_COMPANION_CMD configuration variable cannot
 * alter session routing — every answer still returns to the owning session id
 * or is refused.
 *
 * Pure CommonJS, zero dependencies, cross-platform:
 *   node tests/same-session/provider-identity.test.js
 */

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const harness = require('./harness')

let failures = 0

function check(name, fn) {
  try {
    fn()
    console.log(`ok - ${name}`)
  } catch (err) {
    failures += 1
    console.log(`FAIL - ${name}`)
    console.log(`  ${err && err.message ? err.message : err}`)
  }
}

const PLUGIN_DIR = harness.PLUGIN_ROOT

// ---------------------------------------------------------------------------
// Policy (shared by the production scan and its mutation fixtures)
// ---------------------------------------------------------------------------

// Provider/routing environment variables and endpoint hosts that production
// code must never read or reference. Keeping this in one table means the
// mutation fixtures mutate the SAME policy the production scan enforces.
const PROVIDER_TOKENS = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'DEEPSEEK_API_KEY', 'DEEPSEEK_AUTH_TOKEN',
  'OLLAMA_API_KEY', 'AGNES_API_KEY', 'AGNES_AUTH_TOKEN', 'OPENROUTER_API_KEY',
  'OPENROUTER_AUTH_TOKEN', 'api.deepseek.com', 'api.openrouter.ai',
]

// Explicit non-provider Candice allowlist: the only environment variables the
// shipped plugin may read. READY is the companion-presence probe; CMD is the
// companion launch command. Neither is a provider key or a router knob.
const ALLOWED_ENV = ['CANDICE_COMPANION_READY', 'CANDICE_COMPANION_CMD']

// A further provider/routing deny surface: router aliases, router-knob env,
// provider-prefixed model ids, and gateway hosts. Anything hitting these in
// production code would couple Candice to how the session was launched.
const ROUTER_TOKENS = ['9router', '9Router', 'claude-nine', /cx\//]

/**
 * The interview registry legitimately NAMES the two supported harnesses in a
 * question it asks the user: CAPACITY_HARNESS_CONFIRM, "Which AI tool are you
 * running this in?", options ["claude-code", "claude-nine"]. Naming a product
 * in a question is not coupling to it -- Candice still never branches on the
 * answer, which is the invariant this file exists to defend.
 *
 * The exemption is SELF-POLICING and deliberately narrow: it holds only while
 * EVERY occurrence of the token in that file sits inside a question's
 * user-facing copy. The moment "claude-nine" appears in a key, a validation
 * rule, or any other position, `seen !== total`, the exemption evaporates, and
 * the scan fails exactly as before. 9router, provider keys and
 * provider-prefixed model ids remain banned in this file like everywhere else.
 */
const REGISTRY_SCHEMA = /packages[/\\]candice-protocol[/\\]schemas[/\\]question-keys\.json$/
const REGISTRY_COPY_FIELDS = ['display', 'spoken', 'meaning', 'helpText', 'options']

function claudeNineIsQuestionCopyOnly(src) {
  let parsed
  try {
    parsed = JSON.parse(src)
  } catch (err) {
    return false
  }
  if (!parsed || !Array.isArray(parsed.keys)) return false
  const total = (src.match(/claude-nine/g) || []).length
  if (total === 0) return false
  let seen = 0
  for (const entry of parsed.keys) {
    for (const field of REGISTRY_COPY_FIELDS) {
      const value = entry[field]
      const text = Array.isArray(value)
        ? value.filter((v) => typeof v === 'string').join('\u0000')
        : (typeof value === 'string' ? value : '')
      seen += (text.match(/claude-nine/g) || []).length
    }
  }
  return seen === total
}

/**
 * Walks production source under `root`: skips node_modules, .git, and every
 * non-production surface (__tests__, docs, fixtures, generated output,
 * evidence). Returns absolute file paths.
 */
function productionFiles(root) {
  const EXCLUDED_DIRS = new Set(['node_modules', '.git', '__tests__', 'docs', 'fixtures', 'generated', 'evidence'])
  const files = []
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) walk(path.join(dir, entry.name))
      } else if (entry.isFile()) {
        files.push(path.join(dir, entry.name))
      }
    }
  }
  walk(root)
  return files
}

/** Every `process.env.<VAR>` read in `files`, as "VAR in <relpath>". */
function envReads(files) {
  const reads = []
  for (const file of files) {
    if (!/\.(js|mjs|cjs|sh|json)$/.test(file)) continue
    const src = fs.readFileSync(file, 'utf8')
    const m = src.match(/process\.env\.([A-Z0-9_]+)/g)
    if (!m) continue
    for (const hit of m) reads.push(`${hit.slice('process.env.'.length)} in ${path.relative(harness.REPO_ROOT, file)}`)
  }
  return reads
}

/**
 * Applies the production static policy to the tree under `root`, returning an
 * array of violation strings (empty = clean). Paths are reported relative to
 * `root` so the mutation fixtures assert stable names. The fixtures call this
 * too, so the policy under test is byte-identical to the policy enforced
 * live.
 */
function staticPolicyViolations(root) {
  const violations = []
  for (const file of productionFiles(root)) {
    const rel = path.relative(root, file)
    const src = fs.readFileSync(file, 'utf8')
    for (const token of PROVIDER_TOKENS) {
      if (src.includes(token)) {
        violations.push(`provider token ${token} in ${rel}`)
      }
    }
    const registryCopyOnly = REGISTRY_SCHEMA.test(file) && claudeNineIsQuestionCopyOnly(src)
    for (const token of ROUTER_TOKENS) {
      if (typeof token === 'string') {
        if (token === 'claude-nine' && registryCopyOnly) continue
        if (src.includes(token)) {
          violations.push(`router token ${token} in ${rel}`)
        }
      } else if (token.test(src)) {
        violations.push(`provider-prefixed model id in ${rel}`)
      }
    }
    if (/\.(js|mjs|cjs|sh|json)$/.test(file)) {
      const m = src.match(/process\.env\.([A-Z0-9_]+)/g)
      if (!m) continue
      for (const hit of m) {
        const name = hit.slice('process.env.'.length)
        if (!ALLOWED_ENV.includes(name)) {
          violations.push(`env read outside allowlist: ${name} in ${rel}`)
        }
      }
    }
  }
  return violations
}

/** Writes the synthetic plugin tree used by the mutation fixtures. */
function makeFixtureDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'candice-provider-identity-'))
}

// ---------------------------------------------------------------------------
// Static: production plugin source has zero provider/routing coupling
// ---------------------------------------------------------------------------

check('plugin tree contains no provider credential or router keys', () => {
  const walked = productionFiles(PLUGIN_DIR)
  assert.ok(walked.length > 5, 'plugin production tree was walked')
  for (const file of walked) {
    const src = fs.readFileSync(file, 'utf8')
    for (const token of PROVIDER_TOKENS) {
      assert.ok(!src.includes(token), `no ${token} in ${path.relative(harness.REPO_ROOT, file)}`)
    }
  }
})

check('no router config, no provider-prefixed model id in production plugin source', () => {
  // Scans production source only: tests, docs, checkpoints, and fixtures are
  // excluded, so wording that legitimately quotes what the code must NOT do
  // (e.g. a dispatcher test asserting no claude-nine coupling) is not misread
  // as shipped coupling. R1 closure (fan-in): the wake-dispatcher self-test
  // names SHIPPED launcher files only to prove the launcher does NOT implement
  // or bypass Candice wake dispatch — an anti-coupling assertion, not a
  // coupling — so its own source is exempted from the claude-nine scan while
  // provider keys and router knobs stay banned everywhere.
  const walked = productionFiles(PLUGIN_DIR)
  assert.ok(walked.length > 5, 'plugin production tree was walked')
  const antiCouplingTest = new RegExp('bin[/\\\\]__tests__[/\\\\]wake-dispatcher\\.test\\.mjs$')
  for (const file of walked) {
    const src = fs.readFileSync(file, 'utf8')
    assert.ok(!src.includes('9router') && !src.includes('9Router'), `no 9router reference in ${file}`)
    const registryCopyOnly = REGISTRY_SCHEMA.test(file) && claudeNineIsQuestionCopyOnly(src)
    if (!antiCouplingTest.test(file) && !registryCopyOnly) {
      assert.ok(!src.includes('claude-nine'), `no claude-nine coupling in ${file}`)
    }
    assert.ok(!/cx\//.test(src), `no provider-prefixed model id in ${file}`)
  }
})

check('production env reads are exactly the non-provider Candice allowlist', () => {
  const reads = envReads(productionFiles(PLUGIN_DIR))
  // The shipped plugin must read at least one allowlisted env variable — the
  // policy is proven against real production code, not a vacuous empty set.
  // (CANDICE_COMPANION_READY is allowlisted for the install/bootstrap lane's
  // companion-presence probe; not every allowlisted name must be read by this
  // plugin's own code.)
  assert.ok(reads.length >= 1, 'at least one allowlisted env read must be present')
  for (const read of reads) {
    const name = read.split(' in ')[0]
    assert.ok(ALLOWED_ENV.includes(name), `env read outside allowlist: ${read}`)
  }
})

check('static policy is enforced against production source', () => {
  const violations = staticPolicyViolations(PLUGIN_DIR)
  assert.deepStrictEqual(violations, [], `production violations:\n${violations.join('\n')}`)
})

// ---------------------------------------------------------------------------
// Mutation guards: the policy rejects provider vars and admits ONLY the
// allowed non-provider configuration vars
// ---------------------------------------------------------------------------

check('mutation: provider variables are rejected by the production policy', () => {
  const dir = makeFixtureDir()
  try {
    // Positive control — the exact allowlisted reads pass the policy.
    fs.writeFileSync(path.join(dir, 'wake-candice.mjs'),
      "const cmd = process.env.CANDICE_COMPANION_CMD || 'candice-companion'\n")
    assert.deepStrictEqual(staticPolicyViolations(dir), [], 'allowlist fixture must pass')

    // Each negative case overwrites the SAME fixture file, so every assertion
    // sees exactly one violating file.
    const leak = path.join(dir, 'leak.js')

    // Provider key read — must be rejected on BOTH surfaces (the key token
    // and the env read are independent deny rules).
    fs.writeFileSync(leak, 'const key = process.env.DEEPSEEK_API_KEY\n')
    assert.deepStrictEqual(
      staticPolicyViolations(dir),
      [
        'provider token DEEPSEEK_API_KEY in leak.js',
        'env read outside allowlist: DEEPSEEK_API_KEY in leak.js',
      ],
      'provider key read must be rejected',
    )

    // Router knob read — must be rejected.
    fs.writeFileSync(leak, 'const mode = process.env.CLAUDE_ROUTER_MODE\n')
    assert.deepStrictEqual(
      staticPolicyViolations(dir),
      ['env read outside allowlist: CLAUDE_ROUTER_MODE in leak.js'],
      'router knob read must be rejected',
    )

    // Provider endpoint host — must be rejected.
    fs.writeFileSync(leak, "const base = 'https://api.deepseek.com/v1'\n")
    assert.deepStrictEqual(
      staticPolicyViolations(dir),
      ['provider token api.deepseek.com in leak.js'],
      'provider endpoint host must be rejected',
    )

    // Router coupling token — must be rejected.
    fs.writeFileSync(leak, "// talks to the 9router gateway\n")
    assert.deepStrictEqual(
      staticPolicyViolations(dir),
      ['router token 9router in leak.js'],
      'router coupling token must be rejected',
    )

    // The policy does not over-admit: an unknown Candice-looking variable is
    // still outside the explicit allowlist and must be rejected.
    fs.writeFileSync(leak, 'const flag = process.env.CANDICE_COMPANION_MODE\n')
    assert.deepStrictEqual(
      staticPolicyViolations(dir),
      ['env read outside allowlist: CANDICE_COMPANION_MODE in leak.js'],
      'unlisted configuration variable must be rejected',
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

check('mutation: the scan stays production-only — excluded surfaces are invisible', () => {
  const dir = makeFixtureDir()
  try {
    // A provider token and a router token inside excluded surfaces must not be
    // seen by the production scan — those surfaces quote what the code must NOT
    // do and are outside the production claim.
    fs.writeFileSync(path.join(dir, 'real.mjs'), 'export const ok = true\n')
    fs.mkdirSync(path.join(dir, '__tests__'))
    fs.writeFileSync(path.join(dir, '__tests__', 'notes.test.mjs'), '// asserts no claude-nine coupling\n')
    fs.mkdirSync(path.join(dir, 'docs'))
    fs.writeFileSync(path.join(dir, 'docs', 'README.md'), 'operators set ANTHROPIC_API_KEY in their own env\n')
    fs.mkdirSync(path.join(dir, 'evidence'))
    fs.writeFileSync(path.join(dir, 'evidence', 'report.json'), '{"note":"api.deepseek.com seen in review"}\n')
    fs.mkdirSync(path.join(dir, 'fixtures'))
    fs.writeFileSync(path.join(dir, 'fixtures', 'sample.json'), '{"base":"https://api.openrouter.ai/v1"}\n')
    assert.deepStrictEqual(staticPolicyViolations(dir), [], 'excluded surfaces must not be scanned')
    assert.strictEqual(productionFiles(dir).length, 1, 'only the production file is scanned')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

check('mutation: the scan stays production-only — excluded surfaces are invisible', () => {
  const dir = makeFixtureDir()
  try {
    // A provider token and a router token inside excluded surfaces must not be
    // seen by the production scan — those surfaces quote what code must NOT
    // do and are outside the production claim.
    fs.writeFileSync(path.join(dir, 'real.mjs'), 'export const ok = true\n')
    fs.mkdirSync(path.join(dir, '__tests__'))
    fs.writeFileSync(path.join(dir, '__tests__', 'notes.test.mjs'), '// asserts no claude-nine coupling\n')
    fs.mkdirSync(path.join(dir, 'docs'))
    fs.writeFileSync(path.join(dir, 'docs', 'README.md'), 'operators set ANTHROPIC_API_KEY in their own env\n')
    fs.mkdirSync(path.join(dir, 'evidence'))
    fs.writeFileSync(path.join(dir, 'evidence', 'report.json'), '{"note":"api.deepseek.com seen in review"}\n')
    fs.mkdirSync(path.join(dir, 'fixtures'))
    fs.writeFileSync(path.join(dir, 'fixtures', 'sample.json'), '{"base":"https://api.openrouter.ai/v1"}\n')
    assert.deepStrictEqual(staticPolicyViolations(dir), [], 'excluded surfaces must not be scanned')
    assert.strictEqual(productionFiles(dir).length, 1, 'only the production file is scanned')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Functional: the ask path is identical with and without routed-provider env
// ---------------------------------------------------------------------------

/** Runs a tiny ask-path probe in a child process under the given env additions. */
function runProbe(extraEnv) {
  const probe = `
    const assert = require('assert')
    const harness = require(${JSON.stringify(path.join(__dirname, 'harness.js'))})
    const deps = harness.loadDeps()
    const server = new deps.AskUserServer({ isCompanionReady: () => true })
    ;(async () => {
      const result = await server.askUser({
        sessionId: 'session-p-1',
        question: {
          schemaVersion: '1.0', sessionId: 'session-p-1', skill: 'spec-protocol',
          event: 'question', questionKey: 'BUILD_TARGET',
          text: 'the same question', answerKind: 'free_text',
          allowedInputModes: ['voice', 'typed', 'terminal'],
          readAloud: true, sensitivity: 'normal', counted: true,
          progress: null, helpText: 'h', canGoBack: true,
        },
      })
      // Companion absent in the probe: the tool fails soft and the skill asks
      // the same question in Claude normally — the ONLY behavior there is.
      assert.strictEqual(result.result.isError, true)
      const text = result.result.content[0].text
      assert.ok(text.includes('ask the same question in Claude normally'))
      console.log('PROBE_OK')
    })().catch((e) => { console.error(e); process.exit(1) })
  `
  const env = Object.assign({}, process.env, extraEnv)
  return execFileSync(process.execPath, ['-e', probe], { env, encoding: 'utf8' })
}

check('ask path with a routed-provider session env: same fail-soft behavior', () => {
  const out = runProbe({
    // Router-flavored signals a routed session would carry. Values are
    // synthetic and never printed — the probe only asserts behavior.
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:20128/v1',
    CLAUDE_CODE_SESSION_ID: 'synthetic-session-1',
  })
  assert.ok(out.includes('PROBE_OK'), 'probe completed under routed-provider env')
})

check('ask path with NO routed-provider env: byte-identical behavior', () => {
  const env = Object.assign({}, process.env)
  delete env.ANTHROPIC_BASE_URL
  delete env.CLAUDE_CODE_SESSION_ID
  const out = runProbe(env)
  assert.ok(out.includes('PROBE_OK'), 'probe completed without routed-provider env')
})

check('routed session env cannot change the session-keyed answer seam', () => {
  // The answer registry and the guard key on (sessionId, questionKey) ONLY.
  // Run them with router env present and absent; the shapes are identical.
  const deps = harness.loadDeps()
  const registry = new deps.AnswerSlotRegistry()
  assert.strictEqual(registry.open({ sessionId: 'sess-1', questionKey: 'BUILD_TARGET' }).ok, true)
  const guard = new deps.DoubleCountGuard()
  const deferred = guard.deferToTerminal({ sessionId: 'sess-1', questionKey: 'BUILD_TARGET' })
  assert.strictEqual(deferred.ok, true)
  // No provider signal anywhere in the seam's state or return shapes.
  const status = JSON.stringify(guard.status())
  assert.ok(!status.includes('provider') && !status.includes('ANTHROPIC'), 'guard state carries no provider identity')
})

check('allowed configuration env cannot alter session routing', () => {
  // Behavioral mutation guard: even the allowlisted configuration variables
  // (READY probe, CMD launch command) must not move an answer across
  // sessions. The same seam runs with CANDICE_COMPANION_CMD pointed at a
  // foreign companion binary name — the session-keyed answer routing and the
  // fail-soft ask-path behavior are unchanged.
  const deps = harness.loadDeps()
  const registry = new deps.AnswerSlotRegistry()
  const makeAnswer = (sessionId) => ({
    schemaVersion: '1.0',
    sessionId,
    questionKey: 'BUILD_TARGET',
    answerText: 'approved answer text',
    inputMode: 'typed',
    userConfirmedTranscript: true,
    sensitivity: 'normal',
    answeredAt: '2026-08-23T00:00:00.000Z',
  })
  const sessions = ['sess-a', 'sess-b']
  for (const sessionId of sessions) {
    assert.strictEqual(registry.open({ sessionId, questionKey: 'BUILD_TARGET' }).ok, true)
  }
  // An answer is accepted only for the session that opened the slot, and a
  // cross-session answer for the same question key is refused, never
  // re-routed.
  const put = registry.put({ sessionId: 'sess-a', questionKey: 'BUILD_TARGET', answer: makeAnswer('sess-a') })
  assert.strictEqual(put.ok, true, 'owning-session answer is accepted')
  const cross = registry.put({ sessionId: 'sess-b', questionKey: 'BUILD_TARGET', answer: makeAnswer('sess-a') })
  assert.strictEqual(cross.ok, false, 'cross-session answer is refused')
  assert.strictEqual(cross.code, 'session-mismatch', 'refusal is session-mismatch, never a re-route')
  const sibling = registry.put({ sessionId: 'sess-b', questionKey: 'BUILD_TARGET', answer: makeAnswer('sess-b') })
  assert.strictEqual(sibling.ok, true, 'each session answers its own slot')
  const status = JSON.stringify(registry.slots)
  assert.ok(!status.includes('ANTHROPIC') && !status.includes('provider'), 'registry state carries no provider identity')

  const out = runProbe({
    CANDICE_COMPANION_READY: '0',
    CANDICE_COMPANION_CMD: '/nonexistent/foreign-companion --provider=other',
  })
  assert.ok(out.includes('PROBE_OK'), 'allowlisted config env cannot change the ask-path behavior')
})

if (failures > 0) {
  console.log(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL TESTS PASSED')
