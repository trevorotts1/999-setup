//! WS-17 push-to-talk controller — the single capture state authority.
//!
//! Ported from the WS-17 TypeScript prototype (controller.ts) that passed
//! its 20-test acceptance suite; same transitions, same invariants, Rust.
//!
//! Lifecycle (spec 6 PTT UX):
//!   idle --press--> requesting -> listening (mic LIVE) --release--> idle
//!   listening --duration-limit--> auto-release
//!   requesting/denied/no-device/error --release--> idle (spec 20: typing
//!   remains available; dead-end states reset on release)
//!
//! Privacy (spec 8): `press` is the ONLY path that opens the mic;
//! `release` closes it. Recording is consumed once by `take_recording`
//! (WS-18) or discarded on the next hold / at dispose.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::mpsc::{self, Receiver, Sender};
use std::time::{Duration, Instant};

use crate::config::CaptureConfig;
use crate::devices::no_device_error;
use crate::error::{CaptureError, CaptureErrorCode};
use crate::ring_buffer::{CaptureChunk, Recording, RingBuffer};
use crate::source::{MicSource, SourceChunk};

/// Lifecycle of the push-to-talk capture path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureStatus {
    Idle,
    Requesting,
    Listening, // mic LIVE — only while HOLD TO TALK is pressed
    Stopping,
    Denied,
    NoDevice,
    Error,
    Disposed,
}

impl CaptureStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Requesting => "requesting",
            Self::Listening => "listening",
            Self::Stopping => "stopping",
            Self::Denied => "denied",
            Self::NoDevice => "no-device",
            Self::Error => "error",
            Self::Disposed => "disposed",
        }
    }
}

/// PTT events — the only outbound contract (WS-09 renders, WS-18
/// transcribes, WS-20 listens for interrupts). Audio travels as a
/// [`Recording`] via `take_recording`, never inside events.
#[derive(Debug, Clone)]
pub enum PttEvent {
    StatusChanged {
        at_ms: u64,
        status: CaptureStatus,
        error: Option<CaptureError>,
    },
    ListeningStarted {
        at_ms: u64,
    },
    ListeningEnded {
        at_ms: u64,
        duration_ms: u64,
    },
    PermissionDenied {
        at_ms: u64,
        error: CaptureError,
    },
    NoDevice {
        at_ms: u64,
        error: CaptureError,
    },
    DeviceListChanged {
        at_ms: u64,
        devices: Vec<String>,
    },
    /// WS-20: stop Candice's speech now (spec 6 — press while speaking).
    InterruptRequest {
        at_ms: u64,
    },
    DurationLimit {
        at_ms: u64,
        limit_ms: u64,
    },
    Discarded {
        at_ms: u64,
        reason: DiscardReason,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiscardReason {
    Release,
    Cancel,
    Dispose,
    DurationLimit,
}

impl DiscardReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Release => "release",
            Self::Cancel => "cancel",
            Self::Dispose => "dispose",
            Self::DurationLimit => "duration-limit",
        }
    }
}

type PttListener = Box<dyn FnMut(&PttEvent) + Send + Sync>;

/// The push-to-talk controller.
pub struct PttController<S: MicSource> {
    source: S,
    config: CaptureConfig,
    status: CaptureStatus,
    current_error: Option<CaptureError>,
    press_active: bool,
    listening: bool,
    hold_started_at: Instant,
    ring: RingBuffer,
    source_rx: Option<Receiver<SourceChunk>>,
    chunk_seq: u64,
    completed: Option<Recording>,
    listeners: Vec<PttListener>,
    disposed: bool,
}

impl<S: MicSource> PttController<S> {
    pub fn new(source: S) -> Self {
        Self::with_config(source, CaptureConfig::default())
    }

    pub fn with_config(source: S, config: CaptureConfig) -> Self {
        let ring_capacity = ring_capacity_for(&config);
        Self {
            source,
            config,
            status: CaptureStatus::Idle,
            current_error: None,
            press_active: false,
            listening: false,
            hold_started_at: Instant::now(),
            ring: RingBuffer::with_capacity(ring_capacity),
            source_rx: None,
            chunk_seq: 0,
            completed: None,
            listeners: Vec::new(),
            disposed: false,
        }
    }

    // ------------------------------------------------------------ listeners

    pub fn on_event<F>(&mut self, f: F)
    where
        F: FnMut(&PttEvent) + Send + Sync + 'static,
    {
        self.listeners.push(Box::new(f) as PttListener);
    }

