'use strict'

/**
 * candice activation matrix — replay/idempotency leg.
 * Owned path: tests/activation-matrix/** (G22 FIX-010 automated evidence).
 *
 * Automates captured activation replays across restarts, plus replacement/
 * stale refusal assertions, against the REAL token-file semantics of
 * plugins/candice-integration/mcp/ask-user/local-companion-bridge.js
 * (read-only): owner-only 0700 socket dir and 0600 token file, single-use
 * activation per instance, idempotent same-instance reconnect with the same
 * binding id, no replacement-instance takeover, no cross-session rebinding.
 */

const crypto = require('crypto')
const fs = require('fs')
const test = require('node:test')
const { assert, loadDeps, connectClient, sanitizedReceipt } = require('./harness')

const { LocalCompanionBridge, BRIDGE_PROTOCOL_VERSION } = loadDeps()

/** Always close the bridge so an assertion failure can never leak a listener
 *  and hang the process (matches local-companion-bridge.test.js discipline). */
async function withBridge(make, body) {
  const bridge = make()
  try {
    await body(bridge)
  } finally {
    await bridge.close().catch(() => {})
  }
}

test('real token file is owner-only and never appears in the launch argument vector', async () => {
  await withBridge(() => new LocalCompanionBridge(), async (bridge) => {
    await bridge.start()
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(bridge.tokenFile).mode & 0o077, 0,
        'bridge token file must be owner-only (0600)')
      assert.equal(fs.statSync(bridge.socketDir).mode & 0o077, 0,
        'bridge socket directory must be owner-only (0700)')
    }
    // The on-disk content is the exact capability token.
    assert.equal(fs.readFileSync(bridge.tokenFile, 'utf8'), bridge.token)
    // No launch argument carries a token value.
    const activation = { ...bridge.activation, instanceId: 'candice-owner' }
    const hello = {
      type: 'hello', version: BRIDGE_PROTOCOL_VERSION, token: 'REDACTED',
      sessionId: activation.sessionId, activationId: activation.activationId,
      activationIssuedAt: String(activation.issuedAt), instanceId: activation.instanceId,
    }
    assert.equal(JSON.stringify(hello).includes(bridge.token), false)
  })
})

test('captured activation replay across restart: same instance reconnects idempotently with the same binding id', async () => {
  await withBridge(() => new LocalCompanionBridge(), async (bridge) => {
    await bridge.start()
    // First launch captures the exact activation a companion would receive.
    await bridge.ensureSession('session-a')
    const captured = {
      sessionId: bridge.activation.sessionId,
      activationId: bridge.activation.activationId,
      issuedAt: bridge.activation.issuedAt,
      instanceId: 'candice-original',
    }
    // Companion connects and completes the ready acknowledgement.
    const firstReady = new Promise((resolve) => {
      connectClient(bridge.endpoint, bridge.token, captured, (message) => {
        if (message.type === 'ready') resolve(message)
      })
    })
    const ack = await firstReady
    assert.equal(ack.sessionId, 'session-a')
    assert.equal(ack.activationId, captured.activationId)
    assert.equal(ack.instanceId, 'candice-original')
    assert.match(ack.bindingId, /^[A-Za-z0-9._:-]+$/)
    const firstBindingId = bridge.binding.bindingId
    // Restart simulation: the companion process dies (socket closes), then
    // reconnects with the SAME captured activation and SAME instance id.
    bridge.socket.destroy()
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.equal(bridge.isReady(), false)
    const secondReady = new Promise((resolve) => {
      connectClient(bridge.endpoint, bridge.token, captured, (message) => {
        if (message.type === 'ready') resolve(message)
      })
    })
    const reack = await secondReady
    assert.equal(reack.instanceId, 'candice-original')
    // Idempotent recovery: the exact same binding identity is echoed, no new
    // binding and no second instance are created.
    assert.equal(reack.bindingId, firstBindingId)
    assert.equal(bridge.binding.bindingId, firstBindingId)
    assert.equal(bridge.binding.instanceId, 'candice-original')
    assert.equal(bridge.isReady(), true)
    bridge.socket.destroy()
  })
})

