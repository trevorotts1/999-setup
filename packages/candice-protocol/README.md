# candice-protocol

Versioned JSON contract between the Claude Code session/skill layer and the Candice
Companion app. This package is the contract root (Master Spec section 14): it defines
the structured question/answer/status events and the local preferences profile. The
companion never infers protocol questions from arbitrary terminal prose, never creates
a second AI conversation, and never maintains a competing project memory.

## Schemas (`schemas/`)

| Logical name | File | Purpose |
|---|---|---|
| `question-event` | `schemas/question-event.schema.json` | A structured governed question delivered to the companion |
| `answer-event` | `schemas/answer-event.schema.json` | The single approved answer returned to the owning Claude session |
| `status-event` | `schemas/status-event.schema.json` | Real session/skill state; progress is never invented |
| `preferences` | `schemas/preferences.schema.json` | Local preference profile (spec 9); never project memory |
| `event-envelope` | `schemas/common/event-envelope.schema.json` | Shared discriminators across all events |
| `question-keys` | `schemas/question-keys.json` | Machine-enumerable stable question key registry (spec 14) |

`schemas/schema-index.json` enumerates the protocol schemas; the WS-41 contract suite
validates against it.

## Contract rules

- **Session identity is routing authority.** `sessionId` binds question and answer to
  the same Claude Code session. Host-window position is never session identity
  (spec 17).
- **Exactly one answer per question.** Voice, typed, and Answer-in-Claude paths each
  return exactly one answer; Answer-in-Claude never double-counts (spec 5.1, 27).
- **Raw audio is never part of the contract** (spec 14).
- **Transcripts require confirmation.** A voice transcription is submitted only after
  the user confirms it (USE ANSWER / EDIT / TRY AGAIN, spec 6).
- **Secret questions are never read aloud** (`readAloud: false`, `sensitivity: "secret"`).
- **Captions always shown** regardless of voice-output state (spec 5.2).
- **Stable question keys.** Keys are fixed for the life of the contract; a key is
  never re-asked once answered and never reused for a different question.
- **Version discipline.** `schemaVersion` is `"1.0"` in this baseline. Consumers
  reject unknown versions; schema bumps are proposed by the owning lane and applied by
  the integration/release owner (manifest 9.4 class 2); migrations live in WS-34.

## Fixtures (`tests/fixtures/`)

- `question-event.valid.json`, `answer-event.valid.json`, `status-event.valid.json`,
  `preferences.valid.json` — valid instances of each schema (spec 14 example shapes).
- `question-event.invalid.json`, `answer-event.invalid.json` — deliberate violations
  (bad enum, missing key, wrong discriminator) that must fail validation.

The WS-41 contract suite (L3) extends this into the full regression suite; the
fixtures here are the minimum set required for the WS-01 acceptance criterion.
