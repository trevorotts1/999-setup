# candice-macos-binding — WS-21 macOS terminal-window discovery/binding

Part of WR-015 (candice-macos) of the Candice Companion build. Owned glob:
`apps/candice-companion/src-tauri/binding/macos/**`.

## What it does

Finds the terminal window the user invoked the skill from and computes the
anchor rectangle for the companion window beside it.

- **Terminal.app** — mandatory primary target.
- **iTerm2** — supported where installed.
- Any other host — reported as `unknown`, never bound as supported.

It reads the public window-server metadata API
(`CGWindowListCopyWindowInfo`) — owner PID, owner name, bounds, layer,
on-screen state — which needs **no Accessibility permission** and no
Screen Recording consent for those keys.

It performs **visual anchoring only**. Session routing is the WS-03 bridge's
job; this crate has no routing surface (spec 17).

## Quick start

```sh
cargo test                              # 35 tests, no permissions needed
cargo test --features live-probe        # same tests + live feature compiles
cargo clippy --features live-probe --all-targets -- -D warnings

# Live probe (diagnostic; needs Screen Recording consent to see other
# apps' windows — without it the window list comes back empty, which is a
# clean graceful path, spec 20):
cargo run --features live-probe --example probe -- --from-pid <shell-pid>
```

The runtime app (Tauri shell, WR-012 lane) wires this crate at fan-in with
`--features live-probe`.

## Layout

| Module | Owns |
|---|---|
| `geometry.rs` | pure value types (RectLike/PointLike/ScaleHint) |
| `host.rs` | host classification (Terminal.app / iTerm2 / unknown) |
| `discover.rs` | matching (PID-exact → owner-by-name → none) + confidence |
| `anchor.rs` | placement math (side/gap/offset, flip, fallback, clamp) |
| `probe.rs` | live `CGWindowListCopyWindowInfo` decode (behind `live-probe`) |

## Design rules (binding)

1. Anchoring-only. Never route on a window (spec 17).
2. No TCC prompt of its own. Accessibility is WS-22's lane.
3. Total functions: degrade to `None`/fallback, never panic (spec 20).
4. Titles are optional metadata (Screen Recording gate on 10.15+); never
   required for matching.

See `CONTRACT.md` for the evidence-grader checklist and CB explanation
rules, and `CHECKPOINT-WS21.md` for build provenance.
