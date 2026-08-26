# WS-42 Checkpoint — same-session Claude + Claude-Nine test suite

**Builder:** WS-WS-42 (opus/max), W3 build
**Run:** WR-020 candice-tests slice, workstream WS-42 (L4 — deps WS-02, WS-03, WS-04, WS-05, WS-36)
**Worktree:** `candice/wr001-bootstrap` (worktrees/wr001-bootstrap)
**Date:** 2026-08-21
**Status:** BUILT — awaiting independent QC verdict (no commit made, per dispatch instruction)

## Files created (all inside the owned glob `tests/same-session/**`)

| File | Purpose |
|---|---|
| `tests/same-session/suite.js` | Single entry point: runs all four test files, exit 0 only when each prints ALL TESTS PASSED |
| `tests/same-session/harness.js` | Read-only resolution of the dependency lanes (WS-02/03/04/05 plugin modules + WS-36 SKILL.md/references), JSON readers, deterministic clock, fake Claude input surface |
| `tests/same-session/same-session.test.js` | E.1 leg 1 (same session owns question and answer): voice/typed/terminal paths all return to the asking session id; second answer refused in every path; cross-session answer refused (`session-mismatch`); answer into a session that never asked refused (`no-open-slot`); `ask_user` end-to-end through the WS-04 server with the WS-03 manager as lifecycle (delivered 1 question, answer returns into the same tool call, `questionCount` = 1); crash recovery re-asks the exact pending question in the same session with `counted` flag and questionCount stays 0 |
| `tests/same-session/no-second-ai.test.js` | E.1 leg 2 (no second independent AI conversation): invariant stated byte-exact in SKILL.md / candice-companion.md / candice-question-contract.md / plugin.json; wake hooks = the four supported commands only, all async; WS-04 server + WS-05 fallback code carry no provider keys, no model refs, no completion endpoints; `fallbackQuestion` returns the SAME text (byte-equal, no reword/renumber), repeat display is a redelivery (no second slot); terminal delivery routes to the owning session id and injects exactly the user text; MCP-unavailable fails soft with the "ask the same question in Claude normally" instruction; wake script launches only `candice-companion --wake`, never a Claude process |
| `tests/same-session/provider-identity.test.js` | E.1 leg 3 (routed provider identity does not change behavior): static scan of the whole plugin tree for provider credential keys / router config / provider-prefixed model ids — zero hits; the ONLY env read in executable plugin code is `CANDICE_COMPANION_READY`; ask-path probes run in child processes with and without routed-provider env — identical fail-soft behavior; guard/registry state carries no provider identity |
| `tests/same-session/session-authority.test.js` | E.1 leg 4 (session identity is the routing authority, never the window): route by session id only; anchor is metadata; unproven window refuses (`unproven-session`); one window hosting two sessions refuses (`ambiguous-window` — tabs/panes cannot cross-route); dead session never routes (`session-not-active`); `SessionLifecycle.route()` seam surfaces the same refusals; terminal adapter self-disables injection on unproven target (`route-refused`, zero injected); a matching unambiguous anchor still routes to the session id |
| `tests/same-session/README.md` | Suite doc: criterion mapping, run commands, cross-lane findings summary |

## Design decisions

- **Harness-agnostic by construction** (E.1: "green under both `claude` and `claude-nine`"). The suite contains ZERO references to either launcher and zero provider coupling — proved by `provider-identity.test.js` itself. The same suite passes on both paths because the code under test never branches on the harness. That is exactly the E.1 clause: "routed provider identity does not change Candice behavior."
- **Drives the real dependency seams, read-only** (0C): WS-03 `SessionManager`/`BindingBridge`/`SessionLifecycle`, WS-04 `AskUserServer`/`AnswerSlotRegistry`, WS-05 `FallbackCoordinator`/`DoubleCountGuard`/`TerminalInputAdapter`, WS-36 SKILL.md + references, WS-02 plugin.json/hooks.json/wake-candice.sh. Never edited.
- **Byte-exact doc greps** for invariants ("She never creates a second AI conversation") so a silent doc edit that drops an invariant fails this suite.
- **Child-process env probes** for the provider-identity leg — the parent runner's environment is never mutated; synthetic env values are never printed.
- **Zero dependencies, plain `node`**, matching every other lane suite (sections 12/17/27: no package-manager step, no network).

