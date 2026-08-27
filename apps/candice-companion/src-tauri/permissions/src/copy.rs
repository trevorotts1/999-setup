//! Plain-language permission copy (Master Spec 0E WS-22, spec 0.3:
//! "request Accessibility/microphone permissions in plain language only
//! when needed").
//!
//! This module owns the exact human strings the app shows. Keeping them
//! here (instead of inside the UI) gives QC one place to review for
//! honesty: every string explains WHAT is being asked, WHY it helps, and
//! what Candice does WITHOUT it. No permission is ever required for
//! Claude to keep working (spec 20).

use crate::permission::PermissionKind;

/// Plain-language explanation shown when Accessibility permission is
/// requested. Accessible via System Settings → Privacy & Security →
/// Accessibility.
pub fn accessibility_explanation() -> &'static str {
    "Candice can follow your terminal window so she stays beside it while \
     you work. This is optional: without it, she simply floats as her own \
     window that you can move anywhere. Claude keeps working either way. \
     To enable: System Settings → Privacy & Security → Accessibility, then \
     tick Candice Companion. No answer, question, or conversation is ever \
     read through this permission — it is used for window position only."
}

/// Plain-language explanation shown when the microphone is needed
/// (first HOLD TO TALK press). Audio is captured only while the button
/// is held, transcribed locally on your Mac, and deleted immediately
/// (spec 8). Typing an answer always remains available.
pub fn microphone_explanation() -> &'static str {
    // "your Mac" is correct here: this crate is candice-macos-permissions
    // and is macOS-only by name and purpose. It is NOT a dependency of the
    // app crate and nothing in the repo links it -- verified against the
    // app's Cargo.toml, a repo-wide reference search, and the fact that
    // its `status` example is never invoked by any script. So these
    // strings do not currently reach a user through the shipping app.
    // Recorded in CONTROL/TODO.md rather than papered over here.
    "To answer by voice, Candice needs microphone access. The microphone \
     records only while you hold the talk button, the audio never leaves \
     your Mac, and it is discarded as soon as it is transcribed. You can \
     still type every answer — this is optional. To change it later: \
     System Settings → Privacy & Security → Microphone."
}

/// Plain-language note for Screen Recording consent. This only affects
/// whether Candice can read window TITLES for better anchoring; matching
/// by app name, position, and process ID works without it.
pub fn screen_capture_explanation() -> &'static str {
    // "helps it stay anchored" — she is "she" in every other string in
    // this file and everywhere else in the product.
    "Candice can read the titles of your terminal windows, which helps her \
     stay next to the right one. This is optional: without it, Candice \
     still finds your terminal by its app, position, and size — titles are \
     just extra confirmation. To enable: System Settings → Privacy & \
     Security → Screen Recording."
}

/// Notice shown when Candice runs in floating mode (Accessibility
/// denied / not yet granted). Frames it as the designed fallback, never
/// as an error, and points at the plain-language explanation.
pub fn floating_mode_notice() -> &'static str {
    // Was: "it stays near your terminal and follows none of your window
    // movement automatically. Move it anywhere you like." Three "it"s for
    // a character who is "she" everywhere else, and a negation that takes
    // three reads to parse into "she will not follow your window".
    "Candice is in floating mode — she won\u{2019}t follow your terminal window \
     around, but you can drag her anywhere you like. If you\u{2019}d like her to \
     follow your terminal, turn on Accessibility for Candice Companion: \
     System Settings → Privacy & Security → Accessibility. Everything else \
     works the same in the meantime."
}

/// The copy pair for a permission row: a title plus the explanation.
/// (Consumed by the app layer's permission row at fan-in and by the
/// diagnostic example; kept here so the strings have exactly one home.)
#[allow(dead_code)]
pub fn permission_copy(kind: PermissionKind) -> (&'static str, &'static str) {
    match kind {
        PermissionKind::Accessibility => ("Follow my terminal window", accessibility_explanation()),
        PermissionKind::Microphone => ("Answer by voice", microphone_explanation()),
        PermissionKind::ScreenRecording => ("Read terminal window titles", screen_capture_explanation()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_copy_blob_is_nonempty_and_substantive() {
        assert!(accessibility_explanation().len() > 200);
        assert!(microphone_explanation().len() > 200);
        assert!(screen_capture_explanation().len() > 200);
        assert!(floating_mode_notice().len() > 100);
    }

    #[test]
    fn copy_explains_what_happens_without_permission() {
        // The failure doctrine (spec 20) requires the copy to state the
        // fallback, never to imply the feature is broken.
        assert!(accessibility_explanation().contains("floats as her own"));
        assert!(microphone_explanation().contains("type every answer"));
        assert!(screen_capture_explanation().contains("still finds your terminal"));
    }

    #[test]
    fn floating_notice_presents_fallback_as_design_not_error() {
        let notice = floating_mode_notice();
        assert!(notice.contains("floating mode"));
        assert!(!notice.to_lowercase().contains("broken"));
        assert!(!notice.to_lowercase().contains("error"));
    }

    #[test]
    fn every_kind_has_a_copy_pair() {
        for kind in [
            PermissionKind::Accessibility,
            PermissionKind::Microphone,
            PermissionKind::ScreenRecording,
        ] {
            let (title, body) = permission_copy(kind);
            assert!(!title.is_empty());
            assert!(!body.is_empty());
        }
    }
}