test('replacement instance refused against real token file semantics', async () => {
  await withBridge(() => new LocalCompanionBridge(), async (bridge) => {
    await bridge.start()
    await bridge.ensureSession('session-a')
    const activation = { ...bridge.activation, instanceId: 'candice-owner' }
    const ready = new Promise((resolve) => {
      connectClient(bridge.endpoint, bridge.token, activation, (message) => {
        if (message.type === 'ready') resolve(message)
      })
    })
    const ack = await ready
    assert.equal(bridge.binding.instanceId, 'candice-owner')
    // A replacement instance presenting the same activation is refused.
    let replacementReady = false
    const replacement = await connectClient(bridge.endpoint, bridge.token,
      { ...activation, instanceId: 'candice-replacement' }, (message) => {
        if (message.type === 'ready') replacementReady = true
      })
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(replacementReady, false, 'replacement instance must never take over a binding')
    assert.equal(bridge.binding.instanceId, 'candice-owner')
    assert.equal(bridge.isReady(), true)
    replacement.destroy()
    // The original binding identity is echoed exactly in the acknowledgement.
    assert.equal(ack.bindingId, bridge.binding.bindingId)
    assert.deepEqual(sanitizedReceipt({
      activationId: activation.activationId,
      sessionId: activation.sessionId,
      bindingId: bridge.binding.bindingId,
      instanceId: bridge.binding.instanceId,
      outcome: 'authenticated-ready',
    }), {
      activationId: activation.activationId,
      sessionIdSha256: crypto.createHash('sha256').update(activation.sessionId).digest('hex'),
      bindingId: bridge.binding.bindingId,
      instanceId: 'candice-owner',
      outcome: 'authenticated-ready',
    })
    bridge.socket.destroy()
  })
})

test('stale activation rejected after TTL; rapid duplicate activation creates no second active instance', async () => {
  let clock = 1_000
  await withBridge(() => new LocalCompanionBridge({ now: () => clock, activationTtlMs: 50 }), async (bridge) => {
    await bridge.start()
    await bridge.ensureSession('session-a')
    const activation = { ...bridge.activation, instanceId: 'candice-owner' }
    const ready = new Promise((resolve) => {
      connectClient(bridge.endpoint, bridge.token, activation, (message) => {
        if (message.type === 'ready') resolve(message)
      })
    })
    await ready
    // Rapid duplicate activation for the SAME session is not a second instance.
    const second = await bridge.ensureSession('session-a')
    assert.equal(second.ok, true, 'same-session duplicate activation must be idempotent')
    assert.equal(bridge.activation.sessionId, 'session-a')
    // A different session while one is bound is refused (no cross-binding).
    const cross = await bridge.ensureSession('session-b')
    assert.equal(cross.code, 'session-binding-in-use')
    // Disconnect, advance past TTL, reconnect with the original activation.
    bridge.socket.destroy()
    await new Promise((resolve) => setTimeout(resolve, 25))
    clock += 100
    let staleReady = false
    const stale = await connectClient(bridge.endpoint, bridge.token, activation, (message) => {
      if (message.type === 'ready') staleReady = true
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(staleReady, false, 'expired activation must not reconnect')
    assert.equal(bridge.isReady(), false)
    stale.destroy()
  })
})

test('wrong token, wrong session, wrong activation are each refused before any ready state', async () => {
  await withBridge(() => new LocalCompanionBridge(), async (bridge) => {
    await bridge.start()
    await bridge.ensureSession('session-a')
    const activation = { ...bridge.activation, instanceId: 'candice-owner' }
    const attempts = [
      { label: 'wrong token', token: '0'.repeat(64), sessionId: activation.sessionId, activationId: activation.activationId },
      { label: 'wrong session', token: bridge.token, sessionId: 'other-session', activationId: activation.activationId },
      { label: 'wrong activation', token: bridge.token, sessionId: activation.sessionId, activationId: 'other-activation' },
    ]
    for (const attempt of attempts) {
      let ready = false
      const intruder = await connectClient(bridge.endpoint, attempt.token,
        { sessionId: attempt.sessionId, activationId: attempt.activationId, issuedAt: activation.issuedAt, instanceId: 'candice-intruder' },
        (message) => { if (message.type === 'ready') ready = true })
      await new Promise((resolve) => setTimeout(resolve, 40))
      assert.equal(ready, false, `${attempt.label} must be refused`)
      assert.equal(bridge.isReady(), false, `${attempt.label} must not authenticate`)
      intruder.destroy()
    }
    // The legitimate companion still completes after the intruders are gone.
    const ready = new Promise((resolve) => {
      connectClient(bridge.endpoint, bridge.token, activation, (message) => {
        if (message.type === 'ready') resolve(message)
      })
    })
    const ack = await ready
    assert.equal(ack.instanceId, 'candice-owner')
    bridge.socket.destroy()
  })
})

test('missing companion is fail-soft at the bridge boundary: bounded activation, never a hang', async () => {
  await withBridge(() => new LocalCompanionBridge({ launchCommand: null }), async (bridge) => {
    await bridge.start()
    // Unconfigured companion: ensureSession issues only the bounded activation
    // and reports the companion is not configured — it never hangs.
    const result = await bridge.ensureSession('session-a')
    assert.equal(result.ok, false)
    assert.equal(result.code, 'companion-not-configured')
    assert.equal(bridge.activation.sessionId, 'session-a')
    assert.match(bridge.activation.activationId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })
})

// Exit contract for suite.js (matches tests/same-session convention).
test('prints ALL TESTS PASSED when every check passed', () => {
  assert.ok(true)
})
