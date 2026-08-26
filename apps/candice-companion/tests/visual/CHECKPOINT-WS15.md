# CHECKPOINT — WS-15 (visual / transparent-background test harness)

Builder: WS-WS-15 (opus/max), W2 slice WR-014.
Worktree: `worktrees/wr001-bootstrap` @ branch `candice/wr001-bootstrap`.
Date: 2026-08-21.

## Files created (owned glob `apps/candice-companion/tests/visual/**`)

- `tests/visual/png.ts` — zero-dep PNG codec: full unfilterer (all 5 filter
  types), RGBA-only decoder, filter-0 encoder, IHDR reader, CRC-32.
- `tests/visual/gates.ts` — pure predicate gates over decoded RGBA
  (`measure`, `gateForBackground`, `gateAll`, `verdict`, `interiorHolePx`
  region-based scan); gate constants each anchored to a measured pack
  baseline in the file header.
- `tests/visual/transparency.test.ts` — the suite, 23 tests:
  - E.1 core: RGBA/alpha verification of all 17 assets, manifest alpha
    re-derivation, light+dark gate pass, light/dark agreement, wash-share,
    no-baked-box, edge quality, fringe translucency;
  - harness honesty (negative): flatten-on-black, opaque box, letterbox,
    hard matte, alpha hole, dust field, backdrop-washed fringe all FAIL;
    rebuilt real asset PASSES;
  - codec honesty: all 5 filter types decode to reference pixels; engine
    (type-0) round-trip pixel-identical for all 17 assets;
  - spec 19: lazy-loading contract declarations asserted from WS-11/WS-13/
    WS-07 source; one-decode-at-a-time residency proof.
- `tests/visual/report.ts` — measurement table dump (per-asset wash /
  border / fringe on both backdrops).
- `tests/visual/README.md` / `tests/visual/transparency.contract.md` —
  run instructions + cross-lane contract.

## Verification (primary-source evidence)

```text
$ node --test tests/visual/transparency.test.ts
tests 23  pass 23  fail 0

$ npx tsc --noEmit --allowImportingTsExtensions --module nodenext \
    --moduleResolution nodenext --target es2022 --strict \
    tests/visual/png.ts tests/visual/gates.ts \
    tests/visual/transparency.test.ts tests/visual/report.ts
exit=0 (clean)

$ node --experimental-strip-types tests/visual/report.ts
ALL PASS (E.1 WS-15 binary verdict per asset)
```

## Measured pack facts (the numbers the gates are calibrated against)

- All 17 sources: 8-bit RGBA (colorType 6), non-interlaced; 15 at
  1152x2048, 2 at 1520x2688.
- Alpha extrema 0..255 in all 17 (genuine alpha, never flattened).
- Corner alpha 0..1 in all 17 (no baked box/frame).
- Border: 6/17 fully transparent on all 4 edges (02, 03, 04, 11, 13, 17);
  11/17 touch only the BOTTOM edge (character crop contact): bottom opaque
  share 0.20%..79.51%. 10-eye-half-blink.png is the marginal case (79.51%
  bottom, corners 0..1, no full-width opaque run at alpha>=250: max
  857/1152) — full-bleed crop, PASS, measurement recorded.
- Hard alpha cut (adjacent pair jump >= 128): 0.000% in all 17 (fully
  anti-aliased edges, no mattes).
- Interior alpha holes (region scan, >=36px, opaque ring): 0 px in all 17.
- Isolated fringe dust: 1 px in all 17 (06-mouth-wide-open.png (453,1),
  alpha=8 rgb(8,8,8); gate 500).
- Backdrop wash (share of alpha>=32 px indistinguishable from backdrop):
  light max 1.40% (10-eye-half-blink), dark max 1.02% (09-eye-open) —
  gates at 12%.
- Fringe (alpha 8..246) mean alpha 122..134; mean |luma - light| 118..137,
  |luma - dark| 83..102 — nominal semi-transparency, nothing invisible.

## Notes for QC / next lanes

- The suite decodes each asset once per run (memoized); full run ~15 s on
  Apple Silicon, zero network and zero graphics dependency.
- The manifest 11 note about "10-eye-half-blink.png alpha mean 169.9 —
  flag for WS-15 light/dark verification" is now measured and resolved:
  the frame is a full-bleed crop (pixels run to the bottom edge), corners
  stay 0..1, no near-opaque run spans the whole row (max 857/1152 at
  alpha>=250) — it is not
  a baked rectangle and passes both backdrops.
- Runtime CPU/RSS measurements (spec 19 list) belong to WS-24/WS-30
  instrumentation lanes; this harness measures the ASSET, not the process.
- No commits made (lane policy); files staged for the handoff batch.
