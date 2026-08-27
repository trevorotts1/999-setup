# derived/ — deterministic runtime derivatives (FIX-004)

## Authority

- Canonical authority remains `source/operator-approved/` (16 operator originals).
  Nothing in `derived/` is visual authority until FIX-003 operator approval
  binds the pinned hashes in `DERIVATIVE-MANIFEST.json`.
- `derived/experimental-kie/` is the WS-11 quarantine. The pipeline never
  touches it, and it can never enter production resolution.
- `approved-pending/` is the pipeline's single output tree. Its
  `DERIVATIVE-MANIFEST.json` records every derivative: id, file, format,
  dimensions, source ids + source sha256, transform (crop box, resample,
  scaled size, target box), byte count, sha256, and pinned encoder parameters.

## Spec: sizes measured before they were chosen

`../DERIVATIVE-SPEC.json` is the source-of-truth derivative spec. Every tier
target was measured against the live app before selection:

- App window: 420x640 (`tauri.conf.json`), resizable.
- Stage CSS: `.candice-character-image` max-width `min(100%, 520px)`,
  max-height 100%, `object-fit: contain`.
- Fullbody sources are 941x1672 (aspect 941:1672).
- Alpha content of every source touches the frame edge (measured), so
  uniform-fit resize preserves all content — no cropping on whole-frame tiers.
- Only `13-multipose-sheet` has two bounded row bands (measured); its two
  crop rectangles are pinned in the spec and are the only crops in the build.

Tiers:

| Tier | Size | Inputs | Why (measured) |
|---|---|---|---|
| compact | 420x746 | 01, 02 | fits 420px window at native aspect; honest 420px scale of 941:1672 |
| fullbody | 941x1672 | 01, 02 | native resolution, on-demand inspection |
| face | 376x376 | 03–09 | 0.3 scale of the 1254px face square |
| portrait | 307x461 | 10, 11, 12, 14, 15, 16 | 0.3 scale of the 1024x1536 tier |
| sheet-pose-a | 307x237 | 13 | alpha-band crop row A, pinned box (4,10,1009,786) |
| sheet-pose-b | 307x222 | 13 | alpha-band crop row B, pinned box (4,792,1009,1518) |

Formats per derivative: PNG (lossless, compress_level 6, optimize off) and
WebP (lossy quality 95, method 6, alpha exact — measured: Pillow 11.3
"lossless" WebP is lossy in RGB, so WebP is declared honestly as 95-quality).

## Determinism rules

- Sources read in sorted order; tiers and inputs iterated in spec order.
- Fixed encoder parameters (above). Fixed file mtime 2026-01-01T00:00:00Z.
- No timestamps, randomness, hostname, or absolute paths in any output.
- `DERIVATIVE-MANIFEST.json` pins `sourceManifestSha256`, `specSha256`,
  tool versions, and every output hash. Approval binds by comparing this file.

## Commands

```bash
# Build (writes only under derived/approved-pending/)
python3 apps/candice-companion/scripts/build-derivatives.py

# Independent determinism proof: two clean builds (BUILD-A in-tree cwd,
# BUILD-B in a foreign cwd), byte-compare, integrity, and committed-tree match
python3 apps/candice-companion/scripts/verify-derivatives.py
```

Asset bytes are OFF-CONTEXT (DOC-ASSET-HANDLING-NOTE.md): metadata via
`shassum -a 256` / `stat -f%z` / PIL computed off-disk only.

## Prohibited

- No generated, synthesized, or AI-produced art enters `derived/approved-pending/`.
- No background fill, flattening, or color manipulation; no upscale beyond
  native source dimensions.
- Sources are never rewritten. Build outputs land only under
  `approved-pending/`.
