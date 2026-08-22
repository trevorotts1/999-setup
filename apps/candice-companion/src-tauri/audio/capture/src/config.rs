//! WS-17 capture constants — one truth for the controller and sources.

/// Sample rate fed to whisper.cpp (spec 7 / WS-16 native rate).
pub const DEFAULT_SAMPLE_RATE: u32 = 16_000;
/// Mono capture.
pub const DEFAULT_CHANNELS: u16 = 1;
/// Frames per chunk handed from the source to the ring buffer.
pub const DEFAULT_CHUNK_FRAMES: usize = 512;
/// Stuck-press safety valve: force-release after this long (spec 8).
pub const DEFAULT_DURATION_LIMIT_MS: u64 = 60_000;
/// Ring capacity in chunks.
pub const RING_BUFFER_CAPACITY: usize = 256;

/// Nontechnical, user-facing wording (spec 4/22 plain-language rule).
pub const NO_DEVICE_MESSAGE: &str = "No microphone was found. You can still type your answer.";
/// Nontechnical, user-facing wording (spec 22 plain-language rule).
pub const PERMISSION_DENIED_MESSAGE: &str =
    "Microphone permission was not granted. You can still type your answer.";

/// Tunable capture parameters (all optional, all defaulted).
#[derive(Debug, Clone)]
pub struct CaptureConfig {
    pub sample_rate: u32,
    pub channels: u16,
    pub chunk_frames: usize,
    pub duration_limit_ms: u64,
}

impl Default for CaptureConfig {
    fn default() -> Self {
        Self {
            sample_rate: DEFAULT_SAMPLE_RATE,
            channels: DEFAULT_CHANNELS,
            chunk_frames: DEFAULT_CHUNK_FRAMES,
            duration_limit_ms: DEFAULT_DURATION_LIMIT_MS,
        }
    }
}

/// Prefixed module-relative re-export for callers that prefer
/// `use capture::defaults::*`.
pub mod defaults {
    pub use super::{
        DEFAULT_CHANNELS, DEFAULT_CHUNK_FRAMES, DEFAULT_DURATION_LIMIT_MS, DEFAULT_SAMPLE_RATE,
        NO_DEVICE_MESSAGE, PERMISSION_DENIED_MESSAGE, RING_BUFFER_CAPACITY,
    };
}
