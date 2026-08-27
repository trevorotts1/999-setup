# Candice question contract — Spec Protocol lane

Owned by WS-36 (manifest 9.2 WR-019). The structured, versioned contract the
Spec Protocol skill uses to deliver governed questions to the Candice
companion and receive exactly one approved answer. Contract root: Candice
Master Spec section 14. Companion behavior, session identity, fallback, and
privacy rules: `references/candice-companion.md`.

The question/answer JSON never replaces the human/model-facing protocol
doctrine. The schemas are the enforceable companion contract; the interview
doctrine stays readable where it already lives.

## 1. Where the contract lives

| Item | Path | Owner (manifest 9.2) |
|---|---|---|
| question-event schema | `packages/candice-protocol/schemas/question-event.schema.json` | WS-01 |
| answer-event schema | `packages/candice-protocol/schemas/answer-event.schema.json` | WS-01 |
| status-event schema | `packages/candice-protocol/schemas/status-event.schema.json` | WS-01 |
| preferences schema | `packages/candice-protocol/schemas/preferences.schema.json` | WS-01 |
| governed-question registry | `packages/candice-protocol/schemas/question-keys.json` (+ `question-registry.js`) | WS-01 |
| schema index | `packages/candice-protocol/schemas/schema-index.json` | WS-01 |
| contract test suite | `tests/contract/**` | WS-41 |
| MCP tool | `candice.ask_user` — `plugins/candice-integration/mcp/ask-user/server.js` | WS-04 |
| fallback adapter | `plugins/candice-integration/fallback/**` | WS-05 |
| session lifecycle | `plugins/candice-integration/session/**` | WS-03 |

Schema versions are bumped by the integration/release owner only (manifest
9.4 class 2); consumers reject unknown versions. **Question keys are stable
for the life of the contract**: the same key is never sent twice to the same
session once answered.

## 2. Question event (schemaVersion 1.0)

The `candice.ask_user` tool accepts `{ question, sessionId }` where
`question` validates against the question-event schema. Required fields:

| Field | Meaning |
|---|---|
| `schemaVersion` | `"1.0"` — const |
| `sessionId` | Opaque Claude session id — routing authority (spec 17) |
| `skill` | `spec-protocol`, `kaizen`, `eli5`, or `bro` |
| `event` | `"question"` — const discriminator |
| `questionKey` | Stable key, pattern `^[A-Z][A-Z0-9_-]*$` (registry below) |
| `text` | Display and spoken wording |
| `answerKind` | `free_text`, `single_choice`, `yes_no`, `confirm`, `mode_choice` |
| `allowedInputModes` | Subset of `voice`, `typed`, `terminal` (min 1, unique) |
| `readAloud` | `false` for secret-bearing questions — never spoken aloud |
| `sensitivity` | `normal`, `secret`, or `personal` |
| `counted` | True when the question counts toward the governed ceiling |
| `progress` | `null` or `{ current, ceiling, shortcut }` — real state only |
| `helpText` | Optional plain-language guidance (string or null) |
| `canGoBack` | Whether the user may return to this question |

Optional extensions validated by the schema: `options` (allowed choices for
`single_choice`/`mode_choice`), `validation` (`minLength`/`maxLength`/`pattern`),
`conditions` (branching metadata). Additional properties are refused.

Canonical example (spec 14, verbatim):

```json
{
  "schemaVersion": "1.0",
  "sessionId": "opaque-session-id",
  "skill": "spec-protocol",
  "event": "question",
  "questionKey": "BUILD_TARGET",
  "text": "Tell me about your idea in your own words: what is it, and who is it for?",
  "answerKind": "free_text",
  "allowedInputModes": ["voice", "typed", "terminal"],
  "readAloud": true,
  "sensitivity": "normal",
  "counted": false,
  "progress": null,
  "helpText": "A sentence or two is plenty.",
  "canGoBack": true
}
```

## 3. Answer event (schemaVersion 1.0)

Exactly one answer returns from the same `candice.ask_user` tool call in the
same session. Required fields:

