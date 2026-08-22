# WS-18 transcript confirmation/edit/retry (ui/transcript)

The transcript confirmation surface: after PTT release and local
transcription (WS-16/WS-17), Candice shows "Here is what I heard…" with
the unconfirmed transcript and offers USE ANSWER / EDIT / TRY AGAIN
(spec 6). Nothing is submitted to the skill until the user confirms; a
confirmed answer is counted exactly once (CHECKLIST E.1 WS-18). See
`CONTRACT.md` for the proven contract and `CHECKPOINT-WS18.md` for the
builder checkpoint.

## Surface

- `config.ts` — canonical declarations + exact spec-6 labels, contract
  version, the 4096-char wire bound (MIRROR of WS-01 `answerText` /
  WS-04 `MAX_TEXT_LENGTH`), reduced-motion class consumption.
- `model.ts` — pure presentation model from the real WS-08 machine
  state + the submission latch; no clock/IO/DOM; unknown statuses
  degrade; blank transcripts never provide a submit row.
- `view.ts` — DOM surface: heard prompt, transcript display,
  USE ANSWER / EDIT / TRY AGAIN, the EDIT editor (textarea + SAVE/CANCEL
  with live validity), the nothing-heard state; no-op view on null
  mount (spec 20).
- `controller.ts` — machine-event wiring + the exactly-once submission
  latch (both the click path and the `handle()` path); TRY AGAIN
  re-arms real capture via machine `ptt:start`.
- `index.ts` — public exports.
- `__tests__/transcript.test.ts` — 24 acceptance tests (FakeEl DOM
  shim, same convention as the ptt lane).

## Run

```bash
node --test apps/candice-companion/src/ui/transcript/__tests__/transcript.test.ts
```

## Dependency contract

Imports the REAL WS-08 machine (`src/state/machine.ts`) — never a fake.
Consumes the `speech:transcript` machine event (WS-16/WS-17 pipeline)
and confirms through the machine's `answer:confirmed`. The answer
transport (WS-04/WS-05) receives the confirmed text with
`userConfirmedTranscript: true`; the WS-04 runtime rejects anything
else. WS-09's answer-controls lane hooks its EDIT/TRY AGAIN intent
transports into this lane's surface at the shell level — one answer,
one route, one count.
