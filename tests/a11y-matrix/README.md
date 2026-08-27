# tests/a11y-matrix — FIX-008 accessibility matrix automation

Owned path: `tests/a11y-matrix/**` (FIX-008 lane). Read-only consumers of
`apps/candice-companion/**` (WS-06/WS-07/WS-14/WS-40 lanes) and
`packages/candice-protocol/**` (WS-01). This lane never edits them.

## Purpose

The FIX-008 QC report (`evidence/FIX-008/qc/QC-REPORT.md`) blocks release on
seven evidence classes. This suite automates every class that can be proven
by machine and shrinks the external human QA pass to exactly the classes
that require a live OS, a real assistive-technology session, or a real
WindowServer click route:

| QC gap | Machine-proven here | Still human-required |
|---|---|---|
| 1. macOS + Windows packaged run at 100/150/200% | Build + boot + scale-token math (macOS only, this host) | Windows packaged run; live display-scale captures |
| 2. 5x5 transparent-point grid + visible-control grid | Input-policy fail-closed proof + live CGEventPost grid with Terminal receipts | Real human click receipts on a physical desktop |
| 3. Light/dark 100/200% + forced-colors contrast | WCAG 2.1 ratio math on the exact shipped tokens + live pixel measurement of the packaged window | Windows packaged captures |
| 4. Keyboard tab order for every visible interactive element | AX-tree export: roles, labels, focus order, tabindex | Human keyboard traversal on the packaged app |
| 5. VoiceOver (macOS) / Narrator (Windows) | AX-tree JSON the human tester reads aloud from | The actual VoiceOver/Narrator session |
| 6. OS reduced-motion toggle + text-scale 0.8/1.0/1.6 | Tier resolution + scale bounds + CSS kill rules + live OS toggle pixel-diff proof | Windows OS toggle |
| 7. Session-bound Return to Claude | Absence proof (owned by FIX-010, not this fix) | FIX-010 supplies the feature first |

## Files

| File | Role |
|---|---|
| `lib/wcag.mjs` | Shared zero-dep WCAG 2.1 math + Candice token extraction. |
| `contrast.test.mjs` | Static contrast suite (`node --test`): parses the shipped tokens, computes ratios vs thresholds for every theme x surface x text-scale cell, writes `report/contrast-report.json`. |
| `motion-scale.test.mjs` | Motion-tier x text-scale matrix + keyboard tab-order enumeration + deterministic per-cell captures to `report/captures/`. |
| `live-contrast.test.mjs` | Live CDP leg: real headless Chrome measures computed colors per theme x scale, forced-colors system pair, and reduced-motion animation kill; writes `report/live-contrast-report.json`. Skips honestly when no Chrome debug endpoint answers. |
| `contrast-harness.mjs` | Candidate-exact harness: parses the 3bca501 `styles.css` fixture (extracted via `git show`), computes WCAG ratios from tokens, checks forced-colors coverage, reduced-motion kill rules, focus-visible outline, transparent body. Deterministic — run twice, outputs must be identical. |
| `motion-harness.mjs` | Candidate-exact harness: imports the 3bca501 a11y lane fixtures (`runtime.ts`, `config.ts`, `apply.ts`, `controller.ts`, `motion.ts`) via Node type-stripping with a fake DOM. Checks text-scale bounds, runtime token writes, tier resolution, single-writer reduced-motion class, controller, state store, cross-lane consumers. Deterministic. |
| `input-policy-harness.mjs` | Candidate-exact harness: imports the 3bca501 `window/input-policy.ts` fixture. Checks fail-closed pass-through policy (null adapter, empty/invalid regions, adapter throw all reassert pass-through) and the happy-path partial-interactive state. Deterministic. |
| `ax-export.py` | Live AX-tree exporter: walks the AXUIElement tree of the packaged candidate directly through ApplicationServices (ctypes, no System Events cache), emits roles/labels/focus order/geometry to JSON. |
| `ax-export-check.mjs` | Parses the live AX export JSONs, asserts window/web-area/static-text/image identities, no interactive roles, determinism modulo capture timestamp and animated character geometry. |
| `emit-evidence.mjs` | Evidence pack emitter: copies machine-generated evidence into `${PACK}/evidence/FIX-008/builder/` with packet-exact filenames, writes the machine-proven vs still-human-required gap report and SHA-256 index. |
| `live-pass-through-grid.py` | Live leg: activates the packaged candidate, posts a 5x5 CGEventPost click grid inside its native bounds, asserts the app beneath (Terminal) stays frontmost after every click, plus a control click outside the bounds. Requires the packaged candidate app running; pass its PID. |
| `live-appearance-captures.py` | Live leg: toggles OS reduceMotion/dark/increaseContrast, captures the packaged window via Quartz, measures real pixel contrast inside AX-derived text rects, proves the breathe animation stops under reduced motion (two captures 1.5s apart pixel-identical). Restores OS state on exit. |
| `suite.js` | Aggregating runner: the three `node --test` suites, the four deterministic harnesses twice each (outputs diffed), then the two live legs. `--skip-live` skips the live legs. Writes `evidence/FIX-008/qc/suite-results.json`. |
| `fixtures/candidate-a11y/` | Exact 3bca501 blobs extracted via `git show <sha>:<path>` with subdirectory structure (41 files: a11y/*, window/*, shell/*, ui/* consumers, styles.css, index.html, main.ts, capabilities/main.json, assert-accessibility-bundle.mjs). |

## Run

```bash
# Full suite (live legs need the packaged candidate app running):
CANDICE_PID=<pid> node tests/a11y-matrix/suite.js

# Without live legs:
node tests/a11y-matrix/suite.js --skip-live

# Individual suites:
node --test tests/a11y-matrix/contrast.test.mjs
node --test tests/a11y-matrix/motion-scale.test.mjs
node --test tests/a11y-matrix/live-contrast.test.mjs
```

`live-contrast.test.mjs` requires Google Chrome at
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` (present on
the operator box). It exits 0 with an honest `skipped` marker when Chrome
is absent — a skip is never silent and never claimed as tested.

## Live-leg environment notes

- The candidate window must sit over the beneath-app (Terminal) and clear
  of any other candice-companion windows. Other lanes (e.g. FIX-013) launch
  their own instances at the same default bounds; a stacked window above
  the candidate eats the grid clicks. Move the candidate window
  (`osascript` System Events `position`) to a clear spot over Terminal
  before running the grid.
- The appearance captures toggle OS-wide reduceMotion/dark/increaseContrast
  and restore them on exit; do not run them concurrently with another
  lane's live OS-toggle leg.

## Honesty contract

- The headless boot is a **webview-payload boot**, not a native Tauri
  window. It proves the shipped DOM/AX surface; the live legs prove
  WindowServer click routing and native appearance behavior on the
  packaged app.
- The visible-control grid is recorded as `not enabled / no visible
  interactive control` — the candidate intentionally has no interactive
  regions. A synthetic PASS is never invented.
- `Return to Claude` is recorded as `not enabled / owned by FIX-010`.
