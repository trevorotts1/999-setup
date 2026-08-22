# CHECKPOINT — WS-04 structured ask_user MCP path

- **Run/unit:** WS-WS-04 builder (opus/max), W2 slice WR-013, workstream WS-04
- **Slice row:** PROJECT-MANIFEST 9.2 WR-011 (`plugins/candice-integration/mcp/**` incl. `plugins/candice-integration/.mcp.json`)
- **Snapshot truth (CONTROL/task-graph-snapshot.json WS-04):** deps WS-01, WS-02, WS-03; level 2; wave W2; slice WR-013; owned_paths `plugins/candice-integration/mcp/ask-user/`; required_outputs "ask_user MCP tool (question events in, structured answer out)", "answer routes to owning Claude session"
- **Worktree:** `/Users/blackceomacmini/Downloads/999-setup/worktrees/wr001-bootstrap`
- **Date:** 2026-08-21
- **Consumed (read-only):** WS-01 schemas (`packages/candice-protocol/schemas/**`, fixtures), WS-03 `session/session-lifecycle.js` (lifecycle seam), WS-05 `fallback/**` + README structure, WS-02 plugin layout. No file outside the owned glob was created or modified.

## Files created (all under owned glob)

| Path | Role |
|---|---|
| `mcp/.mcp.json` (plugin root per spec-layout + plugin docs) | Registers the `candice` stdio MCP server: `node ${CLAUDE_PLUGIN_ROOT}/mcp/ask-user/server.js`. Env `CANDICE_COMPANION_READY=probe` — the READY=1 flip to adopt the companion is the install/bootstrap lane's job (probe treats "companion unavailable" as fail-soft, not as failure). |
| `mcp/ask-user/server.js` | MCP stdio server + `candice.ask_user` tool. Zero-dependency JSON-RPC/MCP wire layer: initialize (+protocol negotiation), notifications/initialized, tools/list (exactly one tool), tools/call, ping. Enforces exactly-one-answer, same-session routing, and fail-soft on every unavailability path. |
| `mcp/ask-user/validate.js` | Field-level validator mirroring the WS-01 schemas (question/answer events): required, enum, pattern, bounds, additionalProperties:false. Rejects bad questions BEFORE they reach the companion, and unconfirmed transcripts before they are recorded. |
| `mcp/ask-user/answer-registry.js` | Slot registry for the in-flight tool call: open -> put -> take, exactly once. Second answer refused; wrong-session refused (spec 17, never re-routed). No answer store survives the read (spec 13.2 "no duplicate answer store"). |
| `mcp/ask-user/mcp.test.js` | Zero-dependency Node suite, 43 checks (exit 0). Includes canonical `tools/call` framing checks (`params.name` + `params.arguments`, the shape a real MCP client emits). |
| `mcp/ask-user/CHECKPOINT-WS-04.md` | This note. |

## Acceptance evidence (E.1 WS-04)

> WS-04 PASS: `candice.ask_user` MCP path delivers a question and returns exactly one answer to the owning session.

Spec 13.2 checklist 1–5, each proven by suite check with exact input printed:

1. **Receives the structured question event from the same active session** — `ask_user` validates the question-event shape (questionKey pattern, skill enum, input-mode enum, sensitivity/readAloud pair) and refuses an invalid event BEFORE any delivery (`delivered === 0` proven).
2. **Display/speak it locally** — the tool calls the injectable `deliverQuestion(question)` front channel only after validation; the companion surface owns display/speak (WS-09/WS-19 consume the same contract).
3. **Accept voice or typed input** — answer-event `inputMode` carries `voice` and `typed`; both confirmed-answer tests pass.
4. **Allow transcript correction** — unconfirmed transcripts (`userConfirmedTranscript:false`) are refused with `not-confirmed`; only the final approved text is recorded (spec 14).
5. **Return the final approved text to the same MCP tool call in the same session** — the tool call blocks on the slot registry until the approved answer lands, then returns it in the same `tools/call` response. Wrong session / wrong questionKey / second answer are all refused.
6. **Fail soft when the companion is unavailable** — `companion unavailable`, `delivery failed`, and `no answer within window` all return `isError:true` text instructing "ask the same question in Claude normally" (spec 13.2, 20). Proven over real stdio too.
7. **Crash recovery handoff (spec 20)** — the tool records the pending question through the WS-03 lifecycle seam (`setPendingQuestion`) and the one answer (`recordAnswer`); a lifecycle failure never destroys the answer (try/catch around record, spec 20).
8. **Exactly one answer (spec 14)** — double open refused (`slot-open`), second put refused (`already-answered`), second take finds nothing (`not-answered`); `openCount() === 0` after the single read — no retained answer store.

