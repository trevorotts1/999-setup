# Candice layer registration registry — FIX-005

Owned lane files: `assets/candice/layers/**` and
`apps/candice-companion/src/animation/viseme/**`.
Pack control files (manifest, loader, source, derived) are NOT owned here.

## Purpose

Mouth/eye layers must align to the approved sources at reference anchors and
required scales across every phoneme/blink state without drift.

The canonical sources are 1254x1254 and 1024x1536 frame-filling portraits that
were authored with cross-frame drift. The registry records, per state, the
measured anchor (alpha-bounding-box top-left, normalized to the frame) and the
required scale that pins each subject to the registration reference
`03-mouth-neutral-closed`, so a renderer applies layers at one fixed reference
geometry with known bounded residual drift.

## Reference geometry

Reference state: `mouth-neutral-closed` (source `03-mouth-neutral-closed.png`).
Every registered state carries:

- `anchorX` / `anchorY` — measured top-left of the opaque-subject bounding box
  (alpha >= 128), normalized to the frame. Values below are measurement facts,
  not opinion.
- `requiredScaleX` / `requiredScaleY` — scale relative to the reference
  subject extents that pins the state to the reference geometry.
- `maxDriftX` / `maxDriftY` — worst-case post-alignment drift from the
  reference subject extents, normalized to those extents. Residuals come from
  hair/pose sway inside the sources; no pre-aligned frame exceeds 1.7% / 2.4%.

The `eye-half-blink` state (`11`) is a 1024x1536 bust on a larger virtual
stage; its anchor and scale are recorded against the same reference.

## Files

- `layer-anchor-registry.json` — data.
- `schema.json` — JSON Schema (draft 2020-12) the data must validate against.
- `registry.ts` — zero-dependency TypeScript loader: JSON parse, strict
  validation, per-state canonical-hash check, fail-loud on any missing or
  unknown entry. Loads the JSON lazily; the registry never reads image bytes.
- `__tests__/registry.test.ts` — node:test acceptance tests.

## Non-negotiable

- The 7 canonical mouth/eye PNGs are read-only (mode 444, WS-11 staged).
  This lane stages no image, decodes no image bytes at runtime, and records
  no pixels — only the measured numbers in the JSON.
- Every registered state must carry the SHA-256 of its canonical source.
  A registration that does not resolve to a canonical hash fails loudly.
- JSON is generated data, not hand-editable facts: regeneration command is
  `python3 tools/measure-anchors.py source/operator-approved \
  layer-anchor-registry.json`.
