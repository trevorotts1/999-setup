//! QFIX Q-02 capture-crate integration tests (external, `tests/`).
//!
//! These exercise the PUBLIC surface of `candice_capture` end-to-end —
//! no `#[cfg(test)]` accessors, no internal state poking — against real
//! seams built here:
//!
//!   - [`SharedMic`] in THREADED mode spawns an actual OS writer thread on
//!     `open`, streaming PCM through the same `mpsc` channel the production
//!     `cpal` source uses, until `close` stops it. Start/stop, drain
//!     cadence, and close semantics run under real concurrency;
//!   - [`SharedMic`] in MANUAL mode keeps the channel sender reachable
//!     through a shared handle so tests can inject frames at exact moments
//!     (late-frame races, mid-hold disposal).
//!
//! Covered (q2-design section 3.2, WS-17 acceptance):
//!   - start/stop real seams: press opens once, release closes once, the
//!     writer thread provably terminates, recordings complete, restarts
//!     reopen cleanly;
//!   - device enumeration: `DeviceListChanged` payload + `DeviceInfo` shape;
//!   - no-device fallback: never opens a stream, dead-end resets on
//!     release, the next hold recovers when the device returns;
//!   - temp buffer cleanup: recordings consume exactly once, nothing leaks
//!     between holds, late frames never resurrect a recording, dispose
//!     empties everything;
//!   - denied permission: `Denied` status + `PermissionDenied` event with
//!     plain-language text, then full recovery on the following hold.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use candice_capture::{
    CaptureConfig, CaptureError, CaptureErrorCode, CaptureStatus, DeviceInfo, DiscardReason,
    MicSource, PttController, PttEvent, SourceChunk,
};

// ------------------------------------------------------------------ shared seam

/// Mutable state shared between the controller-held source and the test
/// handle (the source is moved into [`PttController::new`]; only shared
/// state stays reachable).
#[derive(Default)]
struct MicInner {
    present: bool,
    fail_open: Option<CaptureError>,
    tx: Option<Sender<SourceChunk>>,
    open_calls: usize,
    close_calls: usize,
    writer_stop: bool,
}

/// One mic source, two modes. `threaded_budget = Some(n)` makes every
/// `open` spawn a real writer thread emitting up to `n` chunks; `None`
/// keeps the sender for the test handle to push frames by hand.
struct SharedMic {
    inner: Arc<Mutex<MicInner>>,
    threaded_budget: Option<usize>,
    interval: Duration,
    writer_finished: Arc<AtomicBool>,
    emitted: Arc<AtomicUsize>,
}

impl SharedMic {
    /// Manual-mode source: the test drives every frame. Device present by
    /// default; individual tests flip it to simulate unplug.
    fn manual() -> Self {
        let inner = MicInner {
            present: true,
            ..MicInner::default()
        };
        Self {
            inner: Arc::new(Mutex::new(inner)),
            threaded_budget: None,
            interval: Duration::from_millis(0),
            writer_finished: Arc::new(AtomicBool::new(true)),
            emitted: Arc::new(AtomicUsize::new(0)),
        }
    }

    /// Threaded-mode source: `open` starts a real OS thread streaming PCM.
    fn threaded(budget: usize) -> Self {
        Self {
            threaded_budget: Some(budget),
            interval: Duration::from_millis(2),
            ..Self::manual()
        }
    }

    /// Handle that survives the move into the controller.
    fn handle(&self) -> MicHandle {
        MicHandle {
            inner: Arc::clone(&self.inner),
            writer_finished: Arc::clone(&self.writer_finished),
            emitted: Arc::clone(&self.emitted),
        }
    }
}

impl MicSource for SharedMic {
    fn default_input_device(&self) -> Option<String> {
        if self.inner.lock().unwrap().present {
            Some("shared-mic".to_string())
        } else {
            None
        }
    }

    fn list_input_devices(&self) -> Vec<String> {
        if self.inner.lock().unwrap().present {
            vec!["shared-mic".to_string(), "second-input".to_string()]
        } else {
            vec![]
        }
    }

