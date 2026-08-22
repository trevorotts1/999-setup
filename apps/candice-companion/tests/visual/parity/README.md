# FIX-020 — parity review harness (BAR-10 / BAR-10A)

Owned lane: `apps/candice-companion/tests/visual/parity/**`.
This is the automated portion of the FIX-020 review machinery. Everything
except the human sign-off runs mechanically; when the operator approves
FIX-003 the parity gate runs from the pack, not from prose.

## What the harness does

1. **Manifest-driven checklist** — `manifest.json` is the machine copy of
   `docs/candice-visual/VISUAL-PARITY-CHECKLIST.md`: the seven required
   visual states (idle/greeting/listening/speaking/thinking/compact/
   expressive), per-state binary rows, ten global release checks, and the
   ANIM-01..ANIM-07 items of BAR-10A. The spec text is the authority; this
   file is its executable encoding and fails loudly if they drift.
2. **Side-by-side diff engine** (`diff.ts`) — two disciplines:
   - strict alpha-exact region compare (zero tolerance, one differing byte
     fails) for same-canvas frames: layer composites, golden
     reconstructions;
   - SSIM (8x8 windows, luma-with-alpha) for different-scale
     capture-vs-source likeness bounds. The bound only detects identity
     swaps and gross divergence — it never approves likeness. Likeness
     rows stay REQUIRE_SIGN_OFF until a human signs.
3. **Asset authority** (`asset.ts`) — the only lawful LEFT side is
   `assets/candice/asset-manifest.json` (contract
   `candice-operator-originals-v1`). The harness re-derives every
   canonical SHA-256 from the bytes on disk and rejects any cite of a
   non-canonical id. KIE/placeholder material in a capture set fails
   global checks.
4. **Binary verdict** (`engine.ts`) — any missing required state, any FAIL
   row, any un-signed REQUIRE_SIGN_OFF row, any prohibited wording ("same
   vibe", "looks good enough", "same concept", "roughly similar",
   "probably used the images") keeps BAR-10 FAIL. ANIM items must all be
   PASS or BAR-10A FAILs.
5. **Reviewer-ready HTML** (`report-html.ts`) — canonical source LEFT,
   runtime capture RIGHT, per-row PASS/FAIL chips, proof lines, global
   checks, ANIM scoring, operator sign-off block.

## Pack layout (produced by the capture pipeline, consumed here)

```text
<reviewDir>/
  canonical/<assetId>.png          operator-approved sources (byte copies)
  captures/<state>.png             runtime captures
  captures/<state>.capture.json    CaptureMetadata per capture
  evidence.overrides.json          optional global-check overrides w/ proof notes
  anim.json                        optional ANIM-01..07 scores w/ notes
  decision.json                    optional operator decision (signs the pack)
  review-report.json               emitted — machine verdict
  reviewer.html                    emitted — human review page
```

A capture names its cited canonical ids, build/commit, OS/display scale,
and timestamp; the harness re-derives the capture PNG's own SHA and
verifies the citation chain before evaluating any row.

## Run

```bash
cd apps/candice-companion
node --test tests/visual/parity/parity.test.ts     # harness self-tests (17)
node tests/visual/parity/run-review.ts <reviewDir> # evaluate a pack
```

Zero external dependencies (Node built-ins + the WS-15 codec). The suite
runs in CI containers without the app toolchain and without a display
server; capture production is the pipeline's job, evaluation is this
lane's.

## What stays human

The spec bans "close enough" and requires operator approval naming the
reviewed runtime build/commit. Rows marked REQUIRE_SIGN_OFF
(overall-likeness, face, hair, identity, selected-source-approved, and
the other likeness rows) are filled by `decision.json` and the operator's
dated signature — the harness verifies the signature names a build and
contains no prohibited wording, and only then can BAR-10 PASS.

## Files

- `manifest.json` — executable checklist (BAR-10 states/rows/global checks, BAR-10A items).
- `types.ts` — shared report/check types.
- `asset.ts` — manifest authority, canonical SHA re-derivation, cite validation.
- `diff.ts` — strict alpha-exact + SSIM pixel engine, compositing, bbox, scaling.
- `engine.ts` — manifest validation, row evaluation, binary verdicts.
- `report-html.ts` — reviewer HTML emitter.
- `run-review.ts` — CLI pack runner.
- `parity.test.ts` — self-tests (negative-result contract: missing capture,
  wrong canonical cite, prohibited wording, alpha corruption, identity
  swap, unsigned pack all FAIL; complete signed pack PASSes).
