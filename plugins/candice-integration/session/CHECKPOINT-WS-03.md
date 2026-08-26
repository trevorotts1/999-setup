# CHECKPOINT — WS-03 session lifecycle + binding bridge

- **Slice:** WR-010 (manifest 9.2 row; launch ID per board resolution) — workstream WS-03
- **Builder:** B-WR-010-WS-03 (opus/max)
- **Worktree:** `/Users/blackceomacmini/Downloads/999-setup/worktrees/wr001-bootstrap`
  (branch `candice/wr001-bootstrap` @ `aa23ed9`, base `6bb00ec`)
- **Date:** 2026-08-21
- **Owned glob:** `plugins/candice-integration/session/**` — exact WS-03 `owned_paths` from `CONTROL/task-graph-snapshot.json` (dispatch authority). Bridge module nested inside as `session/bridge/`. WS-02-owned `.claude-plugin/**`/`hooks/**`, WS-04 `mcp/**`, WS-05 `fallback/**`, and `.mcp.json` (WS-02 snapshot-owned) — none touched.

  QC-repair note (blind verdict 2026-08-21): builder initially wrote `bin/session/**` + `bin/bridge/**`, citing the stale root `SPEC/PROJECT-MANIFEST.md` (09:54). The worktree manifest 9.2 row WR-011 (12:02, QC-repaired) and the task-graph snapshot both give WS-03 `plugins/candice-integration/session/`. Files moved; internal requires fixed to `./bridge/binding-bridge`; README/checkpoint paths corrected.

## Files created (all under owned glob)

| Path | Role |
|---|---|
| `plugins/candice-integration/session/session-manager.js` | Session lifecycle store: begin/end, pending question, crash recovery, write-through JSON with atomic writes. |
| `plugins/candice-integration/session/bridge/binding-bridge.js` | Session-keyed binding registry; window = visual metadata only, session ID = routing authority (spec 17). |
| `plugins/candice-integration/session/session-lifecycle.js` | Façade over manager + bridge; the seam WS-02 hooks and WS-04 MCP tools consume. |
| `plugins/candice-integration/session/session-lifecycle.test.js` | Zero-dependency Node suite, 20 checks. |
| `plugins/candice-integration/session/README.md` | Usage + contract documentation. |
| `plugins/candice-integration/session/CHECKPOINT-WS-03.md` | This note. |

Determinism note: `session-manager.js` contains one `new Date()` — the default
of the injectable `clock` option. All 21 test constructor sites inject a fixed
clock (`fixedClock('2026-08-21T00:00:00.000Z')`); the default exists only for
real runtime use. This is product code, not a workflow script, so the
workflows.md §5(c) determinism ban does not govern it; the injectable clock
keeps every test run reproducible. (QC repair: the claim was true after repair;
the original test file defined `fixedClock` with zero call sites.)

## Verification (primary source, run on this worktree)

```
node plugins/candice-integration/session/session-lifecycle.test.js
=> ALL TESTS PASSED (exit 0), 20/20 checks
node -e "require('./plugins/candice-integration/session/session-manager')"
node -e "require('./plugins/candice-integration/session/bridge/binding-bridge')"
node -e "require('./plugins/candice-integration/session/session-lifecycle')"
=> all three modules load clean on Node v26.7.0
```

## WS-03 acceptance criterion (CHECKLIST E.1)

> WS-03 PASS: `begin_session`/`end_session` lifecycle works; the bridge binds the
> app to the Claude session ID; session identity is the routing authority, never
> the window.

Covered by tests: lifecycle open/close (+duplicate protection, not-found),
pending-question set/answer-once, question-key mismatch refusal, crash recovery
returning the exact pending question without re-count, resume from recovering,
write-through durability across instances, and the routing-authority matrix —
session-only route resolves; window-only evidence refused (`unproven-session`);
ambiguous window refused (`ambiguous-window`); rebind changes anchor, never
session identity. Independent QC verdict still required before the E.1 box
flips (box-flip rule, CHECKLIST 0J).

## Deliberately NOT done (scope)

- No MCP tool files (`mcp/**` — WS-04), no hook files (`.claude-plugin/**` +
  `hooks/**` — WS-02), no `.mcp.json` (WS-02 snapshot-owned), no terminal
  fallback (`fallback/**` — WS-05), no tests outside the owned glob.
- No commit, no push (builder discipline: checkpoint on handoff only via
  conductor/integration writer).
- No `CONTROL/**`, root, or shared-file writes (9.4/9.5).

## CROSS-LANE-FINDING (1)

- **Affected lane:** WR-012 (WS-08 Candice application state machine,
  `apps/candice-companion/src/state/**`)
- **Finding:** `apps/candice-companion/src/state/machine.ts` (untracked, in this
  worktree) is a TypeScript file. The other two WS-03 modules are plain CommonJS
  and the repo rule set forbids no-TS, but the WS-03 session store
  (`session-manager.js`) is JS and the state machine (`machine.ts`) is TS —
  the WS-08 lane should decide the canonical module format for the session
  lifecycle seam or document the boundary, so WS-04/WS-05 adapters import from
  exactly one shape.
- **Severity:** low (informational; no functional defect observed).
- **Recommended action:** WR-012 lane records a format decision for
  `apps/candice-companion/src/state/**`; WS-03 modules stay CommonJS
  (zero-dependency, node-runnable in the plugin context by design).

## Status

`QC_REPAIRED_AWAITING_FRESH_RECHECK` — blind QC verdict FAIL on ownership +
determinism-claim grounds; QC took the write baton and repaired in place
(paths moved into snapshot-owned `session/**`, internal requires fixed, test
clock injected at all 21 sites, docs corrected). FRESH RECHECK REQUIRED by an
independent sonnet/max QC agent before the E.1 WS-03 box flips. No
self-promotion (CHECKLIST box-flip rule).
