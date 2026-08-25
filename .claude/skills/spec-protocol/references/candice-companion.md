# Candice companion — integration reference (Spec Protocol lane)

Owned by WS-36 (manifest 9.2 WR-019). Read this file when a step must interact
with the Candice companion — wake-up, the structured question bridge, the
Answer-in-Claude fallback, or progress reporting. The question/answer JSON
contract itself lives in `references/candice-question-contract.md`.

Candice is optional presentation infrastructure. **No Candice failure is ever
allowed to destroy, reset, or block the project** (Master Spec 20). Every
interaction below is fail-soft: if the companion, the MCP bridge, or the
session binding is unavailable, the exact same question is asked normally in
Claude, in the same session, without double-counting.

The active Claude Code session and this skill remain the brain, rules, memory,
and source of truth. Candice is the face, voice, ears, and lightweight user
interface. She never creates a second AI conversation, never keeps competing
project memory, never rewrites question order or skill rules (Master Spec
§2/§9/§15).

---

## 1. When Candice appears

Candice wakes automatically when a supported slash command is invoked
(`/spec-protocol`, `/kaizen`, `/eli5`, `/bro` — Master Spec §3). The wake-up is
the Candice plugin's job (`plugins/candice-integration/` — hooks on
UserPromptExpansion and SessionStart). The companion is launched/raised
asynchronously and bound to the current Claude session id and foreground
terminal host (Master Spec §13.1). The hook never blocks this skill.

**Spec Protocol's own Candice touchpoint:** Candice appears at the beginning of
the slash-command run and welcomes the user before preflight: "Hi, I'm
Candice. I'm here to help you build the app, the software, or the thing you've
always dreamed about. Think of me as your fairy godmother: you make a wish,
and I help make it real." This is a presentation-only setup-check surface, not
a question: it does not alter governed-question order or counts. Candice is a
progress surface for the preflight — **she is not the component that decides
whether setup passes.** This skill still runs its own environment/preflight
checks, records the results, and reports them itself.

### Companion availability check

The skill does not probe the app by launching it. The readiness probe is
environment-driven:

1. The Candice plugin is registered (its hooks fired on the slash command —
   Master Spec §2/§13.1). If the plugin/hooks are absent, Candice simply never
   wakes and every question is asked normally in Claude. No action needed.
2. `CANDICE_COMPANION_READY=1` in the `candice` MCP server env
   (`plugins/candice-integration/.mcp.json`) means the companion binary is
   provisioned. The `ask_user` tool fails soft when this flag is not `1`
   (`companion unavailable`) — the skill then asks the question in Claude
   normally. The flag is flipped by the bootstrap/updater lanes (WS-31/WS-32),
   never by this skill.
3. Neither the plugin nor the app being present is an error. Candice is an
   optional surface; her absence changes only how questions are delivered, not
   what is asked, how many times, or what happens next.

## 2. Session identity — the routing authority

Session identity is the routing authority, never the window (Master Spec §17).
The WS-03 session bridge (`plugins/candice-integration/session/**`) is the
single seam that opens/closes sessions, binds the app to the Claude session,
records pending questions, and answers. Window anchors are visual metadata
only.

The skill's part: pass the session id through untouched everywhere Candice is
involved. Answers must return to the same session that asked (Master Spec
§13.2/§17). A wrong session, or a window that cannot be proven to be the
session's, is refused by the bridge — the skill then asks the question in
Claude normally, never by force-injecting into an unproven window.

## 3. The structured bridge (governed questions)

For every governed question this skill asks (interview, gauntlet loop, etc.):

1. Deliver the question as a structured question event through the local MCP
   tool `candice.ask_user` (plugin `.mcp.json` registers the server:
   `node ${CLAUDE_PLUGIN_ROOT}/mcp/ask-user/server.js`). The event shape,
   fields, and the stable key registry are in
   `references/candice-question-contract.md`.
2. The tool blocks until exactly one approved answer returns in the same
   session (voice, typed, or Answer-in-Claude — each counted exactly once).
3. On ANY unavailability (`companion unavailable`, `delivery failed`, `no
   answer within the wait window`, `invalid question event`) the tool returns
   `isError:true` with instructions to ask the same question normally in
   Claude. Do that — same wording, same question key, same counted state.
4. Crash recovery (Master Spec §20): if the session crashed mid-question,
   the WS-03 lifecycle recovers the exact pending question with its
   `counted` flag. Re-ask that question without re-counting; never re-ask an
   answered question.
5. Exactly one governed question at a time. Never deliver a second question
   while one is pending.

**Clarifications are free, governed questions are not:** the user may ask
ordinary clarification questions at any time and receive a natural answer,
but Candice may not skip or rewrite the interview — one governed question at a
time, question ceilings/counts, never-re-ask, write-through durability,
resume, the "I don't know" path, and simple/advanced logic all remain this
skill's authority (Master Spec §15).

## 4. The fallback: "Answer in Claude instead"

When the MCP bridge is unavailable, or the user chooses to answer in Claude:

- Ask the **same question** normally in Claude (same wording, same key).
- Record the answer path as `inputMode: terminal` in the answer event — the
  question is counted exactly once (Master Spec §5.1/§13.2).
- The WS-05 fallback adapter (`plugins/candice-integration/fallback/**`)
  owns the no-double-count accounting seam. This skill drives it
  (`fallbackQuestion` on unavailability, `answerFromTerminal` when the answer
  arrives in the normal turn). The adapter stores no answer text — only
  `(sessionId, questionKey)` bookkeeping (Master Spec §13.2).

## 5. Progress reporting after the interview

When the interview is complete the companion moves to compact mode
(Master Spec §16). Progress is reported from real project state only, never
invented percentages:

- phase/status events follow the status-event schema (`CHECKING_SETUP`,
  `INTERVIEW`, `BUILDING`, `QUALITY_CHECKING`, `FIXING`, `WAITING_FOR_USER`,
  `COMPLETE`, `RECOVERING`, `TEXT_FALLBACK`, `IDLE`, `CLOSED`).
- progress = real counts/ceiling from the run's own ledger/state, formatted
  as text (`"wave 2 of 3"`, `"card 3 of 7"`). Candice never invents a
  percentage this skill did not derive from real state.
- When the active Claude session ends, the companion closes/dormants for
  that session (the app cleans temp audio and window tracking itself; the
  skill does not need to do more than end the session via the WS-03 bridge).

## 6. Privacy and safety (binding)

- **Raw audio is never part of the question/answer contract** (Master Spec
  §14).
- Secret-bearing questions (`sensitivity: "secret"`) are never read aloud:
  `readAloud:false` in the question event; captions still shown (Master Spec
  §5.2/§14).
- No API keys, router tokens, env secrets, or unrelated terminal output are
  ever logged or sent to the companion (Master Spec §24/§20).
- The companion never stores answers; only `(sessionId, questionKey)`
  bookkeeping and the local preference profile (Master Spec §9/§13.2).

## 6. Failure matrix — never stops Claude

| Failure | Behavior (this skill) |
|---|---|
| Companion/app fails to launch | Continue in Claude text mode; ask questions normally |
| MCP bridge unavailable | `ask_user` fails soft → ask the same question in Claude normally |
| Session mismatch/unprovable window | Refuse injection; ask the question directly |
| Companion crashes mid-question | Recover the exact pending question (WS-03), re-ask without re-count |
| Microphone denied / no device | Typing + Answer-in-Claude remain |
| Character/speech assets fail | Captions + text mode; question still asked |

No Candice error is allowed to destroy, reset, or block the user's project
(Master Spec §20).
