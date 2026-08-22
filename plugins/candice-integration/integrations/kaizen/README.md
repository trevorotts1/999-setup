# Kaizen Candice integration (WS-37)

Owned path: `plugins/candice-integration/integrations/kaizen/**` (manifest 9.2
WR-019, task-graph snapshot WS-37). Minimum integration instructions for the
Kaizen Loop skill to surface the Candice companion — nothing more.

Candice is the face, voice, ears, and lightweight user interface. **The active
Claude Code session and the Kaizen skill remain the brain, rules, memory, and
source of truth** (Master Spec 2, 13, 15). This integration:

- never modifies Kaizen question order or rules (E.1 WS-37, Master Spec 15);
- never creates a second AI conversation, and never maintains a competing
  project memory (Master Spec 2);
- adds no question, removes no question, renumbers nothing, and never
  re-asks an answered question (Master Spec 14, 20);
- is minimal: the Kaizen skill text is unchanged — this directory is the
  entire WS-37 write surface (spec 25: "add only the minimum integration
  instructions").

Dependencies consumed read-only (verified in CHECKPOINT-WS-37.md):

- WS-04 structured bridge: `plugins/candice-integration/mcp/ask-user/server.js`
  (`candice.ask_user`), readiness flag `CANDICE_COMPANION_READY=1` in
  `plugins/candice-integration/.mcp.json`;
- WS-05 fallback: `plugins/candice-integration/fallback/fallback-coordinator.js`
  (`fallbackQuestion` / `answerFromTerminal`, no double-count);
- WS-36 integration pattern: `.claude/skills/spec-protocol/references/
  candice-companion.md` and `candice-question-contract.md` (schema 1.0
  question/answer events, stable keys, status codes, fail-soft rules).

## 1. Activation (spec 13.1 — already wired, nothing to do here)

The wake-up hook `plugins/candice-integration/hooks/hooks.json` fires on
`/kaizen` (UserPromptExpansion matcher) and raises/binds the companion to the
current Claude session id and terminal host. Kaizen itself does not launch or
probe the app. If the plugin/hooks are absent, Candice never wakes and every
Kaizen question is asked normally in Claude — that is a supported path, never
an error (candice-companion.md §1).

## 2. Companion availability check (environment-driven)

The Kaizen skill does not self-probe. Readiness is decided by the plugin
contract (candice-companion.md §1):

1. plugin hooks fired on `/kaizen`; absent → text mode, questions asked in
   Claude normally;
2. `CANDICE_COMPANION_READY=1` in the `candice` MCP server env = companion
   provisioned; `ask_user` fails soft when the flag is not `1`.

## 3. The Kaizen governed questions and the bridge (spec 13.2)

Only the onboarding interview is a structured governed question flow.
`question-map.js` in this directory carries the stable Kaizen question
registry fragment — keys, display wording, answer kinds, counted flags,
sensitivity, help text, options, and the fixed order. The fragment is a
candidate for `packages/candice-protocol/schemas/question-keys.json`
(registry owned by WS-01; kaizen/eli5/bro keys are owned by their integration
lanes per candice-question-contract.md §4 — proposed, never applied by this
lane).

Delivery rule for the Kaizen skill:

- Ask each Recipe question one at a time, in the fixed order of the Kaizen
  Recipe (onboarding.md: Target, Location, Better, Scope, Permission, Proof,
  Interval), via `candice.ask_user` with the question event from the map.
- `ask_user` blocks until exactly one approved answer returns in the same
  session (voice, typed, or Answer-in-Claude — each counted exactly once).
- On ANY unavailability the tool returns `isError:true` with a stable code
  (candice-question-contract.md §7) — then ask the same question normally in
  Claude: same wording, same key, same counted state (spec 13.2/20).
- Never deliver a second governed question while one is pending; recover the
  exact pending question on crash without re-counting (spec 20).
- Adapting later questions to earlier answers is done in Kaizen's normal turn
  logic, not by renumbering the Recipe — the map's order is fixed and
  answered-keys are never re-asked (spec 14, 15).
- The Contract approval question ("This is your Kaizen Contract. Do you
  approve it?") is a governed confirmation — `KAZEN_CONTRACT_APPROVAL`
  (confirm), uncounted. Never present the Contract for approval before the
  Recipe completes, and never activate recurring work without approval
  (Kaizen SKILL.md §3 item 4).

## 4. Free conversation and compact mode (spec 13.3, 16)

Outside the onboarding interview, Candice is a compact companion: HOLD TO
TALK, typed questions, `/bro` or `/eli5` shortcuts, mute toggle. Out-of-band
prompts prefer the documented same-session local control interface, else the
tightly scoped WS-05 terminal fallback adapter bound only to the exact
terminal/session that launched Candice (never another window; never hidden
prompts). Progress after the interview (BUILDING, QUALITY CHECKING, FIXING,
WAITING FOR USER, COMPLETE, RECOVERING, TEXT FALLBACK) is reported from real
Kaizen state only — cycle number, item counts, next run time from the Loop's
`STATE.json`/`LOCAL_STATE.json`; never an invented percentage (spec 16).

## 5. Invariants this integration enforces

`invariants.js` + `invariants.test.js` enforce, mechanically:

1. question order is fixed (keys, never renumbered);
2. the seven-piece Recipe is never shortened or extended by Candice
   (Candice surfaces only);
3. every question event from the map validates against the
   question-event schema (skill `kaizen`, schemaVersion `1.0`);
4. answered questions are never re-asked (once-answered rule per
   (sessionId, questionKey));
5. secret-bearing questions are `readAloud:false` (spec 14);
6. no Candice failure path changes the question, order, or count — every
   unavailability path falls back to the same question in Claude.

## Tests

```bash
node plugins/candice-integration/integrations/kaizen/invariants.test.js
```

Exits 0 on PASS, 1 on FAIL. Plain node, zero dependencies (12/17/27).

## Ownership boundary

- `plugins/candice-integration/integrations/kaizen/**` — WS-37 only.
- `question-keys.json` (registry) — WS-01 owns the file; the Kaizen fragment
  here is the proposal source (candice-question-contract.md §4).
- `.claude/skills/kaizen/SKILL.md` and `references/**` — not owned by this
  lane; any edit there is a cross-lane proposal through the integration owner
  (manifest 9.4 item 5). The skill's own onboarding wording remains the
  authority for what is asked.
