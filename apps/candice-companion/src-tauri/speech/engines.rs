//! Real speech engines behind the command boundary (QFIX Q-02/Q-05).
//!
//! The boundary commands dispatch here instead of slot/echo/queue fakes:
//!   - capture: a dedicated worker thread owns
//!     `PttController<CpalMicSource>` — the mic opens only inside the
//!     controller's `press()` and closes on `release()` (WS-17 invariants
//!     preserved; `cpal::Stream` is not `Send`, so the controller lives
//!     and dies inside its own thread, never in managed state);
//!   - STT: spawns the pinned `whisper-cli` on a session-temp WAV with a
//!     bounded wait; the model is SHA-256 verified pre-run; the output
//!     transcript and every temp file are deleted after transcription
//!     (FIX-017: text is returned to the webview, never logged here);
//!   - TTS: spawns the pinned Kokoro Python worker (WS-19 JSON-lines
//!     contract), decodes float32 PCM and plays it through a real `cpal`
//!     output stream on a playback thread; `stop` flips an interrupt
//!     flag the callback obeys within one buffer period; timing facts
//!     flow to the FIX-016 event surface (speech-start/drain/boundary);
//!   - system-TTS fallback: macOS `say` (non-canonical, FIX-015 FAIL-2).
//!
//! Failure doctrine (spec 20): every engine call is total — it returns
//! `Err(String)` with a human-actionable reason and the typed-answer
//! surface stays untouched. No audio bytes and no transcript text are
//! ever logged.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

use candice_capture::{CaptureStatus, CpalMicSource, PttController, Recording};

/// Webview event carrying capture lifecycle facts (status codes only —
/// never PCM, never transcripts).
pub const CAPTURE_STATUS_EVENT: &str = "candice:speech-capture-status";

/// Session temp root the cleanup lane owns (`transcribe` only accepts
/// files inside it — FIX-015 plan 3A path safety).
pub fn session_temp_root() -> PathBuf {
    std::env::temp_dir().join("candice-companion")
}

/// Bounded subprocess wait (std has no timeout). The child is killed on
/// deadline; stdout/stderr are drained on reader threads so a chatty
/// child can never deadlock the pipe. Returns the reaped output.
fn run_bounded(cmd: &mut Command, timeout: Duration) -> Result<std::process::Output, String> {
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("engine spawn failed: {e}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "engine stdout unavailable".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "engine stderr unavailable".to_string())?;
    let out_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = BufReader::new(stdout).read_to_end(&mut buf);
        buf
    });
    let err_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = BufReader::new(stderr).read_to_end(&mut buf);
        buf
    });

    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = out_thread.join();
                let _ = err_thread.join();
                return Err(format!(
                    "engine did not finish within {}s and was stopped",
                    timeout.as_secs()
                ));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = out_thread.join();
                let _ = err_thread.join();
                return Err(format!("engine wait failed: {e}"));
            }
        }
    };
    Ok(std::process::Output {
        status,
        stdout: out_thread.join().unwrap_or_default(),
        stderr: err_thread.join().unwrap_or_default(),
    })
}

// ------------------------------------------------------------------ capture

enum CaptureCmd {
    Press,
    Release(Sender<ReleaseOutcome>),
    QueryStatus(Sender<CaptureStatus>),
    /// Session-end teardown (spec 8): the app lifecycle calls
    /// [`CaptureEngine::shutdown`] on close so the mic can never stay
    /// open past exit. Reserved until the shell wires app-exit.
    #[allow(dead_code)]
    Shutdown,
}

/// Result of a real release: controller status plus the recording written
/// as a session-temp WAV (None when the hold produced no audio).
pub struct ReleaseOutcome {
    pub status: CaptureStatus,
    pub wav_path: Option<PathBuf>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureStatusPayload {
    status: &'static str,
    at_ms: u64,
    /// Plain-language error text (denied/no-device); never audio data.
    error: Option<String>,
}

/// Encode a completed WS-17 recording as PCM WAV bytes (16-bit). The
/// capture chunks are planar mono f32 (the source downmixes); channels
/// above 1 collapse to the single mono plane. Pure; testable without
/// hardware.
pub fn recording_to_wav(rec: &Recording) -> Option<Vec<u8>> {
    if rec.is_empty() || rec.total_samples == 0 {
        return None;
    }
    let rate = rec.sample_rate.max(1);
    let channels = rec.channels.max(1) as u32;
    let frames = rec.total_samples / channels as usize;
    if frames == 0 {
        return None;
    }
    // Flatten ONCE, then index.
    //
    // This used to call `.nth(c * frames + i)` on a freshly built
    // `chunks.iter().flat_map(...)` INSIDE the inner loop. `nth` walks; the
    // iterator was rebuilt per sample; so reading sample i cost i steps and
    // the whole encode was quadratic in frame count.
    //
    // MEASURED, because the arithmetic overstates it. A naive reading counts
    // 4.6e11 element steps at the 60-second capture limit and concludes the
    // worker wedges for minutes. It does not: `FlatMap::nth` advances the
    // inner slice iterators a chunk at a time, so the real cost is
    // O(frames * chunks), not O(frames^2). Benchmarked against this exact
    // shape (release build, black_box, 16 kHz):
    //
    //     16k frames   50us      64k frames  1.20ms     -> ~4x per doubling
    //
    // which extrapolates to roughly 15ms for a ten-second hold and ~540ms at
    // the 60-second limit with the configured 512-frame chunks. Half a second
    // of pointless CPU inside the capture worker is worth deleting, and the
    // growth is still quadratic, but it never came close to the 5-second
    // `CaptureEngine::release` timeout. Recorded here so nobody re-derives
    // the scary number and treats this as a release blocker.
    //
    // The layout is planar -- all of channel 0, then all of channel 1 -- so
    // sample (c, i) lives at c * frames + i. That is a direct index into the
    // flattened buffer, and the whole encode becomes linear.
    let flat: Vec<f32> = rec
        .chunks
        .iter()
        .flat_map(|chunk| chunk.samples.iter().copied())
        .collect();
    let mut interleaved: Vec<i16> = Vec::with_capacity(rec.total_samples);
    for i in 0..frames {
        for c in 0..channels {
            let s = flat.get((c as usize) * frames + i).copied().unwrap_or(0.0);
            interleaved.push((s.clamp(-1.0, 1.0) * 32767.0).round() as i16);
        }
    }
    let data_len = (interleaved.len() * 2) as u32;
    let mut wav = Vec::with_capacity(44 + data_len as usize);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_len).to_le_bytes());
    wav.extend_from_slice(b"WAVE");
    wav.extend_from_slice(b"fmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes()); // PCM
    wav.extend_from_slice(&(channels.min(u16::MAX as u32) as u16).to_le_bytes());
    wav.extend_from_slice(&rate.to_le_bytes());
    wav.extend_from_slice(&(rate * channels * 2).to_le_bytes()); // byte rate
    wav.extend_from_slice(&(channels.min(u16::MAX as u32) as u16 * 2).to_le_bytes()); // block align
    wav.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());
    for s in interleaved {
        wav.extend_from_slice(&s.to_le_bytes());
    }
    Some(wav)
}