## Verification (primary source, run on this worktree)

```
node plugins/candice-integration/mcp/ask-user/mcp.test.js
=> ALL TESTS PASSED (exit 0), 41/41 checks
claude plugin validate plugins/candice-integration
=> Validation passed (plugin manifest + .mcp.json accepted)
jq empty plugins/candice-integration/.mcp.json
=> valid
node plugins/candice-integration/session/session-lifecycle.test.js   # regression: untouchable, still green
=> ALL TESTS PASSED
node plugins/candice-integration/fallback/fallback.test.js           # regression: untouchable, still green
=> ALL TESTS PASSED
```

Live stdio handshake through the exact command `.mcp.json` registers
(`node plugins/candice-integration/mcp/ask-user/server.js`):
initialize -> protocolVersion 2025-06-18 / serverInfo name `candice` /
capabilities.tools accepted; tools/list -> `ask_user`; clean exit 0.

Fixtures parity: WS-01 `question-event.valid.json`/`answer-event.valid.json` accepted;
`question-event.invalid.json`/`answer-event.invalid.json` refused by field checks
(skill enum / questionKey pattern respectively).

## QC round (blind sonnet/max, 2026-08-21) — FAIL then fixed; FRESH RECHECK REQUIRED

Blind QC found one CRITICAL defect and repaired it (backup at
`.qc-backup-ws04-qc-20260821/` — `server.js.bak`, `mcp.test.js.bak`,
`CHECKPOINT-WS-04.md.bak`):

- **CRITICAL (fixed):** `tools/call` param extraction in `server.js` read
  `msg.params.params` — the legacy nesting. The MCP spec (2024-11-05,
  2025-03-26, 2025-06-18) and every real client (Claude Code included) frame
  tool calls as `params: { name, arguments: {...} }`. A canonical call reached
  `askUser` with `question: undefined` and every real invocation would have
  returned `invalid question event (question: must be an object)` — the tool
  could never deliver a question in production. Fix: extract
  `msg.params.arguments` first, fall back to the legacy `params` key for
  back-compat. New suite checks: canonical framing honored in-process, and
  canonical framing over real stdio subprocess (43/43 green after fix).
- Verified after fix: canonical happy path (ready + deliverQuestion via
  `handleLine`) returns the structured answer end to end; canonical fail-soft
  over real stdio returns the "ask in Claude normally" instruction.

FRESH RECHECK REQUIRED by an independent sonnet/max QC agent before the
E.1 WS-04 box may flip.

## Deliberately NOT done (scope)

- No companion display/speak/TTS/STT (WS-09/WS-12/16/17/19 lanes) — the tool
  calls a `deliverQuestion` seam.
- No OS terminal injection (WS-05 adapter owns fallback; WS-21/26 bindings own OS injection).
- No `status`/`begin_session`/`show_message`/`set_progress`/`compact`/`end_session`
  tools in this server: they belong to other conceptual MCP tools (spec 13.2 list)
  and their consumers (WS-08/WS-36). This lane deliberately ships exactly the
  one tool its acceptance criterion names — a second tool would expand the
  surface without a lane owner.
- No `tests/contract/**` (WS-41 owns the ajv contract suite).
- No commits, no pushes (slice instructions). No shared/root writes (9.4/9.5).

## Cross-lane notes (informational)

- `.mcp.json` is the 9.3 within-run shared file explicitly for the WR-011 run
  (consolidated endpoint registration) — this lane wrote it once; the run's
  integration owner maps consolidation, and the WS-31 bootstrap lands
  `CANDICE_COMPANION_READY=1` when the companion binary is provisioned.
- `README.md` (plugin root, WS-05-owned) already documents `mcp/**` as WS-04's —
  no edit needed.
