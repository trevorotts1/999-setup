# WS-09 — push-to-talk control — contract

Owned lane: `apps/candice-companion/src/ui/ptt/**` (PROJECT-MANIFEST 9.2,
WS-09 glob; sibling of `src/ui/answer-controls/**`).

## What is proven

Binary acceptance criteria (CHECKLIST E.1 WS-09, spec 6):

1. **Idle button** — exact label `🎙 HOLD TO TALK`.
2. **Pressed state** — exact label `🔴 LISTENING — LET GO WHEN FINISHED`
   plus red glow/pulse plus optional lightweight waveform; no ambiguous
   icon-only state.
3. **Mic live only while held** (E.1 WS-17 parity) — `pointerdown` starts,
   `pointerup`/`pointercancel`/`pointerleave`/blur stop; single-flight
   (a second down while pressed is ignored); keyboard Space/Enter hold
   works; repeat filtered.
4. **Release → transcribing** — exact label `Here is what I heard…`; the
   transcript confirmation (USE ANSWER / EDIT / TRY AGAIN) is owned by the
   answer-controls surface (spec 6), not duplicated here.
5. **Spec 19** — one animation (the glow pulse), dropped under OS reduced
   motion via the shared `candice-reduced-motion` class (WS-14).
6. **Spec 20** — null/absent mount returns a no-op view, never throws;
   every status maps to a presentation without throwing.

## What is NOT proven here

- Recording — WS-17 (`src-tauri/audio/capture/**`). Intent hooks only.
- The full question surface (TYPE ANSWER, Answer-in-Claude, voice toggle) —
  `src/ui/answer-controls/**` (same WS-09 lane); this control mounts into
  its PTT slot.
- Pixels on a real desktop — WS-15 visual harness + spec 18/28 smoke.

## Run

```bash
node --test apps/candice-companion/src/ui/ptt/__tests__/ptt.test.ts
```

Requires Node >= 22.6, zero deps, matching the WS-07/WS-08/WS-17 lane
convention. `tsc --noEmit` typechecks the lane when the app toolchain is
present.
