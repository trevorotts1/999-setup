# WS-15 — visual / transparent-background test harness

Owned lane: `apps/candice-companion/tests/visual/**` (PROJECT-MANIFEST 9.2,
WR-013 row, WS-15).

## What is proven

Binary acceptance criteria (CHECKLIST E.1 WS-15 + task-graph-snapshot
required outputs):

1. Every supplied Candice source PNG is RGBA (colorType 6) with a genuine
   alpha channel (min 0, max 255), and the harness RE-DERIVES the alpha
   extrema/mean from decoded pixels and matches them against
   `asset-manifest.json`'s recorded values — the manifest claims are
   independently proven, not trusted.
2. Every asset passes the transparency gates on BOTH light (`#F2F2F2`) and
   dark (`#161616`) desktop backdrops (spec 11B: preserve source alpha,
   never flatten onto black; spec 10/28: no baked terminal/UI background).
3. Light and dark verdicts agree — E.1 is binary ("both light and dark").
4. Edge quality: no hard alpha matte cuts, no opaque corners, no baked box
   (at most one heavy edge, and only the bottom = character crop contact),
   no interior alpha holes (region-based), no isolated fringe dust.
5. Harness honesty (negative results): synthetic known-bad candidates —
   flattened-on-black, opaque box, letterbox, hard matte, alpha hole,
   dust field, backdrop-washed fringe — all FAIL, and a rebuilt copy of a
   real asset still PASSES (round-trip).
6. Codec honesty: the harness's own PNG unfilterer decodes all five filter
   types (None/Sub/Up/Average/Paeth) to reference pixels; encode(filter 0)
   round-trips pixel-identically for all 17 assets.
7. Spec 19 low-memory animation behavior: the animation lanes declare
   lazy-loaded / limited-resident-frame contracts (WS-11 loader laziness,
   WS-13 boot subset + finite duty cycles, WS-07 transparent root), and
   the harness proves one-decode-at-a-time residency (peak reachable RGBA
   is bound by a single frame, never the whole pack).

## Run

```bash
cd apps/candice-companion
node --test tests/visual/transparency.test.ts   # Node >= 22.6 (26 strips types natively)
node --experimental-strip-types tests/visual/report.ts   # measurement table (Node < 26)
node tests/visual/report.ts                     # Node 26
```

Zero external dependencies (Node built-ins only + the checked-in asset
manifest). The suite runs in any CI container without the app toolchain
and without a display server.

## Files

- `png.ts` — minimal PNG codec (decode all filter types, encode filter 0).
- `gates.ts` — pure predicate gates over decoded RGBA; gate constants and
  measured rationale in the file header.
- `transparency.test.ts` — the suite (23 tests).
- `report.ts` — human/CI measurement table (per-asset wash, border, fringe
  metrics on both backdrops).
- `transparency.contract.md` — stable contract for other lanes.
