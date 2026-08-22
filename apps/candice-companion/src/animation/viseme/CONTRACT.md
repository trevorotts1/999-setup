# CONTRACT — WS-12 viseme lane

Stable API surface. Breaking changes require a version bump and recheck.

## Types

```ts
type VisemeId = "closed" | "rest" | "ai" | "oh" | "ee" | "mm" | "wide";
interface VisemeEvent { startSec: number; endSec: number; viseme: VisemeId }
interface VisemeStep { viseme: VisemeId; startMs: number; endMs: number }
type VisemeBlendMode = "direct" | "crossfade";
```

`VisemeStep` times are in scheduler-clock ms (monotonic, same clock as the
injected `Clock`).

## Functions

| Function | Contract |
|---|---|
| `phonemeToViseme(phoneme, table?)` | maps Kokoro phoneme → `VisemeId`; unknown → `"rest"`; case-insensitive |
| `timingToVisemeEvent(phoneme, startSec, endSec)` | `VisemeEvent` or `null` for non-finite or non-positive span |
| `shouldBlend(mode, a, b)` | true only for `"crossfade"`, differing shapes, real gap |
| `idleViseme()` | `"closed"` |
| `assertRegistrationMeasured(registered?)` | throws unless a registration measurement is recorded; returns `null` |
| `recordRegistrationMeasured()` | records a measurement (render lane) |

## Class

`VisemeScheduler`

- `start(timings: {phoneme,startSec,endSec}[])` — load an utterance;
  invalid spans skipped; out-of-order spans sorted; empty input leaves
  the scheduler idle.
- `stop()` — idle; subsequent `visemeAt` returns `"closed"`.
- `stepsAt(nowMs, windowMs)` — ordered, non-overlapping, window-clamped
  `VisemeStep[]`; `[]` when idle or outside the horizon; never throws.
- `visemeAt(nowMs)` — containing step's shape, `"rest"` in active gaps,
  `"closed"` otherwise.
- `active` — true while an utterance is loaded.

Defaults: `leadMs` 60, `minSpanMs` 50, `blendMode` `"direct"`.

## Invariants (tested)

1. Steps are ordered and non-overlapping.
2. Every step lies inside the requested window.
3. The first span leads audio by `leadMs` (bounded).
4. Garbage timings never throw and never corrupt the sequence.
5. The registration guard fails closed until measured.
6. The default phoneme table is frozen data, never code.
