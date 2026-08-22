# candice-integration / session — session lifecycle + binding bridge (WS-03)

Owned path: `plugins/candice-integration/session/**` (task-graph snapshot WS-03 owned_paths) — session lifecycle and binding
bridge for the Candice companion. Companion app, MCP tools, hooks, and terminal
fallback adapters consume this API.

## Layout

| Path | Responsibility |
|---|---|
| `session/session-manager.js` | Session lifecycle store: `begin_session`, `end_session`, pending-question state, crash recovery. Write-through JSON state, atomic writes. |
| `session/session-lifecycle.js` | Facade over the session manager + binding bridge — the single seam the MCP path and hooks call. |
| `session/session-lifecycle.test.js` | Node test suite (zero dependencies) for lifecycle + bridge. |
| `session/bridge/binding-bridge.js` | Session-keyed binding registry. Window anchors are **visual metadata only**; session ID is the routing authority (Master Spec section 17). |

## Rules these modules enforce

1. **Session identity is the routing authority, never the window.** The bridge
   refuses to route when a window alone is offered as proof, and refuses when a
   window maps to more than one session (tabs/panes).
2. **One active session per store.** `begin_session` on an already-active
   session returns `already-active`; it never silently overwrites.
3. **Crash recovery returns the exact pending question** with its `counted`
   flag so the skill re-asks without re-counting (section 20). No double-count.
4. **Write-through durability.** Every mutation persists immediately to
   `stateDir/candice-sessions.json` via temp-file + rename; a new manager
   instance reloads the same truth.
5. **Failure never stops Claude.** Every route returns `{ ok:false, code }` and
   callers fall back to text-in-Claude (section 20).
6. **No runtime dependencies.** Plain CommonJS on macOS and Windows native
   paths — no package-manager step on the customer machine (sections 12/17/27).

## Usage

```js
const { SessionLifecycle } = require('./session/session-lifecycle')

const lifecycle = new SessionLifecycle({ stateDir: process.env.CANDICE_STATE_DIR || null })

const begin = lifecycle.beginSession({ sessionId: '<claude session id>', skill: 'spec-protocol' })
if (!begin.ok) { /* fall back to text mode — never block the skill */ }

const status = lifecycle.status({ sessionId: '<claude session id>' })
const route = lifecycle.route({ sessionId: '<claude session id>' })
// route.ok === true only when the exact session is provable.

const end = lifecycle.endSession({ sessionId: '<claude session id>', reason: 'interview complete' })
// end.cleanup.releaseWindowAnchor — caller performs actual resource cleanup.
```

## Test

```bash
node plugins/candice-integration/session/session-lifecycle.test.js
```

Exit 0 = PASS. The suite covers lifecycle open/close, duplicate protection,
pending-question answer-once semantics, question-key mismatch refusal, crash
recovery without re-count, write-through durability, and the routing-authority
matrix (session-only, unproven window, ambiguous window, rebind metadata).
