# WS-12 — Viseme animation lane (mouth sync to TTS)

Owned path: `apps/candice-companion/src/animation/viseme/**`
(snapshot `owned_paths` for WS-12; manifest 9.2 WR-013 row).

This lane owns the **viseme state machine**: TTS timing ingestion,
phoneme→mouth mapping, scheduling, cross-fade step emission, and the
face-state registration precondition. It owns **no assets, no DOM, no
TTS runtime** — those are WS-11 (`assets/candice/**`, `src/loader/**`),
WS-13 (`src/animation/gesture/**`), and WS-19 (`src-tauri/tts/**`).

## Modules

| File | Role |
|---|---|
| `types.ts` | Domain types + frozen default phoneme→viseme table |
| `mapping.ts` | Pure mapping: phoneme→viseme, timing→event, blend gating |
| `scheduler.ts` | `VisemeScheduler` — the state machine |
| `registration.ts` | Fail-closed face-state registration precondition |
| `index.ts` | Public surface |

## Scheduler math (alignment design)

The scheduler runs on a local monotonic clock (ms; `performance.now` by
default, injectable for tests).

For each TTS phoneme span `(startSec, endSec)`:

1. `startMs = clockStart + startSec*1000 - leadMs` (default lead 60ms —
   lips arrive before the sound, spec 11A "switch/warp only the minimum
   face/mouth region").
2. `endMs = clockStart + endSec*1000`.
3. Clamp `startMs` so it never precedes the previous span's end
   (non-overlap invariant).
4. If `endMs - startMs < minSpanMs` (default 50ms), stretch to the
   minimum.
5. Cross-fade mode only: when a gap separates two different visemes,
   emit an inter-viseme step covering the second half of the gap with
   the next shape (spec 11A: cross-fade of a few frames is the ceiling;
   direct sprite swap is the default cheap path).

Outside speech spans, the mouth is `closed`. During a span, `visemeAt`
returns the span's shape. In gaps while an utterance is active, `rest`.
After the utterance ends, `closed`.

## Handshake with the render lane (WS-11/WS-13)

The render lane must call `assertRegistrationMeasured()` before applying
`VisemeStep`s to assets. The guard fails closed until
`recordRegistrationMeasured()` is called with a real landmark/placement
measurement (spec 11A: "Measure registration first"). This makes the
E.1 second clause a runtime check, not a comment.

## Test / typecheck

```text
node --test src/animation/viseme/__tests__/viseme.test.ts
npx tsc --noEmit        # app tsconfig
```

Zero deps; node:test + TS type-stripping (WS-07/WS-40 convention).
