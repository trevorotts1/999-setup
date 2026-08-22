//! macOS terminal-window discovery/binding — Candice Companion
//! (Master Spec 0E WS-21, sections 12 / 17 / 27 / 28).
//!
//! Owned by WR-015 lane (ownership map 9.2):
//! `apps/candice-companion/src-tauri/binding/macos/**`.
//!
//! This crate discovers the terminal window the user invoked the skill
//! from (Terminal.app and iTerm2 are the supported hosts; other hosts are
//! reported as `unknown`) and computes an anchor rectangle for the
//! companion window beside it.
//!
//! Spec 17 is explicit and binding about separation of concerns:
//!
//!   - the Claude **session ID / bridge binding** (WS-03) is the authority
//!     for which conversation Candice belongs to — never a window;
//!   - the top-level host window is used **only for visual anchoring**;
//!   - never assume "foreground window" means "correct Claude session".
//!
//! Therefore every entry point in this crate is anchoring-only: the window
//! match produces geometry and host metadata, never a routing decision.
//! Routing stays in `plugins/candice-integration/session/bridge` (WS-03).
//!
//! Permission model (spec 17/20/22): discovery runs on the public
//! window-server metadata API (`CGWindowListCopyWindowInfo`) which needs
//! no Accessibility permission; window-list visibility under macOS 10.15+
//! requires Screen Recording consent for *other apps'* window *titles*
//! only — owner name, PID, bounds, layer and on-screen state remain
//! available without it. The binding therefore never *requires* the
//! Accessibility permission; the frontmost check and title-based matching
//! (`kCGWindowName`) consume optional metadata and degrade to
//! `None`/`unknown` when it is absent (spec 20: no Candice failure may
//! stop Claude).
//!
//! Failure isolation: all entry points are total — a failed probe returns
//! an `Err(String)` or a conservative fallback, never a panic and never a
//! throw. Tests need no OS permissions and no hardware.

mod anchor;
mod discover;
mod geometry;
mod host;
mod probe;

pub use anchor::{
    AnchorPolicy, AnchorRect, AnchorSide, AnchorSpec, CompanionSize, compute_anchor,
    sanitize_terminal_bounds, DEFAULT_ANCHOR_POLICY,
};
pub use discover::{
    DiscoverOptions, DiscoveredWindow, DiscoveryMode, WindowConfidence, WindowMatches,
    discover_terminal_window, discovery_mode_from, pid_matches_window,
};
pub use geometry::{CgRectLike, DisplayId, PointLike, RectLike, ScaleHint};
pub use host::{
    TerminalHost, TerminalKind, classify_host, host_bundle_id, host_kind_id, host_window_title,
    matches_host_kind, normalize_host_name,
};
// The live window-server read is only available with the `live-probe`
// feature; the crate always builds and tests without it.
#[cfg(feature = "live-probe")]
pub use probe::read_window_records;
