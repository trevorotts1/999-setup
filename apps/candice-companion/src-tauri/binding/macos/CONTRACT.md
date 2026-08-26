# WS-21 Contract — macOS terminal-window discovery/binding

Owned glob (manifest 9.2): `apps/candice-companion/src-tauri/binding/macos/**`
Lane: WR-015 / WS-21. Deps: WS-03 (session bridge), WS-06 (Tauri shell).

## What this crate is

The macOS platform adapter that finds the terminal window the user invoked
the skill from (Terminal.app primary, iTerm2 supported) and computes the
rectangle where the Candice companion window anchors beside it.

## What this crate will NEVER do (binding rules)

1. **Route anything on a window.** Spec 17: the Claude session ID / bridge
   binding (WS-03) is the routing authority. Every type here is
   anchoring-only geometry/host metadata; the crate contains no routing
   decision, no injection, no message routing, no "foreground terminal"
   heuristics that could send an answer to the wrong session.
2. **Require the Accessibility permission.** Discovery reads the public
   window-server metadata API (`CGWindowListCopyWindowInfo`), which needs
   no TCC consent for owner/PID/bounds/layer/on-screen. The Accessibility
   path and the denied-access fallback (movable floating companion +
   plain-language explanation) are owned by WR-015 / WS-22.
3. **Panic or throw across the bridge.** All entries are total: the live
   read returns `Result`, discovery always returns a `WindowMatches` with
   a `None` confidence when nothing credible is found, and the anchor
   math degrades to a marked fallback. Spec 20: no Candice failure stops
   Claude.

## Behavior contract (CHECKLIST E.1 WS-21)

Evidence-grader checklist — each item maps to a test:

| Requirement (spec 17) | Where it lives | Test |
|---|---|---|
| Terminal.app is the primary target | `host.rs` classify | `terminal_is_classified_by_owner_name` |
| iTerm2 supported where installed | `host.rs` classify | `iterm2_accepts_both_owner_names`, `iterm2_is_a_candidate` |
| Other hosts reported, never bound as supported | `host.rs` | `unknown_hosts_are_not_an_error`, `unsupported_hosts_are_ignored` |
| Window owner/PID/bounds via public window-server API | `probe.rs` (live-probe feature) | compiles + live run on hardware |
| Anchor beside the terminal (default: right, 12pt gap) | `anchor.rs` | `default_policy_places_companion_to_the_right` |
| Follow move/resize (recompute on change → same math) | `anchor.rs` | side/offset tests |
| Follow monitor changes (per-display frame, clamp) | `anchor.rs` | `user_offset_is_applied_then_clamped`, `flips_to_opposite_side_when_no_room` |
| Hide/dim when terminal minimized or off-screen | `discover.rs` (on-screen filter) + app host-state logic | `off_screen_windows_are_ignored` |
| User repositioning honored | `anchor.rs` user offset | `user_offset_is_applied_then_clamped` |
| Remember preferred offset | persisted by app (offset is an input, not a policy write) | `user_offset_is_applied_then_clamped` |
| Permission denied → movable floating companion, Claude never stops | out-of-crate (WS-22 owns); this crate returns `None` confidence instead of erroring | `empty_list_is_not_fatal` |
| Host window placement never equals session identity | crate has no session concept at all (0C separation) | code inspection: no routing surface |

## Feature flags

- `default` (empty): pure logic, fixture-tested, no OS permission, no
  network, no window-server call. `cargo test` / `cargo clippy` green
  everywhere.
- `live-probe`: enables `core-graphics` + `core-foundation` and the real
  `read_window_records()` (decode of `kCGWindow*` keys). Used by
  `examples/probe.rs` and by CI smoke tests on real Mac hardware; the
  runtime app crate wires this feature at fan-in (9.3 integration owner).

## Live-probe privacy note

`kCGWindowName` (titles) is gated behind Screen Recording consent on
macOS 10.15+. This crate never depends on titles: matching uses owner
name/PID/bounds only. Titles are read when present, ignored when absent.

## Provenance / evidence (2026-08-21)

- `cargo test` (default): 35 passed, 0 failed.
- `cargo test --features live-probe`: 35 passed, 0 failed.
- `cargo clippy --features live-probe --all-targets -- -D warnings`: 0
  errors/warnings.
- Live probe run on this Mac (Terminal.app running, PID 469):
  `window-count=0` with exit 0 — the probe binary has no Screen Recording
  consent, so the window-server metadata API returns only its own
  (empty) window list; the crate degrades to `confidence=None`, `anchor=none`
  and exits cleanly. This is the documented, non-blocking path (spec 20):
  the companion falls back to floating mode until consent is granted via
  the WS-22 permission flow.
