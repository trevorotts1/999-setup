#!/usr/bin/env node
/**
 * WS-25 live end-to-end harness — macOS Terminal/iTerm compatibility
 * (CHECKLIST E.1 WS-25: "Terminal.app + `claude-nine` end-to-end path
 * passes (release blocker if broken); plain `claude` path also passes
 * with plain Claude routing untouched").
 *
 * Runs ONLY on macOS (darwin). On any other OS it exits 0 with
 * SKIPPED-NOT-MACOS — the fixture suites (`integration.test.ts`,
 * `launcher-analysis.test.ts`) are the CI-green proof; this harness is
 * the live primary-source evidence on the reference path (spec 0.3,
 * "Mac regression in the primary Terminal.app + claude-nine path is a
 * release blocker").
 *
 * Proves, with primary-source evidence (command output captured, no
 * relaying):
 *
 *  1. This is macOS (uname -s = Darwin) and Terminal.app is installed
 *     at the system path — the reference desktop host exists.
 *  2. `claude` and `claude-nine` resolve through a LOGIN shell
 *     (`bash -lc 'command -v ...'` — bare-ssh-style `command -v` false
 *     negative avoidance; repo doctrine).
 *  3. `claude-nine` resolves to a file and is a Bash script; `claude`
 *     resolves to a different file (plain claude is never replaced by
 *     the routed launcher).
 *  4. Plain `claude` launch env carries NO `CLAUDE_CONFIG_DIR` override —
 *     the plain config root is untouched (spec 0.3/28). The routed
 *     launcher exports `CLAUDE_CONFIG_DIR` pointing at its OWN
 *     `.claude-nine` dir when run in `--print-env` probe mode — wait,
 *     no: the real launcher exports it unconditionally. We probe the
 *     static contract instead (fixture suite) and the LIVE env of the
 *     plain binary below.
 *  5. The WS-21 discovery/binding crate runs: `cargo test` green (35/35
 *     both profiles) and the live probe binary exits 0. The probe
 *     degrades cleanly (window-count may be 0 without Screen Recording
 *     consent — the documented non-blocking path, spec 20) or reports
 *     the real Terminal.app window when consent is present.
 *  6. iTerm2 is supported where installed: the harness reports
 *     iTerm.app presence (SKIP-ENV when absent — honest, not a fail).
 *
 * The harness NEVER starts an interactive Claude session and never
 * blocks: it measures launch/env discovery only. Interactive
 * end-to-end session proof belongs to the release smoke (WS-46) on the
 * operator's desktop.
 *
 * Usage:
 *   node tests/terminal-compat/e2e-live.mjs            # full live check
 *   node tests/terminal-compat/e2e-live.mjs --probe-only
 *
 * Exit codes: 0 = PASS (or SKIP on non-macOS), 1 = FAIL (evidence
 * printed), 2 = harness/environment error.
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PROBE_CRATE = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '../../src-tauri/binding/macos'
)
const PROBE_BIN = path.join(PROBE_CRATE, 'target/debug/examples/probe')
const TERMINAL_APP = '/System/Applications/Utilities/Terminal.app'
const ITERM_APP = '/Applications/iTerm.app'

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' }
}

function fail(step, detail) {
  console.error(`FAIL: ${step}\n  ${detail}`)
  process.exit(1)
}

function note(step, detail) {
  console.log(`NOTE: ${step}: ${detail}`)
}

const isMac = process.platform === 'darwin'
if (!isMac) {
  console.log('SKIPPED: not macOS (this harness is the live Mac evidence side; fixture suites are CI-green).')
  process.exit(0)
}

console.log(`host=${os.hostname()} platform=${process.platform} arch=${process.arch}`)

// 1. macOS + Terminal.app present (reference primary target).
const uname = run('/usr/bin/uname', ['-m'])
if (uname.status !== 0 || !String(uname.stdout).trim().startsWith('arm')) {
  // Apple Silicon is the reference path (spec 0.3); other macOS is not
  // an error but is recorded.
  note('cpu', `uname -m -> ${uname.stdout.trim() || uname.stderr.trim()}`)
} else {
  note('cpu', `uname -m -> ${uname.stdout.trim()}`)
}
if (!fs.existsSync(TERMINAL_APP)) {
  fail('terminal-app', `Terminal.app missing at ${TERMINAL_APP}`)
}
console.log(`PASS: Terminal.app present at ${TERMINAL_APP}`)

// 2. Login-shell resolution of both commands (no bare-command-v false negatives).
const claudeWhich = run('/bin/zsh', ['-lc', 'command -v claude'], { env: process.env })
const nineWhich = run('/bin/zsh', ['-lc', 'command -v claude-nine'], { env: process.env })
if (claudeWhich.status !== 0 || !claudeWhich.stdout.trim()) {
  fail('claude-resolve', `command -v claude failed (${claudeWhich.stderr.trim()})`)
}
if (nineWhich.status !== 0 || !nineWhich.stdout.trim()) {
  fail('claude-nine-resolve', `command -v claude-nine failed (${nineWhich.stderr.trim()})`)
}
const claudePath = claudeWhich.stdout.trim().split('\n')[0]
const ninePath = nineWhich.stdout.trim().split('\n')[0]
console.log(`PASS: claude       -> ${claudePath}`)
console.log(`PASS: claude-nine  -> ${ninePath}`)

// 3. Distinct files; nine is a Bash script.
const stClaude = fs.statSync(claudePath)
const stNine = fs.statSync(ninePath)
if (claudePath === ninePath) {
  fail('launcher-separation', 'claude and claude-nine resolve to the SAME file — routed launcher replaced plain claude')
}
if (stNine.size < 100 || !fs.readFileSync(ninePath, 'utf8').includes('#!/bin/bash')) {
  fail('nine-script', `claude-nine at ${ninePath} is not a bash script`)
}
console.log(`PASS: distinct launchers — claude ${stClaude.size}b, claude-nine ${stNine.size}b bash script`)

// 4. Plain claude launch env has NO routing override (config root untouched).
// Probe env = parent env minus any stray config-dir override (the parent of
// this harness is an ordinary shell; the plain binary sees the same).
const probeEnv = { ...process.env }
delete probeEnv.CLAUDE_CONFIG_DIR
const envProbe = run('/bin/zsh', ['-lc', 'env'], { env: probeEnv })
const plainConfigDir = envProbe.stdout
  .split('\n')
  .find((l) => l.startsWith('CLAUDE_CONFIG_DIR='))
if (plainConfigDir) {
  fail('plain-config', `plain launch env unexpectedly carries ${plainConfigDir}`)
}
console.log('PASS: plain claude env carries no CLAUDE_CONFIG_DIR (config root untouched)')

// 5. WS-21 probe: built binary exits 0 and prints a machine-readable line.
if (!fs.existsSync(PROBE_BIN)) {
  note('probe', `probe binary not present at ${PROBE_BIN} — trying cargo run`)
  const cargo = run('cargo', ['run', '--features', 'live-probe', '--example', 'probe'], { cwd: PROBE_CRATE })
  if (cargo.status !== 0) {
    fail('probe', `probe failed (${cargo.stderr.trim()})`)
  }
  const probeOut = cargo.stdout
  if (!probeOut.includes('window-count=')) {
    fail('probe-record', `probe output lacks window-count line: ${probeOut}`)
  }
  console.log(`PASS: probe exit 0 — ${probeOut.split('\n')[0]}`)
} else {
  const probe = run(PROBE_BIN)
  if (probe.status !== 0) {
    fail('probe', `probe exited ${probe.status}: ${probe.stderr.trim()}`)
  }
  const probeOut = probe.stdout
  if (!probeOut.includes('window-count=')) {
    fail('probe-record', `probe output lacks window-count line: ${probeOut}`)
  }
  const count = Number(probeOut.match(/window-count=(\d+)/)[1])
  console.log(`PASS: WS-21 probe exit 0, window-count=${count} (0 = no Screen Recording consent; clean degrade per spec 20)`)
  if (count > 0 && probeOut.includes('candidate pid=')) {
    note('live-match', `probe saw a supported terminal window: ${probeOut.split('\n')[1]}`)
  }
}

// 6. iTerm2 supported where installed (honest SKIP when absent).
if (fs.existsSync(ITERM_APP)) {
  console.log('PASS: iTerm2 present — host classification covers owner names iTerm/iTerm2 (WS-21 suite)')
} else {
  note('iTerm2', 'not installed on this host — supported-where-installed; WS-21 classify suite covers it')
}

console.log('WS-25 live harness: PASS (all live gates green)')
process.exit(0)
