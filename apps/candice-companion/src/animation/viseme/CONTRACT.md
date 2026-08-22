# CONTRACT — WS-12 viseme lane

Stable API surface. Breaking changes require a version bump and recheck.

## FIX-005 layer anchor registry (registered mouth/eye layers)

Reference anchor registry data: `assets/candice/layers/layer-anchor-registry.json`
(schema: `schema.json`, generator: `tools/measure-anchors.py`, both in the same
directory). Every registered state resolves to a canonical operator-original
SHA-256; a registration that does not resolve fails loudly.

| Function | Contract |
|---|---|
| `validateLayerRegistry(data)` | collects every shape/hash defect as `string[]`; `[]` = sound |
| `assertValidLayerRegistry(data)` | throws with the full defect list when unsound |
| `loadLayerRegistry()` | lazy, fail-loud; returns `LayerAnchorRegistry` |
| `resolveLayerState(stateId)` | one registered state or throws for unknown ids |
| `stateForViseme(viseme)` | `VisemeId` → registered canonical mouth layer; no lookalike fallback |
| `stateForBlink("open"\|"halfBlink")` | registered canonical eye layer; no approved closed-eye art exists, so `eye-closed` fails loudly |
| `CANONICAL_SOURCE_SHA256` | frozen hash table of the seven canonical mouth/eye sources |
| `EYE_STATES` | frozen `{ open: "eye-open", halfBlink: "eye-half-blink" }` |

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
