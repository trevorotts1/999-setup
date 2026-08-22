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
| 2. 5x5 transparent-point grid + visible-control grid | Input-policy fail-closed proof (no interactive regions exist) | Real WindowServer click receipts in Terminal |
| 3. Light/dark 100/200% + forced-colors contrast | WCAG 2.1 ratio math on the exact shipped tokens | Live screenshot captures + contrast-checker output |
| 4. Keyboard tab order for every visible interactive element | AX-tree export: roles, labels, focus order, tabindex | Human keyboard traversal on the packaged app |
| 5. VoiceOver (macOS) / Narrator (Windows) | AX-tree JSON the human tester reads aloud from | The actual VoiceOver/Narrator session |
| 6. OS reduced-motion toggle + text-scale 0.8/1.0/1.6 | Tier resolution + scale bounds + CSS kill rules | Live OS toggle while the packaged app runs |
| 7. Session-bound Return to Claude | Absence proof (owned by FIX-010, not this fix) | FIX-010 supplies the feature first |

## Files

| File | Role |
|---|---|
| `contrast.js` | WCAG 2.1 contrast math, token extraction from the shipped CSS, thresholds. Zero deps. |
| `contrast.test.js` | `node --test` suite over `contrast.js`. |
| `ax-tree.js` | AX-tree exporter: walks a DOM, emits roles/labels/focus order as JSON. Zero deps. |
| `ax-tree.test.js` | `node --test` suite over `ax-tree.js` (fake DOM, no browser needed). |
| `evidence-pack.js` | Evidence pack emitter: machine-proven vs still-human-required, packet-exact filenames. |
| `evidence-pack.test.js` | `node --test` suite over `evidence-pack.js`. |
| `run-matrix.mjs` | Orchestrator: builds the webview payload, boots it in headless Chrome, exports the AX tree, computes contrast, emits the evidence pack. |
| `suite.js` | Aggregating runner (repo convention: plain `node`, zero deps). |
| `lib/wcag.mjs` | Shared zero-dep WCAG 2.1 math + Candice token extraction (used by both contrast legs). |
| `contrast.test.mjs` | Static contrast suite (`node --test`): parses the shipped tokens, computes ratios vs thresholds for every theme x surface x text-scale cell, writes `report/contrast-report.json`. |
| `motion-scale.test.mjs` | Motion-tier x text-scale matrix + keyboard tab-order enumeration + deterministic per-cell captures to `report/captures/`. |
| `live-contrast.test.mjs` | Live CDP leg: real headless Chrome measures computed colors per theme x scale, forced-colors system pair, and reduced-motion animation kill; writes `report/live-contrast-report.json`. Skips honestly when no Chrome debug endpoint answers. |

## Run

```bash
# Unit suites (no browser, no build):
node --test tests/a11y-matrix/contrast.test.js
node --test tests/a11y-matrix/ax-tree.test.js
node --test tests/a11y-matrix/evidence-pack.test.js

# Full matrix (build + headless Chrome boot + evidence pack):
node tests/a11y-matrix/run-matrix.mjs
```

`run-matrix.mjs` requires Google Chrome at
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` (present on
the operator box). It exits 0 with an honest `skipped` marker when Chrome
is absent — a skip is never silent and never claimed as tested.

## Honesty contract

- The headless boot is a **webview-payload boot**, not a native Tauri
  window. It proves the shipped DOM/AX surface; it cannot prove
  WindowServer click routing, native focus, or assistive-technology
  behavior. Those stay in the human-required packet.
- The visible-control grid is recorded as `not enabled / no visible
  interactive control` — the candidate intentionally has no interactive
  regions. A synthetic PASS is never invented.
- `Return to Claude` is recorded as `not enabled / owned by FIX-010`.
