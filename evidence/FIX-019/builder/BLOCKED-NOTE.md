# FIX-019 packaged tier — BLOCKED record (environment gate)

Date: 2026-08-22. Host: operator Mac Mini (Apple Silicon, macOS Darwin 25.3.0).
Launcher: `node tests/e2e-acceptance/packaged/suite.js` (exit 2, mechanical BLOCKED).

## Verdict

PACKAGED_AUTOMATED: **BLOCKED** — all six required legs recorded BLOCKED with
the named environmental reason. No leg ran, no leg is claimed. Per
EXECUTION-PLAN.md, BLOCKED in a required tier fails FIX-019 QC; this note
records the honest state, not a green tier.

## Gate reason

`screen is locked (CGSSessionScreenIsLocked=1) — macOS degrades AX window
enumeration box-wide while locked; unlock the screen and rerun`

## Control evidence (known-good controls on this instrument)

1. **Lock probe** — `swift -e 'import Foundation; import CoreGraphics; let d =
   CGSessionCopyCurrentDictionary() as NSDictionary?; print(d?["CGSSessionScreenIsLocked"] ?? "?")'`
   prints `1`, exit 0. Same probe on an unlocked session prints `0` (control
   verified during development).
2. **System Events false-pass** — while locked, `tell application "System
   Events" to get name of first process` returns `loginwindow` (non-empty), so
   the a11y control probe alone false-passes. The lock check therefore runs
   first and is authoritative (`packaged-driver.js` `environmentGate()`).
3. **AX window degradation** — on a fresh app instance while locked,
   `AXUIElementCopyAttributeValue(app, kAXWindowsAttribute)` returns the
   application element itself instead of real windows; children are
   AXApplication + AXMenuBar only; WebContent AX read returns err=-25204.
4. **Rendering proof** — before/after screenshots in `blocked-controls/`
   prove the question reaches the frontend and the answer controls DO render
   (light purple rounded surface + dark panel, left region) while locked.
   The lock blocks only the driving/observation mechanism, not the app.

## What the gate fix changed

`tests/e2e-acceptance/packaged/packaged-driver.js` gained `screenLocked()`
(CGSSessionScreenIsLocked) and `environmentGate()` now checks lock first,
then the a11y control probe. Before the fix, locked-screen runs misrecorded
FAIL (exit 1) instead of BLOCKED (exit 2).

## Rerun procedure

1. Unlock the screen on this Mac.
2. `node tests/e2e-acceptance/packaged/suite.js` — runs each leg twice from
   clean state, writes `packaged-report.json` + traces.
3. `node tests/e2e-acceptance/suite.js` — merges the aggregate report.

## Pre-existing UNIT failure (not FIX-019)

`same-session-provider-identity` fails 2 checks at base b54aec0 with zero
diff in the flagged files (`plugins/candice-integration/bin/__tests__/wake-dispatcher.test.mjs`
contains `claude-nine` x3; `plugins/candice-integration/bin/wake-candice.mjs`
reads `process.env.CANDICE_COMPANION_CMD`). Proven with `git show b54aec0:...`
— pre-existing, outside the FIX-019 lane.
