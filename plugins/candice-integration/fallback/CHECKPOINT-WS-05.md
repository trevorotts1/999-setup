# CHECKPOINT — WS-05 same-session free-conversation/terminal fallback adapter

- **Slice:** WR-011 (manifest 9.2 row) — workstream WS-05
- **Builder:** WS-WS-05 (opus/max)
- **Worktree:** `/Users/blackceomacmini/Downloads/999-setup/worktrees/wr001-bootstrap`
  (branch `candice/wr001-bootstrap`, base `aa23ed9`)
- **Date:** 2026-08-21
- **Owned glob (manifest 9.2 WR-011):** `plugins/candice-integration/fallback/**` + `plugins/candice-integration/README.md` (WS-05)
- **Dept snapshot truth (CONTROL/task-graph-snapshot.json WS-05):** deps WS-01, WS-03; level 2; wave W2; owned_paths `plugins/candice-integration/fallback/`; required_outputs "terminal fallback adapter", "Answer in Claude instead path with no double-count guard", "same-session identity enforcement".

  WS-03-owned `session/**`, WS-02-owned `.claude-plugin/**`/`hooks/**`/`bin/**`, WS-04-owned `mcp/**`/`.mcp.json` — none touched. Cross-lane dependency: consumes the WS-03 `SessionLifecycle` via `require('../session/session-lifecycle')` (read-only import; the real facade test also verifies the seam). No file outside the owned glob was created or modified by this lane.

## Files created (all under owned glob)

| Path | Role |
|---|---|
| `fallback/double-count-guard.js` | Exactly-once bookkeeping per `(sessionId, questionKey)`: none -> deferred -> answered. Defer is idempotent (redelivery never opens a second answer slot); reconcile records the answer exactly once through the WS-03 lifecycle seam and surfaces `question-already-consumed` when the MCP path already consumed the slot. |
| `fallback/terminal-input-adapter.js` | Same-session terminal input adapter (spec 13.3 injection rules): exact-session routing via the WS-03 route resolver, refuse-safe when unproven/ambiguous/inactive (spec 17, 20), busy-queue with "Claude is working" state, returns the exact payload for display (no hidden prompts). |
| `fallback/fallback-coordinator.js` | The "Answer in Claude instead" orchestrator: `fallbackQuestion` hands the same question to the terminal surface (no state loss), `answerFromTerminal` produces exactly one answer-event with `inputMode: 'terminal'` and refuses duplicates. |
| `fallback/fallback.test.js` | Zero-dependency Node suite, 29 checks. |
| `fallback/CHECKPOINT-WS-05.md` | This note. |
| `README.md` (plugin root, WS-05-owned per 9.2) | Plugin layout + fallback behavior documentation. |

## Acceptance evidence (E.1 WS-05)

> WS-05 PASS: same-session free-conversation/terminal fallback adapter delivers
> the question normally in Claude when MCP is unavailable, without double-counting.

Covered by tests (each printed with exact input, primary source):

1. **Delivers the question normally in Claude** — `fallbackQuestion` returns the same `text`/`questionKey`/`sessionId` payload; repeat delivery is `redelivered:true` with one slot (no state loss, spec 5.1).
2. **No double-count** — defer/reconcile exactly once; second defer refuses `already-answered`; second answer refuses `already-answered`; reconcile against a lifecycle whose slot the MCP path consumed refuses `question-already-consumed`. Real-seam proof: with the actual WS-03 `SessionLifecycle` the terminal reconcile yields `questionCount === 1`, `hasPendingQuestion === false`, and a second reconcile leaves `questionCount === 1`.
3. **Same-session identity enforcement** — no route resolver => `unproven-session`; window as only evidence => `unproven-session`; ambiguous window (tabs/panes) => `route-refused`; inactive/mismatched session => `route-refused` (spec 17 "refuse", spec 20 "session mismatch"); answer to a different session => `never-deferred`.
4. **Spec 13.3 injection rules in the adapter** — busy queues (nothing injected while busy, "Claude is working…" note), ordered flush, `dropQueued` before submission, broken busy probe fails closed, exact payload returned for display.
5. **Zero dependencies / load clean** — all three modules `require` clean on Node v26.7.0; existing WS-03 suite still PASS (cross-lane regression check).

## Verification (primary source, run on this worktree)

```
node plugins/candice-integration/fallback/fallback.test.js
=> ALL TESTS PASSED (exit 0), 29/29 checks
node plugins/candice-integration/session/session-lifecycle.test.js
=> ALL TESTS PASSED (exit 0)          # WS-03 regression, untouched by this lane
```

No commit made (per slice instructions: no commits; no shared/root files touched).
