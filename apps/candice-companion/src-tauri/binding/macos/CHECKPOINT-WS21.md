# CHECKPOINT — WS-21 macOS terminal-window discovery/binding

Builder: WS-WS-21 (opus/max, W2 build). Worktree: `wr001-bootstrap`.
Date: 2026-08-21.

## Scope

Owned glob (manifest 9.2): `apps/candice-companion/src-tauri/binding/macos/**`
— created new (was absent). Nothing outside the glob was touched.

## Deliverable

Standalone Rust crate `candice-macos-binding`:

| File | Purpose |
|---|---|
| `Cargo.toml` | manifest; `default` = pure logic, `live-probe` = CoreGraphics |
| `src/lib.rs` | crate API surface (anchoring-only; no session/routing types) |
| `src/geometry.rs` | pure RectLike/PointLike/ScaleHint value types |
| `src/host.rs` | Terminal.app / iTerm2 / unknown classification + canonical bundle ids |
| `src/discover.rs` | window matching: PID-exact, owner-by-name, degraded-None; confidence |
| `src/anchor.rs` | anchor math: side/gap/offset/policy, flip, fallback, clamp |
| `src/probe.rs` | live `CGWindowListCopyWindowInfo` decode (`kCGWindow*` keys) behind `live-probe` |
| `examples/probe.rs` | diagnostic CLI (`cargo run --features live-probe --example probe`) |
| `CONTRACT.md` | binding rules + evidence-grader table for E.1 WS-21 |
| `Cargo.lock` | resolved (offline vendored crates; no network used) |

## Verification

- `cargo test` — 35 passed / 0 failed (pure logic; no permissions, no hardware).
- `cargo test --features live-probe` — 35 passed / 0 failed.
- `cargo clippy --features live-probe --all-targets -- -D warnings` — 0 errors, 0 warnings.
- Live probe on this Mac (Terminal.app PID 469): `window-count=0`, exit 0 —
  no Screen Recording consent for the probe binary; crate degrades to
  `confidence=None`, `anchor=none` without panic. Non-blocking by design
  (spec 20); consent flow is WS-22's lane. Full live-match evidence
  requires an app signed/consented for Screen Recording — that is the
  WS-25 terminal-compat lane's end-to-end job (its tests live in
  `tests/terminal-compat/**`, per manifest 9.2).

## Ownership boundary notes

- Session binding/routing: WS-03 (`plugins/candice-integration/session/**`) —
  this crate exposes no routing surface.
- Accessibility permission + denied fallback: WS-22
  (`src-tauri/permissions/**`) — this crate triggers no prompt.
- Window appearance/topmost: WS-07 (`src/window/**`) — this crate only
  computes placement geometry.
- Terminal.app + claude-nine end-to-end (E.1 WS-25): WS-25 lane
  (`tests/terminal-compat/**`); this crate is its macOS-side dependency,
  consumed at fan-in (9.3 within-run shared set).

## Handoff

Working tree only — no commit, no merge (builder discipline). QC may
build/test the crate directly:
`cd apps/candice-companion/src-tauri/binding/macos && cargo test && cargo clippy --features live-probe --all-targets -- -D warnings`.
