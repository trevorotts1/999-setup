# WS-15 transparency harness — contract for other lanes

## Public surface (`tests/visual/gates.ts`, `tests/visual/png.ts`)

| Symbol | Type | Purpose |
|---|---|---|
| `viewOf(frame)` | `RgbaView` | Bounds-checked RGBA accessor (`a(x,y)`, `rgb(x,y)`). |
| `alphaStats(view)` | `{min,max,mean}` | Alpha extrema + mean (manifest verification). |
| `measure(view, bg)` | `GateMeasurement` | All gate metrics against one backdrop. |
| `gateForBackground(view, bg)` | `GateResult` | `pass` + exact `failures[]` strings for one backdrop. |
| `gateAll(view)` | `{light, dark, agree}` | Both backdrops + agreement flag. |
| `verdict(file, frame)` | `AssetVerdict` | Full binary verdict (both backdrops, `pass`, `agree`). |
| `heavyEdgeCount(m)` | number | Border edges with opaque share >= 8%. |
| `interiorHolePx(view)` | number | Region-based interior hole pixel count. |
| `BACKDROP_LIGHT` / `BACKDROP_DARK` | `{r,g,b}` | `#F2F2F2` / `#161616`. |
| `GATE` | const | All gate constants (binary; never tuned at runtime). |
| `decodeRgba / decodePngFile / encodeRgba / readHeader` | png.ts | Zero-dep PNG codec. |

## Binding rules

1. **Source PNGs are READ-ONLY for every lane** (9.4 item 8, spec
   11A/11B). The harness reads them; nobody rewrites them.
2. **Any new asset added to `assets/candice/source/` MUST pass the suite
   before it is shipped** — `node --test tests/visual/transparency.test.ts`
   is the gate. A new asset that fails (e.g. flattened onto black or with a
   baked frame) is a dispatch blocker, not a "measure and note" case.
3. **Derived runtime assets** (`derived/`, created by WS-11/WS-12/WS-13)
   must also satisfy the gates at their runtime size — the harness can be
   pointed at any decoded `{width,height,rgba}` frame, so derived-content
   tests reuse `verdict()` directly without duplication.
4. **Gate constants change only with the rationale re-measured.** Every
   threshold in `GATE` has a measured pack baseline documented in the
   `gates.ts` header; a threshold change without an updated measurement
   record is a contract break.
5. The harness itself never writes files (no fixture generation into the
   tree; synthetic candidates are built in memory).

## Interaction with other lanes

- WS-11 (`assets/candice/**`) — manifest alpha claims verified here.
- WS-12/WS-13 (`src/animation/**`) — the spec-19 contract test reads their
  source to assert lazy-loading declarations; a lane that regresses to
  eager loading fails the suite.
- WS-07 (`src/window/**`) — the transparent-root contract is asserted from
  `style.ts`.
- WS-14 captions / WS-09 controls — separate UI layers; the harness only
  guarantees the character stage itself paints nothing opaque.
