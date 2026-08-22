# Same-session test suite — WS-42

The same-session suite proves the E.1 WS-42 acceptance criterion
(`CONTROL/CHECKLIST.md`): *the same session owns question and answer, no
second independent AI conversation is created, routed provider identity does
not change Candice behavior* (Master Spec 2, 13.2, 17, 20, 27).

## Run

```bash
node tests/same-session/suite.js
```

Exit 0 only when every file prints `ALL TESTS PASSED`. Each file is its own
process (plain `node`, zero dependencies, zero network, no package-manager
step — the repo convention, sections 12/17/27). Cross-platform: macOS and
Windows native paths, no shell.

## Files

| File | Purpose |
|---|---|
| `suite.js` | Single entry point; runs all four test files; exit 0 only when each prints ALL TESTS PASSED |
| `harness.js` | Resolves the dependency lanes read-only (WS-02 plugin, WS-03 session, WS-04 MCP, WS-05 fallback, WS-36 SKILL.md), JSON readers, deterministic clock, fake Claude input surface |
| `same-session.test.js` | Leg 1 — the SAME session owns question and answer: voice / typed / terminal paths all return to the asking session id; second answers refused; cross-session answers refused (spec 17); `ask_user` end-to-end counts exactly once; crash recovery re-asks the exact pending question in the same session without re-count |
| `no-second-ai.test.js` | Leg 2 — no second independent AI conversation: the invariant is stated byte-exact in SKILL.md, candice-companion.md, the question contract, and plugin.json; the shipped seams (WS-04 server, WS-05 fallback, wake hook) carry no provider keys, no model, no prompt synthesis; the fallback redelivers the SAME question text (no reword/renumber); MCP-unavailable fails soft to "ask the same question in Claude normally" |
| `provider-identity.test.js` | Leg 3 — routed provider identity does not change Candice behavior: the plugin has zero provider/routing coupling (static scan of the whole plugin tree), the ONLY env read in code is the `CANDICE_COMPANION_READY` probe, and the ask path behaves identically with and without routed-provider env (child-process probes) |
| `session-authority.test.js` | Leg 4 — session identity is the routing authority, never the window: unproven window refuses, multi-session window (tabs/panes) refuses, dead session never routes, adapter self-disables injection, answers always route to the owning session id |

## Criteria mapping (CHECKLIST E.1 WS-42)

- **same-session suite green under both `claude` and `claude-nine`** — the
  suite is harness-agnostic: zero references to either launcher, zero
  provider coupling (proved by `provider-identity.test.js`), so the same
  suite passes on both paths by construction.
- **the same session owns question and answer** — `same-session.test.js`
  (all paths), `session-authority.test.js` (routing).
- **no second independent AI conversation is created** —
  `no-second-ai.test.js`.
- **routed provider identity does not change Candice behavior** —
  `provider-identity.test.js`.

## Cross-lane findings (recorded, not repaired — 0C)

See `CHECKPOINT-WS-42.md` for the two CROSS-LANE-FINDINGs this suite surfaced
(WS-03 `SessionLifecycle` facade missing `setPendingQuestion`/`recordAnswer`
pass-throughs; WS-03 `BindingBridge.rebind` not re-checking session activity).