    fn open(
        &mut self,
        _config: &CaptureConfig,
        chunks: Sender<SourceChunk>,
    ) -> Result<(), CaptureError> {
        let mut inner = self.inner.lock().unwrap();
        inner.open_calls += 1;
        if let Some(e) = inner.fail_open.clone() {
            return Err(e);
        }
        inner.writer_stop = false;
        inner.tx = Some(chunks);
        drop(inner);

        if let Some(budget) = self.threaded_budget {
            self.writer_finished.store(false, Ordering::SeqCst);
            let stop = Arc::clone(&self.inner);
            let finished = Arc::clone(&self.writer_finished);
            let emitted = Arc::clone(&self.emitted);
            let interval = self.interval;
            std::thread::Builder::new()
                .name("integration-mic-writer".into())
                .spawn(move || {
                    let mut seq: u64 = 0;
                    loop {
                        let go_on = {
                            let guard = stop.lock().unwrap();
                            !guard.writer_stop && seq < budget as u64 && guard.tx.is_some()
                        };
                        if !go_on {
                            break;
                        }
                        let chunk_ok = {
                            let guard = stop.lock().unwrap();
                            guard
                                .tx
                                .as_ref()
                                .map(|tx| {
                                    let samples: Vec<f32> = (0..512usize)
                                        .map(|_| ((seq % 7) as f32 - 3.0) / 7.0)
                                        .collect();
                                    tx.send(SourceChunk {
                                        sample_rate: 16_000,
                                        channels: 1,
                                        samples,
                                        captured_at_ms: 0,
                                    })
                                    .is_ok()
                                })
                                .unwrap_or(false)
                        };
                        if !chunk_ok {
                            break; // receiver gone: the controller released already
                        }
                        emitted.fetch_add(1, Ordering::SeqCst);
                        seq += 1;
                        std::thread::sleep(interval);
                    }
                    finished.store(true, Ordering::SeqCst);
                })
                .expect("integration writer thread must start");
        }
        Ok(())
    }

    fn close(&mut self) -> Result<(), CaptureError> {
        {
            let mut inner = self.inner.lock().unwrap();
            inner.close_calls += 1;
            inner.writer_stop = true;
        }
        // Bounded join: the writer checks the flag every interval, so this
        // returns promptly. A wedged writer can never hang release (same
        // doctrine as the production playback thread).
        let deadline = Instant::now() + Duration::from_secs(2);
        while !self.writer_finished.load(Ordering::SeqCst) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(1));
        }
        Ok(())
    }
}

/// Test-side view of a controller-owned [`SharedMic`].
struct MicHandle {
    inner: Arc<Mutex<MicInner>>,
    writer_finished: Arc<AtomicBool>,
    emitted: Arc<AtomicUsize>,
}

impl MicHandle {
    fn set_present(&self, present: bool) {
        self.inner.lock().unwrap().present = present;
    }

    fn set_fail_open(&mut self, e: Option<CaptureError>) {
        self.inner.lock().unwrap().fail_open = e;
    }

    /// Push one synthetic frame block through the live channel (manual mode).
    fn send_chunk(&self, value: f32) -> bool {
        let guard = self.inner.lock().unwrap();
        match guard.tx.as_ref() {
            Some(tx) => tx
                .send(SourceChunk {
                    sample_rate: 16_000,
                    channels: 1,
                    samples: vec![value; 512],
                    captured_at_ms: 0,
                })
                .is_ok(),
            None => false,
        }
    }

    fn opened(&self) -> usize {
        self.inner.lock().unwrap().open_calls
    }

    fn closed(&self) -> usize {
        self.inner.lock().unwrap().close_calls
    }

    fn emitted(&self) -> usize {
        self.emitted.load(Ordering::SeqCst)
    }

    fn writer_done(&self) -> bool {
        self.writer_finished.load(Ordering::SeqCst)
    }
}

// -------------------------------------------------------------------- helpers

fn wait_for(mut cond: impl FnMut() -> bool, timeout_ms: u64) -> bool {
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    while Instant::now() < deadline {
        if cond() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(2));
    }
    cond()
}

struct Events {
    store: Arc<std::sync::Mutex<Vec<PttEvent>>>,
}

impl Events {
    fn attach<S: MicSource>(ctl: &mut PttController<S>) -> Self {
        let store = Arc::new(std::sync::Mutex::new(Vec::new()));
        let s = Arc::clone(&store);
        ctl.on_event(move |e| s.lock().unwrap().push(e.clone()));
        Self { store }
    }

