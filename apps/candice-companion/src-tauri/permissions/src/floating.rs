//! Companion mode decision — the heart of WS-22 (Master Spec 0E WS-22,
//! spec 17: "If Accessibility permission is denied: do not stop Claude,
//! run Candice as a movable independent floating companion, explain the
//! optional permission in plain language").
//!
//! This module is pure: it takes what the platform tells us (permission
//! states + window reachability) and returns a mode. The app renders the
//! mode; it never re-derives policy. All inputs are optional so the
//! decision is total — a missing probe must not crash or block the app
//! (spec 20).

use crate::permission::MicStatus;

/// Whether the WS-21 binding can currently see/attach to the terminal.
/// The binding crate deliberately returns `None` confidence rather than
/// erroring when it cannot see a window (no Screen Recording consent,
/// Accessibility not granted, headless session). That `None` is this
/// enum's `Unconfirmed`/`NotFound`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowReachability {
    /// The binding produced a confident window match; anchoring is
    /// possible and reliable.
    Anchored,
    /// The binding sees no window but the OS still exposes one (e.g.
    /// window titles unavailable without consent, or the app has not
    /// yet been granted Accessibility). Anchoring may improve later.
    Unconfirmed,
    /// The binding explicitly found no usable terminal window.
    NotFound,
}

/// The two runtime modes WS-22 distinguishes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompanionMode {
    /// Anchored beside the bound terminal window (WS-21 geometry).
    Anchored,
    /// Movable independent floating companion (Accessibility denied or
    /// the terminal cannot be anchored to). The fallback is a designed
    /// first-class mode, never an error state (spec 17).
    Floating,
}

/// The precise reason a mode was chosen — used by the app for the
/// permission row and by tests to prove every branch is reachable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModeDecisionKind {
    /// Accessibility granted and a window match confirmed.
    Anchored,
    /// Accessibility denied → floating, with the notice (spec 17).
    AccessibilityDenied,
    /// Accessibility granted but no window found (headless, window
    /// server unreachable) → floating rather than blocking.
    NoWindowFound,
    /// No live probe result in this build (feature `live` off) →
    /// conservative floating until the app probes.
    ProbeUnavailable,
}

/// The full decision detail the app renders.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModeDecision {
    pub mode: CompanionMode,
    /// Why — kept separate from `mode` so the UI can show a specific
    /// plain-language explanation without re-deriving policy.
    pub reason: ModeReason,
}

/// Human-readable reason data: the input states plus the kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModeReason {
    pub accessibility_granted: bool,
    pub mic: MicStatus,
    pub window: WindowReachability,
    pub kind: ModeDecisionKind,
}

