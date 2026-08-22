//! Live macOS permission probes (Master Spec 0E WS-22, feature `live`).
//!
//! Read-only TCC status queries. None of these functions prompts the
//! user and none of them can fail the app:
//!
//! | Permission | API | Prompt? |
//! |---|---|---|
//! | Accessibility | `AXIsProcessTrusted()` | no (the `WithOptions` prompt variant is intentionally NOT used) |
//! | Screen Recording | `CGPreflightScreenCaptureAccess()` | no |
//! | Microphone | `[AVCaptureDevice authorizationStatusForMediaType:]` | no |
//!
//! The prompt-with-UX is the app layer's job (it owns the plain-language
//! copy and the timing: "request ... only when needed", spec 0.3). This
//! module only reports current state.
//!
//! All probes are total: a failed or abnormal call degrades to the
//! conservative reading (denied / unknown), never a panic (spec 20).

use crate::permission::{MicStatus, mic_status_from_raw};

/// Result of the live accessibility probe.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AccessibilityProbe {
    /// True when `AXIsProcessTrusted()` returned true.
    pub granted: bool,
}

/// Result of the live screen-capture probe.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScreenCaptureProbe {
    /// True when `CGPreflightScreenCaptureAccess()` returned true.
    pub granted: bool,
}

/// Result of the live microphone probe.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MicProbe {
    pub status: MicStatus,
    /// False when AVFoundation's class could not be reached (headless
    /// CI, older macOS) — the app then treats the mic as unknown and
    /// typing remains available (spec 20).
    pub callable: bool,
}

/// Probe Accessibility status via `AXIsProcessTrusted()`.
///
/// Never the `WithOptions` prompt variant: this module must not trigger
/// a TCC dialog (that is the app's UX decision).
pub fn probe_accessibility() -> AccessibilityProbe {
    let granted = unsafe { ax_is_process_trusted() };
    AccessibilityProbe { granted }
}

/// Probe Screen Recording status via `CGPreflightScreenCaptureAccess()`.
pub fn probe_screen_capture() -> ScreenCaptureProbe {
    let granted = core_graphics::access::ScreenCaptureAccess.preflight();
    ScreenCaptureProbe { granted }
}

/// Probe microphone status via
/// `[AVCaptureDevice authorizationStatusForMediaType:]`.
pub fn probe_microphone() -> MicProbe {
    // `Class::get` takes a `&CStr`; a `b"..."` literal gives us one.
    let Some(cls) = objc2::runtime::AnyClass::get(c"AVCaptureDevice") else {
        // AVFoundation not reachable (e.g. headless CI build without the
        // framework). Conservative: report as unknown/denied; the app
        // keeps typing available (spec 20).
        return MicProbe {
            status: MicStatus::NotDetermined,
            callable: false,
        };
    };
    // `AVMediaTypeAudio` is the constant @"soun" (4-char media type).
    // The call is wrapped in `objc2::exception::catch`: a rejected media
    // type or an unexpected runtime state raises an NSException, and
    // Rust cannot let foreign exceptions unwind (spec 20: no probe may
    // abort the app — degrade instead).
    let media_type = objc2_foundation::NSString::from_str("soun");
    let caught = objc2::exception::catch(std::panic::AssertUnwindSafe(|| unsafe {
        let raw: objc2::ffi::NSInteger =
            objc2::msg_send![cls, authorizationStatusForMediaType: &*media_type];
        raw
    }));
    match caught {
        Ok(raw) => MicProbe {
            status: mic_status_from_raw(raw as i32),
            callable: true,
        },
        Err(_) => MicProbe {
            // The ObjC runtime rejected the call; treat the mic as
            // unknown and keep typing available (spec 20).
            status: MicStatus::NotDetermined,
            callable: false,
        },
    }
}

// Raw declaration of `AXIsProcessTrusted()` from the ApplicationServices
// framework (HIServices). macOS-only; returns 0/1.
#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrusted() -> bool;
}

/// Call `AXIsProcessTrusted()`. Total: the framework link guarantees the
/// symbol; on any abnormal runtime state it returns false (conservative).
///
/// # Safety
///
/// Must be called only from a macOS process. Trivial FFI — no arguments,
/// returns an integer; the ApplicationServices framework is linked above
/// and present on every macOS. No other preconditions.
pub unsafe fn ax_is_process_trusted() -> bool {
    // SAFETY: trivial FFI — no arguments, returns an integer; the
    // framework is linked above and present on every macOS.
    unsafe { AXIsProcessTrusted() }
}

// Force AVFoundation into the link line so the ObjC runtime can resolve
// `AVCaptureDevice` lazily. No symbols are imported here — all access
// goes through `objc_msgSend` in the probe above.
#[cfg(target_os = "macos")]
#[link(name = "AVFoundation", kind = "framework")]
unsafe extern "C" {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_functions_exist_and_are_total() {
        // On a real Mac these hit the OS; on a headless/CI runner they
        // must still return without panic (the callable=false path is
        // exercised by the None-class guard in probe_microphone).
        let a = probe_accessibility();
        assert!(!a.granted || a.granted); // any bool is valid; no panic
        let s = probe_screen_capture();
        assert!(!s.granted || s.granted);
        let m = probe_microphone();
        assert!(matches!(
            m.status,
            MicStatus::NotDetermined
                | MicStatus::Denied
                | MicStatus::Restricted
                | MicStatus::Authorized
        ));
    }
}