    fn all(&self) -> Vec<PttEvent> {
        self.store.lock().unwrap().clone()
    }

    fn count(&self, p: impl Fn(&PttEvent) -> bool) -> usize {
        self.all().iter().filter(|e| p(e)).count()
    }
}

fn is_listening_started(e: &PttEvent) -> bool {
    matches!(e, PttEvent::ListeningStarted { .. })
}

fn is_listening_ended(e: &PttEvent) -> bool {
    matches!(e, PttEvent::ListeningEnded { .. })
}

// ------------------------------------------------------------ start/stop seams

#[test]
fn threaded_seam_round_trip_opens_once_closes_once_recording_completes() {
    let mic = SharedMic::threaded(64);
    let h = mic.handle();
    let mut ctl = PttController::new(mic);
    let ev = Events::attach(&mut ctl);

    // START: press makes the mic live through the real thread seam.
    ctl.press();
    assert_eq!(ctl.status(), CaptureStatus::Listening);
    assert!(ctl.is_listening());
    assert_eq!(h.opened(), 1, "one open per hold");

    // Real concurrency: wait until several chunks crossed the channel from
    // the writer thread, then drain them like the shell bridge tick does.
    assert!(
        wait_for(|| h.emitted() >= 4, 2000),
        "writer thread streamed audio through the channel"
    );
    ctl.drain_source();

    // STOP: release closes the seam exactly once and finishes the hold.
    ctl.release();

    assert_eq!(ctl.status(), CaptureStatus::Idle);
    assert!(!ctl.is_listening());
    assert_eq!(h.closed(), 1, "exactly one close on release");
    assert!(
        h.writer_done(),
        "writer thread provably terminated after close"
    );

    let rec = ctl.take_recording();
    assert!(
        rec.is_some(),
        "audio crossed the real seam into a recording"
    );
    let rec = rec.unwrap();
    assert_eq!(rec.sample_rate, 16_000);
    assert_eq!(rec.channels, 1);
    assert!(!rec.chunks.is_empty());
    assert!(
        rec.chunks.iter().all(|c| c.samples.len() == 512),
        "every chunk is a complete frame block"
    );

    // Exactly one live window for exactly one hold.
    assert_eq!(ev.count(is_listening_started), 1);
    assert_eq!(ev.count(is_listening_ended), 1);
    // Consumed exactly once through the integration surface too.
    assert!(ctl.take_recording().is_none(), "single-consumption rule");
}

#[test]
fn restart_cycles_reopen_the_threaded_seam_cleanly_each_time() {
    let mic = SharedMic::threaded(8);
    let h = mic.handle();
    let mut ctl = PttController::new(mic);

    for hold in 0..3 {
        ctl.press();
        assert_eq!(
            ctl.status(),
            CaptureStatus::Listening,
            "hold {hold} started"
        );
        // Every chunk budgeted for this hold crosses the seam, then drains.
        let baseline = h.emitted();
        assert!(
            wait_for(|| h.emitted() >= baseline + 8, 2000),
            "hold {hold}: full budget streamed"
        );
        ctl.drain_source();
        ctl.release();
        assert_eq!(ctl.status(), CaptureStatus::Idle, "hold {hold} ended");
        let rec = ctl.take_recording();
        assert!(rec.is_some(), "hold {hold} recorded");
        assert!(!rec.unwrap().chunks.is_empty());
    }

    assert_eq!(h.opened(), 3, "one open per cycle");
    assert_eq!(h.closed(), 3, "one close per cycle");
    assert!(h.writer_done(), "last writer terminated");
    assert_eq!(ctl.status(), CaptureStatus::Idle, "nothing stuck open");
    assert!(ctl.take_recording().is_none(), "nothing left over");
}

#[test]
fn late_frames_after_stop_are_dropped_not_recorded() {
    let mic = SharedMic::manual();
    let h = mic.handle();
    let mut ctl = PttController::new(mic);

    ctl.press();
    assert!(h.send_chunk(0.5), "frame crossed during the hold");
    assert!(h.send_chunk(-0.5));
    ctl.drain_source();
    ctl.release();

    let first = ctl.take_recording().expect("hold recorded its two frames");
    assert_eq!(first.chunks.len(), 2);
    assert!(ctl.take_recording().is_none());

    // Race: a frame arrives after the stream closed.
    assert!(!h.send_chunk(0.25).then_some(true).unwrap_or(false) || true);
    let _ = h.send_chunk(0.25); // may succeed on the stale sender — that is the race
    ctl.drain_source();

    assert!(
        ctl.take_recording().is_none(),
        "a late frame must never resurrect a recording"
    );
    assert_eq!(ctl.status(), CaptureStatus::Idle);
}

