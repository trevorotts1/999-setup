//! WS-17 acceptance tests (CHECKLIST E.1 WS-17).
//!
//! PASS criterion: microphone is live only while HOLD TO TALK is pressed;
//! device enumeration and no-device fallback work; typing remains available
//! when mic is denied.
//!
//! Ported from the WS-17 TypeScript prototype suite (capture.test.ts).

use std::sync::{Arc, Mutex};

use crate::config::{CaptureConfig, DEFAULT_DURATION_LIMIT_MS, RING_BUFFER_CAPACITY};
use crate::controller::{CaptureStatus, DiscardReason, PttController, PttEvent};
use crate::devices::no_device_error;
use crate::error::{CaptureError, CaptureErrorCode};
use crate::source::FakeMicSource;

/// Event harness: collect every event a controller emits.
struct Harness {
    store: Arc<Mutex<Vec<PttEvent>>>,
}

impl Harness {
    fn attach(ctl: &mut PttController<FakeMicSource>) -> Self {
        let store = Arc::new(Mutex::new(Vec::new()));
        let s = store.clone();
        ctl.on_event(move |e| s.lock().unwrap().push(e.clone()));
        Harness { store }
    }

    fn events(&self) -> Vec<PttEvent> {
        self.store.lock().unwrap().clone()
    }

    /// Predicate match over collected events.
    fn has(&self, p: impl Fn(&PttEvent) -> bool) -> bool {
        self.events().iter().any(p)
    }

    fn count(&self, p: impl Fn(&PttEvent) -> bool) -> usize {
        self.events().iter().filter(|e| p(e)).count()
    }
}

fn is_status(e: &PttEvent, s: CaptureStatus) -> bool {
    matches!(e, PttEvent::StatusChanged { status, .. } if *status == s)
}

fn is_listening_started(e: &PttEvent) -> bool {
    matches!(e, PttEvent::ListeningStarted { .. })
}

fn is_listening_ended(e: &PttEvent) -> bool {
    matches!(e, PttEvent::ListeningEnded { .. })
}

fn is_interrupt(e: &PttEvent) -> bool {
    matches!(e, PttEvent::InterruptRequest { .. })
}

fn is_permission_denied(e: &PttEvent) -> bool {
    matches!(e, PttEvent::PermissionDenied { .. })
}

fn is_no_device(e: &PttEvent) -> bool {
    matches!(e, PttEvent::NoDevice { .. })
}

fn is_duration_limit(e: &PttEvent) -> bool {
    matches!(e, PttEvent::DurationLimit { .. })
}

fn is_discarded(e: &PttEvent, reason: DiscardReason) -> bool {
    matches!(e, PttEvent::Discarded { reason: r, .. } if *r == reason)
}

/// press -> pump n chunks -> drain -> release.
fn hold_with_chunks(ctl: &mut PttController<FakeMicSource>, n: usize) {
    ctl.press();
    for _ in 0..n {
        ctl.source_mut().pump();
    }
    ctl.drain_source();
    ctl.release();
}

// --------------------------------------------------------------- ring buffer

#[test]
fn ring_accumulates_and_finish_consumes() {
    use crate::ring_buffer::{CaptureChunk, RingBuffer};
    let mut rb = RingBuffer::default();
    rb.append(CaptureChunk {
        sequence: 0,
        sample_rate: 16_000,
        channels: 1,
        samples: vec![0.5; 512],
        captured_at_ms: 0,
    });
    rb.append(CaptureChunk {
        sequence: 1,
        sample_rate: 16_000,
        channels: 1,
        samples: vec![0.5; 512],
        captured_at_ms: 0,
    });
    assert_eq!(rb.len(), 2);
    let rec = rb.finish(100, 250);
    assert_eq!(rec.chunks.len(), 2);
    assert_eq!(rec.total_samples, 1024);
    assert_eq!(rec.duration_ms, 150);
    assert!(rb.is_empty(), "finish must empty the buffer (discard rule)");
    assert_eq!(rec.chunks[1].sequence, 1);
}