/// Decide the companion mode from permission + window state. Total:
/// every input combination yields a decision; none blocks Claude.
///
/// Policy:
/// 1. Accessibility denied (or unknown when the probe exists) → Floating
///    with the notice (spec 17).
/// 2. Accessibility granted but no window confirmed → Floating (anchoring
///    without a target is meaningless; the companion must stay usable).
/// 3. Otherwise → Anchored.
pub fn decide_mode(
    accessibility_granted: Option<bool>,
    mic: MicStatus,
    window: WindowReachability,
) -> ModeDecision {
    let (mode, kind) = match accessibility_granted {
        None => (CompanionMode::Floating, ModeDecisionKind::ProbeUnavailable),
        Some(false) => (
            CompanionMode::Floating,
            ModeDecisionKind::AccessibilityDenied,
        ),
        Some(true) => match window {
            WindowReachability::Anchored => (CompanionMode::Anchored, ModeDecisionKind::Anchored),
            WindowReachability::Unconfirmed | WindowReachability::NotFound => {
                (CompanionMode::Floating, ModeDecisionKind::NoWindowFound)
            }
        },
    };

    ModeDecision {
        mode,
        reason: ModeReason {
            accessibility_granted: accessibility_granted.unwrap_or(false),
            mic,
            window,
            kind,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accessibility_denied_always_floats() {
        for w in [
            WindowReachability::Anchored,
            WindowReachability::Unconfirmed,
            WindowReachability::NotFound,
        ] {
            let d = decide_mode(Some(false), MicStatus::Authorized, w);
            assert_eq!(d.mode, CompanionMode::Floating);
            assert_eq!(d.reason.kind, ModeDecisionKind::AccessibilityDenied);
            assert!(!d.reason.accessibility_granted);
        }
    }

    #[test]
    fn accessibility_unknown_always_floats_without_claiming() {
        // No probe result → float; the UI must not present a permission
        // decision it does not have.
        let d = decide_mode(None, MicStatus::Authorized, WindowReachability::Anchored);
        assert_eq!(d.mode, CompanionMode::Floating);
        assert_eq!(d.reason.kind, ModeDecisionKind::ProbeUnavailable);
    }

    #[test]
    fn granted_plus_anchored_window_anchors() {
        let d = decide_mode(Some(true), MicStatus::Authorized, WindowReachability::Anchored);
        assert_eq!(d.mode, CompanionMode::Anchored);
        assert_eq!(d.reason.kind, ModeDecisionKind::Anchored);
        assert!(d.reason.accessibility_granted);
    }

    #[test]
    fn granted_but_no_window_floats() {
        for w in [WindowReachability::Unconfirmed, WindowReachability::NotFound] {
            let d = decide_mode(Some(true), MicStatus::Authorized, w);
            assert_eq!(d.mode, CompanionMode::Floating);
            assert_eq!(d.reason.kind, ModeDecisionKind::NoWindowFound);
        }
    }

    #[test]
    fn mic_status_does_not_change_mode() {
        // Microphone denial is handled by the capture lane (typing
        // remains); it never downgrades the window mode.
        for mic in [
            MicStatus::NotDetermined,
            MicStatus::Denied,
            MicStatus::Restricted,
            MicStatus::Authorized,
        ] {
            let d = decide_mode(Some(true), mic, WindowReachability::Anchored);
            assert_eq!(d.mode, CompanionMode::Anchored);
            let d2 = decide_mode(Some(false), mic, WindowReachability::Anchored);
            assert_eq!(d2.mode, CompanionMode::Floating);
        }
    }

    #[test]
    fn decision_is_total_over_all_input_combinations() {
        // 3 x 4 x 3 = 36 combinations; every one yields a decision.
        let mut count = 0;
        for a in [None, Some(false), Some(true)] {
            for mic in [
                MicStatus::NotDetermined,
                MicStatus::Denied,
                MicStatus::Restricted,
                MicStatus::Authorized,
            ] {
                for w in [
                    WindowReachability::Anchored,
                    WindowReachability::Unconfirmed,
                    WindowReachability::NotFound,
                ] {
                    let d = decide_mode(a, mic, w);
                    assert!(matches!(
                        d.mode,
                        CompanionMode::Anchored | CompanionMode::Floating
                    ));
                    count += 1;
                }
            }
        }
        assert_eq!(count, 36);
    }

    #[test]
    fn anchored_requires_granted_plus_confirmed_window() {
        // The only Anchored path is granted + Anchored. Prove the other
        // eight granted combos are Floating.
        let granted_combos: Vec<(Option<bool>, WindowReachability)> = vec![
            (None, WindowReachability::Anchored),
            (None, WindowReachability::Unconfirmed),
            (None, WindowReachability::NotFound),
            (Some(false), WindowReachability::Anchored),
            (Some(false), WindowReachability::Unconfirmed),
            (Some(false), WindowReachability::NotFound),
            (Some(true), WindowReachability::Unconfirmed),
            (Some(true), WindowReachability::NotFound),
        ];
        for (a, w) in granted_combos {
            let d = decide_mode(a, MicStatus::Authorized, w);
            assert_eq!(d.mode, CompanionMode::Floating, "a={a:?} w={w:?}");
        }
    }
}