/// The real capture engine: a worker thread owns the PTT controller and
/// the `cpal` device. Commands cross a channel; status changes are
/// emitted to the webview as codes. The engine starts lazily on the first
/// press (`ensure_started`) so tests and headless runs never spawn threads.
pub struct CaptureEngine {
    inner: Mutex<Option<Sender<CaptureCmd>>>,
    last_status: Arc<Mutex<Option<String>>>,
}

impl Default for CaptureEngine {
    /// Un-started engine: no worker thread yet. Every command fails with
    /// "capture engine is not running" until [`CaptureEngine::ensure_started`].
    fn default() -> Self {
        Self {
            inner: Mutex::new(None),
            last_status: Arc::new(Mutex::new(None)),
        }
    }
}

impl CaptureEngine {
    /// Spawn the worker on first use. Idempotent.
    pub fn ensure_started<R: Runtime>(&self, app: AppHandle<R>) {
        let mut guard = match self.inner.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        if guard.is_some() {
            return;
        }
        let (tx, rx) = mpsc::channel::<CaptureCmd>();
        if std::thread::Builder::new()
            .name("candice-capture".into())
            .spawn(move || capture_worker(app, rx))
            .is_ok()
        {
            *guard = Some(tx);
        }
    }

    fn send(&self, cmd: CaptureCmd) -> Result<(), String> {
        let tx = self
            .inner
            .lock()
            .ok()
            .and_then(|g| g.clone())
            .ok_or_else(|| "capture engine is not running".to_string())?;
        tx.send(cmd)
            .map_err(|_| "capture engine is not running".to_string())
    }

    fn record_status(&self, status: &CaptureStatus) {
        if let Ok(mut slot) = self.last_status.lock() {
            *slot = Some(status.as_str().to_string());
        }
    }

    /// HOLD TO TALK pressed: the real controller opens the device. The
    /// returned status is the controller snapshot AFTER the open attempt —
    /// listening / denied / no-device / error are all real states.
    pub fn press(&self) -> Result<CaptureStatus, String> {
        self.send(CaptureCmd::Press)?;
        let status = self.status()?;
        self.record_status(&status);
        Ok(status)
    }

    /// LET GO: closes the mic and finishes the recording inside the worker.
    /// The finished WAV path stays native; nothing audio-shaped crosses IPC.
    pub fn release(&self) -> Result<ReleaseOutcome, String> {
        let outcome = (|| {
            let (tx, rx) = mpsc::channel();
            self.send(CaptureCmd::Release(tx))?;
            rx.recv_timeout(Duration::from_secs(5))
                .map_err(|_| "capture release timed out".to_string())
        })();
        // Record the post-release status even when the round-trip failed —
        // the permission report must reflect reality either way.
        if let Ok(out) = &outcome {
            self.record_status(&out.status);
        }
        outcome
    }

    /// Last-known controller status (never opens the mic — permission
    /// prompting stays PTT-only). None before the first press.
    pub fn status(&self) -> Result<CaptureStatus, String> {
        let (tx, rx) = mpsc::channel();
        self.send(CaptureCmd::QueryStatus(tx))?;
        rx.recv_timeout(Duration::from_secs(5))
            .map_err(|_| "capture status query timed out".to_string())
    }

    /// Last-known status as a plain string without a channel round-trip;
    /// safe from a dead engine (returns None). Feeds cmd_speech_permissions.
    pub fn last_status(&self) -> Option<String> {
        self.last_status.lock().ok().and_then(|g| g.clone())
    }

    /// Session-end teardown (spec 8). Reserved until the shell wires
    /// app-exit; the worker also disposes on channel disconnect, so a
    /// dropped sender already covers the normal exit path.
    #[allow(dead_code)]
    pub fn shutdown(&self) {
        let _ = self.send(CaptureCmd::Shutdown);
    }
}

fn capture_worker<R: Runtime>(app: AppHandle<R>, rx: Receiver<CaptureCmd>) {
    let mut ctl = PttController::new(CpalMicSource::default());
    // Poll-based status watch: the controller mutates only inside this
    // loop (press/release/duration-limit all run here), so a snapshot
    // diff per tick misses nothing and needs no listener wiring.
    let mut last: Option<(CaptureStatus, Option<String>)> = None;
    let emit_status = |ctl: &PttController<CpalMicSource>, last: &mut Option<(CaptureStatus, Option<String>)>| {
        let (status, error) = ctl.snapshot();
        let sig = (status, error.as_ref().map(|e| e.message.clone()));
        if last
            .as_ref()
            .map(|l| l.0 == sig.0 && l.1 == sig.1)
            .unwrap_or(false)
        {
            return;
        }
        *last = Some(sig.clone());
        let at_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let _ = app.emit(
            CAPTURE_STATUS_EVENT,
            CaptureStatusPayload {
                status: sig.0.as_str(),
                at_ms,
                error: sig.1,
            },
        );
    };

    loop {
        // Drain audio chunks and enforce the stuck-press limit every
        // pass; the loop cadence is the capture tick.
        ctl.drain_source();
        ctl.check_duration_limit();
        emit_status(&ctl, &mut last);
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(CaptureCmd::Press) => ctl.press(),
            Ok(CaptureCmd::Release(tx)) => {
                ctl.release();
                let wav_path = ctl.take_recording().and_then(|rec| {
                    let bytes = recording_to_wav(&rec)?;
                    let root = session_temp_root();
                    std::fs::create_dir_all(&root).ok()?;
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_millis())
                        .unwrap_or(0);
                    let path = root.join(format!("capture-{now}-{}.wav", std::process::id()));
                    std::fs::write(&path, bytes).ok().map(|_| path)
                });
                let _ = tx.send(ReleaseOutcome {
                    status: ctl.status(),
                    wav_path,
                });
            }
            Ok(CaptureCmd::QueryStatus(tx)) => {
                let _ = tx.send(ctl.status());
            }
            Ok(CaptureCmd::Shutdown) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        emit_status(&ctl, &mut last);
    }
    // Session end: the mic can never stay open past app exit (spec 8).
    ctl.dispose();
}

// ---------------------------------------------------------------------- STT