    fn emit(&mut self, event: PttEvent) {
        // A listener must never break capture (spec 20: Candice failure
        // never blocks the user; a UI listener panic is the same rule).
        let mut dead: Vec<usize> = Vec::new();
        for (i, l) in self.listeners.iter_mut().enumerate() {
            let r = catch_unwind(AssertUnwindSafe(|| l(&event)));
            if r.is_err() {
                dead.push(i);
            }
        }
        // Drop panicking listeners so they cannot wedge the session.
        for &i in dead.iter().rev() {
            drop(self.listeners.remove(i));
        }
    }

    // --------------------------------------------------------------- state

    pub fn status(&self) -> CaptureStatus {
        self.status
    }

    pub fn is_listening(&self) -> bool {
        self.listening
    }

    /// Current snapshot for the UI (WS-09).
    pub fn snapshot(&self) -> (CaptureStatus, Option<CaptureError>) {
        (self.status, self.current_error.clone())
    }

    /// Last completed recording — consumed exactly once (WS-18).
    pub fn take_recording(&mut self) -> Option<Recording> {
        self.completed.take()
    }

    // --------------------------------------------------------- transitions

    /// HOLD TO TALK pressed. The only legal way to make the mic live.
    pub fn press(&mut self) {
        if self.disposed || self.press_active {
            return;
        }
        self.press_active = true;

        // WS-20: press while Candice speaks must stop her speech first.
        self.emit(PttEvent::InterruptRequest { at_ms: now_ms() });

        if self.status != CaptureStatus::Listening && self.status != CaptureStatus::Stopping {
            self.set_status(CaptureStatus::Requesting);
        }

        let device = self.source.default_input_device();
        if device.is_none() {
            // No-device fallback: never attempt a stream without a device.
            // Typing remains available (spec 20).
            self.press_active = false;
            self.listening = false;
            let e = no_device_error();
            self.current_error = Some(e.clone());
            self.set_status(CaptureStatus::NoDevice);
            self.emit(PttEvent::NoDevice {
                at_ms: now_ms(),
                error: e,
            });
            return;
        }

        let devices = self.source.list_input_devices();
        self.emit(PttEvent::DeviceListChanged {
            at_ms: now_ms(),
            devices,
        });

        let (tx, rx): (Sender<SourceChunk>, Receiver<SourceChunk>) = mpsc::channel();
        let started = now_ms();
        self.ring.reset();
        self.hold_started_at = Instant::now();
        self.source_rx = Some(rx);
        self.chunk_seq = 0;
        self.listening = true;
        self.set_status(CaptureStatus::Listening);
        self.emit(PttEvent::ListeningStarted { at_ms: started });

        match self.source.open(&self.config, tx) {
            Ok(()) => {}
            Err(e) => {
                self.listening = false;
                self.press_active = false;
                self.source_rx = None;
                self.current_error = Some(e.clone());
                match e.code {
                    CaptureErrorCode::PermissionDenied => {
                        self.set_status(CaptureStatus::Denied);
                        self.emit(PttEvent::PermissionDenied {
                            at_ms: now_ms(),
                            error: e,
                        });
                    }
                    _ => {
                        self.set_status(CaptureStatus::NoDevice);
                        self.emit(PttEvent::NoDevice {
                            at_ms: now_ms(),
                            error: e,
                        });
                    }
                }
                self.emit(PttEvent::ListeningEnded {
                    at_ms: now_ms(),
                    duration_ms: 0,
                });
            }
        }
    }

    /// LET GO. Stops recording; WS-18 transcribes from `take_recording`.
    pub fn release(&mut self) {
        if !self.press_active && !self.listening {
            // Dead-end states reset on release so the next question can
            // type or retry freely (spec 20).
            match self.status {
                CaptureStatus::Denied
                | CaptureStatus::NoDevice
                | CaptureStatus::Error
                | CaptureStatus::Requesting => self.set_status(CaptureStatus::Idle),
                _ => {}
            }
            return;
        }
        self.press_active = false;

        if !self.listening {
            self.set_status(CaptureStatus::Idle);
            return;
        }
        self.listening = false;
        self.set_status(CaptureStatus::Stopping);

        let _ = self.source.close(); // failures are not user-visible
        self.source_rx = None;

        let ended = now_ms();
        let duration_ms = self.hold_started_at.elapsed().as_millis() as u64;
        let mut recording = self.ring.finish(0, 0);
        if recording.chunks.is_empty() {
            self.set_status(CaptureStatus::Idle);
            self.emit(PttEvent::Discarded {
                at_ms: ended,
                reason: DiscardReason::Release,
            });
            self.emit(PttEvent::ListeningEnded {
                at_ms: ended,
                duration_ms: 0,
            });
            return;
        }
        recording.duration_ms = duration_ms;
        self.completed = Some(recording);
        self.set_status(CaptureStatus::Idle);
        self.emit(PttEvent::ListeningEnded {
            at_ms: ended,
            duration_ms,
        });
    }