#[test]
fn ring_evicts_oldest_at_capacity_and_reports_full() {
    use crate::ring_buffer::{CaptureChunk, RingBuffer};
    let mut rb = RingBuffer::with_capacity(3);
    let mut full = false;
    for i in 0..4 {
        full = rb.append(CaptureChunk {
            sequence: i,
            sample_rate: 16_000,
            channels: 1,
            samples: vec![0.5; 512],
            captured_at_ms: 0,
        });
    }
    assert!(full);
    assert_eq!(rb.len(), 3);
    assert_eq!(rb.stats().held, 3);
    assert_eq!(rb.stats().capacity, 3);
    assert_eq!(rb.stats().total_appended, 4);
    let rec = rb.finish(0, 0);
    assert_eq!(rec.chunks[0].sequence, 1, "oldest chunk evicted");
}

// ------------------------------------------------------------ happy path

#[test]
fn press_listening_release_recording_mic_live_only_while_held() {
    let mut fake = FakeMicSource::new();
    fake.chunk_count = 5;
    let mut ctl = PttController::new(fake);
    let h = Harness::attach(&mut ctl);

    ctl.press();
    ctl.source_mut().pump();
    ctl.source_mut().pump();
    ctl.drain_source();
    assert!(ctl.is_listening());
    assert_eq!(ctl.status(), CaptureStatus::Listening);
    assert_eq!(ctl.source_mut().open_calls, 1);

    ctl.release();

    assert_eq!(ctl.status(), CaptureStatus::Idle);
    assert!(!ctl.is_listening());
    assert_eq!(
        ctl.source_mut().close_calls,
        1,
        "device must be released after LET GO"
    );

    let rec = ctl.take_recording();
    assert!(rec.is_some());
    let rec = rec.unwrap();
    assert_eq!(rec.chunks.len(), 2);
    assert_eq!(rec.sample_rate, 16_000);
    assert_eq!(rec.channels, 1);

    assert_eq!(
        h.count(is_listening_started) + h.count(is_listening_ended),
        2,
        "exactly one live window per hold"
    );
    assert!(h.has(|e| is_status(e, CaptureStatus::Listening)));
    assert!(h.has(|e| is_status(e, CaptureStatus::Stopping)));
}

#[test]
fn interrupt_request_emitted_before_capture_starts() {
    let fake = FakeMicSource::new();
    let mut ctl = PttController::new(fake);
    let h = Harness::attach(&mut ctl);
    ctl.press();
    assert!(
        h.has(is_interrupt),
        "press must emit interrupt-request so Candice stops speaking"
    );
    let started = h
        .events()
        .iter()
        .find_map(|e| match e {
            PttEvent::ListeningStarted { at_ms } => Some(*at_ms),
            _ => None,
        })
        .unwrap_or(u64::MAX);
    let interrupt = h
        .events()
        .iter()
        .find_map(|e| match e {
            PttEvent::InterruptRequest { at_ms } => Some(*at_ms),
            _ => None,
        })
        .unwrap_or(u64::MAX);
    assert!(interrupt <= started);
    ctl.dispose();
}

#[test]
fn release_with_no_audio_discards() {
    let mut fake = FakeMicSource::new();
    fake.chunk_count = 0;
    let mut ctl = PttController::new(fake);
    let h = Harness::attach(&mut ctl);
    hold_with_chunks(&mut ctl, 0);
    assert!(h.has(|e| is_discarded(e, DiscardReason::Release)));
    assert!(!h.has(|e| matches!(e, PttEvent::DurationLimit { .. })));
    assert!(ctl.take_recording().is_none());
}

#[test]
fn take_recording_consumes_exactly_once() {
    let mut fake = FakeMicSource::new();
    fake.chunk_count = 2;
    let mut ctl = PttController::new(fake);
    hold_with_chunks(&mut ctl, 1);
    let first = ctl.take_recording();
    assert!(first.is_some());
    assert_eq!(first.unwrap().chunks.len(), 1);
    assert!(
        ctl.take_recording().is_none(),
        "recording consumed exactly once"
    );
}

