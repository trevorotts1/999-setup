# CHECKPOINT — WS-12 (mouth/viseme animation)

Builder: QC-Q-WS-12 (sonnet/max) — QC-fix lane. Blind verdict was FAIL (no
WS-12 deliverable existed on disk); this lane took the write baton, built the
unit under the snapshot-owned path, and fixed its own defects during test
runs. **FRESH RECHECK REQUIRED** — a QC/fixer may not final-certify its own
output (spec 0.1 override 2 / 0B).

Worktree: `worktrees/wr001-bootstrap` @ `aa23ed9` (branch
`candice/wr001-bootstrap`).
Date: 2026-08-21.

## Blind verdict record (pre-fix)

- Owned path `apps/candice-companion/src/animation/viseme/` did not exist.
  `find` across the repo (worktree + root) found no `anim/`, `animation/`,
  or `mouth/` directory anywhere. Control: the same find located
  `src/window/**` and `src/prefs/**` lane trees.
- No `CHECKPOINT-WS12.md` existed (10 other CHECKPOINT files present for
  WS06/07/16/17/23/24/29/30/40).
- E.1 WS-12 in `CONTROL/CHECKLIST.md` was unchecked.
- Only WS-12 artifacts on disk were WS-19's `PhonemeTiming` contract in
  `src-tauri/tts/types.ts` (WR-014-owned) and planning references
  (snapshot, manifest 9.2, execution plan) — no WS-12-owned code or tests.

## Files created (all under owned glob `apps/candice-companion/src/animation/viseme/**`)

Source:
- `types.ts` — viseme domain types (`VisemeId`, `VisemeEvent`, `VisemeStep`,
  `Clock`, `VisemeBlendMode`) and the frozen default Kokoro
  phoneme→viseme data table.
- `mapping.ts` — pure functions: `phonemeToViseme` (rest fallback),
  `timingToVisemeEvent` (rejects non-finite/non-positive spans),
  `shouldBlend`, `idleViseme`.
- `scheduler.ts` — `VisemeScheduler`: TTS timing ingestion, 60ms bounded
  lip lead, out-of-order span sorting, garbage-in skip, min-span
  normalization, window-clamped non-overlapping step emission, optional
  cross-fade inter-step (spec 11A cross-fade ceiling), `visemeAt` /
  `active` query surface, idle-closed fallback.
- `registration.ts` — fail-closed registration precondition
  (`VISEME_REGISTRATION_PRECONDITION`, `assertRegistrationMeasured`,
  `recordRegistrationMeasured`): render lanes cannot apply viseme steps to
  whole-frame assets before face-state registration is measured (spec 11A
  second clause).
- `index.ts` — public surface.

Tests + docs:
- `__tests__/viseme.test.ts` — 16 tests: phoneme mapping + fallback +
  frozen-table invariant, span validation, blend gating, TTS-timing sync
  with bounded lead, ordering/non-overlap, window clamping, out-of-order
  and garbage input, idle-closed before start / after stop / after
  utterance end, visemeAt during speech and in gaps, cross-fade vs direct
  emission, never-throw on malformed input, registration guard fail-closed
  then open after measurement.
- `README.md` — lane contract, scheduler math, and the render-lane
  handshake.
- `CONTRACT.md` — stable API contract (E.1-style evidence record).

## Verification evidence (this lane, pre-fresh-recheck)

```text
node --test src/animation/viseme/__tests__/viseme.test.ts   -> 16 pass / 0 fail (exit 0)
node --test src/window/__tests__/window.test.ts tests/prefs/prefs.test.ts -> 44 pass / 0 fail (regression control)
npx tsc --noEmit (app tsconfig)                             -> exit 0
```

Node v26.7.0, zero deps, node:test + TS type-stripping — same lane
convention as WS-07/WS-40. The lane touches no root files, no CONTROL/
carriers, no shared `src-tauri` capabilities, no CHANGELOG/VERSION/tags.

## Ownership boundary notes

- TTS runtime and phoneme timings stay WS-19-owned
  (`src-tauri/tts/**`, WR-014). This lane consumes the shared timing
  shape and documents the mirror in `types.ts`; it does not import or
  modify WS-19 code.
- Asset application (mouth overlay onto registered bust frames) stays
  WS-11/WS-13 territory (`assets/candice/**`, `src/loader/**`,
  `src/animation/gesture/**`). The registration guard is this lane's
  handshake for that seam.
- `DEFAULT_PHONEME_TO_VISEME` is a data constant; a final-art pass can
  extend it without touching scheduler logic.

## Notes for the conductor

- No commit made (per builder instructions). Branch remains at `aa23ed9`;
  all files are working-tree additions under
  `apps/candice-companion/src/animation/viseme/**`.
- E.1 WS-12 checkbox in `CONTROL/CHECKLIST.md` intentionally NOT flipped:
  a QC/fixer cannot self-certify (0.1 override 2). The fresh recheck
  flips it if it passes.
- FRESH RECHECK REQUIRED by an independent sonnet/max QC agent.
