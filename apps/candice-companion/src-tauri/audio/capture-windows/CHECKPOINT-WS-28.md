# CHECKPOINT — WS-28 (Windows microphone/audio/device path)

QC-as-fixer: QC-Q-WS-28 (sonnet/max), Candice W1 build.
Worktree: `worktrees/wr001-bootstrap` @ `aa23ed9` (branch `candice/wr001-bootstrap`).
Date: 2026-08-21.

## QC verdict (blind) — FAIL, write baton taken, fixed

**Defect 1 — ownership violation (critical).** The prior builder landed the
whole unit at `apps/candice-companion/src/platform/windows/audio/**` — a path
no authority grants to WS-28. Live authorities: worktree `SPEC/PROJECT-MANIFEST.md`
9.2 WR-016 row and the native snapshot `CONTROL/task-graph-snapshot.json` WS-28
node (`owned_paths`) both pin WS-28 to
`apps/candice-companion/src-tauri/audio/capture-windows/**`. The WS-17 lane's
checkpoint (QC-Q-WR-009-WS-17, cross-lane finding) hands this lane the Rust
`MicSource` trait at exactly that path; a TypeScript/PowerShell-MCI facade at
the wrong path cannot satisfy it. Removed the out-of-ownership tree; prior
content preserved at worktree root `.qc-backup-ws28-20260821/audio/**`.

**Defect 2 — functional: PTT release discarded valid audio (E.1/spec 6).**
The removed lane force-stopped the microphone at a hard 4 s window
(`ENGINE_WINDOW_MS = 4000`) on every hold. Cross-lane truth: the WS-17
controller's spec-8 stuck-press valve is 60 s
(`DEFAULT_DURATION_LIMIT_MS = 60_000`, QC-verified, ring covers the full
window). A 4 s window truncates any legitimate hold >4 s mid-press — the
exact defect class WS-17's QC already repaired there. The rebuilt unit has
no such window: the WS-17 controller alone ends the hold (release or its
60 s clock), and `MicSource::open`/`close` bound the live-mic window by
construction.

**Defect 3 — no checkpoint/evidence file.** Every landed sibling unit
(WS-06/07/16/17/23/24/29/30/40) carries a `CHECKPOINT-WS*.md`; the prior
builder left none. Added this file.

**Defect 4 — Windows-host tests were vacuous.** The prior suite carried
three tests gated `if (process.platform !== 'win32') return` — they pass
vacuous on macOS and prove nothing on Windows. The rebuilt suite tests the
real decision code (observation -> CaptureError mapping, open-error
classification) on any OS, and the WASAPI stream itself is exercised on
the interactive Windows matrix (spec 18 release gate, late-bound
environment).

## Acceptance criterion (CHECKLIST E.1 WS-28)

> Windows microphone/device path works with PTT; no-device and
> permission-denied paths fall back to typing.

The binary decision surface is the WS-17 controller contract: this crate
provides the Windows `MicSource`; `DevicesPresent`/`NoDevice`/
`PermissionDenied` map to the capture contract; anything but success
leaves typing available (spec 17/20). Live Windows proof is the WS-46
interactive-smoke obligation (spec 18) — CI alone is not that proof and
this lane does not claim it.

## Files created (all inside the owned glob `apps/candice-companion/src-tauri/audio/capture-windows/**`)

| File | Role |
|---|---|
| `Cargo.toml` | standalone crate `candice-capture-windows` v0.1.0; default features empty (offline tests), `wasapi` feature = cpal WASAPI host; path-depends on sibling `candice-capture` (WS-17 boundary); integration owner (9.3) wires into the app crate at fan-in |
| `src/lib.rs` | crate root + re-exports (`WindowsMicSource`, `windows_mic_probe`) |
| `src/presence.rs` | Windows mic presence/consent decision: `WindowsMicObservation` + `map_windows_observation` -> `CaptureError::no_device()`/`permission_denied()`; pure decision code testable on any OS |
| `src/source.rs` | `WindowsMicSource` — `MicSource` impl over cpal's WASAPI host; `open` pushes `SourceChunk`s straight into the WS-17 ring (no temp files, no PowerShell at capture time); `close` drops the stream (mic cannot outlive release); `classify_open_error` maps access-denied/not-found to the capture contract |
| `CHECKPOINT-WS-28.md` | this note |

## Verification (primary-source evidence)

```text
$ cargo test
test result: ok. 5 passed; 0 failed     (no features — offline, no audio hardware)

$ cargo test --features wasapi
test result: ok. 8 passed; 0 failed     (cpal path compiles; macOS coreaudio build)

$ cargo clippy --all-targets              -> 0 warnings
$ cargo clippy --all-targets --features wasapi -> 0 warnings
$ cargo fmt --check                       -> clean
$ cargo check --features wasapi --target x86_64-pc-windows-msvc
Finished dev profile, 0 warnings (cpal WASAPI host resolves on the Windows target)

Sibling regression (the one additive export this fix needed):
$ cd ../capture && cargo test             -> 25 passed, 0 failed
$ cargo test --features cpal              -> 25 passed, 0 failed
$ cargo clippy --all-targets --features cpal -> 0 warnings
$ cargo fmt --check                       -> clean
```

