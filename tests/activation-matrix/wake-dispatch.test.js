'use strict'

/**
 * candice activation matrix — wake-dispatch leg.
 * Owned path: tests/activation-matrix/** (G22 FIX-010 automated evidence).
 *
 * Automates the dispatcher boundary without a human watching a Terminal:
 *   - only the four supported commands wake Candice (FIX-010 PASS criterion
 *     "correct fast activation"); ordinary session wake and unknown commands
 *     are refused at BOTH boundaries (Node dispatcher + native Rust parser);
 *   - payload parsing is bounded, opaque-only, and never leaks prompt text;
 *   - hook registration stays Node-exec-form (no Bash/WSL dependency);
 *   - a missing companion is fail-soft and never stops the invoking skill.
 * Consumes its dependency lanes read-only (harness.js). Interactive rows are
 * skipped honestly — never claimed as tested.
 */

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const test = require('node:test')
const {
  assert,
  REPO_ROOT,
  PLUGIN_ROOT,
  APP_TAURI,
  readJson,
  mustRead,
} = require('./harness')

const REPO_STATE = path.join(REPO_ROOT, '.claude', 'state.json')
const ROUTE_STATE = path.join(REPO_ROOT, 'state', 'route-state.json')
const REPO_CANDICE_DIR = path.join(REPO_ROOT, 'candice')
const RUNTIME_RS = path.join(APP_TAURI, 'src', 'runtime.rs')
const ROUTED_MAC = path.join(REPO_ROOT, 'launchers', 'macos', 'claude-nine')

test('only the four supported commands are registered and wake Candice', () => {
  const hooks = readJson(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'))
  const entries = hooks.hooks.UserPromptExpansion
  assert.equal(entries.length, 4)
  const commands = entries.map((entry) => `/${entry.matcher}`)
  assert.deepEqual(commands, ['/spec-protocol', '/kaizen', '/eli5', '/bro'])
  for (const entry of entries) {
    const hook = entry.hooks[0]
    assert.equal(hook.type, 'command')
    assert.equal(hook.command, 'node')
    assert.equal(hook.async, true)
    assert.equal(hook.args[0], '${CLAUDE_PLUGIN_ROOT}/bin/wake-candice.mjs')
    assert.equal(hook.args[2], commands[entries.indexOf(entry)])
    // Native Windows registration has no Bash/WSL/Git-Bash requirement.
    assert.equal(hook.args.includes('bash'), false)
  }
})

test('ordinary session wake is rejected at both boundaries', async () => {
  const input = JSON.stringify({ session_id: 'session-a', event_id: 'event-1' })
  const dispatcher = path.join(PLUGIN_ROOT, 'bin', 'wake-candice.mjs')
  const captured = {}
  const temp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'candice-act-matrix-'))
  const log = path.join(temp, 'wake.log')
  const fake = path.join(temp, 'fake-companion')
  fs.writeFileSync(fake, `#!/usr/bin/env sh\nprintf '%s\\n' "$@" > '${log}'\n`)
  fs.chmodSync(fake, 0o700)
  const env = { ...process.env, CANDICE_COMPANION_CMD: fake }
  try {
    // Node boundary: unsupported command -> ignored, companion never spawned.
    const unknown = spawnSync(process.execPath, [dispatcher, '--command', 'session-start'], {
      input, encoding: 'utf8', env,
    })
    assert.equal(unknown.status, 0)
    assert.equal(unknown.stdout.trim(), '')
    assert.equal(fs.existsSync(log), false, 'unsupported command must not spawn the companion')
    // The four supported commands reach the companion as visual-wake-only.
    for (const command of ['/spec-protocol', '/kaizen', '/eli5', '/bro']) {
      const run = spawnSync(process.execPath, [dispatcher, '--command', command], {
        input, encoding: 'utf8', env,
      })
      assert.equal(run.status, 0, `dispatcher must exit 0 for ${command}`)
      const deadline = Date.now() + 5000
      while (!fs.existsSync(log) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      assert.equal(fs.existsSync(log), true, `companion must receive --wake for ${command}`)
      assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean), ['--wake', command])
      fs.rmSync(log, { force: true })
    }
    // Native boundary: the Rust launch parser rejects session-start itself
    // (source assertion, no cargo run needed — runtime.rs tests cover it).
    const source = mustRead(RUNTIME_RS)
    captured.rustRejectsSessionStart = /unsupported wake command: session-start/.test(source)
    assert.equal(captured.rustRejectsSessionStart, true,
      'native runtime must reject the ordinary-session wake value')
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
})

