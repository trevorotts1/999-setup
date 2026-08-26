# WS-13 gesture lane tests

## Run

```bash
node --test apps/candice-companion/src/animation/gesture/__tests__/gesture.test.ts
```

Zero deps: `node:test` + TS type-stripping (Node >= 22.6). Typecheck:

```bash
cd apps/candice-companion && npx tsc --noEmit
```

## What is proven here

- E.1 WS-13 shape: only layer-swap / transform / opacity primitives declared
  (spec 10 Prefer list); forbidden primitives never appear.
- Lazy loading: boot gestures are a strict subset; the rest are late-bound
  placeholders until WS-11's loader registers final-art layers.
- Light/dark background contract: no hex/rgba/url/background declarations in
  the whole contract surface; glow intensities are unitless 0..1 opacities.
- Deterministic, bounded motion calculators (blink, breath, drift, glow,
  stagger).
- Gesture registry: canonical ids, status→gesture purity, lazy registration
  validation (bad id/kind/hold rejected, never throws).
- Driver: single-active layer swap, continuous vs static status loops, blink
  transform applied, glow opacity applied, reduced-motion stop + static cap,
  idempotent detach, null-DOM safety (spec 20).

## Not proven here (owned elsewhere)

- Pixel-level alpha edges on light AND dark desktops: WS-15 visual harness.
- Reduced-motion detection/class placement: WS-14 `src/a11y/**`.
- Mouth/viseme synchronization: WS-12 `src/animation/viseme/**`.
- Final-art asset loading: WS-11 `assets/candice/**` + `src/loader/**`.
- Status event delivery: WS-08 state machine + session bridge.