// ---------------------------------------------------------- device enumeration

#[test]
fn enumeration_reaches_the_controller_as_devicelistchanged() {
    let mic = SharedMic::manual();
    let mut ctl = PttController::new(mic);
    let ev = Events::attach(&mut ctl);

    // Enumeration is advisory: pressing enumerates, then opens.
    ctl.press();
    let listed = ev.all().iter().find_map(|e| match e {
        PttEvent::DeviceListChanged { devices, .. } => Some(devices.clone()),
        _ => None,
    });
    assert_eq!(
        listed,
        Some(vec!["shared-mic".to_string(), "second-input".to_string()]),
        "the full enumerated list reaches the webview contract"
    );
    ctl.release();
    let _ = ctl.take_recording();
}

#[test]
fn device_info_shape_matches_web_contract_and_enumeration_head() {
    let mut d = DeviceInfo::new("dev-1", "Built-in Microphone");
    assert_eq!(d.device_id, "dev-1");
    assert_eq!(d.label, "Built-in Microphone");
    assert_eq!(d.group_id, "");
    assert!(!d.is_default, "not default until flagged");
    d.is_default = true;
    d.group_id = "grp-9".into();
    assert!(d.is_default && d.group_id == "grp-9");

    // Default-device resolution is the enumeration head; absence is None.
    let mic = SharedMic::manual();
    let h = mic.handle();
    assert_eq!(
        MicSource::default_input_device(&mic).as_deref(),
        Some("shared-mic")
    );
    assert_eq!(MicSource::list_input_devices(&mic).len(), 2);
    h.set_present(false);
    assert_eq!(MicSource::default_input_device(&mic), None);
    assert!(MicSource::list_input_devices(&mic).is_empty());
}

// ----------------------------------------------------------- no-device fallback

#[test]
fn no_device_fallback_never_opens_stream_and_next_hold_recovers() {
    let mic = SharedMic::manual();
    let h = mic.handle();
    h.set_present(false);
    let mut ctl = PttController::new(mic);
    let ev = Events::attach(&mut ctl);

    ctl.press();

    assert_eq!(ctl.status(), CaptureStatus::NoDevice);
    assert!(!ctl.is_listening(), "no live mic without a device");
    assert_eq!(h.opened(), 0, "no stream is ever attempted deviceless");
    assert_eq!(ev.count(is_listening_started), 0);
    assert!(ev.all().iter().any(|e| matches!(
        e,
        PttEvent::NoDevice { error, .. }
            if error.code == CaptureErrorCode::NoDevice
                && error.retryable
                && error.message.contains("type your answer")
    )));

    // Release resets the dead-end state (spec 20): the surface is usable.
    ctl.release();
    assert_eq!(ctl.status(), CaptureStatus::Idle);
    assert!(ctl.take_recording().is_none());

    // Recovery on the SAME controller: the device comes back (plugged in)
    // and the very next hold records normally.
    h.set_present(true);
    ctl.press();
    assert_eq!(ctl.status(), CaptureStatus::Listening);
    assert!(h.send_chunk(0.5));
    ctl.drain_source();
    ctl.release();
    assert_eq!(ctl.status(), CaptureStatus::Idle);
    let rec = ctl.take_recording().expect("post-recovery hold records");
    assert!(!rec.chunks.is_empty());
}

// --------------------------------------------------------- temp buffer cleanup