Runner: rustc/cargo 1.97.1 (Apple Silicon); `x86_64-pc-windows-msvc`
target added via rustup for the cross-check. No external test dependency:
the default-feature suite runs in any CI container without the app
toolchain or audio hardware. On the Windows host itself the `wasapi`
build exercises the real MMDevice/WASAPI path; interactive smoke is the
spec-18 release gate.

## Design notes

- Push-to-talk is structural, not temporal: the WS-17 controller calls
  `open` only from `press()` and `close` on `release()`; `MicSource` has
  no other way to start the stream. There is no capture window in this
  lane to mis-tune — the only hold terminator is the controller's 60 s
  stuck-press valve or the user's release.
- Privacy per spec 8: audio flows `mic -> WS-17 in-memory ring buffer ->
  whisper.cpp -> transcript -> discard`. This lane writes no audio to
  disk, uploads nothing, logs nothing; device names leave only through
  the advisory `list_input_devices` contract.
- Native Windows only (spec 0.3/17): cpal's WASAPI host speaks MMDevice/
  WASAPI directly; no Git Bash, no WSL, no PowerShell dependency at
  capture time.
- Prior TS/PowerShell-MCI attempt preserved at
  `.qc-backup-ws28-20260821/audio/**` (worktree root) for history;
  superseded by this Rust boundary implementation.

## Cross-lane findings

- CROSS-LANE-FINDING (WS-28 -> WR-014 lane): `SourceChunk` was not
  exported from the `candice-capture` crate root, so no external
  `MicSource` implementation (this lane's Windows source included) could
  compile. Minimal additive fix applied: one `pub use
  source::{FakeMicSource, MicSource, SourceChunk}` line in
  `src-tauri/audio/capture/src/lib.rs`. Sibling crate re-verified green
  (25/25 both feature sets, clippy 0, fmt clean). Recorded for the
  WR-014 lane recheck.
- CROSS-LANE-FINDING (WS-28 -> WR-012 shell lane): wire
  `WindowsMicSource` (feature `wasapi`) into the app's capture
  controller at fan-in, matching the WS-17 checkpoint's WS-17 -> WR-012
  finding. No action required from this lane.
- CROSS-LANE-FINDING (WS-28 -> WS-46 / release): interactive Windows
  10/11 smoke (mic permission/device behavior, PTT) remains the
  spec-18 release gate; the interactive environment is a late-bound
  release input. Not provable from this machine — recorded, not claimed.

## Not done (out of scope, per ownership map)

- No commit/push (per dispatch instructions).
- No edits to CONTROL/**, SPEC/**, root release files, CHANGELOG.md,
  README.md, VERSION files, tags, .github/**.
- `Cargo.lock` generated by cargo inside the unit dir (needed for
  reproducibility; integration owner may move it at fan-in).

**FRESH RECHECK REQUIRED** — separate later lane must blind-review this
repaired unit.

## Defect chain (historical — superseded TS/PowerShell-MCI chain A, backup-only)

Source: `CONTROL/SESSION-LOG.md` line 355 (WS-28 third-round blind QC, seat
`agent-a78c65af95a009233`, run `wf_c3b3ed8b-978`). The prior TypeScript/
PowerShell-MCI chain ran builder OK -> QC1 FAIL -> QC2 FAIL -> QC2
interrupted before post-fix verdict. This Rust rebuild (chain B) superseded
chain A at the owned glob `apps/candice-companion/src-tauri/audio/capture-windows/**`;
chain A artifacts survive only in the four backup dirs cited below, all
verified present on disk at worktree root.

**QC1 — 4 defects (FAIL, fixed):**

1. Ownership violation — built at `apps/candice-companion/src/platform/windows/audio/**`,
   a path no authority grants to WS-28.
2. 4 s-window truncation — recorder force-stopped the microphone at a hard
   4 s window (`ENGINE_WINDOW_MS = 4000`), truncating any hold > 4 s mid-press.
3. Missing checkpoint — no `CHECKPOINT-WS*.md` landed with the unit.
4. Vacuous platform-gated tests — three tests gated
   `if (process.platform !== 'win32') return` passed vacuously on macOS and
   proved nothing on Windows.

**QC2 — 6 defects (FAIL, fixed):**

1. `runPowerShellJson` parse — fixed to parse first JSON object OR array.
2. PowerShell `finally` cleanup — fixed to keep PCM, delete only WAV.
3. Close handler error preservation — fixed to preserve stdout
   `ERROR:device-unavailable` / `permission-denied`.
4. WAV parsing — fixed with own WAV fmt/data chunk walk + channel-averaging
   downmix + linear resample to 16 kHz mono.
5. `flushAndComplete` — fixed: no longer requires disposed (4 s backstop).
6. device-info.ts PS 5.1 normalization — fixed: single-object/null collapse
   normalized.

All 10 historical defects (4 + 6) fixed and verified per the live record.
**Note: the chain is recorded as 4+6 (QC1 4, QC2 6), not 4+4+2 — no live
record says 4+4+2; the literal "4+4+2" appears nowhere in live files.**

Backups (chain A preservation, all exist on disk at worktree root, verified
2026-08-21):

- `.qc-backup-011b-ws28/audio/**`
- `.qc-backup-011c-ws28/audio/**`
- `.qc-backup-011d-ws28/audio/**` (round-3 write-baton backup, per SESSION-LOG line 355)
- `.qc-backup-ws28-20260821/audio/**` (chain A removal backup from this rebuild)
