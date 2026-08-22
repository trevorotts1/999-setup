# WS-14 accessibility + captions lane

Reduced motion (spec 9/10/19) and captions (spec 5.2) for the Candice
Companion. Owned globs:

- `apps/candice-companion/src/a11y/**` — reduced-motion class, tier
  resolution, OS listener, focus/a11y helpers.
- `apps/candice-companion/src/ui/captions/**` — the always-visible caption
  region driven by real WS-08 machine effects.

## Key declarations

| Symbol | Value | Meaning |
|---|---|---|
| `A11Y_CONTRACT_VERSION` | `1` | Bump only on breaking surface changes. |
| `REDUCED_MOTION_CLASS` | `candice-reduced-motion` | The single shared class on `<html>` consumed by WS-07/WS-09/WS-10/WS-13. |
| `REDUCED_MOTION_QUERY` | `(prefers-reduced-motion: reduce)` | OS media query (spec 10). |
| `CAPTIONS_CONTRACT_VERSION` | `1` | Bump only on breaking surface changes. |
| `CAPTIONS_ROOT_CLASS` | `candice-captions` | Caption region root (`role="status"`, `aria-live="polite"`). |

## Tier model

```
preference (spec 9)  null → follow OS via matchMedia('(prefers-reduced-motion: reduce)')
                     true → force minimal ('reduce')
                     false → animations allowed ('allow')
```

The WS-40 profile is consumed as the plain `reducedMotion: boolean | null`
shape only — this lane never reads or writes the profile document.

## Who uses what

- WS-13 `src/animation/gesture/**`: imports `REDUCED_MOTION_CLASS`, checks
  `html.candice-reduced-motion`; stops continuous loops, keeps a capped
  static glow.
- WS-09 `src/ui/ptt/**` + `src/ui/answer-controls/**`: kills the glow
  pulse / transitions under `html.candice-reduced-motion`.
- WS-10 `src/ui/compact/**`: drops the one-shot expand transition.
- WS-07 `src/window/**`: no hot animation; the shared class rule is
  consumed in CSS only.

## Failure behavior (spec 20)

Every public function degrades to a typed result or no-op; none throws. A
missing `matchMedia` (e.g. plain-web dev preview) leaves the class unset —
animation lanes treat that as "motion allowed" — and the caption view
becomes a no-op view when the mount/document are absent.

## Tests

```bash
node --test apps/candice-companion/src/a11y/__tests__/a11y.test.ts
node --test apps/candice-companion/src/ui/captions/__tests__/captions.test.ts
```

Zero deps: `node:test` + TS type-stripping (Node >= 22.6). Typecheck:

```bash
cd apps/candice-companion && npx tsc --noEmit
```
