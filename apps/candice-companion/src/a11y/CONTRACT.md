# CONTRACT — WS-14 accessibility lane

Stable API contract for consuming lanes. Bump `A11Y_CONTRACT_VERSION` on
any breaking shape change below.

## Ownership

- Owned glob: `apps/candice-companion/src/a11y/**` + `apps/candice-companion/src/ui/captions/**` (this lane).
- `apps/candice-companion/src/animation/gesture/**` — WS-13 (blink/idle/head/gesture). This lane defines the reduced-motion class; WS-13 consumes it.
- `apps/candice-companion/src/animation/viseme/**` — WS-12 (mouth/viseme). Not this lane.
- `apps/candice-companion/src/state/**` — WS-08. This lane consumes the machine's real `captions:show` effects, never invents captions.
- `apps/candice-companion/src/ui/answer-controls/**` + `src/ui/ptt/**` — WS-09. Consumes `candice-reduced-motion`; this lane never hides their captions.
- `apps/candice-companion/src/ui/compact/**` — WS-10. Consumes `candice-reduced-motion`.
- `apps/candice-companion/src/prefs/**` — WS-40. This lane consumes the `reducedMotion`/`textScale` preference shape (boolean | null), never reads or writes the profile.
- Pixel-level alpha proof — WS-15 visual harness.

## Surface: `src/a11y/index.ts`

| Export | Shape | Notes |
|---|---|---|
| `REDUCED_MOTION_CLASS` | `'candice-reduced-motion'` | THE single shared class on `<html>`; consuming lanes import it, never define it. |
| `REDUCED_MOTION_QUERY` | `'(prefers-reduced-motion: reduce)'` | The OS media query (spec 10). |
| `createReducedMotionState()` | `ReducedMotionState` | DOM-free tier store with subscribe; never throws. |
| `resolveReducedMotionTier(pref, win)` | `{tier, mediaAvailable}` | Preference wins over OS; null = follow OS. Never throws. |
| `applyReducedMotion(root, tier)` | `detach()` | Single writer of the class on `<html>` + `data-candice-reduced-motion`. `os` tier keeps the class live on OS `change`. |
| `applyReducedMotionForPreference` | `{result, detach}` | Preference + window → resolve → apply. |
| `createA11yController(opts)` | `A11yController` | Boot-time wiring: resolve, apply, re-apply on preference change, detach on teardown. |
| `tierFromPreference` / `tierFromMedia` | tier / `{tier, mediaAvailable}` | Pure resolvers. |
| `setKeyboardOnlyFocusable` / `ensureAriaLabel` / `setLiveRegion` | guards | A11y DOM helpers; never throw. |

Tiers: `os` (follow OS), `reduce` (force minimal), `allow` (animations allowed).

## Surface: `src/ui/captions/index.ts`

| Export | Shape | Notes |
|---|---|---|
| `CAPTIONS_ROOT_CLASS` | `'candice-captions'` | Root of the caption region. |
| `createCaptionsController(opts)` | `CaptionsController` | `handle(event)` consumes the real machine transition, then renders its `captions:show` effects. |
| `createCaptionsView(mount, doc)` | `CaptionsView` | `show/sync/fade/setTextScale/destroy`; null mount → no-op view (spec 20). |
| `createCaptionsModel()` | pure | `push(entry)`, `state {current, shownCount, seq}`. |
| `clipCaption(text)` | string | Display-side truncation only, never the question contract. |
| `CAPTIONS_TEXT_SCALES` | `['small','medium','large']` | Spec 9 text size. |

## DOM contract

- Caption root: `.candice-captions` with `role="status"` + `aria-live="polite"`;
  text goes through `textContent`, never `innerHTML`.
- Reduced motion: `html.candice-reduced-motion` (applied by this lane) kills
  the caption fade transition; consuming lanes scope their own
  `html.candice-reduced-motion ...` rules to stop continuous animation.
- Style text: CSS-variable references only — no hex/rgba/url/background
  (WS-07 transparent-window invariant, spec 11).

## Runtime behavior contract

1. Captions are ALWAYS shown regardless of `voiceOutputEnabled` (spec 5.2);
   this lane never consults the voice toggle for visibility.
2. The caption is always exactly the machine's last reported
   `captions:show` payload (question text, listening label, transcribing
   label, text-fallback label, recovering label) — never invented text.
3. A transition with no `captions:show` effect fades (never blanks) the
   last caption; an explicit empty caption clears it.
4. OS reduced motion is respected (spec 10): `os` tier listens to the
   `prefers-reduced-motion` change event; an explicit preference
   (`true`/`false`) always wins.
5. Never throws from render paths; null DOM degrades to no-op (spec 20).
6. No continuous animation, no canvas/3D/video (spec 19/10); one-shot
   opacity transition only, dropped under reduced motion.
