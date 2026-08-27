#!/usr/bin/env node
'use strict'

/**
 * Test-double companion process for the bridge-IPC probe (FIX-018).
 *
 * NOT an injected fake socket: this is a real separate process that reads
 * the bridge launch arguments (`--bridge-endpoint`, `--bridge-token-file`,
 * `--bridge-version`, `--session-id`, `--activation-id`,
 * `--activation-issued-at`), connects to the loopback TCP endpoint, reads
 * the owner-only token file, and performs the authenticated hello
 * handshake exactly as the real companion does (bridge spec 1.0). It then
 * reads the `ready` frame, prints one status line, and exits — so probes
 * against it exercise the genuine transport, authentication, and protocol
 * path. Any argument or handshake mismatch exits nonzero.
 */

const fs = require('fs')
const net = require('net')

const args = process.argv.slice(2)
const get = (name) => {
  const i = args.indexOf(name)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null
}

const endpoint = get('--bridge-endpoint')
const tokenFile = get('--bridge-token-file')
const version = get('--bridge-version')
const sessionId = get('--session-id')
const activationId = get('--activation-id')
const issuedAt = get('--activation-issued-at')

if (!endpoint || !tokenFile || !version || !sessionId || !activationId || !issuedAt) {
  console.error('FAIL fixture: missing bridge launch arguments')
  process.exit(2)
}
if (version !== '1.0') {
  console.error(`FAIL fixture: unsupported bridge version ${version}`)
  process.exit(2)
}

let token
try {
  token = fs.readFileSync(tokenFile, 'utf8').trim()
} catch (e) {
  console.error(`FAIL fixture: token unreadable: ${e.message}`)
  process.exit(2)
}
if (!/^[a-f0-9]{64}$/.test(token)) {
  console.error('FAIL fixture: token not a 64-hex capability token')
  process.exit(2)
}

const port = Number(endpoint.split(':').pop())
if (!Number.isInteger(port) || port <= 0) {
  console.error(`FAIL fixture: malformed endpoint ${endpoint}`)
  process.exit(2)
}

const socket = net.connect(port, '127.0.0.1', () => {
  socket.write(JSON.stringify({
    type: 'hello',
    version,
    sessionId,
    activationId,
    activationIssuedAt: issuedAt,
    token,
    instanceId: `fixture-${process.pid}`,
  }) + '\n')
})

socket.setEncoding('utf8')
let buffer = ''
const deadline = setTimeout(() => {
  console.error('FAIL fixture: no ready frame within 10s')
  process.exit(1)
}, 10000)

socket.on('data', (chunk) => {
  buffer += chunk
  let idx
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx)
    buffer = buffer.slice(idx + 1)
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      console.error('FAIL fixture: unparseable frame')
      process.exit(1)
    }
    if (msg.type === 'ready' && msg.bindingId && msg.sessionId === sessionId) {
      clearTimeout(deadline)
      console.log(`OK fixture hello verified (binding ${msg.bindingId})`)
      // Hold the authenticated connection open like the real companion:
      // an immediate exit would flip bridge readiness back off before the
      // prober's readiness poll observes it. Exit only when the bridge
      // closes the socket (probe cleanup).
      socket.on('close', () => process.exit(0))
      socket.on('error', () => process.exit(0))
      return
    }
  }
})

socket.on('error', (e) => {
  clearTimeout(deadline)
  console.error(`FAIL fixture: socket error: ${e.message}`)
  process.exit(1)
})