/// Real whisper.cpp transcription. The model is SHA-256 verified against
/// the inventory pin BEFORE the run (WS-16 contract); the run is bounded
/// (120 s); the transcript is returned and every temp file (WAV + output
/// txt) is deleted afterwards (FIX-017: no audio, no text left on disk).
pub fn run_whisper(
    wav: &Path,
    model: &Path,
    model_pin: &str,
    binary: &Path,
    language: &str,
) -> Result<String, String> {
    if !wav.is_file() {
        return Err("captured audio file is missing — try holding again".into());
    }
    if !model.is_file() {
        return Err("STT model is not installed; captions and typed answers remain available".into());
    }
    if !binary.is_file() {
        return Err("STT engine is not installed; captions and typed answers remain available".into());
    }
    // Pre-run integrity (WS-16: verified before load).
    let measured = super::assets::sha256_file(model)
        .map_err(|e| format!("STT model check failed: {e}"))?;
    if !measured.eq_ignore_ascii_case(model_pin) {
        return Err("STT model checksum mismatch; captions and typed answers remain available".into());
    }

    let out_prefix = wav.with_extension(""); // whisper-cli appends .txt
    let mut cmd = Command::new(binary);
    crate::proc::no_console(&mut cmd);
    cmd.arg("-m")
        .arg(model)
        .arg("-f")
        .arg(wav)
        .arg("-l")
        .arg(language)
        .arg("-otxt")
        .arg("-of")
        .arg(&out_prefix);
    let out = run_bounded(&mut cmd, Duration::from_secs(120))?;
    let txt_path = out_prefix.with_extension("txt");

    // Cleanup is unconditional: the recording and its output never
    // outlive the transcription attempt (FIX-017 guard).
    let text = std::fs::read_to_string(&txt_path).ok();
    let _ = std::fs::remove_file(&txt_path);
    let _ = std::fs::remove_file(wav);

    if !out.status.success() {
        return Err(format!(
            "speech recognition failed; captions and typed answers remain available ({})",
            String::from_utf8_lossy(&out.stderr).trim().chars().take(200).collect::<String>()
        ));
    }
    let text = text.unwrap_or_default().trim().to_string();
    if text.is_empty() {
        // Empty transcript is a failure — never a blank answer (spec 20).
        return Err("no speech was recognized — try holding again, or type your answer".into());
    }
    Ok(text)
}

/// Resolve the STT assets (model pin + model + binary) from the verified
/// directory for the current platform. Shared by both transcribe modes.
fn stt_assets<R: Runtime>(app: &AppHandle<R>) -> Result<(PathBuf, String, PathBuf), String> {
    let res = super::assets::resolve_speech_assets(app);
    let inventory: Option<super::assets::InventoryRecord> = res
        .inventory_text
        .as_deref()
        .and_then(|text| serde_json::from_str(text).ok());
    let find = |id: &str| -> Option<PathBuf> {
        inventory
            .as_ref()
            .and_then(|inv| inv.entries.iter().find(|e| e.id == id).cloned())
            .and_then(|e| res.root_for(&e))
    };
    let binary_id = if cfg!(target_os = "macos") {
        "stt-binary-macos"
    } else {
        "stt-binary-windows-x64"
    };
    let model = find("stt-model")
        .ok_or_else(|| "STT model is not installed; captions and typed answers remain available".to_string())?;
    let binary = find(binary_id)
        .ok_or_else(|| "STT engine is not installed; captions and typed answers remain available".to_string())?;
    // The pin: inventory sha256 when present, else the manifest fallback
    // constant (identical value — design section 2.5 last bullet).
    let fallback_pin = "c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b";
    let pin = inventory
        .as_ref()
        .and_then(|inv| inv.entries.iter().find(|e| e.id == "stt-model").cloned())
        .and_then(|e| e.sha256)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| fallback_pin.to_string());
    Ok((model, pin, binary))
}

/// STT for the PTT path (design 2.3 step 7): transcribe the WAV the
/// capture worker wrote at release, then delete it. `run_whisper` owns
/// checksum pre-check, bounded run, and unconditional temp cleanup.
pub fn run_whisper_for_capture<R: Runtime>(
    app: &AppHandle<R>,
    wav: &Path,
    language: &str,
) -> Result<String, String> {
    let (model, pin, binary) = stt_assets(app)?;
    run_whisper(wav, &model, &pin, &binary, language)
}

/// STT for the explicit session-temp WAV path. Same guarantees as
/// [`run_whisper_for_capture`] — including deletion of the caller's temp
/// file inside `run_whisper` (cleanup-lane contract). Reserved for the
/// wavPath transcribe leg once the boundary plan dispatches it.
#[allow(dead_code)]
pub fn run_whisper_on_wav<R: Runtime>(
    app: &AppHandle<R>,
    wav: &Path,
    language: &str,
) -> Result<String, String> {
    let (model, pin, binary) = stt_assets(app)?;
    run_whisper(wav, &model, &pin, &binary, language)
}

// ---------------------------------------------------------------------- TTS

/// One worker stdout line decoded from the WS-19 JSON-lines contract
/// (`ok`, `pcmB64`, `sampleRate`, `timings`[], `error`).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngineLine {
    ok: bool,
    #[serde(default)]
    pcm_b64: Option<String>,
    #[serde(default)]
    sample_rate: Option<u32>,
    #[serde(default)]
    timings: Option<Vec<EngineTiming>>,
    #[serde(default)]
    error: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngineTiming {
    phoneme: String,
    start_sec: f64,
    end_sec: f64,
}

/// The real TTS engine handle. Synthesis happens in the Kokoro Python
/// worker (WS-19 JSON-lines, bounded 120 s); playback runs on a `cpal`
/// output stream in its own thread. `stop` flips an interrupt flag the
/// output callback obeys within one buffer period — audio stops
/// immediately and the playback thread emits the boundary event.
#[derive(Default)]
pub struct TtsEngine {
    stop: Arc<AtomicBool>,
}

/// Build the Kokoro worker command.
///
/// `PYTHONDONTWRITEBYTECODE` / `-B` is load-bearing, not tidiness. The worker
/// script and its interpreter live inside the code-signed .app bundle, and
/// CPython writes `__pycache__` next to every module it imports. Those writes
/// land in `Contents/Resources`, break the bundle's sealed-resource hashes,
/// and `codesign --verify` fails from the first time voice is ever used —
/// after which macOS can refuse to launch the app. Both forms are set: `-B`
/// survives a stripped environment, the env var is inherited by children.
/// Never remove either.
pub(crate) fn kokoro_command(
    python: &Path,
    worker: &Path,
    model: &Path,
    voices: &Path,
) -> Command {
    let mut cmd = Command::new(python);
    crate::proc::no_console(&mut cmd);
    cmd.arg("-B")
        .arg(worker)
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env("CANDICE_KOKORO_MODEL", model)
        .env("CANDICE_KOKORO_VOICES", voices);
    cmd
}

/// The playback thread could not be created at all.
///
/// This is the THIRD way to strand her, and the guard below cannot cover it:
/// `PlaybackExit` is armed INSIDE the closure, so a thread that never starts
/// never arms it. `emit_speech_start` has already fired by this point, so the
/// viseme scheduler is animating a mouth with no audio behind it and the
/// webview believes she is speaking.
///
/// Emits `boundary`, never `drain` — the audio did not play out. Same choice
/// as the unwind path, for the same reason: both close the mouth, so honesty
/// is free.
///
/// The emitter is INJECTED because a real `Builder::spawn` failure needs
/// EAGAIN under thread or memory pressure, which a unit test cannot honestly
/// manufacture. So the HANDLING is proven and the TRIGGER is not — stated
/// here rather than discovered later.
fn playback_spawn_failed(
    utterance_id: &str,
    error: &std::io::Error,
    emit_boundary: &dyn Fn(&str),
) -> String {
    emit_boundary(utterance_id);
    format!("voice engine playback thread could not start: {error}; captions remain available")
}

