# WS-18 CHECKPOINT — transcription confirmation/edit/retry

Builder: WS-WS-18 (opus/max), slice WR-014 (L3: needs WS-01, WS-04,
WS-16, WS-17), worktree `wr001-bootstrap` (no commit per lane
instruction; units staged in the worktree only).

## Ownership (PROJECT-MANIFEST 9.2, WR-014/WS-18 glob)

- `apps/candice-companion/src/ui/transcript/**` (all files created by
  this lane)

No shared/root file touched. No commits made. Dependencies verified
present before build: WS-01 schemas (`packages/candice-protocol/
schemas/answer-event.schema.json`), WS-04 MCP answer validation
(`plugins/candice-integration/mcp/ask-user/validate.js` —
`userConfirmedTranscript` must be true), WS-16 STT runtime contract
(`src-tauri/stt/runtime/whisper-runtime.mjs` — "returned text is
UNCONFIRMED — WS-18 owns the confirm-before-submit gate"), WS-17
capture (`src-tauri/audio/capture/**`).

## Acceptance criterion (CHECKLIST E.1 WS-18)

> PASS: no voice transcription is submitted to the skill until the user
> confirms; EDIT and TRY AGAIN work; confirmed answer counted exactly
> once.

## Files created (inside the owned glob)

| File | Role |
|---|---|
| `config.ts` | canonical declarations: exact spec-6 labels (`TRANSCRIPT_LABELS`), contract version, wire bound 4096 (mirror of WS-01/WS-04), reduced-motion class consumption |
| `model.ts` | pure presentation model from the REAL WS-08 machine state + submission latch; heard prompt + confirm-row gating; nothing-heard state; editing state with validation; unknown statuses degrade |
| `view.ts` | DOM surface: heard prompt, transcript display, USE ANSWER / EDIT / TRY AGAIN, EDIT editor (textarea + live validity + SAVE/CANCEL), nothing-heard state; style text variable-only, no baked background; null mount = no-op view (spec 20) |
| `controller.ts` | machine-event wiring + the exactly-once submission latch (click path AND `handle()` path); EDIT draft sync; TRY AGAIN = machine `ptt:start` (restart semantics) + retry transport; per-question latch re-arm on `question:received`/`question:recovered` |
| `index.ts` | public surface |
| `CONTRACT.md` | lane contract |
| `README.md` | lane readme |
| `CHECKPOINT-WS18.md` | this file |
| `__tests__/transcript.test.ts` | 24 tests (FakeEl DOM shim, ptt-lane convention) |

## Verification (independent, on this worktree)

- `node --test apps/candice-companion/src/ui/transcript/__tests__/transcript.test.ts`
  — 24 passed, 0 failed.
- Regression: all TS suites (machine, window, ptt, answer-controls,
  transcript, prefs, visual/transparency) via `node --test` — 157
  passed, 0 failed.
- `tsc --noEmit` (app tsconfig): RC=0, clean (no pre-existing errors).
- Node v26.7.0 (>= 22.6 required), zero deps.

## CROSS-LANE-FINDING (recorded, not edited)

- WS-09's answer-controls controller already exposes `editTranscript` /
  `retryTranscription` transports and USE ANSWER submission; the shell
  wires those into THIS lane's `transcriptController` surface so one
  answer travels one route and is counted once (spec 5.1). No edit
  required to either lane — the seam is the controller options.

## Per 0J, fresh independent recheck still required before the E.1
## WS-18 box flips.
