# WS-01 Checkpoint — Candice event/question/answer schemas

**Builder:** B-WR-008-WS-01 (opus/max)
**Run:** first Candice production fan-out, slice WR-008, workstream WS-01
**Branch/worktree:** `candice/wr001-bootstrap` @ `aa23ed9` (base `6bb00ec`)
**Date:** 2026-08-21
**Status:** BUILT — awaiting independent QC verdict (no commit made, per dispatch instruction)

## Files created (all inside the owned glob `packages/candice-protocol/**`)

| File | Purpose |
|---|---|
| `packages/candice-protocol/schemas/question-event.schema.json` | Structured governed question event (spec 14 minimum question event, plus `options`/`validation`/`sensitivity` extensions) |
| `packages/candice-protocol/schemas/answer-event.schema.json` | The single approved answer returned to the owning session (spec 14 minimum response) |
| `packages/candice-protocol/schemas/status-event.schema.json` | Real session/skill state, phases per spec 16; progress never invented |
| `packages/candice-protocol/schemas/preferences.schema.json` | Local preference profile per spec 9 (name, voice toggle, volume, rate, last method, text size, motion, position, last skill) |
| `packages/candice-protocol/schemas/common/event-envelope.schema.json` | Shared event discriminators (`schemaVersion`, `sessionId`, `skill`, `event`) — B1 shared envelope per manifest 9.2 WR-010 row |
| `packages/candice-protocol/schemas/question-keys.schema.json` | Validation schema for the stable question key registry |
| `packages/candice-protocol/schemas/question-keys.json` | Machine-enumerable stable question key registry data (snapshot acceptance: "stable question keys fixed and machine-enumerable") — seeded with `BUILD_TARGET` (the spec 14 example); empty arrays for kaizen/eli5/bro pending their owning lanes |
| `packages/candice-protocol/schemas/schema-index.json` | Schema index (B2 scope per manifest 9.2 WR-010 row) |
| `packages/candice-protocol/tests/fixtures/question-event.valid.json` | Valid question event (verbatim spec 14 example) |
| `packages/candice-protocol/tests/fixtures/answer-event.valid.json` | Valid answer event (verbatim spec 14 example) |
| `packages/candice-protocol/tests/fixtures/status-event.valid.json` | Valid status event (spec 3 setup-check message) |
| `packages/candice-protocol/tests/fixtures/preferences.valid.json` | Valid preferences instance |
| `packages/candice-protocol/tests/fixtures/question-event.invalid.json` | Must-fail question fixture (bad skill enum, lowercase key, empty text, bad input mode) |
| `packages/candice-protocol/tests/fixtures/answer-event.invalid.json` | Must-fail answer fixture (missing questionKey, empty text, bad input mode) |
| `packages/candice-protocol/README.md` | Package doc: contract rules, version discipline, fixture index |

## Verification evidence (run locally, commands + output)

Validator: `ajv` (draft 2020-12) + `ajv-formats` in an ephemeral venv at `/tmp/candice-val` (NOT committed; repo has no committed test runner for this package yet — WS-41 owns the committed contract suite).

```
COMPILE OK   7 schema files (question-event, answer-event, preferences, question-keys.json,
             question-keys.schema.json, schema-index.json, status-event, common/event-envelope.schema.json)
VALIDATE OK  question-event question-event.valid.json      expected true  valid
VALIDATE OK  question-event question-event.invalid.json    expected false invalid
             ["/skill must be equal to one of the allowed values",
              "/questionKey must match pattern \"^[A-Z][A-Z0-9_-]*$\"",
              "/text must NOT have fewer than 1 characters",
              "/allowedInputModes/0 must be equal to one of the allowed values"]
VALIDATE OK  answer-event answer-event.valid.json          expected true  valid
VALIDATE OK  answer-event answer-event.invalid.json        expected false invalid
             [" must have required property 'questionKey'",
              "/answerText must NOT have fewer than 1 characters",
              "/inputMode must be equal to one of the allowed values"]
VALIDATE OK  status-event status-event.valid.json          expected true  valid
VALIDATE OK  preferences preferences.valid.json            expected true  valid
FORMAT GUARD OK  bad date-time rejected -> /timestamp must match format "date-time"
KEYS REGISTRY SCHEMA OK
KEYS CONSISTENCY OK  unique=1 skills=4
INDEX OK     7 index entries resolve to real files
ALL PASS (exit 0)
```