    /// Cancel without producing a recording.
    pub fn cancel(&mut self, reason: DiscardReason) {
        self.press_active = false;
        if self.listening {
            self.listening = false;
            let _ = self.source.close();
            self.source_rx = None;
            self.ring.reset();
            let ended = now_ms();
            self.emit(PttEvent::ListeningEnded {
                at_ms: ended,
                duration_ms: 0,
            });
        }
        self.set_status(CaptureStatus::Idle);
        self.emit(PttEvent::Discarded {
            at_ms: now_ms(),
            reason,
        });
    }

    /// Session end. Never leaves a device open (spec 8 cleanup).
    pub fn dispose(&mut self) {
        if self.disposed {
            return;
        }
        self.disposed = true;
        self.cancel(DiscardReason::Dispose);
        self.completed = None;
        self.ring.reset();
        self.current_error = None;
        self.set_status(CaptureStatus::Disposed);
        self.listeners.clear();
    }

    // ---------------------------------------------------------------- audio

    /// Test-only access to the underlying source (pump the fake).
    #[cfg(test)]
    pub fn source_mut(&mut self) -> &mut S {
        &mut self.source
    }

    // ---------------------------------------------------------------- audio

    /// Drain queued source chunks into the ring. Called by the shell
    /// bridge from the audio thread (and by tests directly).
    pub fn drain_source(&mut self) {
        let Some(rx) = self.source_rx.take() else {
            return;
        };
        loop {
            match rx.try_recv() {
                Ok(chunk) => self.on_source_chunk(chunk),
                Err(std::sync::mpsc::TryRecvError::Empty) => break,
                Err(std::sync::mpsc::TryRecvError::Disconnected) => break,
            }
        }
        self.source_rx = Some(rx);
    }

    /// Route one source chunk into the ring.
    pub fn on_source_chunk(&mut self, chunk: SourceChunk) {
        if !self.listening {
            return; // late frames after release are dropped
        }
        let seq = self.chunk_seq;
        self.chunk_seq += 1;
        let c = CaptureChunk {
            sequence: seq,
            sample_rate: chunk.sample_rate,
            channels: chunk.channels,
            samples: chunk.samples,
            captured_at_ms: chunk.captured_at_ms,
        };
        if self.ring.append(c) {
            // Ring is full: the oldest chunk was evicted. Never a
            // force-release by itself — the duration-limit clock (60 s)
            // is the only user-visible hold limit; a slow drain must not
            // truncate a valid recording mid-hold.
            let limit = self.config.duration_limit_ms;
            self.emit(PttEvent::DurationLimit {
                at_ms: now_ms(),
                limit_ms: limit,
            });
        }
    }

    /// Stuck-press safety: force-release after the duration limit.
    pub fn check_duration_limit(&mut self) {
        if self.listening
            && self.hold_started_at.elapsed()
                >= Duration::from_millis(self.config.duration_limit_ms)
        {
            let limit = self.config.duration_limit_ms;
            self.emit(PttEvent::DurationLimit {
                at_ms: now_ms(),
                limit_ms: limit,
            });
            self.release();
        }
    }

    // ---------------------------------------------------------------- util

    fn set_status(&mut self, status: CaptureStatus) {
        if self.status == status {
            return;
        }
        self.status = status;
        let error = self.current_error.clone();
        self.emit(PttEvent::StatusChanged {
            at_ms: now_ms(),
            status,
            error,
        });
    }
}

/// Ring capacity (in chunks) required to cover the full stuck-press
/// duration limit: a hold may legally run the whole 60 s, so the ring must
/// hold that much audio without evicting a single chunk.
fn ring_capacity_for(config: &CaptureConfig) -> usize {
    let chunk_ms = (config.chunk_frames * 1000) / config.sample_rate.max(1) as usize;
    let needed = (config.duration_limit_ms as usize) / chunk_ms.max(1);
    // Two extra chunks of headroom: covers a chunk in flight while
    // `drain_source` runs and the final partial chunk.
    needed + 2
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests;
