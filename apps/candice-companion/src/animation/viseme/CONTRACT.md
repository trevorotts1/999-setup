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

const DEFAULT_PHONEME_TO_VISEME: Readonly<Record<string, VisemeId>>;
const CARRY_VISEME_PHONEMES: ReadonlySet<string>;
```

`VisemeStep` times are in scheduler-clock ms (monotonic, same clock as the
injected `Clock`).

## Functions

| Function | Contract |
|---|---|
| `phonemeToViseme(phoneme, table?)` | maps one Kokoro phoneme → `VisemeId`; unknown → `"rest"`; exact key first, lowercase as fallback |
| `isCarryPhoneme(phoneme)` | true for marks with no aperture of their own (stress, length, aspiration, palatalisation, nasalisation) |
| `visemeEventsFromTimings(timings)` | whole-utterance conversion; resolves carry marks against their neighbours. **The scheduler uses this, not the per-span function** |
| `visemeTableCoverage(inventory, table?)` | fraction of a phoneme inventory that resolves to a real shape, 0..1 |
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

## Phoneme alphabet (load-bearing)

The pinned stack — kokoro-onnx 0.6.1 driving espeak-ng — emits **lowercase
IPA**, measured by running the shipped worker, not read off a chart:

```
"Hello, this is Candice speaking about the build."
  →  h ə l ˈ o ʊ ,   ð ɪ s   ɪ z   k ˈ æ n d ɪ s ...
```

- Diphthongs arrive as two spans (`e` + `ɪ`), affricates as two (`t` + `ʃ`).
- The word gap is a bare **space**, and it is a real span.
- Stress marks sit **between** an onset consonant and its vowel; length marks
  **trail** the vowel they prolong. Both are carry marks — never give them a
  shape of their own.
- Uppercase symbols exist in Kokoro's 114-entry vocabulary but this espeak
  path never produces them.

The table is validated against a committed capture of real worker output
(`src/runtime/__tests__/fixtures/kokoro-real-utterance.json`). An ASCII
phoneme rule anywhere on this path silently starves the mouth: it did, in
three separate layers, and the packaged mouth never opened.

A phoneme string is accepted by a **deny-list** (control and format
characters out, everything else in), defined once in
`src-tauri/src/speech_timing.rs::valid_phoneme` and mirrored in
`src/runtime/speech-timing.ts`. It is never an allow-list of today's
alphabet.

## Invariants (tested)

1. Steps are ordered and non-overlapping.
2. Every step lies inside the requested window.
3. The first span leads audio by `leadMs` (bounded).
4. Garbage timings never throw and never corrupt the sequence.
5. The registration guard fails closed until measured.
6. The default phoneme table is frozen data, never code.
7. The table covers 100% of the phonemes in the committed real-TTS capture;
   a mutation test restoring the old ASCII table makes coverage collapse.
8. Carry marks are absent from the shape table (one authority per symbol).
9. Across a real utterance the mouth is open for >60% of the audio and
   reaches at least four distinct shapes.