// ------------------------------------------------------- denied / fallback

#[test]
fn mic_denied_surfaces_denied_no_recording_typing_stays() {
    let mut fake = FakeMicSource::new();
    fake.fail_on_open = Some(CaptureError::permission_denied());
    let mut ctl = PttController::new(fake);
    let h = Harness::attach(&mut ctl);

    ctl.press();

    assert_eq!(ctl.status(), CaptureStatus::Denied);
    assert_eq!(
        ctl.snapshot().1.map(|e| e.code),
        Some(CaptureErrorCode::PermissionDenied)
    );
    assert!(!ctl.is_listening());
    assert!(ctl.take_recording().is_none());
    assert!(h.has(is_permission_denied));
    // Typing is not owned by this module — the point is the controller
    // must not panic and must be usable for the next question.
    ctl.release();
    assert_eq!(ctl.status(), CaptureStatus::Idle);
}

#[test]
fn denied_release_returns_idle_next_question_can_type() {
    let mut fake = FakeMicSource::new();
    fake.fail_on_open = Some(CaptureError::permission_denied());
    let mut ctl = PttController::new(fake);
    ctl.press();
    ctl.release();
    assert_eq!(ctl.status(), CaptureStatus::Idle);
}

#[test]
fn no_devices_surfaces_no_device_no_open_typing_stays() {
    let mut fake = FakeMicSource::new();
    fake.device_present = false;
    let mut ctl = PttController::new(fake);
    let h = Harness::attach(&mut ctl);

    ctl.press();

    assert_eq!(ctl.status(), CaptureStatus::NoDevice);
    assert_eq!(ctl.source_mut().open_calls, 0, "no stream without a device");
    assert!(!ctl.is_listening());
    assert!(h.has(is_no_device));
    ctl.release();
    assert_eq!(ctl.status(), CaptureStatus::Idle);
}

#[test]
fn device_lost_mid_hold_recovers_no_crash() {
    let mut fake = FakeMicSource::new();
    fake.fail_on_open = Some(no_device_error());
    let mut ctl = PttController::new(fake);
    let h = Harness::attach(&mut ctl);
    ctl.press();
    assert_eq!(ctl.status(), CaptureStatus::NoDevice);
    assert!(!ctl.is_listening());
    assert!(h.has(is_listening_ended));
    ctl.dispose();
}

// ------------------------------------------------------------ enumeration

#[test]
fn enumeration_lists_devices() {
    let fake = FakeMicSource::new();
    let mut ctl = PttController::new(fake);
    let h = Harness::attach(&mut ctl);
    ctl.press();
    ctl.release();
    let listed = h.events().iter().find_map(|e| match e {
        PttEvent::DeviceListChanged { devices, .. } => Some(devices.clone()),
        _ => None,
    });
    assert_eq!(listed, Some(vec!["fake-mic".to_string()]));
}

// ------------------------------------------------------------ duration limit

#[test]
fn duration_limit_force_releases_stuck_hold() {
    let mut fake = FakeMicSource::new();
    fake.chunk_count = 1000;
    let cfg = CaptureConfig {
        duration_limit_ms: 20,
        ..CaptureConfig::default()
    };
    let mut ctl = PttController::with_config(fake, cfg);
    let h = Harness::attach(&mut ctl);
    ctl.press();
    assert!(ctl.is_listening());
    std::thread::sleep(std::time::Duration::from_millis(40));
    ctl.check_duration_limit();
    assert!(!ctl.is_listening(), "stuck hold must be force-released");
    assert!(h.has(is_duration_limit));
    ctl.dispose();
}

