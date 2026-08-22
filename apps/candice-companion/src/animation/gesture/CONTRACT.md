# CONTRACT — WS-13 gesture animation lane

Stable API contract for consuming lanes. Bump `GESTURE_CONTRACT_VERSION` on any
breaking shape change below.

## Ownership

- Owned glob: `apps/candice-companion/src/animation/gesture/**` (this lane).
- `apps/candice-companion/src/animation/viseme/**` — WS-12 (mouth), not this lane.
- `apps/candice-companion/src/state/**` — WS-08 statuses; this lane consumes the
  status type, never mutates state.
- `apps/candice-companion/src/a11y/**` — WS-14 defines the reduced-motion class;
  this lane consumes `candice-reduced-motion` on `<html>`, never defines it.
- `apps/candice-companion/assets/candice/**` + `src/loader/**` — WS-11 owns the
  final art and the loader; this lane exposes `registerLayer` for it.
- Pixel-level alpha proof on light/dark backgrounds — WS-15 visual harness.

## Surface

| Export | Shape | Notes |
|---|---|---|
| `createGestureDriver()` | `GestureDriver` | `setStatus`, `registerLayer`, `attach`, `detach`, `active`, `status` |
| `createGestureRegistry()` | registry | Pure status→gesture mapping, testable without DOM |
| `createGlowSurface()` / `findGlowSurface(root)` | `HTMLElement` / `HTMLElement \| null` | Decorative aura layer (`aria-hidden`) |
| `eyeOpenRatio(closedUnits)` | `number` 0..1 | Blink eye openness |
| `breathScale(radians)` | `number` ≈1 | Idle breathing scale |
| `headDriftPx(radians)` | `number` px | Head drift offset |
| `glowIntensity(radians, statusIntensity)` | `number` 0..1 | Glow pulse |
| `staggerPhase(kind, offsetMs)` | radians | Deterministic phase staggering |
| `scheduleLoop` / `scheduleDelay` | `ScheduledLoop` | Pause-safe timers, idempotent `cancel()` |

## DOM contract

- Stage root: `[data-candice-gesture-stage]` (driver falls back to the attach root).
- Glow layer: `[data-candice-glow-stage]` (opacity-only, no background).
- Motion targets inside the stage: `[data-candice-eye]` (blink scaleY),
  `[data-candice-body]` (breath scale), `[data-candice-head]` (drift translateX).
- Gesture layers: `[data-candice-gesture="<GestureId>"]`. The driver toggles
  `candice-gesture-active` / `candice-gesture-inactive` — exactly one active.
- Status evidence: stage attr `data-candice-gesture-active`, glow attr
  `data-candice-glow-status`.

## Status → gesture mapping

| Status | Gesture |
|---|---|
| `idle` (and all unlisted) | `welcome` |
| `listening` | `listening` |
| `thinking` | `thinking` |
| `speaking` | `presenting` |
| `affirmative` | NOT status-mapped — explicit event only (never invented) |

## Invariants

1. Only layer-swap, transform, opacity (spec 10). No canvas/3D/video/particles.
2. No colors or backgrounds painted by this lane (spec 28, light+dark E.1).
3. Reduced motion (`candice-reduced-motion` on `<html>`) stops continuous loops;
   a static capped glow remains (spec 9).
4. Never throws from render paths; null DOM degrades to no-op (spec 20).
5. Blink, breathing, head drift, glow are pause-safe (elapsed-delta driven).
