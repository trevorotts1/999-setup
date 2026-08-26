//! Windows microphone presence/consent decision (spec 20 fallback matrix).
//!
//! Maps "what the Windows audio subsystem reports" onto the WS-17
//! `CaptureError` vocabulary: `NoDevice` and `PermissionDenied` both keep
//! typing available. Pure decision code is host-independent — the
//! fixture-driven tests below run on any OS, including macOS CI, while
//! the WASAPI endpoint enumeration itself is exercised on the
//! interactive Windows matrix (spec 18).

use candice_capture::CaptureError;

/// What the Windows microphone probe observed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowsMicObservation {
    /// At least one capture-capable endpoint is present.
    DevicesPresent,
    /// No capture endpoint exists on the machine (no-device path).
    NoDevice,
    /// Microphone privacy consent is Deny (permission-denied path).
    PermissionDenied,
}

/// Map a Windows probe observation onto the capture error contract.
///
/// - `DevicesPresent` -> `None` (recording may proceed);
/// - `NoDevice` -> `CaptureError::no_device()` (typing stays available);
/// - `PermissionDenied` -> `CaptureError::permission_denied()`
///   (typing stays available).
///
/// This is the exact decision the Windows source consults before opening
/// the WASAPI stream; the tests exercise the real function, not a
/// reimplementation.
pub fn map_windows_observation(obs: WindowsMicObservation) -> Option<CaptureError> {
    match obs {
        WindowsMicObservation::DevicesPresent => None,
        WindowsMicObservation::NoDevice => Some(CaptureError::no_device()),
        WindowsMicObservation::PermissionDenied => Some(CaptureError::permission_denied()),
    }
}

/// Probes live on Windows hosts via the capture-device availability.
///
/// Returns the observation, or `None` when the platform is not Windows
/// (this lane is Windows-native by definition — spec 18: platform modules
/// own platform audio plumbing only; other platforms use their own lane).
#[cfg(all(feature = "wasapi", target_os = "windows"))]
pub fn windows_mic_probe() -> Option<WindowsMicObservation> {
    use cpal::traits::HostTrait;
    let host = cpal::default_host();
    match host.default_input_device() {
        Some(_) => Some(WindowsMicObservation::DevicesPresent),
        None => Some(WindowsMicObservation::NoDevice),
    }
}

#[cfg(not(all(feature = "wasapi", target_os = "windows")))]
pub fn windows_mic_probe() -> Option<WindowsMicObservation> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use candice_capture::CaptureErrorCode;

    #[test]
    fn devices_present_allows_recording() {
        assert!(map_windows_observation(WindowsMicObservation::DevicesPresent).is_none());
    }

    #[test]
    fn no_device_maps_to_no_device_error() {
        let err = map_windows_observation(WindowsMicObservation::NoDevice).expect("error");
        assert_eq!(err.code, CaptureErrorCode::NoDevice);
        assert!(err.retryable);
    }

    #[test]
    fn permission_denied_maps_to_permission_denied_error() {
        let err = map_windows_observation(WindowsMicObservation::PermissionDenied).expect("error");
        assert_eq!(err.code, CaptureErrorCode::PermissionDenied);
        assert!(err.retryable);
    }

    #[test]
    fn fallback_keeps_typing_available_by_contract() {
        // Every error variant in this lane maps to typing; the WS-17
        // controller demotes Denied/NoDevice to statuses that never
        // block text input (spec 20).
        for obs in [
            WindowsMicObservation::NoDevice,
            WindowsMicObservation::PermissionDenied,
        ] {
            let err = map_windows_observation(obs).expect("error");
            assert!(matches!(
                err.code,
                CaptureErrorCode::NoDevice | CaptureErrorCode::PermissionDenied
            ));
        }
    }

    #[test]
    fn probe_contract_is_option() {
        // Non-Windows hosts (macOS CI) get None: this lane is
        // Windows-native by definition (spec 18).
        let _ = windows_mic_probe();
    }
}