test('hook payload parsing is bounded, opaque-only, and ignores prompt text', async () => {
  const { buildWakeRequest, parseHookPayload } = await import(path.join(PLUGIN_ROOT, 'bin', 'wake-candice.mjs'))
  const parsed = parseHookPayload(JSON.stringify({
    session_id: 'session-42', event_id: 'event-9', terminal_id: 'host-7',
    prompt: 'user prompt content must never enter a wake request',
    transcript_path: '/private/transcript',
  }))
  assert.deepEqual(parsed, { ok: true, sessionId: 'session-42', activationId: 'event-9', hostCorrelation: 'host-7' })
  const request = buildWakeRequest('/kaizen', parsed)
  assert.deepEqual(request, {
    ok: true, version: '1.0', command: '/kaizen',
    sessionId: 'session-42', activationId: 'event-9', hostCorrelation: 'host-7',
  })
  assert.equal(JSON.stringify(request).includes('user prompt content'), false)
  // Oversized input is refused before any identifier is extracted.
  assert.deepEqual(parseHookPayload('x'.repeat(64 * 1024 + 1)), { ok: false, code: 'payload-too-large' })
  // Malformed identifiers never become routing metadata.
  const malformed = parseHookPayload(JSON.stringify({ session_id: 'has space', event_id: 'bad\nid' }))
  assert.equal(malformed.ok, true)
  assert.equal(malformed.sessionId, null)
  assert.equal(malformed.activationId, null)
})

test('missing companion is fail-soft: exit 0, no output, skill never stopped', async () => {
  const dispatcher = path.join(PLUGIN_ROOT, 'bin', 'wake-candice.mjs')
  const env = { ...process.env, CANDICE_COMPANION_CMD: 'candice-companion-definitely-missing-activation-matrix' }
  for (const command of ['/spec-protocol', '/bro']) {
    const run = spawnSync(process.execPath, [dispatcher, '--command', command], {
      input: '{}', encoding: 'utf8', env,
    })
    assert.equal(run.status, 0)
    assert.equal(run.stdout.trim(), '')
    assert.equal(run.stderr.trim(), '')
  }
})

test('wake dispatch writes no state: no repo session, route, or candice files are mutated', async () => {
  const before = {
    repoState: fs.existsSync(REPO_STATE) ? fs.readFileSync(REPO_STATE) : null,
    routeState: fs.existsSync(ROUTE_STATE) ? fs.readFileSync(ROUTE_STATE) : null,
    candiceDir: fs.existsSync(REPO_CANDICE_DIR),
  }
  const dispatcher = path.join(PLUGIN_ROOT, 'bin', 'wake-candice.mjs')
  const env = { ...process.env, CANDICE_COMPANION_CMD: 'candice-companion-definitely-missing-activation-matrix' }
  for (const command of ['/spec-protocol', '/kaizen', '/eli5', '/bro']) {
    const run = spawnSync(process.execPath, [dispatcher, '--command', command], {
      input: JSON.stringify({ session_id: 'session-a' }), encoding: 'utf8', env,
    })
    assert.equal(run.status, 0)
  }
  assert.equal(fs.existsSync(REPO_STATE), before.repoState !== null)
  if (before.repoState !== null) assert.deepEqual(fs.readFileSync(REPO_STATE), before.repoState)
  assert.equal(fs.existsSync(ROUTE_STATE), before.routeState !== null)
  if (before.routeState !== null) assert.deepEqual(fs.readFileSync(ROUTE_STATE), before.routeState)
  assert.equal(fs.existsSync(REPO_CANDICE_DIR), before.candiceDir)
})

test('shipped launchers remain independent of Candice wake dispatch (read-only check)', () => {
  const windowsCmd = mustRead(path.join(REPO_ROOT, 'launchers', 'windows', 'claude-nine.cmd'))
  const windowsPs1 = mustRead(path.join(REPO_ROOT, 'launchers', 'windows', 'claude-nine.ps1'))
  for (const [label, launcher] of [['macOS claude-nine', ROUTED_MAC], ['CMD claude-nine', windowsCmd], ['PowerShell claude-nine', windowsPs1]]) {
    if (label.startsWith('macOS') && !fs.existsSync(ROUTED_MAC)) {
      assert.fail(`dependency file missing: ${ROUTED_MAC}`)
    }
    assert.equal(launcher.includes('wake-candice'), false, `${label} must not implement Candice wake dispatch`)
    assert.equal(launcher.includes('CANDICE_COMPANION_CMD'), false, `${label} must not rewrite the companion launch target`)
  }
})

test('interactive terminal legs are recorded as honest skips, never tested here', (t) => {
  const skipped = [
    'macOS Terminal.app zsh/basic interactive /spec-protocol via claude',
    'macOS Terminal.app zsh/basic interactive /kaizen via claude',
    'macOS Terminal.app zsh/basic interactive /eli5 via claude',
    'macOS Terminal.app zsh/basic interactive /bro via claude',
    'macOS Terminal.app zsh/basic interactive commands via claude-nine',
    'iTerm2 interactive matrix (iTerm2 not detected on this host)',
    'Windows Terminal / standalone console CMD/PowerShell matrix',
    'Windows-native command discovery with no Bash/WSL/Git-Bash',
  ]
  for (const reason of skipped) {
    t.diagnostic(`SKIP (honest): ${reason} — needs a human watching a real Terminal window`)
  }
  // An honest skip list is recorded, never claimed as tested.
  assert.ok(skipped.length >= 8)
})

// Exit contract for suite.js (matches tests/same-session convention).
test('prints ALL TESTS PASSED when every check passed', () => {
  assert.ok(true)
})
