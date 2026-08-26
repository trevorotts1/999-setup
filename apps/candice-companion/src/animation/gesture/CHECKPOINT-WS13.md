# CHECKPOINT — WS-13 (blink/idle/head/gesture animation)

Builder: QC-Q-WS-13 (sonnet/max) — blind-verdict FAIL + write-baton fix.
Worktree: `worktrees/wr001-bootstrap`.
Date: 2026-08-21.

## Blind verdict record

- QC-Q-WS-13 blind verdict: **FAIL** — owned glob
  `apps/candice-companion/src/animation/gesture/**` did not exist on disk at
  QC time (2026-08-21 ~17:25Z); no WS-13 run record in
  `CONTROL/task-graph-snapshot.json` `run_records` (25 records, none mention
  WS-13 or WR-015); no WS-13 checkpoint file. Dependencies WS-11 assets/loader
  were also absent (WS-11 owns its own deliverable; noted, not fixed here).
- Write baton taken per FAIL protocol. This checkpoint records the fix lane.

## Files created (all under owned glob `apps/candice-companion/src/animation/gesture/**`)

Source:
- `config.ts` — canonical WS-13 declarations: `ANIMATION_KINDS`
  (layer-swap/transform/opacity only), `GESTURE_IDS` (welcome/presenting/
  listening/thinking/affirmative — Master Spec 11 manifest keys), boot
  gesture subset, `REDUCED_MOTION_CLASS` (WS-14 consumer contract), stage/glow
  attributes, timing constants, unitless glow intensities, status contract.
- `timers.ts` — pause-safe `scheduleLoop`/`scheduleDelay` with injectable
  clock, idempotent cancel (spec 24).
- `motion.ts` — pure deterministic calculators: `eyeOpenRatio`,
  `breathScale`, `headDriftPx`, `glowIntensity`, `staggerPhase` (no DOM, no
  clock, no random).
- `gestures.ts` — gesture registry: pure `gestureForStatus` mapping, lazy
  `register` validation, transparent placeholder layers (spec 28).
- `driver.ts` — `createGestureDriver`: status-driven single-active layer swap,
  blink/idle/head/glow loops from real elapsed deltas, reduced-motion stop +
  static glow cap, idempotent detach, null-DOM no-op (spec 20).
- `glow.ts` — `createGlowSurface`/`findGlowSurface` decorative aria-hidden
  aura layer (opacity-only).
- `index.ts` — public surface re-exports.

Tests + docs:
- `__tests__/gesture.test.ts` — 21 tests covering E.1 shape, light/dark
  no-color invariant, motion bounds, registry purity, driver behavior,
  reduced motion, timers, null-DOM safety.
- `__tests__/README.md` — proven-here vs owned-elsewhere boundaries.
- `CONTRACT.md` — stable API + DOM + mapping contract for consuming lanes.
- `CHECKPOINT-WS13.md` — this file.

## Evidence of verification

- `node --test apps/candice-companion/src/animation/gesture/__tests__/gesture.test.ts`
  — 21/21 PASS, exit 0 (run on this worktree; log at /tmp/ws13-final.log).
- `cd apps/candice-companion && npx tsc --noEmit` — exit 0, whole app
  typechecks (WS-12 viseme errors that appeared mid-run were resolved by the
  viseme lane; none in this lane).
- Source-level scan: no hex/rgba/url/background declarations in the lane; no
  static Tauri IPC imports; no developer absolute paths; no writes outside
  the owned glob.

## Cross-lane findings

```text
CROSS-LANE-FINDING
source workflow/lane: QC-Q-WS-13 (gesture animation, blind-verdict fix)
affected unit: WS-11 (asset manifest + final-art loader)
evidence: WS-13 E.1 requires lazy-loaded gesture layers. This lane exposes
registry.register() for final-art layers, but WS-11's owned paths
(apps/candice-companion/assets/candice/** and src/loader/**) were absent on
disk at QC time. Until WS-11 lands, gestures render as transparent
placeholders (correct per spec 28 — never paint an opaque fallback — but not
visually complete).
recommended action: WS-11 lane should register the final gesture layers
(welcome/presenting/listening/thinking/affirmative) through this lane's
registerLayer/registry.register surface. No action from this lane.
```

```text
CROSS-LANE-FINDING
source workflow/lane: QC-Q-WS-13 (gesture animation, blind-verdict fix)
affected unit: WS-14 (reduced-motion) + WS-15 (visual harness)
evidence: E.1 requires proof on light AND dark desktop backgrounds. This
lane proves the source-of-truth shape (no colors/backgrounds painted), but
pixel-level alpha proof is WS-15's owned path
(apps/candice-companion/tests/visual/**), which was absent on disk at QC
time. The reduced-motion class this lane consumes (candice-reduced-motion)
is defined by WS-14 (src/a11y/**), also absent at QC time.
recommended action: WS-14 must define the class contract; WS-15 must run the
alpha-edge harness. No action from this lane.
```

## Notes for the conductor

- FRESH RECHECK REQUIRED: this lane was rebuilt from a FAIL verdict; per
  protocol the E.1 WS-13 box must flip only after an independent QC re-verdict.
- No commit made. All files are working-tree additions under
  `apps/candice-companion/src/animation/gesture/**` only.
- No root release files, CONTROL/ carriers, CHANGELOG.md, README.md, VERSION,
  tags, .github/ touched.
- The lane is dependency-free by design (node:test only) and typechecks under
  the app tsconfig.