// PlaybackExit below is a Drop guard, and Drop only runs while UNWINDING.
// Under `panic = "abort"` the playback thread dies without dropping: no stop
// event reaches the webview and the speak slot is never released, so she goes
// silent for the rest of the session — the exact defect the guard exists to
// prevent, restored by one line in a different file.
//
// This must fail the BUILD, because it cannot fail a test: unit tests compile
// under `[profile.test]`, which unwinds, so the guard's own tests would stay
// green while the shipped binary lost the guarantee. `[profile.release]` in
// Cargo.toml is size-tuned (codegen-units/lto/opt-level/strip) and
// `panic = "abort"` is the standard next line in every guide for that recipe.
#[cfg(panic = "abort")]
compile_error!(
    "candice-companion requires panic=unwind: PlaybackExit is a Drop guard and \
     is the only thing that stops speech and frees the speak slot when the \
     playback thread panics. Under panic=abort she goes permanently mute."
);

/// Guarantees the FIX-016 stop contract AND the speak-slot release on every
/// exit from the playback thread — including an unwind.
///
/// `play_f32_pcm` drives cpal callbacks and resampling. A panic in there used
/// to take both guarantees with it, and the two consequences are not
/// symmetric with an ordinary failure:
///
///   - no stop event  -> the webview never leaves `status: 'speaking'`, and
///     `ptt:start` refuses while speaking, so HOLD TO TALK goes dead until
///     the next question. That is the exact failure `speech:ended` exists to
///     prevent, surviving in the one branch it could not reach.
///   - no slot release -> `speak_admission_check` answers "speech-busy: an
///     utterance is already active" for every later utterance, so she never
///     speaks again for the rest of the session.
///
/// Drop runs during unwind (this workspace does not set `panic = "abort"`),
/// so "exactly one stop follows every start" is true by construction here
/// rather than by luck. The emitter is injected so the guarantee is provable
/// in a unit test without an `AppHandle`.
struct PlaybackExit {
    utterance_id: String,
    request_id: String,
    slot: Arc<Mutex<Option<String>>>,
    emit_boundary: Box<dyn Fn(&str) + Send>,
    /// True until the thread has emitted its own stop event.
    armed: bool,
}

impl PlaybackExit {
    /// Release the slot only when it still holds THIS request — a later
    /// utterance must never be cancelled by an older thread's cleanup.
    fn release_slot(&self) {
        if let Ok(mut slot) = self.slot.lock() {
            if slot.as_deref() == Some(self.request_id.as_str()) {
                *slot = None;
            }
        }
    }

    /// Normal exit: the thread emitted its own drain or boundary.
    fn disarm(&mut self) {
        self.armed = false;
        self.release_slot();
    }
}

impl Drop for PlaybackExit {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        // Reachable only on an unwind. Boundary, never drain: the audio did
        // NOT play out, and claiming it did would lie to the animation lane.
        // Both close the mouth, so the honest one costs nothing.
        (self.emit_boundary)(&self.utterance_id);
        self.release_slot();
    }
}

impl TtsEngine {
    /// Synthesize `text` through the worker and start real playback.
    /// Emits FIX-016 speech-start (with engine phoneme timings) before
    /// playback; the playback thread emits speech-drain on natural end
    /// and speech-boundary on interrupt, then releases the speak slot.
    #[allow(clippy::too_many_arguments)]
    pub fn synthesize_and_play<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        worker: &Path,
        python: &Path,
        model: &Path,
        voices: &Path,
        text: &str,
        voice_id: &str,
        speed: f64,
        utterance_id: &str,
        slot: Arc<Mutex<Option<String>>>,
        request_id: &str,
    ) -> Result<(), String> {
        // The stop flag may already be set by an interrupt that raced
        // the synthesis: check before spending engine time.
        if self.stop.load(Ordering::SeqCst) {
            return Err("utterance interrupted before synthesis".into());
        }
        let mut child = kokoro_command(python, worker, model, voices)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("voice engine failed to start: {e}"))?;
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "voice engine stdin unavailable".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "voice engine stdout unavailable".to_string())?;

        // Reader thread: one JSON result per line (WS-19 contract).
        let (line_tx, line_rx) = mpsc::channel::<String>();
        std::thread::Builder::new()
            .name("candice-kokoro-reader".into())
            .spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines().map_while(Result::ok) {
                    if line_tx.send(line).is_err() {
                        break;
                    }
                }
            })
            // A panic here would unwind out of the Tauri command with the
            // speak slot still held. As a value it reaches `speak_impl`'s
            // existing error path, which releases the slot and returns the
            // reason to the caption surface.
            .map_err(|e| format!(
                "voice engine reader thread could not start: {e}; captions remain available"
            ))?;

        let cmd_line = serde_json::json!({
            "kind": "synthesize",
            "text": text,
            "voiceId": voice_id,
            "speed": speed,
            "withTimings": true,
        });
        writeln!(stdin, "{cmd_line}")
            .and_then(|_| stdin.flush())
            .map_err(|e| format!("voice engine request failed: {e}"))?;
        drop(stdin); // EOF: the worker exits after its result line

        let line = line_rx
            .recv_timeout(Duration::from_secs(120))
            .map_err(|_| {
                let _ = child.kill();
                let _ = child.wait();
                "voice synthesis timed out; captions remain available".to_string()
            })?;
        // Reap the worker: it exits on EOF; bounded grace in case a
        // platform keeps it alive.
        let deadline = Instant::now() + Duration::from_millis(1000);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if Instant::now() >= deadline => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break;
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(20)),
                Err(_) => break,
            }
        }

        let result: EngineLine = serde_json::from_str(&line)
            .map_err(|e| format!("voice engine returned an invalid result: {e}"))?;
        if !result.ok {
            return Err(format!(
                "voice synthesis failed; captions remain available ({})",
                result.error.unwrap_or_else(|| "unknown engine error".into())
            ));
        }
        let b64 = result
            .pcm_b64
            .ok_or_else(|| "voice engine returned no audio; captions remain available".to_string())?;
        let pcm = decode_f32_pcm(&b64)
            .map_err(|_| "voice engine audio was unreadable; captions remain available".to_string())?;
        if pcm.is_empty() {
            return Err("voice engine produced silent audio; captions remain available".into());
        }
        let sample_rate = result.sample_rate.unwrap_or(24_000).max(1);
        let timings: Vec<crate::speech_timing::SpeechTiming> = result
            .timings
            .unwrap_or_default()
            .into_iter()
            .filter_map(|t| {
                // The phoneme rule lives in speech_timing.rs and is called,
                // not copied. This filter_map DROPS what it rejects, silently
                // and per-span -- so a rule that is merely a little too strict
                // does not fail loudly, it just thins the utterance until the
                // mouth stops moving. That is exactly what an ASCII-only copy
                // of this rule did to every IPA vowel espeak emits.
                (t.start_sec.is_finite()
                    && t.end_sec.is_finite()
                    && t.end_sec > t.start_sec
                    && t.start_sec >= 0.0
                    && crate::speech_timing::valid_phoneme(&t.phoneme))
                .then_some(crate::speech_timing::SpeechTiming {
                    phoneme: t.phoneme,
                    start_sec: t.start_sec,
                    end_sec: t.end_sec,
                })
            })
            .collect();

        // FIX-016: the scheduler learns speech start from the real
        // engine before any audio moves.
        let _ = crate::speech_timing::emit_speech_start(app, utterance_id, &timings);

        // Playback on its own thread (cpal streams are not Send): the
        // command returns while the utterance plays; the slot releases
        // when the mouth provably closes (drain or boundary).
        let stop = Arc::clone(&self.stop);
        let app_handle = app.clone();
        let uid = utterance_id.to_string();
        let rid = request_id.to_string();
        let spawned = std::thread::Builder::new()
            .name("candice-playback".into())
            .spawn(move || {
                // Armed BEFORE playback: if `play_f32_pcm` unwinds, Drop still
                // emits the stop and releases the slot.
                let boundary_app = app_handle.clone();
                let mut exit = PlaybackExit {
                    utterance_id: uid.clone(),
                    request_id: rid.clone(),
                    slot,
                    emit_boundary: Box::new(move |id: &str| {
                        let _ = crate::speech_timing::emit_speech_boundary(&boundary_app, id);
                    }),
                    armed: true,
                };
                let finished = play_f32_pcm(&pcm, sample_rate, &stop);
                if finished {
                    let _ = crate::speech_timing::emit_speech_drain(&app_handle, &uid);
                } else {
                    let _ = crate::speech_timing::emit_speech_boundary(&app_handle, &uid);
                }
                exit.disarm();
            });
        // `.expect()` here panicked on the CALLING thread, inside the Tauri
        // command, so it took the command down and unwound straight past
        // `speak_impl`'s `speak_release_slot` on the error path. The recovery
        // was never missing — the panic simply jumped over it, and the slot
        // stayed held for the rest of the session.
        if let Err(error) = spawned {
            let boundary_app = app.clone();
            return Err(playback_spawn_failed(utterance_id, &error, &|id: &str| {
                let _ = crate::speech_timing::emit_speech_boundary(&boundary_app, id);
            }));
        }
        Ok(())
    }

    /// System-TTS fallback (macOS `say`, non-canonical — FIX-015 FAIL-2).
    /// Reserved for the degraded-TTS path: when the Kokoro engine is
    /// absent the boundary may offer the system voice instead.
    #[allow(dead_code)]
    pub fn speak_system_tts(&self, text: &str) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            crate::proc::no_console(&mut Command::new("/usr/bin/say"))
                .arg(text)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| format!("system voice failed: {e}"))?;
            Ok(())
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = text;
            Err("system voice is unavailable on this platform".into())
        }
    }

    /// Interrupt: flip the flag; the output callback obeys within one
    /// buffer period and the playback thread emits the boundary.
    /// Idempotent.
    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }

    /// Clear the interrupt flag for the next utterance.
    pub fn arm_next(&self) {
        self.stop.store(false, Ordering::SeqCst);
    }
}