## Acceptance criterion mapping (CONTROL/CHECKLIST.md E.1 WS-01)

- `question-event`, `answer-event`, `status-event`, `preferences` JSON schemas exist in
  `packages/candice-protocol/schemas/` — DONE (4 files, plus envelope, keys schema+registry, index).
- validate against fixtures — DONE (6 fixtures, 4 valid + 2 must-fail, all assertions pass;
  format guard proves date-time enforcement).
- question keys are stable — DONE at the contract layer: `question-keys.json` registry with
  schema, uniqueness + skills-cross-reference consistency checks green; the full stability
  regression lives in the WS-41 contract suite (L3), which is not built yet by this lane.

## Cross-lane findings

CROSS-LANE-FINDING
source workflow/lane: WR-008 WS-01 builder (B-WR-008-WS-01)
affected unit: WS-41 (contract/schema test suite, L3 — `tests/contract/**`)
evidence: the E.1 WS-01 acceptance criterion says "validate against fixtures", but the
committed contract suite is WS-41-owned and does not exist yet; this lane therefore kept
validation fixtures inside `packages/candice-protocol/tests/fixtures/` (package-scoped,
disjoint from the WS-41-owned `tests/contract/**` glob) and ran an ephemeral ajv check.
A committed, repeatable contract test runner still needs to be built by WS-41 against
these schemas + fixtures.
severity: low (schemas + fixtures are the hard deliverable; the committed runner is WS-41 scope)
recommended action: WS-41 should consume `packages/candice-protocol/schemas/**` +
`packages/candice-protocol/tests/fixtures/**` as its fixture source; the schema index
(`schema-index.json`) enumerates exactly the files the contract suite must cover.

CROSS-LANE-FINDING
source workflow/lane: WR-008 WS-01 builder (B-WR-008-WS-01)
affected unit: WS-36 (Spec Protocol Candice integration — owns
`.claude/skills/spec-protocol/references/candice-question-contract.md` proposal)
evidence: the question-keys registry seeded only `BUILD_TARGET` (the sole key present in
the spec examples). The full spec-protocol interview key set (capacity A1.., media keys,
gauntlet D1-D4, etc.) lives in `references/interview.md` and was NOT extracted here — the
spec says the structured question registry is the mechanical source for keys, wording,
counted/uncounted, conditions, read-aloud safety, and resume (spec 14), and that registry
must be derived from the actual skill behavior, which is WS-36's domain.
severity: low (this lane's acceptance criterion is satisfied by a machine-enumerable stable
registry; completeness of the key inventory is the owning skill lane's job)
recommended action: WS-36 should enumerate the real spec-protocol question keys from
`references/interview.md` and propose registry additions; kaizen/eli5/bro lanes likewise
(WS-37/WS-38/WS-39). Schema `question-keys.json` is versioned for exactly this growth.

## Notes for QC

- Schemas intentionally avoid cross-file `$ref` (each event schema is standalone-validatable)
  because repo contract tests must validate each schema in isolation; the envelope schema
  documents the shared discriminators instead.
- `schemaVersion` is `"1.0"` everywhere; consumers reject unknown versions; bumps are
  integration/release-owner class (manifest 9.4 item 2), migrations are WS-34.
- No commit created, no push, no CONTROL/** edit, no root release file touched, no
  `tests/{interview,macos,windows}/**` or other regression-protected tree touched.