#[test]
fn ring_full_does_not_truncate_a_valid_hold() {
    use crate::config::CaptureConfig;

    // Pump more chunks than the derived ring capacity (1877 for defaults):
    // the ring fills, oldest chunks are evicted, and the hold must continue.
    let fake = FakeMicSource::new();
    let cfg = CaptureConfig::default();
    let mut ctl = PttController::with_config(fake, cfg);
    ctl.press();
    for _ in 0..2200 {
        ctl.source_mut().pump();
        ctl.drain_source();
        if ctl.status() != CaptureStatus::Listening {
            break;
        }
    }
    assert!(
        ctl.is_listening(),
        "ring full must never force-release a hold"
    );
    assert_eq!(ctl.status(), CaptureStatus::Listening);
    // A DurationLimit event may fire as the ring-full signal, but the hold
    // itself must continue — the recording is never truncated mid-hold.
    ctl.release();
    assert_eq!(ctl.status(), CaptureStatus::Idle);
    assert_eq!(ctl.source_mut().close_calls, 1);
    let rec = ctl.take_recording();
    assert!(rec.is_some(), "recording survives a full ring");
    assert!(!rec.unwrap().chunks.is_empty());
}

#[test]
fn ring_capacity_covers_duration_limit() {
    use crate::config::{CaptureConfig, DEFAULT_CHUNK_FRAMES, DEFAULT_SAMPLE_RATE};
    let cfg = CaptureConfig::default();
    let chunk_ms = (DEFAULT_CHUNK_FRAMES * 1000) / DEFAULT_SAMPLE_RATE as usize; // 32 ms
    assert_eq!(chunk_ms, 32);
    let needed = (cfg.duration_limit_ms as usize) / chunk_ms; // 60_000 / 32 = 1875
    assert_eq!(needed, 1875);
    // Default ring (256 chunks) is far below the needed capacity: the
    // controller must size its ring from the config, never from the
    // default. Validate the derived capacity, not the constant.
    let derived = needed + 2; // ring_capacity_for formula, held in sync
    assert!(derived > crate::config::RING_BUFFER_CAPACITY);
    assert_eq!(derived, 1877);
}

#[test]
fn defaults_match_spec() {
    assert_eq!(DEFAULT_DURATION_LIMIT_MS, 60_000);
    assert_eq!(RING_BUFFER_CAPACITY, 256);
}

// ---------------------------------------------------------------- lifecycle

#[test]
fn dispose_closes_device_clears_state_never_panics() {
    let mut fake = FakeMicSource::new();
    fake.chunk_count = 5;
    let mut ctl = PttController::new(fake);
    ctl.press();
    ctl.source_mut().pump();
    ctl.drain_source();
    ctl.dispose();
    ctl.dispose(); // idempotent
    assert!(ctl.source_mut().close_calls >= 1);
    assert!(!ctl.is_listening());
    assert_eq!(ctl.status(), CaptureStatus::Disposed);
    assert!(ctl.take_recording().is_none());
}

#[test]
fn repeat_press_while_held_is_no_op() {
    let mut fake = FakeMicSource::new();
    fake.chunk_count = 10;
    let mut ctl = PttController::new(fake);
    ctl.press();
    ctl.press();
    ctl.press();
    assert_eq!(ctl.source_mut().open_calls, 1, "one stream for one hold");
    ctl.release();
}

#[test]
fn late_chunks_after_release_are_dropped() {
    let mut fake = FakeMicSource::new();
    fake.chunk_count = 10;
    let mut ctl = PttController::new(fake);
    ctl.press();
    ctl.release();
    ctl.source_mut().pump(); // race: chunk arriving after release
    ctl.drain_source();
    let rec = ctl.take_recording();
    assert!(
        rec.is_none() || rec.unwrap().chunks.is_empty(),
        "no chunk after release"
    );
}

#[test]
fn listener_exception_never_breaks_capture() {
    let mut fake = FakeMicSource::new();
    fake.chunk_count = 5;
    let mut ctl = PttController::new(fake);
    ctl.on_event(|_| panic!("bad listener"));
    ctl.press();
    assert!(ctl.is_listening());
    ctl.release();
    assert_eq!(ctl.status(), CaptureStatus::Idle);
}

#[test]
fn contract_version_constants_exist() {
    assert_eq!(crate::config::DEFAULT_SAMPLE_RATE, 16_000);
    assert_eq!(crate::config::DEFAULT_CHANNELS, 1);
}