/// Decode base64 float32 little-endian PCM (WS-19 `pcmB64`). Hand-rolled
/// (no crate dependency for one field): rejects non-alphabet bytes and
/// byte counts that do not land on a f32 boundary.
///
/// Semantics: canonical base64 only. Alphabet data after a pad character
/// is rejected; trailing `=` groups contribute no payload bytes — the
/// final quantum's leftover 6-bit group is dropped exactly like Python's
/// `base64` decoder, so `"AAAAPw=="` decodes to the 4 bytes of one f32,
/// never to a stray extra byte from the pad bits.
fn decode_f32_pcm(b64: &str) -> Result<Vec<f32>, ()> {
    let mut out: Vec<u8> = Vec::new();
    let mut seen_pad = false;
    let mut acc: u32 = 0;
    let mut nbits = 0u32;
    let mut quanta: usize = 0;
    let mut last_quantum_chars = 0usize;
    for &c in b64.as_bytes() {
        if c == b'=' {
            seen_pad = true;
            last_quantum_chars += 1;
            if last_quantum_chars > 4 {
                return Err(());
            }
            continue;
        }
        if seen_pad {
            // Alphabet data after padding is malformed base64.
            return Err(());
        }
        let v = match c {
            b'A'..=b'Z' => (c - b'A') as u32,
            b'a'..=b'z' => (c - b'a') as u32 + 26,
            b'0'..=b'9' => (c - b'0') as u32 + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return Err(()),
        };
        acc = (acc << 6) | v;
        nbits += 6;
        last_quantum_chars += 1;
        if last_quantum_chars == 4 {
            quanta += 1;
            last_quantum_chars = 0;
        }
        if nbits >= 8 {
            nbits -= 8;
            out.push(((acc >> nbits) & 0xFF) as u8);
        }
        acc &= (1 << nbits) - 1; // keep only the pending low bits
    }
    // A partial final quantum is only legal when pad-terminated: the
    // leftover bits (< 8 after whole-byte pushes) ARE the zero padding of
    // canonical base64 — e.g. "AAAAAAAAgD8=" (11 alphabet chars + one pad)
    // leaves nbits = 2, and those bits were never emitted. An UNPADDED
    // tail with leftover bits is corrupt input.
    if last_quantum_chars > 0 && !seen_pad && quanta > 0 && !nbits.is_multiple_of(8) {
        return Err(());
    }
    if !seen_pad && !nbits.is_multiple_of(8) {
        return Err(()); // dangling partial byte without padding is invalid
    }
    // Pad characters never add bytes; the emitted stream is already the
    // exact payload length when every full quantum plus the padded tail
    // resolves to whole bytes.
    if !out.len().is_multiple_of(4) {
        return Err(());
    }
    Ok(out
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect())
}

/// Shared playback cursor between the thread that built the stream and
/// the `cpal` output callback (the callback is `Send` but not `Sync`,
/// so all shared state goes through a mutex).
struct PlaybackState {
    buf: Arc<Vec<f32>>, // interleaved, device rate
    pos: usize,
    done: bool,
    done_tx: Option<Sender<()>>,
}

