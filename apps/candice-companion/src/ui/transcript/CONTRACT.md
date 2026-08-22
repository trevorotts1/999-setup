# WS-18 — transcription confirmation/edit/retry — contract

Owned lane: `apps/candice-companion/src/ui/transcript/**`
(PROJECT-MANIFEST 9.2, WR-014 WS-18 glob; dependencies WS-01, WS-04,
WS-16, WS-17 per snapshot).

## What is proven

Binary acceptance criteria (CHECKLIST E.1 WS-18, spec 6):

1. **No submission before the user confirms** — a voice transcription
   delivered by the WS-16/WS-17 pipeline lands the WS-08 machine in
   `confirming`; nothing travels to the skill until USE ANSWER (or SAVE
   after EDIT) fires. The WS-04 MCP runtime independently rejects any
   answer with `userConfirmedTranscript !== true`
   (`mcp/ask-user/validate.js`), so the two lanes close the gate from
   both sides.
2. **EDIT works** — opens an editor pre-filled with the unconfirmed
   transcript; keystrokes sync to the controller draft (`onEditChange`);
   SAVE validates against the WS-01 wire bounds (non-empty, max 4096 —
   MIRROR of `answerText` in `answer-event.schema.json` and
   `MAX_TEXT_LENGTH` in WS-04 `validate.js`) and only then submits;
   CANCEL returns to the still-unsubmitted transcript.
3. **TRY AGAIN works** — discards only the unconfirmed local transcript
   and re-arms real capture via the machine's `ptt:start` (its defined
   restart semantics from `confirming`). Nothing was ever submitted; the
   next take must be confirmed again.
4. **Confirmed answer counted exactly once** — the controller's
   submission latch flips in the same turn the machine fires
   `answer:confirmed` (both the click path and the `handle()` path).
   After the latch closes: the confirm row hides, `canSubmit` goes
   false, the USE ANSWER button renders disabled, and a second click —
   or a stale SAVE — is a no-op. The latch is per-question: a new
   `question:received` / `question:recovered` re-arms it.
5. **Spec 20 isolation** — null/absent mount degrades to a no-op view
   and controller (never throws); unknown events are ignored by the
   machine; an empty transcript (STT produced nothing) shows the
   nothing-heard state with TRY AGAIN only — a blank answer is never
   submit-gated (the MCP path rejects blank answers).

## What is NOT proven here (owned by other lanes)

- Actual transcription — `src-tauri/stt/**` (WS-16). This lane consumes
  the `speech:transcript` machine event; the transcript is UNCONFIRMED
  until this lane's latch opens (whisper-runtime.mjs contract: "WS-18
  owns the confirm-before-submit gate").
- Actual capture + PTT hold — `src-tauri/audio/capture/**` (WS-17) and
  `src/ui/ptt/**` (WS-09). TRY AGAIN's `ptt:start` is the machine event;
  the transport `retryTranscription` exists for the shell to re-arm the
  capture path without re-implementing press semantics.
- The in-question row (PTT slot + TYPE ANSWER + voice toggle) —
  `src/ui/answer-controls/**` (WS-09). Its EDIT/TRY AGAIN intent
  transports and USE ANSWER submission hook into THIS lane's
  confirmation surface at the shell level — one answer, one route, one
  count (spec 5.1 no-double-count).
- The answer transport itself — WS-04 (`candice.ask_user` answer event
  with `userConfirmedTranscript: true`) / WS-05 terminal fallback /
  WS-03 session routing.
- The state machine — `src/state/machine.ts` (WS-08). This lane imports
  it, never reimplements it.
- Real-state pixel rendering on a desktop — WS-15 visual harness + the
  interactive desktop smoke (spec 18/28).

## Cross-lane dependencies

- Imports the REAL WS-08 `createCandiceStateMachine` +
  `CandiceEvent`/`CandiceState` types (dependency WS-08 via WS-01's
  status list).
- MIRRORS (never defines) the WS-01 `answerText` bounds and the WS-04
  `MAX_TEXT_LENGTH` = 4096; the schema is the wire authority and this
  lane fails closed (SAVE disabled, no submit) rather than diverging.
- Consumes the WS-14 `candice-reduced-motion` class name only (never
  defines it); consumes WS-07's transparent-window invariant (no baked
  background in any style text this lane emits — variable references
  only).
- Owns no window title (WS-24 claims the `Candice — ` prefix) and no
  preference storage (WS-40).

## Run

```bash
node --test apps/candice-companion/src/ui/transcript/__tests__/transcript.test.ts
```

Requires Node >= 22.6 (node:test + TS type-stripping), zero deps,
matching the WS-07/WS-08/WS-09/WS-17 lane convention. `tsc --noEmit`
(app tsconfig) typechecks the lane when the app toolchain is present.
