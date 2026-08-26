# CHECKPOINT — WS-14 (accessibility / reduced-motion / captions)

Builder: B-WS-WS-14 (opus/max), W2 build run. Deps WS-01/08/12/13 accepted.

Worktree: `worktrees/wr001-bootstrap` @ branch `candice/wr001-bootstrap`.
Date: 2026-08-21.

## Pre-build state

- Owned globs `apps/candice-companion/src/a11y/**` and
  `apps/candice-companion/src/ui/captions/**` did NOT exist (verified by
  `find` — no `a11y` or `captions` directory anywhere under `src`).
- Existing consumers already referenced the shared class that this lane
  defines: WS-13 `src/animation/gesture/**` (config.ts
  `REDUCED_MOTION_CLASS`, driver.ts checks `html.candice-reduced-motion`),
  WS-09 `src/ui/ptt/**` (`PTT_REDUCED_MOTION_CLASS`) and
  `src/ui/answer-controls/**` (`ANSWER_REDUCED_MOTION_CLASS`), WS-10
  `src/ui/compact/**` (`COMPACT_REDUCED_MOTION_CLASS`), plus CSS rules in
  `view.ts` files scoped `html.candice-reduced-motion`. The WS-13
  CONTRACT.md and the manifest 9.2 row name `src/a11y/**` as the
  definition owner — this lane supplies the missing contract.
- WS-08 machine already emits spec-5.2 caption data: every `CandiceSideEffect`
  carries a `caption` field; `captions:show` / `mic:open` carry the exact
  strings (question text, `LISTENING - LET GO WHEN FINISHED`,
  `Answer in Claude instead`).
- E.1 WS-14 in `CONTROL/CHECKLIST.md` was unchecked; not touched by this
  lane (promotion is QC-controlled).

## Files created (all under the two owned globs — no root, no CONTROL, no shared files)

`apps/candice-companion/src/a11y/**` (reduced motion + a11y helpers):
- `config.ts` — `A11Y_CONTRACT_VERSION`, `REDUCED_MOTION_CLASS`
  (`candice-reduced-motion`), `REDUCED_MOTION_QUERY`
  (`(prefers-reduced-motion: reduce)`), tier constants, `ReducedMotionPreference`.
- `motion.ts` — DOM-free tier store (`createReducedMotionState`,
  `isReducedMotionTier`); never throws.
- `apply.ts` — `tierFromPreference`, `tierFromMedia`, `resolveReducedMotionTier`,
  `applyReducedMotion` (single writer of the class + `data-candice-reduced-motion`
  on `<html>`; `os` tier keeps the class live on the media-query `change`
  event; `reduce`/`allow` attach no listener), `applyReducedMotionForPreference`.
- `controller.ts` — `createA11yController`: resolve preference+OS at boot,
  re-apply on preference change, detach on teardown. Never throws (spec 20).
- `focus.ts` — `setKeyboardOnlyFocusable`, `ensureAriaLabel`, `setLiveRegion`.
- `index.ts` — public barrel.
- `CONTRACT.md` — stable API contract for consuming lanes.
- `README.md` — lane doc (tier model + consumers + tests).
- `__tests__/a11y.test.ts` — 12 tests.

`apps/candice-companion/src/ui/captions/**` (captions surface):
- `config.ts` — `CAPTIONS_CONTRACT_VERSION`, root class, role/aria-live
  contract, style id, text scales, max length.
- `model.ts` — pure text pipeline: `captionFromEffect`, `clipCaption`,
  `isEmptyCaption`, `createCaptionsModel`.
- `view.ts` — live-region view (`role="status"`, `aria-live="polite"`),
  textContent-only rendering, scale switching, no-op view on null
  mount/document; style contract: variable references only, no
  hex/rgba/url/background (WS-07 transparent invariant).
- `controller.ts` — consumes the real WS-08 machine transition, renders its
  caption-bearing effects; a transition without one fades (never blanks)
  the last caption; never consults the voice toggle (spec 5.2).
- `index.ts` — public barrel.
- `__tests__/captions.test.ts` — 11 tests.

## Verification evidence

```text
node --test apps/candice-companion/src/a11y/__tests__/a11y.test.ts          -> 12 pass / 0 fail
node --test apps/candice-companion/src/ui/captions/__tests__/captions.test.ts -> 11 pass / 0 fail
npx tsc --noEmit (apps/candice-companion)                                    -> exit 0
npm run build (vite, apps/candice-companion)                                -> exit 0 (16 modules)
Regression control: window/state/compact/answer-controls/ptt/gesture/viseme/prefs suites
  node --test ...-> 137 pass / 0 fail
```

## E.1 WS-14 mapping

- "captions always shown regardless of voice state" — captions controller
  only reads machine `caption` fields; it never reads
  `voiceOutputEnabled`; tests prove both voice-ON and voice-OFF question
  captions render (spec 5.2), and a transition without a caption effect
  fades rather than blanks the last caption.
- "OS reduced-motion setting is respected" — OS tier reads
  `matchMedia('(prefers-reduced-motion: reduce)')` (spec 10) and keeps the
  class live on the `change` event; spec-9 preference `true`/`false`
  overrides the OS; the shared class is proven identical across every
  consuming lane (test reads the sibling lane config sources).

## Lane discipline

No files under root, `CONTROL/**`, `spec/**`, `packages/**`,
`plugins/**`, shared 9.3/9.4 files, `assets/candice/**` (source PNGs
READ-ONLY), or other lanes' globs were touched. No commit created
(checkpoint commit happens at unit handoff). Fresh recheck by an
independent QC lane is required (builder may not final-certify).