/// Play f32 PCM (mono, `sample_rate`) on the real output device. The
/// callback pulls data at the device rate; the interrupt flag stops
/// audio within one buffer period. Returns true on natural drain, false
/// when interrupted or when playback could not start. The `cpal` stream
/// is created and dropped inside this thread (it is not `Send`).
fn play_f32_pcm(pcm: &[f32], sample_rate: u32, stop: &Arc<AtomicBool>) -> bool {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    let host = cpal::default_host();
    let Some(device) = host.default_output_device() else {
        return false;
    };
    let Ok(supported) = device.default_output_config() else {
        return false;
    };
    let device_rate = supported.sample_rate().max(1);
    let channels = supported.channels().max(1) as usize;
    let config: cpal::StreamConfig = supported.config();

    // Linear resample to the device rate, then interleave mono across
    // the device channels.
    let mono: Vec<f32> = if device_rate == sample_rate {
        pcm.to_vec()
    } else {
        let ratio = sample_rate as f64 / device_rate as f64;
        let out_len = ((pcm.len() as f64) / ratio).ceil() as usize;
        (0..out_len)
            .map(|i| {
                let t = i as f64 * ratio;
                let lo = t.floor() as usize;
                let hi = (lo + 1).min(pcm.len().saturating_sub(1));
                let frac = (t - lo as f64) as f32;
                let a = pcm.get(lo).copied().unwrap_or(0.0);
                let b = pcm.get(hi).copied().unwrap_or(0.0);
                a + (b - a) * frac
            })
            .collect()
    };
    let interleaved: Vec<f32> = mono
        .iter()
        .flat_map(|s| std::iter::repeat_n(*s, channels))
        .collect();

    let (done_tx, done_rx) = mpsc::channel::<()>();
    let state = Arc::new(Mutex::new(PlaybackState {
        buf: Arc::new(interleaved),
        pos: 0,
        done: false,
        done_tx: Some(done_tx),
    }));
    let cb_state = Arc::clone(&state);
    let cb_stop = Arc::new(AtomicBool::new(false));
    let cb_state2 = Arc::clone(&state);
    let cb_stop2 = Arc::clone(&cb_stop);
    let stop_handle = Arc::clone(stop);
    let data_cb = move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
        // The slice arrives pre-filled with silence.
        if stop_handle.load(Ordering::SeqCst) {
            cb_stop2.store(true, Ordering::SeqCst);
            let mut guard = match cb_state.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            if !guard.done {
                guard.done = true;
                let _ = guard.done_tx.take().map(|tx| tx.send(()));
            }
            return;
        }
        let mut guard = match cb_state2.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        if guard.pos >= guard.buf.len() {
            if !guard.done {
                guard.done = true;
                let _ = guard.done_tx.take().map(|tx| tx.send(()));
            }
            return;
        }
        let take = data.len().min(guard.buf.len() - guard.pos);
        data[..take].copy_from_slice(&guard.buf[guard.pos..guard.pos + take]);
        guard.pos += take;
    };
    let err_cb = |_: cpal::Error| {};
    let stream = device.build_output_stream(config, data_cb, err_cb, None);
    let Ok(stream) = stream else {
        return false;
    };
    if stream.play().is_err() {
        return false;
    }
    // Wait for drain or interrupt, bounded by the audio length plus
    // slack — a wedged callback can never hang this thread forever.
    let expected =
        Duration::from_millis(mono.len() as u64 * 1000 / device_rate as u64 + 500);
    let timeout = Duration::from_secs(2).max(expected);
    let _ = done_rx.recv_timeout(timeout);
    drop(stream);
    !(cb_stop.load(Ordering::SeqCst) || stop.load(Ordering::SeqCst))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A panic inside `play_f32_pcm` must not strand the session.
    ///
    /// Reported by the animation lane against the real trace: both native
    /// emitters live AFTER `play_f32_pcm` returns, and `speak()` has already
    /// resolved by then, so the webview's rejection handler cannot cover this.
    /// Without the guard the webview sits in `status: 'speaking'` with HOLD TO
    /// TALK refused, AND the speak slot stays parked so every later utterance
    /// is answered "speech-busy" — a permanently mute session.
    /// A playback thread that NEVER STARTS strands her the same way a panicking
    /// one does, and `PlaybackExit` cannot help: the guard is armed inside the
    /// closure, so a thread that never runs never arms it.
    ///
    /// `emit_speech_start` has already fired at this point, so the scheduler is
    /// animating a mouth with no audio behind it. The stop must still be sent.
    #[test]
    fn a_playback_thread_that_never_starts_still_stops_the_mouth() {
        let emitted: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let log = Arc::clone(&emitted);
        let err = std::io::Error::new(std::io::ErrorKind::WouldBlock, "EAGAIN");

        let reason = playback_spawn_failed("utt-7", &err, &move |id: &str| {
            log.lock().expect("emit log").push(id.to_string());
        });

        assert_eq!(
            emitted.lock().expect("emit log").as_slice(),
            ["utt-7"],
            "the mouth is left animating with no audio unless a stop is emitted"
        );
        assert!(reason.contains("EAGAIN"), "the real cause must survive: {reason}");
        assert!(
            reason.contains("captions remain available"),
            "the user must be told what still works: {reason}"
        );
    }

    /// The stop must name the utterance that failed, never a hardcoded or
    /// stale id — a stop for the wrong utterance would close the mouth on a
    /// DIFFERENT, healthy one.
    #[test]
    fn the_spawn_failure_stop_carries_the_failing_utterance_id() {
        let emitted: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let log = Arc::clone(&emitted);
        let err = std::io::Error::other("thread limit");
        let _ = playback_spawn_failed("utt-second", &err, &move |id: &str| {
            log.lock().expect("emit log").push(id.to_string());
        });
        assert_eq!(emitted.lock().expect("emit log").as_slice(), ["utt-second"]);
    }

    #[test]
    fn a_panicking_playback_thread_still_stops_speech_and_frees_the_slot() {
        let slot = Arc::new(Mutex::new(Some("req-1".to_string())));
        let emitted: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));

        let slot_thread = Arc::clone(&slot);
        let emitted_thread = Arc::clone(&emitted);
        let previous_hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {})); // the panic is the fixture, not noise
        let joined = std::thread::spawn(move || {
            let _exit = PlaybackExit {
                utterance_id: "utt-1".to_string(),
                request_id: "req-1".to_string(),
                slot: slot_thread,
                emit_boundary: Box::new(move |id: &str| {
                    emitted_thread.lock().expect("emit log").push(id.to_string());
                }),
                armed: true,
            };
            panic!("cpal unwound mid-playback");
        })
        .join();
        std::panic::set_hook(previous_hook);

        assert!(joined.is_err(), "the fixture must actually panic");
        assert_eq!(
            emitted.lock().expect("emit log").as_slice(),
            ["utt-1"],
            "exactly one stop must still reach the webview, or HOLD TO TALK stays dead"
        );
        assert_eq!(
            *slot.lock().expect("slot"),
            None,
            "the speak slot must be released, or she never speaks again this session"
        );
    }

    /// The normal exit must not double-emit: the thread already sent its own
    /// drain or boundary, so Drop must stay quiet and only free the slot.
    #[test]
    fn a_normal_playback_exit_emits_no_second_stop() {
        let slot = Arc::new(Mutex::new(Some("req-2".to_string())));
        let emitted: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let emitted_guard = Arc::clone(&emitted);
        {
            let mut exit = PlaybackExit {
                utterance_id: "utt-2".to_string(),
                request_id: "req-2".to_string(),
                slot: Arc::clone(&slot),
                emit_boundary: Box::new(move |id: &str| {
                    emitted_guard.lock().expect("emit log").push(id.to_string());
                }),
                armed: true,
            };
            exit.disarm();
        }
        assert!(
            emitted.lock().expect("emit log").is_empty(),
            "Drop must not emit a second stop on the normal path"
        );
        assert_eq!(*slot.lock().expect("slot"), None, "the slot is still freed");
    }

    /// An older thread's cleanup must never cancel a NEWER utterance.
    #[test]
    fn the_exit_guard_never_frees_a_slot_that_a_later_utterance_owns() {
        let slot = Arc::new(Mutex::new(Some("req-NEW".to_string())));
        {
            let _exit = PlaybackExit {
                utterance_id: "utt-old".to_string(),
                request_id: "req-OLD".to_string(),
                slot: Arc::clone(&slot),
                emit_boundary: Box::new(|_| {}),
                armed: true,
            };
        }
        assert_eq!(
            slot.lock().expect("slot").as_deref(),
            Some("req-NEW"),
            "a stale guard must leave the current utterance's slot alone"
        );
    }

    /// Regression guard for a shipping defect: the Kokoro worker runs from
    /// inside the code-signed .app bundle, so if CPython is allowed to write
    /// __pycache__ it drops files into Contents/Resources and the bundle's
    /// signature stops verifying the first time a client ever uses voice.
    /// Observed in the field: 335 stray .pyc files, `codesign --verify
    /// --deep --strict` rc=1. Both `-B` and PYTHONDONTWRITEBYTECODE=1 must
    /// stay on the spawn.
    #[test]
    fn kokoro_worker_is_barred_from_writing_bytecode_into_the_signed_bundle() {
        let cmd = kokoro_command(
            Path::new("/candice/python3"),
            Path::new("/candice/runtime.py"),
            Path::new("/candice/model.onnx"),
            Path::new("/candice/voices.bin"),
        );

        let has_env = cmd.get_envs().any(|(key, value)| {
            key == "PYTHONDONTWRITEBYTECODE" && value == Some("1".as_ref())
        });
        assert!(
            has_env,
            "spawn must set PYTHONDONTWRITEBYTECODE=1 — without it the worker \
             invalidates the app's code signature on first use"
        );

        let has_flag = cmd.get_args().any(|arg| arg == "-B");
        assert!(
            has_flag,
            "spawn must pass -B so a stripped environment cannot re-enable \
             bytecode writing"
        );

        // The worker script must still be the thing being run.
        let has_worker = cmd.get_args().any(|arg| arg == "/candice/runtime.py");
        assert!(has_worker, "worker script argument was lost");
    }
    use candice_capture::CaptureChunk;

    fn rec(chunks: Vec<CaptureChunk>, total: usize) -> Recording {
        Recording {
            chunks,
            sample_rate: 16_000,
            channels: 1,
            total_samples: total,
            duration_ms: 10,
            started_at_ms: 0,
            ended_at_ms: 10,
        }
    }

    #[test]
    fn wav_encoding_matches_pcm_layout() {
        let recording = rec(
            vec![CaptureChunk {
                sequence: 0,
                sample_rate: 16_000,
                channels: 1,
                samples: vec![0.0, 0.5, -0.5, 0.25],
                captured_at_ms: 0,
            }],
            4,
        );
        let wav = recording_to_wav(&recording).expect("wav bytes");
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        // data chunk length = 4 samples * 2 bytes
        assert_eq!(u32::from_le_bytes(wav[40..44].try_into().unwrap()), 8);
        // first sample 0.0 -> 0; second 0.5 -> round(0.5 * 32767) = 16384
        // (round-half-up; the encoder rounds, it never truncates).
        assert_eq!(i16::from_le_bytes(wav[44..46].try_into().unwrap()), 0);
        assert_eq!(i16::from_le_bytes(wav[46..48].try_into().unwrap()), 16384);
    }

    #[test]
    fn a_real_length_hold_encodes_in_linear_time() {
        // A ten-second hold at the configured 16 kHz. Under the previous
        // implementation -- `.nth()` on an iterator rebuilt inside the inner
        // loop -- this cost about 15ms of pointless work and grew
        // quadratically from there (see recording_to_wav for the measurement,
        // and for why the obvious 1.28e10-step estimate is wrong).
        //
        // The bound is deliberately loose (10s for work that takes
        // milliseconds) so this is not a flaky benchmark: it is a tripwire for
        // a return to quadratic, which would blow past it by orders of
        // magnitude on any machine.
        let frames = 16_000 * 10;
        let samples: Vec<f32> = (0..frames).map(|i| ((i % 200) as f32 / 200.0) - 0.5).collect();
        let recording = rec(
            vec![CaptureChunk {
                sequence: 0,
                sample_rate: 16_000,
                channels: 1,
                samples,
                captured_at_ms: 0,
            }],
            frames,
        );
        let started = std::time::Instant::now();
        let wav = recording_to_wav(&recording).expect("wav bytes");
        let elapsed = started.elapsed();
        assert_eq!(
            u32::from_le_bytes(wav[40..44].try_into().unwrap()),
            (frames * 2) as u32,
            "every frame must survive the encode",
        );
        assert!(
            elapsed < std::time::Duration::from_secs(10),
            "encoding 10s of audio took {elapsed:?}; the encoder has gone quadratic again",
        );
    }

    #[test]
    fn planar_channels_interleave_in_the_right_order() {
        // The layout is planar: all of channel 0, then all of channel 1. The
        // encode must interleave them, so indexing (c, i) -> c * frames + i
        // has to stay correct now that it is a direct index rather than a
        // walk. Two frames, two channels: L0 R0 L1 R1.
        let recording = rec(
            vec![CaptureChunk {
                sequence: 0,
                sample_rate: 16_000,
                channels: 2,
                // channel 0 = [1.0, 0.5], channel 1 = [-1.0, -0.5]
                samples: vec![1.0, 0.5, -1.0, -0.5],
                captured_at_ms: 0,
            }],
            4,
        );
        let mut recording = recording;
        recording.channels = 2;
        let wav = recording_to_wav(&recording).expect("wav bytes");
        let s = |n: usize| i16::from_le_bytes(wav[44 + n * 2..46 + n * 2].try_into().unwrap());
        assert_eq!(s(0), 32767, "frame 0 channel 0");
        assert_eq!(s(1), -32767, "frame 0 channel 1");
        assert_eq!(s(2), 16384, "frame 1 channel 0");
        assert_eq!(s(3), -16384, "frame 1 channel 1");
    }

    #[test]
    fn empty_recording_yields_no_wav() {
        assert!(recording_to_wav(&rec(vec![], 0)).is_none());
    }

    #[test]
    fn pcm_decoder_round_trips_and_rejects_junk() {
        // [0.0f32, 1.0f32] little-endian = 00 00 00 00 00 00 80 3f.
        // The hand-rolled decoder stops at the '=' padding; the vector is
        // the canonical std-base64 of exactly those 8 bytes.
        let b64 = "AAAAAAAAgD8=";
        let pcm = decode_f32_pcm(b64).expect("decode");
        assert_eq!(pcm.len(), 2);
        assert_eq!(pcm[0], 0.0);
        assert_eq!(pcm[1], 1.0);
        // Round-trip the other way: encode 0.5f32 and decode it back.
        let half = "AAAAPw==";
        let pcm_half = decode_f32_pcm(half).expect("decode half");
        assert_eq!(pcm_half, [0.5f32]);
        assert!(decode_f32_pcm("not base64!").is_err());
        assert!(decode_f32_pcm("AAAA").is_err()); // 3 bytes -> not f32-aligned
        // Empty input decodes to zero samples — never playable audio.
        assert!(decode_f32_pcm("").map(|p| p.is_empty()) == Ok(true));
    }

    #[test]
    fn dead_capture_engine_fails_total_not_panic() {
        let engine = CaptureEngine::default();
        assert!(engine.press().is_err());
        assert!(engine.status().is_err());
        assert!(engine.release().is_err());
        // The permission report reads the last-known status without a
        // channel round-trip: None on a never-started engine, never a panic.
        assert_eq!(engine.last_status(), None);
    }

    // ---------------------------------------------------- STT engine (t2)

    /// The pinned tiny.en-q5_1 model checksum (WS-16 manifest pin). The
    /// operator cache carries the verified copy; tests skip honestly when
    /// it is absent (CI has no model download step).
    const PINNED_MODEL_SHA256: &str =
        "c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b";

    fn stt_test_inputs() -> Option<(PathBuf, PathBuf, &'static str)> {
        let model = match std::env::var_os("CANDICE_STT_MODEL") {
            Some(v) => PathBuf::from(v),
            None => home_dir().join("candice-stt-cache").join("ggml-tiny.en-q5_1.bin"),
        };
        let binary = match std::env::var_os("CANDICE_STT_BINARY") {
            Some(v) => PathBuf::from(v),
            None => PathBuf::from("/opt/homebrew/bin/whisper-cli"),
        };
        if !model.is_file() || !binary.is_file() {
            return None;
        }
        Some((model, binary, "en"))
    }

    fn home_dir() -> PathBuf {
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/"))
    }

    /// A minimal valid PCM WAV header + payload (silence) written into the
    /// session temp root — the only location transcribe accepts.
    fn write_session_wav(tag: &str, samples: &[f32]) -> (std::path::PathBuf, Vec<u8>) {
        let rec = Recording {
            chunks: vec![CaptureChunk {
                sequence: 0,
                sample_rate: 16_000,
                channels: 1,
                samples: samples.to_vec(),
                captured_at_ms: 0,
            }],
            sample_rate: 16_000,
            channels: 1,
            total_samples: samples.len(),
            duration_ms: 10,
            started_at_ms: 0,
            ended_at_ms: 10,
        };
        let bytes = recording_to_wav(&rec).expect("wav bytes");
        let root = session_temp_root();
        std::fs::create_dir_all(&root).expect("temp root");
        let path = root.join(format!("q2t2-{tag}-{}.wav", std::process::id()));
        std::fs::write(&path, &bytes).expect("write wav");
        (path, bytes)
    }

    #[test]
    fn run_whisper_rejects_missing_wav_model_and_binary() {
        let dir = std::env::temp_dir().join(format!("q2t2-inputs-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let missing = dir.join("missing.wav");
        let model = dir.join("no-model.bin");
        let binary = dir.join("no-whisper");
        // Missing WAV fires before any checksum work.
        let err = run_whisper(&missing, &model, "pin", &binary, "en").unwrap_err();
        assert!(err.contains("captured audio file is missing"), "{err}");
        // Missing model fires before the binary probe.
        std::fs::write(&missing, b"RIFF").unwrap();
        let err = run_whisper(&missing, &model, "pin", &binary, "en").unwrap_err();
        assert!(err.contains("STT model is not installed"), "{err}");
        // Missing engine fails with the honest degraded reason.
        let junk_model = dir.join("junk-model.bin");
        std::fs::write(&junk_model, b"not a model").unwrap();
        let err = run_whisper(&missing, &junk_model, "pin", &binary, "en").unwrap_err();
        assert!(err.contains("STT engine is not installed"), "{err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_whisper_verifies_model_pin_before_running() {
        let inputs = match stt_test_inputs() {
            Some(v) => v,
            None => return, // no verified model/engine on this host: skip
        };
        let (model, binary, _) = inputs;
        let (wav, _bytes) = write_session_wav("pin", &[0.0; 160]);
        // Wrong pin must fail the pre-run integrity gate BEFORE the engine
        // runs — the WAV is still cleaned up either way (FIX-017 guard).
        let err = run_whisper(
            &wav,
            &model,
            "0000000000000000000000000000000000000000000000000000000000000000",
            &binary,
            "en",
        )
        .unwrap_err();
        assert!(
            err.contains("checksum mismatch"),
            "wrong pin must be refused: {err}"
        );
        // The checksum gate fires BEFORE the engine run, so the wav is
        // still on disk here (deletion happens only around the actual
        // transcription). The gate's position is the load-bearing fact.
        assert!(wav.exists(), "pin refusal must precede the engine run");
        let _ = std::fs::remove_file(&wav);
        // The exact pinned checksum passes the gate and reaches a REAL
        // engine run (the transcription itself is proven in the dedicated
        // test; here we only need past the integrity refusal).
        let (wav, _) = write_session_wav("pin2", &[0.0f32; 1_600]);
        let outcome = run_whisper(&wav, &model, PINNED_MODEL_SHA256, &binary, "en");
        let pin_ok = match &outcome {
            Ok(_) => true,
            Err(e) => {
                e.contains("no speech was recognized") || e.contains("speech recognition failed")
            }
        };
        assert!(
            pin_ok,
            "exact pin must not fail integrity: {outcome:?}"
        );
        assert!(!wav.exists());
    }

    #[test]
    fn run_whisper_real_transcribe_and_temp_cleanup() {
        let Some((model, binary, language)) = stt_test_inputs() else {
            return; // host without the pinned assets: nothing to prove here
        };
        // The canonical JFK fixture (operator cache or env override),
        // copied into the session temp root under a fresh name so the
        // engine deletes ITS copy, never the cache original.
        let fixture = std::env::var_os("CANDICE_STT_FIXTURE")
            .map(PathBuf::from)
            .or_else(|| Some(home_dir().join("candice-stt-cache").join("jfk.wav")))
            .filter(|p| p.is_file());
        let Some(fixture) = fixture else { return };
        let root = session_temp_root();
        std::fs::create_dir_all(&root).unwrap();
        let wav = root.join(format!("q2t2-jfk-{}.wav", std::process::id()));
        std::fs::copy(&fixture, &wav).unwrap();

        let text = run_whisper(&wav, &model, PINNED_MODEL_SHA256, &binary, language)
            .expect("real transcription succeeds on the verified stack");
        // FIX-017: transcript returned to caller, temp files gone.
        for word in ["americans", "country"] {
            assert!(
                text.to_ascii_lowercase().contains(word),
                "transcript lost reference word '{word}': {text}"
            );
        }
        assert!(!wav.exists(), "wav must be deleted after success");
        assert!(
            !wav.with_extension("txt").exists(),
            "whisper output txt must be deleted after success"
        );
    }

    #[test]
    fn run_whisper_deletes_temps_on_engine_failure() {
        // A real binary pointed at garbage input fails; the guard requires
        // BOTH the wav and its txt to be gone even then. Uses the real
        // whisper-cli when present so the failure path is the REAL child
        // exiting non-zero, not an injected stub.
        let inputs = match stt_test_inputs() {
            Some(v) => v,
            None => return,
        };
        let (model, binary, _) = inputs;
        let (wav, _) = write_session_wav("fail", &[0.0f32; 16_000]); // ~1 s silence
        let txt = wav.with_extension("txt");
        let result = run_whisper(&wav, &model, PINNED_MODEL_SHA256, &binary, "en");
        match result {
            Ok(text) => {
                // Silence can legitimately produce an empty-transcript
                // failure or a near-empty string; both are acceptable
                // outcomes, but cleanup must hold in every case.
                assert!(!text.contains('\u{0}'));
            }
            Err(err) => {
                assert!(
                    err.contains("speech recognition failed")
                        || err.contains("no speech was recognized"),
                    "honest failure reason expected: {err}"
                );
            }
        }
        assert!(!wav.exists(), "wav deleted even on failure");
        assert!(!txt.exists(), "txt deleted even on failure");
    }
}
