# WS-09 — floating answer controls + PTT UI — contract

Owned lane: `apps/candice-companion/src/ui/answer-controls/**` +
`apps/candice-companion/src/ui/ptt/**` (PROJECT-MANIFEST 9.2, WS-09 glob).

## What is proven

Binary acceptance criteria (CHECKLIST E.1 WS-09):

1. **Both answer methods on every question** (spec 5.1) — HOLD TO TALK and
   TYPE ANSWER are both present in the interview phase; the last-used
   method may be remembered but is never a lock; the machine state is the
   only transition authority (WS-08 reducer imported and event-fed, never
   reimplemented).
2. **"Answer in Claude instead"** (spec 5.1) — dispatches the WS-08
   `answer:delegate-to-claude` event; the surface hides both answer paths
   while the terminal owns the question (no double-count, E.1 WS-18).
3. **Voice responses ON/OFF is a separate persistent toggle** (spec 5.2) —
   independent of answer method: the model keeps typed usable while
   listening, voice usable while muted; captions always shown (WS-14 lane
   owns captions; this lane never hides them).
4. **Listening state unmistakable** (spec 6) — exact label
   `🔴 LISTENING — LET GO WHEN FINISHED` plus a red glow pulse plus the
   optional lightweight waveform; never a tiny icon-only state.
5. **Release shows transcript with USE ANSWER / EDIT / TRY AGAIN** (spec 6)
   — exact labels; nothing is submitted until the user confirms (E.1
   WS-18); confirmed answers travel the `answer:confirmed` path exactly
   once.
6. **Spec 19 resource discipline** — the only continuous animation is the
   single listening glow pulse (one element, opacity/box-shadow, GPU
   composited), killed under OS reduced motion via the shared
   `candice-reduced-motion` class (consumed from WS-14, never defined).
7. **Spec 20 failure isolation** — null/absent mount degrades to a no-op
   view and controller (never throws); unknown statuses map to a neutral
   idle view in the model and degrade the machine listener to no-op.

## What is NOT proven here (owned by other lanes)

- Actual microphone capture — `src-tauri/audio/capture/**` (WR-014
  WS-17). This lane only reports press/release intent (the same events the
  WS-08 machine defines).
- Real-state pixel rendering on a desktop — the WS-15 visual harness and
  the interactive desktop smoke (spec 18/28) prove the pixels.
- Transcript edit UX beyond intent reporting — `src/ui/transcript/**`
  (WR-014 WS-18) owns the full EDIT / TRY AGAIN surfaces; this lane hooks
  into it via the controller transports.
- Session identity / terminal targeting — WS-03; this lane never resolves
  a session or window.
- The voice-toggle persistence — `src/prefs/**` (WS-40). This lane only
  reports the change and renders the resulting preference.
- The compact post-interview surface — `src/ui/compact/**` (WS-10). This
  lane renders only the in-interview question surface.

## Cross-lane decencies

- Imports the REAL WS-08 `createCandiceStateMachine` + `CandiceState`/
  `CandiceEvent` types (dependency WS-08) and the WS-01 status list via
  `src/state/status.ts`.
- Consumes the WS-14 `candice-reduced-motion` class name only (never
  defines it); consumes WS-07's transparent-window invariant (no baked
  background in any style text this lane emits).
- WS-24 claims the `Candice — ` window-title prefix; this lane owns no
  window title.

## Run

```bash
node --test apps/candice-companion/src/ui/ptt/__tests__/ptt.test.ts
node --test apps/candice-companion/src/ui/answer-controls/__tests__/answer-controls.test.ts
```

Requires Node >= 22.6 (node:test + TS type-stripping), zero deps, matching
the WS-07/WS-08/WS-17 lane convention. `tsc --noEmit` (app tsconfig)
typechecks the lane when the app toolchain is present.

## QC ROUND 1 — 2026-08-21 — FAIL -> FIXED (recorded here as the amended contract)

The blind QC found the above contract unproven at the integrated surface.
Fixed contract (regression-tested):

1. The controller drives the embedded PTT control with the machine's real
   status on every render (`pttView.show(state.status)`), so the spec-6
   listening state (glow/pulse + exact label) activates on the real
   surface — not only in the isolated ptt tests.
2. The confirmation row shows ONLY while `confirming` with a real
   transcript (`showConfirmRow`); after USE ANSWER (status `thinking`)
   the row hides and `canConfirm` goes false — the answer can never be
   confirmed twice.
3. The voice toggle re-renders from the model (text/`data-voice-on`/aria)
   and reports its change through the `onVoiceToggleChange` transport
   (WS-40 persists).

Evidence: ptt 20/20, answer-controls 17/17, four-suite regression 81/81,
owned files tsc-clean. Backup `.qc-backup-ws09-20260821/`, no commits.
Fresh independent recheck still required per 0J before the E.1 box flips.
