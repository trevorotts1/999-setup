'use strict'

/**
 * candice activation-matrix suite — shared harness — owned path:
 * tests/activation-matrix/** (G22 FIX-010 automated activation evidence).
 *
 * Automates every FIX-010 activation scenario that does not need a human
 * watching a real Terminal window. Resolves the dependency lanes READ-ONLY
 * from their owned globs (0C cross-lane rule — this lane never edits them):
 *   - plugins/candice-integration/bin/wake-candice.mjs     (dispatch boundary)
 *   - plugins/candice-integration/hooks/hooks.json         (hook registration)
 *   - plugins/candice-integration/session/…                (binding authority)
 *   - plugins/candice-integration/mcp/ask-user/…           (authenticated bridge)
 *   - apps/candice-companion/src-tauri/src/runtime.rs      (native launch parser)
 *
 * No vendored code, no npm, no network: plain Node built-ins plus the repo's
 * own zero-dependency modules (repo convention, sections 12/17/27; matches
 * tests/contract, tests/same-session, tests/e2e-acceptance).
 *
 * Skip discipline (E.1 "honest skip markers"): a leg that needs a real
 * interactive Terminal.app/Windows Terminal session, a real GUI app window,
 * or a release-authorized installed artifact is RECORDED as skipped with the
 * reason and the suite still exits 0. A skip is never silent and never
 * claimed as tested.
 */

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const net = require('net')
const path = require('path')

/** Absolute path of the repo worktree root (tests/activation-matrix is 2 deep). */
const REPO_ROOT = path.join(__dirname, '..', '..')

/** Absolute path of the candice-integration plugin root (WS-02/03/04/05 owned). */
const PLUGIN_ROOT = path.join(REPO_ROOT, 'plugins', 'candice-integration')

/** Absolute path of the candice companion Tauri app (WS-06/16 owned). */
const APP_TAURI = path.join(REPO_ROOT, 'apps', 'candice-companion', 'src-tauri')

/** Loads the dependency-lane modules the suite drives (read-only requires). */
function loadDeps() {
  return {
    SessionManager: require(path.join(PLUGIN_ROOT, 'session', 'session-manager.js')).SessionManager,
    BindingBridge: require(path.join(PLUGIN_ROOT, 'session', 'bridge', 'binding-bridge.js')).BindingBridge,
    LocalCompanionBridge: require(path.join(PLUGIN_ROOT, 'mcp', 'ask-user', 'local-companion-bridge.js')).LocalCompanionBridge,
    AskUserServer: require(path.join(PLUGIN_ROOT, 'mcp', 'ask-user', 'server.js')).AskUserServer,
  }
}

/** Reads a file; throws with a clear cross-lane message when absent. */
function mustRead(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (err) {
    throw new Error(`dependency file missing: ${file} (${err.message})`)
  }
}

/** Reads a JSON file; throws when absent or invalid. */
function readJson(file) {
  return JSON.parse(mustRead(file))
}

/** True when the file exists and is a non-empty readable file. */
function existsNonEmpty(file) {
  try {
    const st = fs.statSync(file)
    return st.isFile() && st.size > 0
  } catch (err) {
    return false
  }
}

/** One activation record mirroring the evidence sanitization contract:
 *  activation id, session-ID SHA-256, binding id, instance id, outcome.
 *  Never a token or token-file content. */
function sanitizedReceipt(entry) {
  return {
    activationId: typeof entry.activationId === 'string' ? entry.activationId : null,
    sessionIdSha256: typeof entry.sessionId === 'string'
      ? crypto.createHash('sha256').update(entry.sessionId).digest('hex')
      : null,
    bindingId: typeof entry.bindingId === 'string' ? entry.bindingId : null,
    instanceId: typeof entry.instanceId === 'string' ? entry.instanceId : null,
    outcome: typeof entry.outcome === 'string' ? entry.outcome : null,
  }
}

/** Minimal in-memory fake SessionManager store for BindingBridge routing
 *  tests: beginSession/endSession/isActive only (see session-manager.js). */
class FakeSessionStore {
  constructor() {
    this.active = new Set()
    this.begun = []
    this.ended = []
  }
  beginSession({ sessionId }) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return { ok: false, code: 'invalid-session-id' }
    if (this.active.has(sessionId)) return { ok: false, code: 'session-already-active' }
    this.active.add(sessionId)
    this.begun.push(sessionId)
    return { ok: true }
  }
  endSession(sessionId) {
    if (!this.active.delete(sessionId)) return { ok: false, code: 'session-not-active' }
    this.ended.push(sessionId)
    return { ok: true }
  }
  isActive(sessionId) {
    return this.active.has(sessionId)
  }
}

/**
 * Connect a scripted companion client to a LocalCompanionBridge and return
 * { socket, messages }. Mirrors the local-companion-bridge.test.js client.
 * Only used by replay.js (the bridge module is loaded read-only).
 */
async function connectClient(endpoint, token, activation, handleMessage) {
  const port = Number(new URL(endpoint).port)
  const socket = await new Promise((resolve, reject) => {
    const client = net.createConnection({ host: '127.0.0.1', port }, () => resolve(client))
    client.once('error', reject)
  })
  socket.setEncoding('utf8')
  socket.write(JSON.stringify({
    type: 'hello', version: '1.0', token,
    sessionId: activation.sessionId,
    activationId: activation.activationId,
    activationIssuedAt: String(activation.issuedAt),
    instanceId: activation.instanceId,
  }) + '\n')
  let buffer = ''
  socket.on('data', (chunk) => {
    buffer += chunk
    let index
    while ((index = buffer.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffer.slice(0, index))
      buffer = buffer.slice(index + 1)
      if (typeof handleMessage === 'function') handleMessage(message, socket)
    }
  })
  return socket
}

module.exports = {
  assert,
  REPO_ROOT,
  PLUGIN_ROOT,
  APP_TAURI,
  loadDeps,
  mustRead,
  readJson,
  existsNonEmpty,
  sanitizedReceipt,
  FakeSessionStore,
  connectClient,
}
