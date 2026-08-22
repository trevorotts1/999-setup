//! `MicSource` for Windows — the WS-17 platform boundary implementation.
//!
//! Built on cpal's WASAPI host (the same cpal the WS-17 lane already
//! pins): MMDevice enumeration and default-endpoint selection happen
//! natively. Audio flows from the WASAPI capture stream straight into
//! the WS-17 ring buffer as `SourceChunk`s — no temp files, no extra
//! processes, no PowerShell dependency at capture time (native plumbing,
//! spec 0.3).
//!
//! Push-to-talk guarantee (spec 8): the controller calls `open` only
//! from `press()` and `close` on `release()`; `MicSource` exposes no
//! other way to start the stream, so the microphone cannot be live
//! outside the hold.
//!
//! Failure mapping (spec 20): no default input device -> `NoDevice`;
//! stream open/start failure classified by kind -> `PermissionDenied`
//! (access/E_ACCESSDENIED), `NoDevice` (not found), or `Unknown`.
//! Every failure leaves typing available.

#[cfg(feature = "wasapi")]
use candice_capture::{CaptureConfig, CaptureError, CaptureErrorCode, MicSource, SourceChunk};

#[cfg(feature = "wasapi")]
use std::sync::mpsc::Sender;

/// Windows WASAPI capture source (cpal host).
///
/// Feature-gated on `wasapi` so the unit tests run on any OS without a
/// Windows host; the real stream is exercised on the interactive
/// Windows matrix (spec 18).
#[cfg(feature = "wasapi")]
#[derive(Default)]
pub struct WindowsMicSource {
    stream: Option<cpal::Stream>,
}

#[cfg(feature = "wasapi")]
impl MicSource for WindowsMicSource {
    fn default_input_device(&self) -> Option<String> {
        use cpal::traits::HostTrait;
        cpal::default_host()
            .default_input_device()
            .map(|d| d.to_string())
    }

    fn list_input_devices(&self) -> Vec<String> {
        use cpal::traits::HostTrait;
        let host = cpal::default_host();
        match host.input_devices() {
            Ok(devs) => devs.map(|d| d.to_string()).collect(),
            Err(_) => vec![],
        }
    }

    fn open(
        &mut self,
        _config: &CaptureConfig,
        chunks: Sender<SourceChunk>,
    ) -> Result<(), CaptureError> {
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(candice_capture::no_device_error)?;
        let supported = device
            .default_input_config()
            .map_err(|e| classify_open_error(&e.to_string(), CaptureErrorCode::NoDevice))?;
        let sample_rate: u32 = supported.sample_rate();
        let channels: u16 = supported.channels();
        let config_out: cpal::StreamConfig = supported.into();
        let err_fn = |_: cpal::Error| {};
        let tx = chunks;
        let stream = device
            .build_input_stream(
                config_out,
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    let chunk = SourceChunk {
                        sample_rate,
                        channels,
                        samples: data.to_vec(),
                        captured_at_ms: 0,
                    };
                    let _ = tx.send(chunk);
                },
                err_fn,
                None,
            )
            .map_err(|e| classify_open_error(&e.to_string(), CaptureErrorCode::Unknown))?;
        stream
            .play()
            .map_err(|e| classify_open_error(&e.to_string(), CaptureErrorCode::Unknown))?;
        self.stream = Some(stream);
        Ok(())
    }

    fn close(&mut self) -> Result<(), CaptureError> {
        // Dropping the stream stops the device: the mic cannot outlive
        // the PTT release.
        self.stream = None;
        Ok(())
    }
}

/// Classify a Windows stream failure into the capture error contract.
///
/// Windows privacy denial surfaces as access/HRESULT wording; device
/// loss as not-found wording. Any unrecognized failure is `Unknown` —
/// never a fake success, never a panic (spec 20).
#[cfg(feature = "wasapi")]
pub fn classify_open_error(message: &str, fallback: CaptureErrorCode) -> CaptureError {
    let lower = message.to_lowercase();
    if lower.contains("access")
        || lower.contains("denied")
        || lower.contains("0x80070005")
        || lower.contains("e_accessdenied")
    {
        CaptureError::permission_denied()
    } else if lower.contains("not found")
        || lower.contains("notfound")
        || lower.contains("no such")
        || lower.contains("0x80070490")
    {
        CaptureError::no_device()
    } else {
        CaptureError::unknown(match fallback {
            CaptureErrorCode::NoDevice => candice_capture::no_device_error().message,
            CaptureErrorCode::PermissionDenied => CaptureError::permission_denied().message,
            _ => message.to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    #[cfg(feature = "wasapi")]
    use super::classify_open_error;
    #[cfg(feature = "wasapi")]
    use candice_capture::CaptureErrorCode;

    #[cfg(feature = "wasapi")]
    #[test]
    fn access_denied_maps_to_permission_denied() {
        assert_eq!(
            classify_open_error("Access is denied.", CaptureErrorCode::Unknown).code,
            CaptureErrorCode::PermissionDenied
        );
        assert_eq!(
            classify_open_error("E_ACCESSDENIED", CaptureErrorCode::Unknown).code,
            CaptureErrorCode::PermissionDenied
        );
    }

    #[cfg(feature = "wasapi")]
    #[test]
    fn not_found_maps_to_no_device() {
        assert_eq!(
            classify_open_error("Element not found.", CaptureErrorCode::Unknown).code,
            CaptureErrorCode::NoDevice
        );
    }

    #[cfg(feature = "wasapi")]
    #[test]
    fn unknown_stays_unknown_never_panics() {
        let err = classify_open_error("some unexpected failure", CaptureErrorCode::Unknown);
        assert_eq!(err.code, CaptureErrorCode::Unknown);
    }
}
