//! Top-level-host-window discovery + selection (WS-26, spec 17).
//!
//! Windows Terminal tabs/panes mean one window can host several Claude
//! sessions. This module therefore resolves the VISUAL anchor only and
//! surfaces the multi-session ambiguity; it never decides which conversation
//! a message belongs to (that is the WS-03 bridge's job, from session proof).
//!
//! Selection order (deterministic, all decisions provenance-labeled):
//!
//! 1. OUR-CONSOLE WINDOW — a candidate that reports `owns_our_console`
//!    (backed by GetConsoleWindow on Windows). The strongest anchor: the
//!    companion runs inside the very console whose window this is.
//! 2. FOREGROUND HOST — the current foreground window, IF its process is a
//!    known terminal host (Windows Terminal / PowerShell / pwsh / cmd /
//!    console host) and it is live (not minimized, not cloaked). This is the
//!    "user is looking at this terminal" case.
//! 3. BACKGROUND HOST (visual-anchor-only) — the best-ranked host-like
//!    window in the snapshot. The app MUST NOT infer session identity from
//!    this pick; it is an anchor suggestion for the floating companion, and
//!    the WS-03 bridge still decides routing from session proof.
//!
//! Failure (spec 17, spec 20): no eligible window -> `NoneFound` with a
//! reason; the caller falls back to a movable floating companion and NEVER
//! stops the Claude session.

#![forbid(unsafe_code)]

use crate::model::{DiscoverVerdict, DiscoveryStrategy, HostKind, HostWindow, NoWindowReason};

/// Platform boundary for this crate (spec 18: platform modules implement
/// window tracking/anchoring).
///
/// `list_all` must return top-level, visible, unowned root windows with
/// populated rects (the backend performs the EnumWindows + visibility +
/// ownership filtering); ordering is unspecified — selection is by the
/// rules documented in the module header.
pub trait Win32WindowSource {
    /// Full snapshot of candidate top-level windows.
    fn list_all(&self) -> Vec<HostWindow>;

    /// The current foreground window, if obtainable (`None` = unavailable).
    fn foreground(&self) -> Option<HostWindow>;
}

/// A known terminal/console host window is eligible for the foreground pick.
fn is_host_kind(w: &HostWindow) -> bool {
    w.host_kind != HostKind::OpenWindow
}

/// Live test: visible on the current virtual desktop, not minimized, has a
/// non-empty rect.
fn is_live(w: &HostWindow) -> bool {
    w.cloaked != Some(true) && !w.minimized && !w.rect.is_empty()
}

/// Provenance-labeled selection. Pure: all input arrives through `source`.
pub fn discover_and_select<S: Win32WindowSource>(source: &S) -> DiscoverVerdict {
    let all = source.list_all();

    // 1. OUR-CONSOLE window: the one visual anchor that is self-proving.
    if let Some(w) = all.iter().find(|w| w.owns_our_console && is_live(w)) {
        return DiscoverVerdict::Found {
            chosen: w.clone(),
            candidates: all.clone(),
            strategy: DiscoveryStrategy::OurConsole,
            from_foreground: false,
        };
    }

    // 2. FOREGROUND host window (exact current-anchor case).
    if let Some(fg) = source.foreground() {
        if is_host_kind(&fg) && is_live(&fg) && fg.process_id != std::process::id() {
            return DiscoverVerdict::Found {
                chosen: fg,
                candidates: all.clone(),
                strategy: DiscoveryStrategy::ForegroundHost,
                from_foreground: true,
            };
        }
    }

    // 3. BACKGROUND best-ranked host (anchoring only — see module header).
    //    Only known terminal/console hosts are eligible: an unrelated
    //    (OpenWindow) window is never a host anchor — the caller then uses a
    //    movable floating companion (spec 17 fallback). Ranking favors live,
    //    multi-session-capable (Windows Terminal) windows; it is an anchor
    //    heuristic, never a routing fact.
    let rank = |w: &HostWindow| -> i32 {
        if !is_live(w) {
            return -10_000;
        }
        if w.host_kind == HostKind::OpenWindow {
            return -9_000; // ineligible as a host anchor
        }
        let mut score = 0;
        if w.host_kind.is_multi_session_host() {
            score += 8; // Windows Terminal is the primary host (spec 17)
        } else {
            score += 4;
        }
        if !w.monitor_work_area.is_empty() {
            score += 2;
        }
        if w.process_id == std::process::id() {
            score -= 4; // never anchor on our own process's windows
        }
        score
    };
    let mut ranked: Vec<&HostWindow> = all.iter().filter(|w| rank(w) > -9_000).collect();
    ranked.sort_by(|a, b| {
        rank(b).cmp(&rank(a)).then_with(|| {
            // tie-break: larger visible window first
            b.rect
                .height
                .cmp(&a.rect.height)
                .then_with(|| a.id.cmp(&b.id))
        })
    });

    if let Some(best) = ranked.first() {
        return DiscoverVerdict::Found {
            chosen: (*best).clone(),
            candidates: all.clone(),
            strategy: DiscoveryStrategy::MostRecentHost,
            from_foreground: false,
        };
    }

    let reason = if all.is_empty() {
        NoWindowReason::NoCandidate
    } else {
        NoWindowReason::NoEligibleHost
    };
    DiscoverVerdict::NoneFound { reason }
}
