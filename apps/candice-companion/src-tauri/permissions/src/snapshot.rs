//! A single immutable snapshot of every permission state — what the app
//! renders in its permission row and what the decision engine consumes.
//! (Master Spec 0E WS-22.)

use crate::floating::{ModeDecision, WindowReachability};
use crate::permission::MicStatus;

/// Immutable view of all permission state at one moment.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PermissionSnapshot {
    /// `None` = not probed in this build/run (the `live` feature is off
    /// or the probe failed). The UI shows "not asked yet" and the mode
    /// decision treats it conservatively.
    pub accessibility_granted: Option<bool>,
    pub mic: MicStatus,
    /// Whether the live probe layer is present. When false the snapshot
    /// carries `None` accessibility and a synthetic mic status.
    pub probe_available: bool,
    /// What the WS-21 binding reported, if the app told us.
    pub window: WindowReachability,
}

impl PermissionSnapshot {
    /// Assemble the mode decision for this snapshot. Pure pass-through to
    /// `decide_mode` with the snapshot's fields; kept here so the app
    /// calls one function.
    pub fn decide(&self) -> ModeDecision {
        crate::floating::decide_mode(self.accessibility_granted, self.mic, self.window)
    }

    /// A conservative default snapshot for builds without the live
    /// feature: nothing known, mic undetermined, no window claim. The
    /// app may run entirely on this (floating mode) — spec 20.
    pub fn fallback() -> Self {
        PermissionSnapshot {
            accessibility_granted: None,
            mic: MicStatus::NotDetermined,
            probe_available: false,
            window: WindowReachability::Unconfirmed,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::floating::{CompanionMode, ModeDecisionKind};

    #[test]
    fn fallback_snapshot_is_conservative_and_non_blocking() {
        let s = PermissionSnapshot::fallback();
        assert!(s.accessibility_granted.is_none());
        assert_eq!(s.mic, MicStatus::NotDetermined);
        let d = s.decide();
        assert_eq!(d.mode, CompanionMode::Floating);
        assert_eq!(d.reason.kind, ModeDecisionKind::ProbeUnavailable);
    }

    #[test]
    fn snapshot_decision_forwarding_matches_decide_mode() {
        let s = PermissionSnapshot {
            accessibility_granted: Some(true),
            mic: MicStatus::Authorized,
            probe_available: true,
            window: WindowReachability::Anchored,
        };
        let d = s.decide();
        assert_eq!(d.mode, CompanionMode::Anchored);
    }
}
