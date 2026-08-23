//! WS-17 local microphone capture + push-to-talk.
//!
//! Owned by the WR-014 lane (ownership map 9.2):
//! `apps/candice-companion/src-tauri/audio/capture/**`.
//!
//! Privacy invariants (Master Spec 8, enforced in code):
//!   - the microphone is live only while HOLD TO TALK is pressed: the
//!     controller opens the [`MicSource`] exclusively from `press()` and
//!     closes it on `release()`;
//!   - audio flows `microphone -> in-memory ring buffer -> whisper.cpp ->
//!     transcript -> discard` — never to disk, never to a cloud endpoint;
//!   - raw audio is never logged; events carry codes, never PCM.
//!
//! Failure doctrine (Master Spec 20): denied permission and no-device both
//! leave the controller in a state where typing remains available; a failed
//! press can never throw out of the session (all errors are captured).

mod config;
mod controller;
mod devices;
mod error;
mod ring_buffer;
mod source;

pub use config::{defaults, CaptureConfig};
pub use controller::{CaptureStatus, DiscardReason, PttController, PttEvent};
pub use devices::{no_device_error, DeviceInfo};
pub use error::{CaptureError, CaptureErrorCode};
pub use ring_buffer::{CaptureChunk, Recording, RingBuffer};
#[cfg(feature = "cpal")]
pub use source::CpalMicSource;
pub use source::{FakeMicSource, MicSource, SourceChunk};
