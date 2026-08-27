# candice-integration

Local Claude Code plugin that gives Candice — the visual/voice companion — a
place to live inside Claude Code, without making her a second AI session.

The active Claude Code session and the invoked skill (Spec Protocol, Kaizen,
ELI5, Bro) remain the brain, rules, memory, and source of truth. Candice is the
face, voice, ears, and lightweight user interface. She never creates a second
independent conversation, never keeps competing project memory, and never
rewrites question order or skill rules.

## Layout

| Path | Responsibility | Owner (manifest 9.2) |
|---|---|---|
| `.claude-plugin/plugin.json` | Plugin manifest (name `candice-integration`, version 1.0.0) | WS-02 |
| `hooks/hooks.json` | Wake-up hooks for `/spec-protocol`, `/kaizen`, `/eli5`, and `/bro` only — no ordinary-session wake | WS-02 |
| `bin/wake-candice.mjs` | Cross-platform non-blocking visual-wake dispatcher; fails soft when the companion is absent | WS-02 |
| `bin/wake-candice.sh` | Legacy POSIX wrapper retained for older package calls; current registration uses Node directly | WS-02 |
| `session/**` | Session lifecycle + binding bridge; session ID is the routing authority | WS-03 |
| `mcp/**` | Structured `ask_user` MCP path (created by WS-04) | WS-04 |
| `fallback/**` | Same-session terminal fallback adapter — "Answer in Claude instead", no double-count | WS-05 |
| `integrations/{kaizen,eli5,bro}/**` | Per-skill integration (WS-37/38/39) | WS-19 lane |

## How the pieces fit

1. A supported slash command fires the wake-up hook (WS-02); it requests a
   visual wake without inventing a session or terminal binding. The current
   runtime correctly reports that authenticated binding/bridge capabilities
   are unavailable until their owning transport is implemented.
2. Structured questions travel over the MCP contract `candice.ask_user`
   (WS-04), and answers return to the same MCP tool call in the same session.
3. If the companion/MCP path is unavailable, the question falls back to the
   terminal/Claude input surface — same question, same session, counted exactly
   once (WS-05; Master Spec 5.1, 13.2, 20).

## Fallback behavior (WS-05)

- **"Answer in Claude instead"** delivers the same question normally in Claude
  without losing state and without counting the question twice.
- The answer comes back through the normal session input; `inputMode` records
  `terminal` (answer-event schema).
- Same-session identity is enforced: the fallback refuses to route when the
  exact session target cannot be proven, and never treats a window as routing
  evidence (Master Spec 17, 20).
- No answer store lives in Candice — only `(sessionId, questionKey)`
  bookkeeping for exactly-once accounting (Master Spec 13.2).

## Conventions

- Pure CommonJS, zero runtime dependencies — the plugin ships on macOS and
  Windows native paths without a package-manager step (Master Spec 12/17/27).
- Every module returns `{ ok:false, code, error }` on failure and never throws
  into the skill; failure must never stop Claude (Master Spec 20).

## Tests

```bash
node plugins/candice-integration/session/session-lifecycle.test.js   # WS-03
node plugins/candice-integration/fallback/fallback.test.js           # WS-05
```

Both exit 0 on PASS, 1 on FAIL.
