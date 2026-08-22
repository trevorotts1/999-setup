# candice-macos-permissions — WS-22 macOS permissions + degraded floating mode

Part of WR-015 (candice-macos) of the Candice Companion build. Owned glob:
`apps/candice-companion/src-tauri/permissions/**`.

## What it does

Owns the macOS permission model and the degraded floating companion
policy (Master Spec 0E WS-22, spec 0.3 / 17 / 20):

- **Permission status model** — Accessibility, microphone, and Screen
  Recording states in one stable representation (`PermissionKind`,
  `MicStatus`).
- **Plain-language copy** — the exact strings shown when a permission is
  asked for and when floating mode is active (`copy.rs`). Every string
  states what is asked, why, and what works without it.
- **Mode decision** — anchored vs. movable floating companion from
  permission + window-reachability inputs (`floating.rs`). Accessibility
  denied → floating, Claude never stops.
- **Live probes** (`live` feature, read-only, no prompts):
  - Accessibility: `AXIsProcessTrusted()`
  - Screen Recording: `CGPreflightScreenCaptureAccess()`
  - Microphone: `[AVCaptureDevice authorizationStatusForMediaType:]`
    (via objc2, exception-caught)

This crate never prompts. Prompts are the app layer's UX job — this
crate reports status and supplies the copy the app shows (spec 0.3:
"request ... only when needed").

## Quick start

```sh
cargo test                              # 20 tests, no permissions needed
cargo test --features live              # 21 tests + live probes compile
cargo clippy --features live --all-targets -- -D warnings

# Diagnostic (read-only status dump, real TCC state):
cargo run --features live --example status
```

The runtime app (Tauri shell, WR-012 lane) wires this crate at fan-in
with `--features live`.

## Layout

| Module | Owns |
|---|---|
| `permission.rs` | `PermissionKind` / `MicStatus` model + raw-status mapping |
| `floating.rs` | `CompanionMode` / `ModeDecision` / `decide_mode` policy |
| `copy.rs` | plain-language copy (single home for the strings) |
| `snapshot.rs` | `PermissionSnapshot` — one immutable view of all state |
| `live.rs` | real macOS probes behind the `live` feature (read-only) |
| `examples/status.rs` | diagnostic CLI (`cargo run --features live --example status`) |

## Design rules (permissions)

1. Read-only probes only; never prompt from the crate (spec 0.3).
2. Total functions: degrade to conservative readings, never panic;
   ObjC exceptions are caught, never allowed to unwind (spec 20).
3. Anchoring is WS-21's lane; this crate only decides the mode.
4. Copy has exactly one home — the UI renders, never rewrites.

See `CONTRACT.md` for the evidence-grader checklist and `CHECKPOINT-WS22.md`
for build provenance.
