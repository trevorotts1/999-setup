# Candice Runtime Architecture

## Status

This is the singular runtime contract as of FIX-009. It describes an
**executable native shell + visual runtime composition**, not a completed
same-session MCP answer bridge. `bridgeAvailable`, `sessionBindingActive`,
`answerRoundTripAvailable`, and `singleInstanceRoutingAvailable` are all
deliberately `false` in the running artifact. FIX-011 owns changing those
capabilities after it implements and tests authenticated transport.

## Processes and authority

```text
Claude Code plugin hook --wake <command>
              |
              v
Candice native Tauri process (RuntimeState)
              |
        cmd_get_runtime_capabilities
              |
              v
Candice webview composition
```

The active Claude session and invoked skill remain the authority for question
order, answer durability, and project state. Candice owns only presentation.
No session identifier is inferred from a window. A `--session-id` argument is
syntax-validated by the native process but is not a session binding until a
future authenticated bridge verifies it.

## Executable boundary

`apps/candice-companion/src-tauri/src/runtime.rs` is the only native runtime
composition entry. It:

1. Parses supported `--wake` values without panicking on malformed input.
2. Stores a truthful `RuntimeCapabilities` value in Tauri managed state.
3. Emits `candice:runtime-capabilities` and serves the same value through
   `cmd_get_runtime_capabilities`.
4. Starts before the webview is displayed.

`apps/candice-companion/src/runtime/composition.ts` is the only webview
composition boundary. It probes the native command, validates the response,
labels the visible state, and never creates an answer-submission path.

## Capability contract

| Field | Current meaning |
|---|---|
| `runtimeCompositionActive` | The native RuntimeState and webview composition are wired into the packaged app. |
| `wakeReceived` / `wakeCommand` | A supported launch argument was parsed. This does not prove it reached a pre-existing process. |
| `sessionBindingActive` | Always false until the bridge proves the exact Claude session. |
| `bridgeAvailable` | Always false until FIX-011 starts an authenticated local transport. |
| `answerRoundTripAvailable` | Always false; no MCP question/answer delivery is implemented here. |
| `singleInstanceRoutingAvailable` | Always false; FIX-011/its platform owner must implement forwarding before a second wake can claim to raise an existing process. |
| `rejectedLaunchReason` | Safe, non-secret reason for a malformed Candice-owned launch argument. |

## Required FIX-011 edge

FIX-011 may replace only the `false` bridge/session fields after it defines a
versioned authenticated local IPC channel, correlates every message by
`(requestId, sessionId, questionKey)`, and proves cancel/disconnect behavior.
The plugin must create its production `deliverQuestion` adapter from that
bridge; it must not flip `CANDICE_COMPANION_READY` to `1` merely because the
app executable exists.

## Verification

```bash
npm --prefix apps/candice-companion run test:visual-stage
cargo test --manifest-path apps/candice-companion/src-tauri/Cargo.toml
npm --prefix apps/candice-companion run build
npm --prefix apps/candice-companion run verify:visual-bundle
```

These prove the runtime composition is reachable, truthful, buildable, and
packaged with the canonical visual asset. They do not certify a full MCP
answer path.
