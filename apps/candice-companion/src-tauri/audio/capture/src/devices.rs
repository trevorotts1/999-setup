//! WS-17 device enumeration + no-device fallback.
//!
//! [`DeviceInfo`] mirrors the web adapter contract so the Tauri shell and
//! the web fallback speak one shape (spec 18 shared contract).

use crate::config::NO_DEVICE_MESSAGE;
use crate::error::{CaptureError, CaptureErrorCode};

/// One enumerated audio device.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceInfo {
    pub device_id: String,
    pub label: String,
    pub group_id: String,
    pub is_default: bool,
}

impl DeviceInfo {
    pub fn new(device_id: impl Into<String>, label: impl Into<String>) -> Self {
        Self {
            device_id: device_id.into(),
            label: label.into(),
            group_id: String::new(),
            is_default: false,
        }
    }
}

/// Build the canonical no-device error (single source of truth).
pub fn no_device_error() -> CaptureError {
    CaptureError::new(CaptureErrorCode::NoDevice, NO_DEVICE_MESSAGE, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_device_error_is_retryable_and_friendly() {
        let e = no_device_error();
        assert_eq!(e.code, CaptureErrorCode::NoDevice);
        assert!(e.retryable);
        assert!(e.message.contains("type your answer"));
    }
}
