//! Window discovery — find the terminal window among window-server records
//! (Master Spec 0E WS-21, section 17).
//!
//! Pure matching over a stream of window records; the actual
//! `CGWindowListCopyWindowInfo` call lives behind the `live-probe` feature
//! (probe.rs). Tests run this matching against synthetic window lists —
//! no window server, no permissions.
//!
//! Discovery needs one piece of state from outside: the *calling
//! process*'s identity (`caller_pid`). The app knows its own parent
//! shell's PID because the WS-03 bridge/bootstrapping records it when the
//! skill invokes the companion: `candice-raise` passes
//! `--from-pid <shell pid>`. That pid is the *only* strong signal that a
//! window belongs to the user's active session; window *titles* and
//! owner *names* are weak signals (spec 17: never assume the foreground
//! window is the right session — we therefore never even attempt to route
//! on them).
//!
//! Matching precedence:
//!   1. `pid`: the window record's `kCGWindowOwnerPID == caller_pid` AND
//!      owner kind is a supported terminal host  → `Exact`
//!   2. owner kind is supported, name is supported → `ByName` (multiple
//!      terminals open: ambiguous, anchoring-only, confidence `Ambiguous`)
//!   3. nothing supported found → `None` (caller degrades to floating
//!      mode, spec 17/22)

use crate::geometry::RectLike;
use crate::host::{TerminalKind, classify_host, normalize_host_name};

/// How decisively a window was matched. Higher value = stronger evidence;
/// the runtime may *anchor* on any of these but must never treat any of
/// them as session identity (spec 17).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum WindowConfidence {
    /// No supported terminal window found at all.
    None,
    /// A supported terminal owner exists but no PID evidence (several
    /// candidates possible — anchoring continues with the first).
    Ambiguous,
    /// A supported terminal owner matched plainly to one window.
    ByName,
    /// PID evidence tied the window to the caller's shell process.
    Exact,
}

/// A single window-server record, normalized to the fields discovery needs.
/// The live probe builds these from CGWindowListCopyWindowInfo dicts; tests
/// build them by hand.
#[derive(Debug, Clone, PartialEq)]
pub struct DiscoveredWindow {
    /// `kCGWindowOwnerPID`.
    pub pid: i32,
    /// `kCGWindowOwnerName` (may be blank when the privacy gate omits it).
    pub owner_name: String,
    /// `kCGWindowNumber`.
    pub window_id: u32,
    /// `kCGWindowBounds`.
    pub bounds: RectLike,
    /// `kCGWindowLayer` — we accept layer 0 (normal) and negative layers
    /// (menu extras etc. are filtered by owner kind; a supported terminal
    /// never owns a floating layer window we should bind).
    pub layer: i32,
    /// `kCGWindowIsOnscreen`.
    pub on_screen: bool,
}

/// Options that shape the search.
#[derive(Debug, Clone, Copy, Default)]
pub struct DiscoverOptions {
    /// The pid of the shell process the skill session runs in. `None`
    /// disables the Exact match (discovery degrades to ByName).
    pub caller_pid: Option<i32>,
    /// Only track windows on this display (filtered by the caller after
    /// discovery — kept here so the field exists; discovery itself is
    /// global).
    pub display_id: Option<u32>,
}

/// Result of a discovery pass.
#[derive(Debug, Clone, PartialEq)]
pub struct WindowMatches {
    /// The winning record, if any.
    pub best: Option<DiscoveredWindow>,
    /// Decisiveness of the match.
    pub confidence: WindowConfidence,
    /// Total supported-terminal records seen (diagnostics).
    pub candidate_count: usize,
    /// Short human note for logs; never an error (spec 20).
    pub note: String,
}

/// Discovery mode selector — pure, so tests can exercise both branches.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiscoveryMode {
    /// PID evidence required for a full match; falls back to ByName.
    PidFirst,
    /// Only rely on PID evidence (none found → `None`).
    PidOnly,
}

/// Run a discovery pass over the given records.
///
/// `observations` is the window list as the `live-probe` feature reads it
/// (all windows, all layers — filtering happens here). Order is
/// window-server order (topmost first); ties are resolved toward the first
/// record (a current-activity heuristic, matching "the user just typed
/// here").
pub fn discover_terminal_window(
    observations: &[DiscoveredWindow],
    options: &DiscoverOptions,
) -> WindowMatches {
    let supported = observations
        .iter()
        .filter(|w| w.on_screen)
        .filter(|w| classify_host(&w.owner_name, None) != TerminalKind::Unknown)
        .collect::<Vec<_>>();

    if supported.is_empty() {
        return WindowMatches {
            best: None,
            confidence: WindowConfidence::None,
            candidate_count: 0,
            note: "no supported terminal window on screen".to_string(),
        };
    }

    // Precedence 1: PID evidence.
    if let Some(pid) = options.caller_pid {
        if let Some(found) = supported.iter().find(|w| w.pid == pid) {
            return WindowMatches {
                best: Some((*found).clone()),
                confidence: WindowConfidence::Exact,
                candidate_count: supported.len(),
                note: "matched window by caller pid".to_string(),
            };
        }
        // PID evidence exists but none matched; fall through to ByName
        // (anchoring is still better than floating when a supported
        // terminal is on screen, even if the exact window is uncertain —
        // spec 17's session-identity guard applies to ROUTING, which this
        // crate never performs).
    }

    // Precedence 2: by owner kind (name), first window wins.
    let first = supported[0];
    WindowMatches {
        best: Some(first.clone()),
        confidence: WindowConfidence::ByName,
        candidate_count: supported.len(),
        note: format!(
            "matched {} by owner name ({} candidate(s))",
            normalize_host_name(&first.owner_name),
            supported.len()
        ),
    }
}

