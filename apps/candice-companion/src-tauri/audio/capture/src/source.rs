//! WS-17 microphone source boundary.
//!
//! [`MicSource`] is the only place platform audio plumbing (spec 18
//! boundary) meets the capture core. The controller is pure Rust with no
//! audio dependency: tests inject a deterministic fake source.
//!
//! [`CpalMicSource`] is the real implementation, compiled only with the
//! `cpal` feature (permission/device handling per spec 8: the stream is
//! opened only while HOLD TO TALK is held and closed on release).

use std::sync::mpsc::Sender;

use crate::config::CaptureConfig;
use crate::error::CaptureError;

/// One chunk pushed from the capture thread to the controller.
#[derive(Debug, Clone)]
pub struct SourceChunk {
    pub sample_rate: u32,
    pub channels: u16,
    pub samples: Vec<f32>,
    pub captured_at_ms: u64,
}

/// Platform-agnostic microphone source contract.
pub trait MicSource: Send + 'static {
    /// Resolve the device the OS will record from. `None` means no input
    /// device exists (no-device fallback, spec 20).
    fn default_input_device(&self) -> Option<String>;

    /// Enumerate input devices (advisory; never requires an open stream).
    fn list_input_devices(&self) -> Vec<String>;

    /// Open the microphone. The mic is live only between `open` and
    /// `close`. Chunks are pushed into `chunks` from the audio thread.
    fn open(
        &mut self,
        config: &CaptureConfig,
        chunks: Sender<SourceChunk>,
    ) -> Result<(), CaptureError>;

    fn close(&mut self) -> Result<(), CaptureError>;
}

/// Deterministic fake source for tests and the visual harness (WS-15):
/// `sin(2*pi*440*t)` PCM. No device, no OS audio.
#[derive(Debug)]
pub struct FakeMicSource {
    pub device_present: bool,
    pub fail_on_open: Option<CaptureError>,
    /// Remaining chunks `pump` may emit.
    pub chunk_count: usize,
    tx: Option<Sender<SourceChunk>>,
    pub open_calls: usize,
    pub close_calls: usize,
    sample_rate: u32,
    channels: u16,
    chunk_frames: usize,
    pub emitted: usize,
}

impl Default for FakeMicSource {
    fn default() -> Self {
        Self::new()
    }
}

impl FakeMicSource {
    pub fn new() -> Self {
        Self {
            device_present: true,
            fail_on_open: None,
            chunk_count: usize::MAX,
            tx: None,
            open_calls: 0,
            close_calls: 0,
            sample_rate: crate::config::DEFAULT_SAMPLE_RATE,
            channels: crate::config::DEFAULT_CHANNELS,
            chunk_frames: crate::config::DEFAULT_CHUNK_FRAMES,
            emitted: 0,
        }
    }

    /// Push one synthetic chunk into the controller (test-only).
    pub fn pump(&mut self) {
        if self.chunk_count == 0 {
            return;
        }
        let Some(tx) = self.tx.as_ref() else {
            return;
        };
        self.chunk_count -= 1;
        let seq = self.emitted;
        self.emitted += 1;
        let frames = self.chunk_frames;
        let rate = self.sample_rate;
        let samples: Vec<f32> = (0..frames)
            .map(|i| {
                let t = (seq * frames + i) as f32 / rate as f32;
                (2.0 * std::f32::consts::PI * 440.0 * t).sin()
            })
            .collect();
        let chunk = SourceChunk {
            sample_rate: rate,
            channels: self.channels,
            samples,
            captured_at_ms: 0,
        };
        let _ = tx.send(chunk);
    }
}

impl MicSource for FakeMicSource {
    fn default_input_device(&self) -> Option<String> {
        if self.device_present {
            Some("fake-mic".to_string())
        } else {
            None
        }
    }

    fn list_input_devices(&self) -> Vec<String> {
        if self.device_present {
            vec!["fake-mic".to_string()]
        } else {
            vec![]
        }
    }

    fn open(
        &mut self,
        config: &CaptureConfig,
        chunks: Sender<SourceChunk>,
    ) -> Result<(), CaptureError> {
        self.open_calls += 1;
        if let Some(e) = self.fail_on_open.clone() {
            return Err(e);
        }
        self.sample_rate = config.sample_rate;
        self.channels = config.channels;
        self.chunk_frames = config.chunk_frames;
        self.tx = Some(chunks);
        Ok(())
    }

    fn close(&mut self) -> Result<(), CaptureError> {
        self.close_calls += 1;
        self.tx = None;
        Ok(())
    }
}

/// Real device source via `cpal` (feature-gated; platform plumbing).
#[cfg(feature = "cpal")]
#[derive(Default)]
pub struct CpalMicSource {
    stream: Option<cpal::Stream>,
}

#[cfg(feature = "cpal")]
impl MicSource for CpalMicSource {
    fn default_input_device(&self) -> Option<String> {
        use cpal::traits::HostTrait;
        let host = cpal::default_host();
        host.default_input_device().map(|d| d.to_string())
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
            .ok_or_else(crate::devices::no_device_error)?;
        let supported = device
            .default_input_config()
            .map_err(|_| crate::error::CaptureError::no_device())?;
        let sample_rate: u32 = supported.sample_rate(); // SampleRate = u32 alias
        let channels: u16 = supported.channels(); // ChannelCount = u16 alias
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
            .map_err(|_| crate::error::CaptureError::unknown("failed to open input stream"))?;
        stream
            .play()
            .map_err(|_| crate::error::CaptureError::unknown("failed to start input stream"))?;
        self.stream = Some(stream);
        Ok(())
    }

    fn close(&mut self) -> Result<(), CaptureError> {
        self.stream = None; // dropping the stream stops the device
        Ok(())
    }
}
