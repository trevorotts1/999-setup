# CHECKPOINT — WS-22 macOS permissions + degraded floating mode

Builder: WS-WS-22 (opus/max, W2 build). Worktree: `wr001-bootstrap`.
Date: 2026-08-21.

## Scope

Owned glob (manifest 9.2): `apps/candice-companion/src-tauri/permissions/**`
— created new (was absent). Nothing outside the glob was touched.

## Deliverable

Standalone Rust crate `candice-macos-permissions`:

| File | Purpose |
|---|---|
| `Cargo.toml` | manifest; `default` = pure model/policy, `live` = real probes |
| `src/lib.rs` | crate API surface; feature gate for `live` |
| `src/permission.rs` | `PermissionKind` (3 kinds) + `MicStatus` + AVFoundation raw-status mapping |
| `src/floating.rs` | `CompanionMode` Anchored/Floating + `decide_mode` (36-combo totality) |
| `src/copy.rs` | plain-language copy (accessibility/mic/screen/floating notices) |
| `src/snapshot.rs` | `PermissionSnapshot` — one immutable state view + conservative fallback |
| `src/live.rs` | read-only probes: `AXIsProcessTrusted` (raw FFI), `CGPreflightScreenCaptureAccess` (core-graphics), AVFoundation mic via objc2 `msg_send` + `exception::catch` |
| `examples/status.rs` | diagnostic CLI (requires `live`) |
| `CONTRACT.md` | binding rules + evidence-grader table for E.1 WS-22 |
| `README.md` | quick start + layout |
| `Cargo.lock` | resolved (objc2 / core-graphics; fetched from crates.io) |

## Verification

- `cargo test` — 20 passed / 0 failed (pure model/policy; no permissions,
  no hardware).
- `cargo test --features live` — 21 passed / 0 failed.
- `cargo clippy --features live --all-targets -- -D warnings` — 0 errors,
  0 warnings. Same for default features.
- Live diagnostic on this Mac (`cargo run --features live --example status`):
  Accessibility GRANTED, Screen Capture GRANTED, Microphone AUTHORIZED
  (real read-only TCC status), mode decision Floating with the WS-21
  `Unconfirmed` default signal, plain-language copy printed. No prompt
  was triggered by any probe.

## Real-hardware defect found and fixed (evidence)

The first AVFoundation call used the naive 4-char constant `@"auio"` for
the audio media type. The ObjC runtime rejected it:

```
NSInvalidArgumentException: *** +[AVCaptureDevice authorizationStatusForMediaType:]
The passed media type 'auio' is not supported
```

A Swift control (`AVCaptureDevice.authorizationStatus(for: .audio)`) returned
`raw=3` (Authorized) on this machine, proving the call shape was right and
the constant wrong. Corrected to the real `AVMediaTypeAudio` constant
`@"soun"` and wrapped the `msg_send` in `objc2::exception::catch` so any
future rejection degrades to `MicProbe { callable: false }` (mic treated
as unknown, typing remains available — spec 20), never an abort.

## Ownership boundary notes

- Window discovery/anchor geometry: WS-21 (`binding/macos`) — this crate
  consumes its confidence signal, never touches windows.
- TCC prompt UX: app layer at fan-in (this crate only reports status and
  provides the copy; spec 0.3 "only when needed").
- Window appearance/topmost: WS-07 (`src/window/**`) — this crate only
  decides which mode the app runs in.
- Session binding/routing: WS-03 — untouched; permissions never route.
- Microphone capture: WS-17 (`src-tauri/audio/capture/**`) — this crate
  reports mic status only; capture and its own permission handling stay
  in the capture lane.

## Handoff

Working tree only — no commit, no merge (builder discipline). QC may
build/test the crate directly:
`cd apps/candice-companion/src-tauri/permissions && cargo test && cargo test --features live && cargo clippy --features live --all-targets -- -D warnings && cargo run --features live --example status`.