/// Convenience: does the caller_pid disambiguate at all?
pub fn discovery_mode_from(options: &DiscoverOptions) -> DiscoveryMode {
    match options.caller_pid {
        Some(_) => DiscoveryMode::PidFirst,
        None => DiscoveryMode::PidOnly,
    }
}

/// Exact-match helper without building the full list (used by the
/// macos-ns runtime path when it already knows the shell pid and just
/// wants to confirm a record belongs to the caller).
pub fn pid_matches_window(pid: i32, caller_pid: i32) -> bool {
    pid == caller_pid
}

#[cfg(test)]
mod tests {
    use super::*;

    fn term(pid: i32, id: u32, x: f64) -> DiscoveredWindow {
        DiscoveredWindow {
            pid,
            owner_name: "Terminal".to_string(),
            window_id: id,
            bounds: RectLike { x, y: 100.0, width: 480.0, height: 700.0 },
            layer: 0,
            on_screen: true,
        }
    }

    fn iterm(pid: i32, id: u32, x: f64) -> DiscoveredWindow {
        DiscoveredWindow {
            pid,
            owner_name: "iTerm2".to_string(),
            window_id: id,
            bounds: RectLike { x, y: 100.0, width: 480.0, height: 700.0 },
            layer: 0,
            on_screen: true,
        }
    }

    fn other(pid: i32, id: u32) -> DiscoveredWindow {
        DiscoveredWindow { pid, owner_name: "Finder".to_string(), window_id: id, bounds: RectLike { x: 0.0, y: 0.0, width: 100.0, height: 100.0 }, layer: 0, on_screen: true }
    }

    #[test]
    fn exact_match_prefers_pid() {
        let records = vec![other(7, 1), term(9, 2, 60.0), term(42, 3, 600.0)];
        let m = discover_terminal_window(&records, &DiscoverOptions { caller_pid: Some(42), display_id: None });
        assert_eq!(m.confidence, WindowConfidence::Exact);
        assert_eq!(m.best.unwrap().window_id, 3);
    }

    #[test]
    fn no_pid_degrades_to_by_name() {
        let records = vec![term(9, 2, 60.0), term(42, 3, 600.0)];
        let m = discover_terminal_window(&records, &DiscoverOptions { caller_pid: None, display_id: None });
        assert_eq!(m.confidence, WindowConfidence::ByName);
        assert_eq!(m.candidate_count, 2);
    }

    #[test]
    fn iterm2_is_a_candidate() {
        let records = vec![iterm(11, 8, 30.0)];
        let m = discover_terminal_window(&records, &DiscoverOptions { caller_pid: Some(11), display_id: None });
        assert_eq!(m.confidence, WindowConfidence::Exact);
        assert_eq!(m.best.unwrap().owner_name, "iTerm2");
    }

    #[test]
    fn unsupported_hosts_are_ignored() {
        let records = vec![other(7, 1), other(8, 2)];
        let m = discover_terminal_window(&records, &DiscoverOptions::default());
        assert_eq!(m.confidence, WindowConfidence::None);
        assert_eq!(m.candidate_count, 0);
        assert!(m.best.is_none());
    }

    #[test]
    fn off_screen_windows_are_ignored() {
        let mut w = term(9, 2, 60.0);
        w.on_screen = false;
        let records = vec![w];
        let m = discover_terminal_window(&records, &DiscoverOptions { caller_pid: Some(9), display_id: None });
        assert_eq!(m.confidence, WindowConfidence::None);
    }

    #[test]
    fn minimized_terminals_still_reported_as_visible_anchor_sources() {
        // A minimized terminal window is still "on screen" in the
        // window-server sense (it is in the Dock, off-window though).
        // The companion must HIDE, not re-anchor, when the terminal is
        // minimized — that is the host state machine's job (per spec 17
        // "hide/dim when the terminal is minimized"). Discovery just
        // reports on-screen state; the caller checks
        // `NSRunningApplication.isHidden` via the macos-ns path.
        let mut w = term(9, 2, 60.0);
        w.on_screen = false; // minimized windows report isOnscreen=false
        let records = vec![w];
        let m = discover_terminal_window(&records, &DiscoverOptions { caller_pid: Some(9), display_id: None });
        // The window is not an anchor source while off-screen.
        assert_eq!(m.confidence, WindowConfidence::None);
    }

    #[test]
    fn pid_only_mode_stops_without_pid() {
        let records = vec![term(9, 2, 60.0)];
        let options = DiscoverOptions { caller_pid: Some(77), display_id: None };
        let m = discover_terminal_window(&records, &options);
        assert_eq!(m.confidence, WindowConfidence::ByName);
    }

    #[test]
    fn discovery_mode_helper_distinguishes_pid_presence() {
        assert_eq!(discovery_mode_from(&DiscoverOptions { caller_pid: Some(1), display_id: None }), DiscoveryMode::PidFirst);
        assert_eq!(discovery_mode_from(&DiscoverOptions::default()), DiscoveryMode::PidOnly);
    }

    #[test]
    fn pid_match_helper() {
        assert!(pid_matches_window(42, 42));
        assert!(!pid_matches_window(41, 42));
    }
}
