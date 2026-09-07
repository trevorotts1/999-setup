# CHECKPOINT — WS-36 Spec Protocol Candice integration

- **Run/unit:** WS-WS-36 builder (opus/max), W2, workstream WS-36
- **Slice row:** PROJECT-MANIFEST 9.2 WR-019 (`.claude/skills/spec-protocol/SKILL.md` + `references/candice-companion.md` + `references/candice-question-contract.md`; final SKILL.md consolidation is 9.4, not lane-applied)
- **Snapshot truth (CONTROL/task-graph-snapshot.json WS-36):** deps WS-01, WS-02, WS-04, WS-05; level 3; wave W2; slice WR-019; owned_paths `.claude/skills/spec-protocol/SKILL.md`, `.claude/skills/spec-protocol/references/candice-companion.md`, `.claude/skills/spec-protocol/references/candice-question-contract.md`; required_outputs "concise SKILL.md section (activation, companion availability check, structured bridge rules, fallback, reference)", "references/candice-companion.md + candice-question-contract.md"
- **Worktree:** `/Users/blackceomacmini/Downloads/999-setup/worktrees/wr001-bootstrap`
- **Date:** 2026-08-21
- **Consumed (read-only):** WS-01 schemas + fixtures + registry (`packages/candice-protocol/**`), WS-02 plugin/hooks (`.claude-plugin/plugin.json`, `hooks/hooks.json`, `bin/wake-candice.sh`), WS-03 session lifecycle (`session/session-lifecycle.js`), WS-04 MCP tool (`mcp/ask-user/server.js`, `.mcp.json`), WS-05 fallback (`fallback/fallback-coordinator.js`, `double-count-guard.js`, `terminal-input-adapter.js`), contract suite (`tests/contract/**`), Master Spec sections 3/5/13/14/15/16/17/20/25, Checklist E.1 WS-36 row. No file outside the owned glob was created or modified.

## Files created (all under owned glob)

| Path | Role |
|---|---|
| `.claude/skills/spec-protocol/SKILL.md` | Added one concise `## CANDICE — the companion` section (activation, environment-driven availability check, structured bridge rules, fail-soft fallback, progress/provenance rules, references) and appended reference-list entries 24 and 25 pointing at the two new references. Spec 25: concise by design — no Candice implementation dump; the detail lives in the two references. |
| `.claude/skills/spec-protocol/references/candice-companion.md` | Detail reference: when Candice appears, availability check (plugin hooks + `CANDICE_COMPANION_READY=1` env, never a self-probe), session identity as routing authority (spec 17), structured `candice.ask_user` bridge, Answer-in-Claude fallback (spec 13.2/20), progress reporting from real state only (spec 16), privacy/safety (spec 14), failure matrix (spec 20). |
| `.claude/skills/spec-protocol/references/candice-question-contract.md` | Contract reference: schema ownership table, question-event fields + canonical spec-14 JSON, answer-event fields + canonical JSON, stable key registry rules, status-event phases, `candice.ask_user` call shape, stable fail-soft status codes. |

Backup: `.claude/skills/spec-protocol/SKILL.md.bak-pre-ws36-candice-20260821` (byte-identical pre-edit copy).

## Consistency with dependencies (each verified against source)

- WS-01: section/reference cite `question-keys.json` registry (`BUILD_TARGET`), `schemaVersion "1.0"`, event envelope discriminators, answer fields (`answerText`, `inputMode voice|typed|terminal`, `userConfirmedTranscript`), status phases list verbatim from `status-event.schema.json`, readAloud/sensitivity rules from schemas.
- WS-02: activation text matches `hooks/hooks.json` matchers (the four slash commands + SessionStart) and `bin/wake-candice.sh` (non-blocking, fails soft when the app is absent).
- WS-04: bridge rules match `mcp/ask-user/server.js` exactly: `{ question, sessionId }` shape, `CANDICE_COMPANION_READY === '1'` readiness probe, fail-soft codes `companion unavailable` / `delivery failed` / `no answer within the wait window` / `sessionId mismatch` / `invalid question event` (validated against `validate.js` codes in `mcp.test.js` expectations), exactly-one-answer, `isError:true` text "ask the same question in Claude normally".
- WS-05: fallback matches `fallback-coordinator.js` usage model (`fallbackQuestion` → same question/prompt in Claude; `answerFromTerminal` → `inputMode: 'terminal'`, exactly once) and `double-count-guard.js` (no answer store, only `(sessionId, questionKey)` bookkeeping).

## Acceptance evidence (E.1 WS-36)

> WS-36 PASS: Spec Protocol `SKILL.md` change is concise (activation, availability check, bridge rules, fallback, reference to `references/candice-companion.md`); Spec Protocol remains the interview authority.

1. Concise: one new section, 49 lines; 2 new reference entries; detail lives in the two references (spec 25). Measured below.
2. Activation: plugin-hook wake on the four commands + setup-check message, never blocks the skill.
3. Availability check: environment-driven (`CANDICE_COMPANION_READY=1`), explicit "never a self-probe"; absence is not an error.
4. Bridge rules: `candice.ask_user` delivery, exactly-one-answer, same-session routing, one governed question at a time, crash recovery without re-count.
5. Fallback: fail-soft on every unavailability path, same question/session/count, no double-count.
6. Reference: both new references linked from SKILL.md and from each other.
7. Interview authority: SKILL.md section states Candice never rewrites question order or rules and remains a progress surface only.

## Verification (primary source, run on this worktree)

```
wc -l SKILL.md                    => 2014 total (was 1963); +51 lines net
node plugins/candice-integration/mcp/ask-user/mcp.test.js
=> ALL TESTS PASSED (exit 0), 43/43 checks        # deps WS-04 regression
node plugins/candice-integration/fallback/fallback.test.js
=> ALL TESTS PASSED                                # deps WS-05 regression
node plugins/candice-integration/session/session-lifecycle.test.js
=> ALL TESTS PASSED                                # deps WS-03 regression
node tests/contract/suite.js
=> ALL PASSED (exit 0)                             # WS-41 contract suite regression (untouched, green)
grep -c '^## ' SKILL.md                            # section count unchanged (+1 only)
```

No test runner exists for SKILL.md content itself; checks above prove the dependencies the section references remain green and the SKILL.md edit is additive (diff below). Uncommitted per dispatch instruction.
