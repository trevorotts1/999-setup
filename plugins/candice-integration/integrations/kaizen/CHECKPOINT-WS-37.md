# CHECKPOINT — WS-37 Kaizen Candice integration

- **Run/unit:** WS-WS-37 builder (opus/max), W3, workstream WS-37
- **Slice row:** PROJECT-MANIFEST 9.2 WR-019 (`plugins/candice-integration/integrations/kaizen/**` (WS-37))
- **Snapshot truth (CONTROL/task-graph-snapshot.json WS-37):** deps WS-04, WS-05, WS-36; level 4; wave W3; slice WR-021 (snapshot; manifest row is WR-019 — slice numbering variance documented in FIX-LEDGER, snapshot is the live authority for this run); owned_paths `plugins/candice-integration/integrations/kaizen/`; required_outputs "Kaizen minimum integration instructions", "no question-order/rules modification"
- **Worktree:** `/Users/blackceomacmini/Downloads/999-setup/worktrees/wr001-bootstrap`
- **Date:** 2026-08-21
- **Consumed (read-only):** WS-04 MCP tool (`mcp/ask-user/server.js`, `validate.js`, `.mcp.json`), WS-05 fallback (`fallback/fallback-coordinator.js`, `double-count-guard.js`), WS-36 references (`references/candice-companion.md`, `references/candice-question-contract.md`), WS-01 schemas (`packages/candice-protocol/schemas/question-event.schema.json`, `question-keys.json`), Kaizen skill sources (`.claude/skills/kaizen/SKILL.md`, `references/onboarding.md`, `references/contract.md`), Master Spec sections 2/3/13/14/15/16/20/25, Checklist E.1 WS-37 row. No file outside the owned glob was created or modified.

## Files created (all under owned glob)

| Path | Role |
|---|---|
| `plugins/candice-integration/integrations/kaizen/README.md` | Minimum integration instructions (spec 25): activation (hook already wired on `/kaizen`), environment-driven availability check, structured bridge rules for the seven Recipe questions + Contract approval, fail-soft fallback, free-conversation/compact mode, invariants list, tests, ownership boundary (Kaizen SKILL.md/references not owned by this lane — cross-lane proposal only, manifest 9.4 item 5). |
| `plugins/candice-integration/integrations/kaizen/question-map.js` | Stable Kaizen question registry fragment: 8 keys (7 Recipe pieces + `KAZEN_CONTRACT_APPROVAL`), fixed order, question text verbatim from the Kaizen skill's onboarding reference, `questionEvent(key, sessionId, progress)` builder producing schemaVersion 1.0 / skill `kaizen` events. |
| `plugins/candice-integration/integrations/kaizen/invariants.js` | Mechanical invariant checks: order fixed/contiguous 1..N, keys upper-snake/unique, surface-only wording, once-answered no-repeat, schema envelope, no-secret-read-aloud. |
| `plugins/candice-integration/integrations/kaizen/invariants.test.js` | Plain-node test suite (10 checks, exit 0/1) covering E.1 WS-37 acceptance + WS-04 dependency gate + spec 25 instructions presence. |
| `CHECKPOINT-WS-37.md` | This file. |

## Consistency with dependencies (each verified against source)

- WS-01: events built by `questionEvent` validate against the question-event schema — all 8 keys pass the vendored ajv validator in the WS-41 contract suite path and the WS-04 `validate.js` gate (skill enum `kaizen` accepted, schemaVersion const `1.0`, event const `question`, answerKind enum, input modes enum).
- WS-04: bridge rules match `mcp/ask-user/server.js` exactly: `{ question, sessionId }` call shape, `CANDICE_COMPANION_READY=1` readiness, fail-soft codes from the contract reference; the lane's tests run the WS-04 `validate.js` validator against every Kaizen event (regression green).
- WS-05: fallback rules match `fallback-coordinator.js` (`fallbackQuestion` / `answerFromTerminal`, `inputMode: terminal`, once-answered accounting); regression suite green.
- WS-36: activation/availability/bridge/fallback wording taken from `references/candice-companion.md`; question/answer contract fields, status codes, key rules taken from `references/candice-question-contract.md` (kaizen keys owned by this lane, registry FILE WS-01-owned — this lane proposes the fragment, never applies it).
- Kaizen skill: question order (Target, Location, Better, Scope, Permission, Proof, Interval + Contract approval) and wording taken verbatim from `.claude/skills/kaizen/references/onboarding.md` and `references/contract.md`. No question-order or rules modification — Candice surfaces only.

## Acceptance evidence (E.1 WS-37)

> WS-37 PASS: Kaizen integration is minimal and never modifies question order or rules; Candice surfaces only.

1. Minimal: one owned directory, 4 small files; no edits to any Kaizen skill file or any file outside the owned glob (spec 25 "add only the minimum integration instructions"; the Kaizen SKILL.md is not owned by any lane — edits there are cross-lane proposals only).
2. Never modifies question order: the map's order is fixed and contiguous 1..N; the test asserts the delivery order is exactly the skill's own Recipe order (Target, Location, Better, Scope, Permission, Proof, Interval) and the approval is last, uncounted.
3. Never modifies rules: question text is the skill's own wording; the integration adds no question, removes none, renumbers nothing, never re-asks (once-answered invariant), keeps secret questions unread aloud.
4. Candice surfaces only: README states the session + skill remain the brain/rules/memory/source of truth; the integration is a display/delivery surface over the WS-04 bridge.

## Verification (primary source, run on this worktree)

```
node plugins/candice-integration/integrations/kaizen/invariants.test.js
=> 10/10 PASS, 0 FAILURE(S), exit 0 (command output captured in run log)
node plugins/candice-integration/mcp/ask-user/mcp.test.js
=> ALL TESTS PASSED, exit 0        # dep WS-04 regression
node plugins/candice-integration/fallback/fallback.test.js
=> ALL TESTS PASSED, exit 0        # dep WS-05 regression
node plugins/candice-integration/session/session-lifecycle.test.js
=> ALL TESTS PASSED, exit 0        # dep WS-03 regression (WS-04 consumes)
node tests/contract/suite.js
=> CONTRACT SUITE ALL GREEN, exit 0  # WS-41 contract suite regression
```

Files are uncommitted per dispatch instruction. The 4 files are the only files created or modified by this lane; `plugins/candice-integration/integrations/{bro,kaizen}` empty dirs pre-existed in the worktree and were untouched by the lane.