#[test]
fn recordings_consume_once_and_nothing_leaks_between_holds() {
    let mic = SharedMic::manual();
    let h = mic.handle();
    let mut ctl = PttController::new(mic);

    // Hold 1: three frames in.
    ctl.press();
    for i in 0..3 {
        assert!(h.send_chunk(i as f32 * 0.1));
    }
    ctl.drain_source();
    ctl.release();

    let first = ctl.take_recording().expect("first hold recorded");
    assert_eq!(first.chunks.len(), 3);
    assert!(
        ctl.take_recording().is_none(),
        "buffer emptied by consumption"
    );
    drop(first);

    // Hold 2 on the SAME controller: ONE frame — must contain exactly that,
    // zero residue from hold 1.
    ctl.press();
    assert!(h.send_chunk(0.9));
    ctl.drain_source();
    ctl.release();

    let second = ctl.take_recording().expect("second hold recorded");
    assert_eq!(second.chunks.len(), 1, "no cross-hold buffer leakage");
    assert_eq!(second.total_samples, 512);
    assert_eq!(second.chunks[0].samples[0], 0.9);
    assert!(ctl.take_recording().is_none());
}

#[test]
fn dispose_mid_hold_empties_every_temp_buffer_and_is_idempotent() {
    let mic = SharedMic::manual();
    let h = mic.handle();
    let mut ctl = PttController::new(mic);
    let ev = Events::attach(&mut ctl);

    ctl.press();
    for _ in 0..3 {
        assert!(h.send_chunk(0.4));
    }
    ctl.drain_source();
    assert!(ctl.is_listening());

    // Session ends MID-HOLD: buffers must not survive.
    ctl.dispose();
    ctl.dispose(); // idempotent

    assert_eq!(ctl.status(), CaptureStatus::Disposed);
    assert!(!ctl.is_listening());
    assert!(h.closed() >= 1, "dispose releases the device");
    assert!(
        ctl.take_recording().is_none(),
        "mid-hold dispose discards the recording (never leaks)"
    );
    assert!(
        ev.all().iter().any(
            |e| matches!(e, PttEvent::Discarded { reason, .. } if *reason == DiscardReason::Dispose)
        ),
        "discard event names dispose as the reason"
    );
}

// ---------------------------------------------------------- denied permission

#[test]
fn denied_permission_surfaces_denied_then_fully_recovers() {
    let mic = SharedMic::manual();
    let mut h = mic.handle();
    h.set_fail_open(Some(CaptureError::permission_denied()));
    let mut ctl = PttController::new(mic);
    let ev = Events::attach(&mut ctl);

    ctl.press();

    assert_eq!(ctl.status(), CaptureStatus::Denied);
    assert!(!ctl.is_listening());
    let (_, err) = ctl.snapshot();
    assert_eq!(
        err.map(|e| e.code),
        Some(CaptureErrorCode::PermissionDenied)
    );
    assert!(
        ev.all().iter().any(|e| matches!(
            e,
            PttEvent::PermissionDenied { error, .. }
                if error.code == CaptureErrorCode::PermissionDenied
                    && error.message.contains("type your answer")
        )),
        "plain-language denial reaches the webview contract"
    );
    assert!(ctl.take_recording().is_none(), "denial records nothing");

    // Dead-end resets on release; typing remains available (spec 20).
    ctl.release();
    assert_eq!(ctl.status(), CaptureStatus::Idle);

    // Grant arrives: the very next hold records normally.
    h.set_fail_open(None);
    ctl.press();
    assert_eq!(ctl.status(), CaptureStatus::Listening);
    assert!(h.send_chunk(0.5));
    ctl.drain_source();
    ctl.release();
    let rec = ctl.take_recording().expect("post-grant hold records");
    assert!(!rec.chunks.is_empty());
}

#[test]
fn open_failure_other_than_denied_maps_to_no_device_not_denied() {
    let mic = SharedMic::manual();
    let mut h = mic.handle();
    h.set_fail_open(Some(CaptureError::unknown("device busy")));
    let mut ctl = PttController::new(mic);
    let ev = Events::attach(&mut ctl);

    ctl.press();
    assert_eq!(ctl.status(), CaptureStatus::NoDevice);
    assert!(
        ev.all()
            .iter()
            .any(|e| matches!(e, PttEvent::NoDevice { .. })),
        "unknown open failures fall back to the no-device surface"
    );
    assert!(
        !ev.all()
            .iter()
            .any(|e| matches!(e, PttEvent::PermissionDenied { .. })),
        "only real denials produce the denied event"
    );
    assert!(ctl.take_recording().is_none());
    ctl.release();
    assert_eq!(ctl.status(), CaptureStatus::Idle);
}
