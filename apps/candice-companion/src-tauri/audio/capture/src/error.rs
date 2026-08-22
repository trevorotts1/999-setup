//! WS-17 capture error model — machine-readable codes, plain-language text.

use crate::config::{NO_DEVICE_MESSAGE, PERMISSION_DENIED_MESSAGE};

/// Machine-readable capture failure codes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CaptureErrorCode {
    PermissionDenied,
    NoDevice,
    DeviceLost,
    DeviceBusy,
    Aborted,
    DurationLimit,
    Unsupported,
    Unknown,
}

/// A capture failure. Never carries audio data; `cause` is for diagnostics
/// only and must never be logged when it contains device bytes (it does
/// not — it is a Rust error object).
#[derive(Debug, Clone)]
pub struct CaptureError {
    pub code: CaptureErrorCode,
    /// Nontechnical, user-facing wording (spec 4/22).
    pub message: String,
    /// True when retrying the same hold may succeed.
    pub retryable: bool,
}

impl CaptureError {
    pub fn new(code: CaptureErrorCode, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code,
            message: message.into(),
            retryable,
        }
    }

    pub fn permission_denied() -> Self {
        Self::new(
            CaptureErrorCode::PermissionDenied,
            PERMISSION_DENIED_MESSAGE,
            true,
        )
    }

    pub fn no_device() -> Self {
        Self::new(CaptureErrorCode::NoDevice, NO_DEVICE_MESSAGE, true)
    }

    pub fn unknown(message: impl Into<String>) -> Self {
        Self::new(CaptureErrorCode::Unknown, message, false)
    }
}

impl std::fmt::Display for CaptureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for CaptureError {}
