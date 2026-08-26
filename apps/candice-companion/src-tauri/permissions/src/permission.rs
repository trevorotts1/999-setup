//! Permission status model (Master Spec 0E WS-22).
//!
//! The three macOS permissions Candice can need, and a stable machine
//! representation of each TCC state that the UI can render without
//! knowing macOS internals.

/// The macOS permission kinds Candice can require.
///
/// - `Accessibility`: window tracking/anchoring (WS-21 binding reads
///   public window-server metadata without it, but frontmost/AX tracking
///   and live anchoring need it). Denied → floating mode (spec 17).
/// - `Microphone`: push-to-talk capture (WS-17). Denied → typing remains
///   available (spec 20).
/// - `ScreenRecording`: window titles and other apps' on-screen window
///   names are gated behind Screen Recording consent on macOS 10.15+
///   (WS-21 probe). Optional metadata only — never required for matching.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PermissionKind {
    Accessibility,
    Microphone,
    ScreenRecording,
}

impl PermissionKind {
    /// Stable machine key for preferences/telemetry (no display text —
    /// display strings live in `copy.rs` so the UI can reword freely).
    pub fn key(self) -> &'static str {
        match self {
            PermissionKind::Accessibility => "accessibility",
            PermissionKind::Microphone => "microphone",
            PermissionKind::ScreenRecording => "screen-capture",
        }
    }

    /// Whether this permission gates an optional capability (true) or a
    /// core path (false). Accessibility is optional by design (spec 17
    /// fallback); Screen Recording is optional metadata (WS-21); the
    /// microphone is optional because typing always remains (spec 20).
    /// No permission in Candice is ever required for Claude to work.
    pub fn is_optional_capability(self) -> bool {
        true
    }
}

/// Microphone permission states, mapped 1:1 from
/// `AVCaptureDevice.authorizationStatusForMediaType(AVMediaTypeAudio)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MicStatus {
    /// NotDetermined — macOS has not asked this app yet. The app may
    /// request when the user first presses HOLD TO TALK.
    NotDetermined,
    /// The app is not authorized for microphone capture (never was, or
    /// the user revoked it). Typing must remain available (spec 20).
    Denied,
    /// Restriction (MDM/parental control): the user cannot grant access.
    Restricted,
    /// Authorized: capture may start.
    Authorized,
}

impl MicStatus {
    /// Whether capture may start right now.
    pub fn can_record(self) -> bool {
        matches!(self, MicStatus::Authorized)
    }

    /// Whether a request could change the state (macOS allows prompting
    /// only from NotDetermined).
    pub fn can_prompt(self) -> bool {
        matches!(self, MicStatus::NotDetermined)
    }
}

/// Maps the raw AVFoundation status integer (0 NotDetermined, 1
/// Restricted, 2 Denied, 3 Authorized) to our enum. Total: any value
/// outside 0..=3 maps to `Denied` (the conservative, non-blocking
/// reading — the app falls back to typing, which is always safe).
pub fn mic_status_from_raw(raw: i32) -> MicStatus {
    match raw {
        0 => MicStatus::NotDetermined,
        1 => MicStatus::Restricted,
        2 => MicStatus::Denied,
        3 => MicStatus::Authorized,
        _ => MicStatus::Denied,
    }
}

/// Short human label for the status (used in the app's permission row;
/// the longer explanation copy lives in `copy.rs`).
pub fn mic_status_label(status: MicStatus) -> &'static str {
    match status {
        MicStatus::NotDetermined => "Not asked yet",
        MicStatus::Denied => "Denied",
        MicStatus::Restricted => "Restricted by policy",
        MicStatus::Authorized => "Allowed",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_have_stable_keys() {
        assert_eq!(PermissionKind::Accessibility.key(), "accessibility");
        assert_eq!(PermissionKind::Microphone.key(), "microphone");
        assert_eq!(PermissionKind::ScreenRecording.key(), "screen-capture");
    }

    #[test]
    fn no_permission_is_required_for_the_core_flow() {
        for kind in [
            PermissionKind::Accessibility,
            PermissionKind::Microphone,
            PermissionKind::ScreenRecording,
        ] {
            assert!(kind.is_optional_capability());
        }
    }

    #[test]
    fn raw_status_mapping_matches_avfoundation() {
        assert_eq!(mic_status_from_raw(0), MicStatus::NotDetermined);
        assert_eq!(mic_status_from_raw(1), MicStatus::Restricted);
        assert_eq!(mic_status_from_raw(2), MicStatus::Denied);
        assert_eq!(mic_status_from_raw(3), MicStatus::Authorized);
    }

    #[test]
    fn unknown_raw_status_degrades_to_denied_not_panic() {
        // Any future/unknown value must land on the conservative,
        // non-blocking reading (spec 20): typing stays available.
        for raw in [-1, 4, 99, i32::MIN, i32::MAX] {
            assert_eq!(mic_status_from_raw(raw), MicStatus::Denied);
        }
    }

    #[test]
    fn only_authorized_can_record() {
        assert!(MicStatus::Authorized.can_record());
        for s in [
            MicStatus::NotDetermined,
            MicStatus::Denied,
            MicStatus::Restricted,
        ] {
            assert!(!s.can_record());
        }
    }

    #[test]
    fn only_undetermined_can_prompt() {
        assert!(MicStatus::NotDetermined.can_prompt());
        for s in [MicStatus::Denied, MicStatus::Restricted, MicStatus::Authorized] {
            assert!(!s.can_prompt());
        }
    }

    #[test]
    fn labels_cover_every_state() {
        for s in [
            MicStatus::NotDetermined,
            MicStatus::Denied,
            MicStatus::Restricted,
            MicStatus::Authorized,
        ] {
            assert!(!mic_status_label(s).is_empty());
        }
    }
}