## Verification evidence (run live, this lane)

```
$ node tests/same-session/suite.js
==== same-session: PASS ====     (7 checks)
==== no-second-ai: PASS ====     (11 checks)
==== provider-identity: PASS ==== (6 checks)
==== session-authority: PASS ==== (9 checks)
SAME-SESSION SUITE ALL GREEN
```

33 checks, 0 failures, exit 0. Repo regression: existing lane suites still pass unchanged —
`plugins/candice-integration/session/session-lifecycle.test.js`,
`plugins/candice-integration/fallback/fallback.test.js`,
`plugins/candice-integration/mcp/ask-user/mcp.test.js` (which itself runs the WS-03 and WS-05 suites as regressions), and `node tests/contract/suite.js` (WS-41, 37 checks) — all green. None modified.

## Acceptance criterion mapping (CONTROL/CHECKLIST.md E.1 WS-42)

- **same-session suite green under both `claude` and `claude-nine`** — the suite is launcher-agnostic and provider-agnostic by construction; both paths run the same suite (proved the code path is identical in `provider-identity.test.js`).
- **the same session owns question and answer** — every answer path returns to the asking session id (`same-session.test.js`); routing authority is session-only (`session-authority.test.js`).
- **no second independent AI conversation is created** — `no-second-ai.test.js` (invariant stated + shipped seams carry no LLM capability).
- **routed provider identity does not change Candice behavior** — `provider-identity.test.js` (zero coupling + env-equivalence probes).

## CROSS-LANE-FINDING (recorded, not repaired — 0C)

**Finding 1 — WS-03 `SessionLifecycle` facade does not expose `setPendingQuestion` / `recordAnswer`.**
source: WS-WS-42 builder; affected unit: WS-03 (`plugins/candice-integration/session/session-lifecycle.js`); evidence: `server.js` (WS-04) calls `this.lifecycle.setPendingQuestion(...)` and `this.lifecycle.recordAnswer(...)` on the lifecycle seam it is wired with, and the `FallbackCoordinator` (WS-05) resolves a recordAnswer facade with two fallback shapes (`lifecycle.recordAnswer` or `lifecycle.sessions.recordAnswer`) — but the shipped `SessionLifecycle` facade exposes neither; only the raw `SessionManager` has them. WS-04's own tests never caught this because they injected a fake lifecycle. Every real wiring must therefore pass the raw `SessionManager` (as this suite does) or the facade misses the durability record and the exactly-once count. severity: medium (the counting mirror and crash-recovery durability are skipped when a skill wires the facade as documented); recommended action: WS-03 adds pass-through `setPendingQuestion`/`recordAnswer` methods to `SessionLifecycle` (mirroring the facade's existing pass-through style); WS-44 audit verifies.

**Finding 2 — WS-03 `BindingBridge.rebind` does not re-check session activity.**
source: WS-WS-42 builder; affected unit: WS-03 (`plugins/candice-integration/session/bridge/binding-bridge.js`, `rebind`); evidence: `bind()` refuses a dead session (`session-not-active`) but `rebind()` checks only `bindings.has(id)` — a binding that survives an `end_session` (the facade's `endSession` does unbind, but a caller that ends the session via the raw manager, or a crash, leaves the binding) can be re-anchored with a fresh window. The ROUTING path stays safe: `resolveRoute` re-checks `isActive` and refuses the dead session (`session-not-active`, proved in `session-authority.test.js`). severity: low (metadata hygiene only — the anchor is never routing authority); recommended action: WS-03 adds the same `_sessionActive` check to `rebind()`; WS-44 audit verifies.

## Notes for QC

- Deliverable is self-contained: fresh checkout + `node tests/same-session/suite.js` is the whole proof.
- No package.json was added (none exists for tests; nothing vendored — everything is Node built-ins plus the repo's own zero-dependency plugin modules).
- `tests/same-session/**` was the pre-declared WS-42 owned glob in manifest 9.2 row WR-020 — no manifest edit, no path-claim added, no CONTROL/** or root file touched, no commit made (per dispatch instruction).