| Field | Meaning |
|---|---|
| `schemaVersion` | `"1.0"` — const |
| `sessionId` | Echoed from the question — mismatch refused, never re-routed |
| `questionKey` | Echoed from the question |
| `answerText` | The final user-approved text (voice = confirmed transcript only) |
| `inputMode` | `voice`, `typed`, or `terminal` (Answer-in-Claude) |
| `userConfirmedTranscript` | True only after explicit confirmation (USE ANSWER) |

Optional: `cancelled` (user abandoned: TRY AGAIN exhausted or
Answer-in-Claude — the owning skill then decides the fallback), `sensitivity`
(echoed; `secret` answers must never be logged), `answeredAt`.

```json
{
  "schemaVersion": "1.0",
  "sessionId": "opaque-session-id",
  "questionKey": "BUILD_TARGET",
  "answerText": "I want a booking tool for local barbers.",
  "inputMode": "voice",
  "userConfirmedTranscript": true
}
```

Raw audio is never part of the response contract.

## 4. Stable question keys (registry)

`packages/candice-protocol/schemas/question-keys.json` is the immutable,
versioned authority registry — the mechanical source for stable keys, display/spoken
wording, counted vs uncounted, conditions, read-aloud safety, validation,
never-re-ask, and resume behavior (spec 14). Seeded key: `BUILD_TARGET`
(spec-protocol). The registry is extended by the owning skill lane only —
new spec-protocol keys are proposed to the WS-36 lane; kaizen/eli5/bro keys
are owned by their integration lanes.

Rules:

- A key is never re-sent to the same session once answered (never-re-ask).
- A key's `counted` flag is fixed for the life of the contract.
- Keys are upper-snake (`^[A-Z][A-Z0-9_-]*$`).
- Unknown and retired keys are refused before bridge delivery. Producers must
  call `question-registry.js` to construct canonical events; text, options,
  validation, count, privacy, retry, resume, and declarative conditions cannot
  be supplied ad hoc. Conditions are data-only expression trees over named
  facts; executable JavaScript and prose-only conditions are invalid.
- A secret entry requires `readAloud:false`; a personal entry requires an
  explicit opt-in. Template context is allow-listed and never carries raw
  secrets. Pending recovery allows only the same key once; answered keys are
  never re-asked.

## 5. Status events (progress)

The status-event schema (`schemaVersion 1.0`, `sessionId`, `event:
"status"`, `phase`, `message`, `captions`, `timestamp`) carries real
session/skill state to the companion. Phases: `CHECKING_SETUP`, `INTERVIEW`,
`BUILDING`, `QUALITY_CHECKING`, `FIXING`, `WAITING_FOR_USER`, `COMPLETE`,
`RECOVERING`, `TEXT_FALLBACK`, `IDLE`, `CLOSED`. `message` is also shown as a
caption regardless of voice state (spec 5.2). Progress is real state only —
never invented percentages (spec 16).

## 6. The MCP call

Tool: `candice.ask_user` — `{ "question": <question event> }`. Behavior
(spec 13.2 items 1-5, proven by WS-04 suite and enforced by the WS-41
contract suite):

1. Receives the structured question from the same active session.
2. Display/speaks it locally.
3. Accepts voice or typed input.
4. Allows transcript correction — unconfirmed transcripts are refused
   (`not-confirmed`); only the final approved text is recorded.
5. Returns the final approved text to the same tool call in the same session.
6. Fails soft on every unavailability path with a stable instruction: ask
   the same question in Claude normally (spec 20).

No duplicate answer store lives inside Candice (spec 13.2).

## 7. Status codes (stable)

| Code | Meaning | Skill action |
|---|---|---|
| `companion unavailable` | App not provisioned (`CANDICE_COMPANION_READY` ≠ `1`) | ask in Claude normally |
| `delivery failed` / `no-deliverer` / `delivery-threw` | Question never reached the surface | ask in Claude normally |
| `no answer within the wait window` | User never confirmed | ask in Claude normally |
| `already-answered` / `slot-open` | double-delivery refused | do not re-deliver |
| `not-confirmed` | transcript not approved | never record |
| `sessionId mismatch` | wrong-session attempt | refused, never re-routed (spec 17) |
| `invalid question event` | schema violation | fix the event; re-validate |

Every error path keeps the same question, same session, same counted state —
no double-count, no re-ask of answered questions (spec 5.1/13.2/20).
