//! WS-28 Windows microphone/audio/device path (Master Spec 0E).
//!
//! Owned by the WR-016 lane (ownership map 9.2, snapshot owned_paths):
//! `apps/candice-companion/src-tauri/audio/capture-windows/**`.
//!
//! This crate is the Windows half of the spec-18 platform boundary: it
//! implements the WS-17 [`candice_capture::MicSource`] trait with native
//! Windows WASAPI/MMDevice plumbing (cpal's WASAPI host). The WS-17
//! controller opens the source only from `press()` and closes it on
//! `release()` — so the microphone is live ONLY while HOLD TO TALK is
//! pressed (spec 8) by construction, with no code path here able to
//! record outside that window.
//!
//! Failure doctrine (spec 17/20, E.1 WS-28): no-device and
//! permission-denied both surface as machine-readable `CaptureError`s
//! that leave typing available; Candice failure never blocks Claude.
//!
//! Privacy (spec 8): audio flows `mic -> in-memory ring buffer ->
//! whisper.cpp -> transcript -> discard` (the ring lives in WS-17). This
//! crate never writes audio to disk, never uploads it, never logs it.
//!
//! The stuck-press valve (60 s) is WS-17's `duration_limit_ms` — the
//! controller force-releases on that clock, never this lane.

mod presence;
mod source;

pub use presence::{map_windows_observation, windows_mic_probe, WindowsMicObservation};
#[cfg(feature = "wasapi")]
pub use source::{classify_open_error, WindowsMicSource};
