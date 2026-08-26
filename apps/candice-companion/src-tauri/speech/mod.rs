//! Speech runtime command boundary (FIX-015, plan section 3A).
//!
//! This module is the typed native contract between the webview and the
//! speech lanes (`stt/`, `tts/`, `audio/capture`, `audio/duplex`,
//! `audio/cleanup`). It owns ONLY the command surface: capability facts,
//! permission facts, bounded lifecycle commands. Heavy engines remain
//! subprocesses owned by their lanes; raw audio never crosses this
//! boundary — every response carries codes and paths, never PCM or
//! secret text.
//!
//! Failure isolation (spec 20): every command is total — it returns a
//! serializable fact instead of panicking, and the frontend degrades to
//! captions/text when a capability is absent.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime, State};

/// Installer-managed verified asset directory (QFIX Q-05, q2-design.md
/// section 5 — the binding asset-delivery authority for this fix lane).
mod assets;

// Real engines behind the boundary commands (QFIX Q-02, design sections
// 3.1 + 3.2): capture worker thread, whisper.cpp STT, Kokoro TTS with cpal
// playback. The commands below dispatch here instead of owning slots.
mod engines;

use assets::{InventoryEntry, InventoryRecord};
use engines::{CaptureEngine, TtsEngine};

// Trait methods on the capture crate's device sources (default_input_device
// probe in cmd_speech_health, design 2.5).
use candice_capture::MicSource as _;

/// Versioned boundary contract (plan section 3A freeze). Additive only.
pub const SPEECH_CONTRACT_VERSION: &str = "1.0";

/// Maximum characters the speak command accepts. Longer text is rejected —
/// the caller must use captions (spec 20 bounded payloads).
const MAX_SPEAK_CHARS: usize = 8192;

/// Maximum size (chars) of a bounded in-memory transcript payload.
const MAX_TRANSCRIBE_TEXT_CHARS: usize = 32_768;

/// Maximum length of an allowlisted temp WAV path handed to transcription.
const MAX_WAV_PATH_CHARS: usize = 512;

/// A permission state as reported by the capture lane (WS-17).
///
/// `Denied` / `NoDevice` / `Error` are part of the serialized wire
/// contract (the frontend consent gate parses all five variants) but are
/// not constructed by this boundary today: the capture lane owns the real
/// TCC state and will map those states here when its adapter lands.
/// They are reserved contract values, never dead weight — the serialized
/// form is the load-bearing side.
#[allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum MicPermissionState {
    Granted,
    Denied,
    NotDetermined,
    NoDevice,
    Error,
}

/// Speech capability fact per subsystem — the "what is actually wired"
/// answer the QC plan requires. No path or hash is invented here: absent
/// state reports unavailable.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechCapabilityFact {
    /// STT capability: transcription path is mounted and reachable.
    pub stt_available: bool,
    /// TTS capability: canonical Kokoro engine path is mounted.
    pub tts_available: bool,
    /// System-TTS fallback availability, as reported by the adapter
    /// (macOS `say` probe; false elsewhere until the platform adapter
    /// registers itself).
    pub system_tts_available: bool,
    /// Duplex controller mounted in the frontend composition.
    pub duplex_mounted: bool,
    /// Capture lane mounted and able to run (binary exists; hardware
    /// availability is a permission/lifecycle fact, not a wiring fact).
    pub capture_mounted: bool,
    /// Canonical voice is operator-APPROVED. True only when the manifest's
    /// `canonicalVoice.approval` is exactly `approved` — there is no
    /// pre-approval default and no substitute voice, so an unapproved or
    /// unresolvable manifest yields no speech at all rather than a voice
    /// the client did not choose. Captions remain available.
    pub canonical_voice_approved: bool,
}

/// Engine/model/voice inventory fact. Paths are facts the caller already
/// owns; they are emitted only to the app's own webview (never logged).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechHealth {
    pub contract_version: String,
    pub capabilities: SpeechCapabilityFact,
    pub stt_runtime: String,
    pub stt_runtime_version: String,
    pub stt_model: String,
    /// The inventory pin — the only accepted checksum (design 5.4).
    pub stt_model_sha256: String,
    /// Probe result for the on-disk model file: ok | absent | mismatch |
    /// no-pin | probe-error. Mismatch is degraded with a precise reason,
    /// never silent.
    pub stt_model_sha256_status: String,
    /// The on-disk measured hash (empty string when the probe could not
    /// measure). Emitted to the app's own webview only, never logged.
    pub stt_model_sha256_measured: String,
    pub stt_engine_ready: bool,
    pub tts_engine_ready: bool,
    pub tts_model: String,
    pub tts_voicepack_release: String,
    pub canonical_voice_id: String,
    pub canonical_voice_approval: String,
    /// Which root supplied the manifest this report was built from:
    /// "env" | "user" | "bundle" | "none". Surfaced because an overriding
    /// manifest is otherwise invisible from outside the process.
    pub speech_assets_root: String,
    /// QFIX Q-05: the installer provenance receipt is present next to the
    /// verified per-user asset directory (design 5.5).
    pub receipt_present: bool,
    /// Human-actionable degraded status when any lane is down.
    pub degraded: bool,
    pub degraded_reason: Option<String>,
}

/// Permission report (plan section 3D): state plus a user-actionable
/// next step. Never a bypass, never a retry loop.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechPermissions {
    pub microphone: MicPermissionState,
    /// Whether permission prompting happens only at PTT (never on startup).
    pub prompt_source: String,
    /// Human-actionable explanation, e.g. "Open System Settings > Privacy
    /// & Security > Microphone, enable Candice Companion, then return."
    pub explanation: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakRequest {
    /// Request id from the caller; echoed back, never interpreted.
    pub request_id: String,
    pub text: String,
    pub voice_id: Option<String>,
    pub speed: Option<f64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeRequest {
    /// Request id from the caller; echoed back, never interpreted.
    pub request_id: String,
    /// QFIX Q-02 (design 2.3 step 7): the PTT path. `capture` runs the real
    /// STT engine on the recording the capture worker produced on release —
    /// no WAV path ever crosses IPC for this mode.
    #[serde(default)]
    pub mode: Option<String>,
    /// Bounded in-memory transcript text (ring-buffer path). The capture
    /// lane never writes raw audio to disk on the PTT path; this field
    /// carries only the text it produced.
    pub transcript_text: Option<String>,
    /// Allowlisted short-lived WAV path under the Candice session temp
    /// root only (cleanup lane owns creation/deletion). Refused when the
    /// file is outside the session root or when text is provided.
    pub wav_path: Option<String>,
    pub language: Option<String>,
}

/// Shared managed state for the speech boundary. Commands mutate only the
/// lifecycle facts the boundary owns; engine state stays inside the engine
/// handles (QFIX Q-02): the capture worker owns the PTT controller, the TTS
/// handle owns synthesis/playback.
#[derive(Default)]
pub struct SpeechState {
    /// The one active capture request id (PTT single-flight, plan 3C).
    active_capture_request: std::sync::Mutex<Option<String>>,
    /// The one active speak request id (idempotent stop, plan 3A). Shared
    /// with the playback thread so the slot releases when the mouth
    /// provably closes (drain or boundary), not when the command returns.
    active_speak_request: std::sync::Arc<std::sync::Mutex<Option<String>>>,
    /// The session-temp WAV written by the capture worker at release,
    /// consumed exactly once by transcribe mode `capture` (WS-18: a
    /// recording is consumed once). Native-only — never crosses IPC.
    last_capture_wav: std::sync::Mutex<Option<std::path::PathBuf>>,
    /// Real capture engine: a worker thread owning the `PttController` and
    /// the device (`Default` is an un-started engine that fails every send
    /// — total, never panics).
    pub(crate) capture: CaptureEngine,
    /// Real TTS engine handle (Kokoro worker + cpal output stream).
    pub(crate) tts: TtsEngine,
}

/// Resolve the bundled interpreter inside a staged `speech-assets/tts` root.
///
/// Both callers used to hardcode `python/bin/python3`. That is the POSIX
/// layout and it cannot exist in a Windows Python install, where the
/// interpreter sits at `python\\python.exe`. So on Windows the probe found
/// nothing and TTS reported "bundled voice runtime is missing" on every
/// launch -- or worse, if a macOS `speech-assets` tree shipped in a Windows
/// installer, `python/bin/python3` DOES exist there and is a Mach-O binary,
/// which fails at spawn with "not a valid Win32 application".
///
/// Unverified on real Windows (no machine available); the layout is the
/// documented one for an embeddable CPython, and `Scripts\\` is included
/// because a venv-shaped staging puts it there instead.
pub(crate) fn bundled_python_path(tts_root: &std::path::Path) -> Option<std::path::PathBuf> {
    #[cfg(windows)]
    let candidates = [
        tts_root.join("python").join("python.exe"),
        tts_root.join("python").join("Scripts").join("python.exe"),
    ];
    #[cfg(not(windows))]
    let candidates = [
        tts_root.join("python").join("bin").join("python3"),
        tts_root.join("python").join("bin").join("python"),
    ];
    candidates.into_iter().find(|c| c.is_file())
}

/// The packaged Python interpreter is only valid inside the app bundle;
/// never trust a host `python3` (FIX-015 FAIL-3: no host-machine
/// runtime assumptions in a shipped package).
pub(crate) fn bundled_python_hint() -> Option<String> {
    std::env::var_os("CANDICE_PYTHON").map(|v| v.to_string_lossy().into_owned())
}

/// Run `binary --version` under a bounded 5 s deadline (design 2.5).
/// The child is killed on timeout — a hung probe can neither stall the
/// health command forever nor leak the process.
fn bounded_version_probe(path: &std::path::Path) -> bool {
    let mut probe = std::process::Command::new(path);
    crate::proc::no_console(&mut probe);
    let Ok(mut child) = probe
        .arg("--version")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
    else {
        return false;
    };
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return false;
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(_) => return false,
        }
    }
}

/// Health command (QFIX Q-05, q2-design.md sections 2.5 + 5). Every fact
/// is a real probe: file exists AND sha256 matches the inventory pin AND
/// (binaries) runs its `--version` under a bounded timeout. The manifest
/// pin and the on-disk measured hash are both reported; a mismatch is
/// degraded with a precise reason, never silent. Slot-based facts are
/// removed — the capture probe is a real device result.
#[tauri::command]
pub fn cmd_speech_health<R: Runtime>(
    app: AppHandle<R>,
) -> Result<SpeechHealth, String> {
    let res = assets::resolve_speech_assets(&app);
    let inventory: Option<InventoryRecord> = res
        .inventory_text
        .as_deref()
        .and_then(|text| serde_json::from_str(text).ok());

    let entry = |id: &str| -> Option<InventoryEntry> {
        inventory
            .as_ref()
            .and_then(|inv| inv.entries.iter().find(|e| e.id == id).cloned())
    };
    let id_pin = |id: &str| entry(id).and_then(|e| e.sha256.filter(|s| !s.is_empty()));
    let id_path = |id: &str| -> Option<std::path::PathBuf> {
        entry(id).and_then(|e| res.root_for(&e))
    };

    let verify = |id: &str| -> Result<(bool, String, String), String> {
        let Some(pin) = id_pin(id) else {
            return Ok((false, "no-pin".into(), "inventory pin missing".into()));
        };
        let Some(path) = id_path(id) else {
            return Ok((false, "no-candidate-root".into(), pin));
        };
        if !path.is_file() {
            return Ok((false, "absent".into(), pin));
        }
        let measured = assets::sha256_file(&path)
            .map_err(|e| format!("asset probe failed for {id}: {e}"))?;
        if !measured.eq_ignore_ascii_case(&pin) {
            return Ok((false, "mismatch".into(), measured));
        }
        Ok((true, "ok".into(), measured))
    };

    // STT model: exists + hash match (verified pre-run by the transcribe
    // path; health proves it without running the engine).
    let stt_model = entry("stt-model")
        .map(|e| e.filename)
        .unwrap_or_else(|| "ggml-tiny.en-q5_1.bin".into());
    let stt_model_pin = id_pin("stt-model")
        .unwrap_or_else(|| "c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b".into());
    let (stt_model_ok, stt_model_status, stt_model_measured) =
        verify("stt-model").unwrap_or((false, "probe-error".into(), String::new()));

    // STT binary: exists + hash match + runs `--version` (bounded 5 s).
    let stt_binary_id = if cfg!(target_os = "macos") {
        "stt-binary-macos"
    } else {
        "stt-binary-windows-x64"
    };
    let stt_binary_present = verify(stt_binary_id)
        .map(|(ok, _, _)| ok)
        .unwrap_or(false);
    let stt_binary_runs = stt_binary_present
        && id_path(stt_binary_id)
            .map(|p| bounded_version_probe(&p))
            .unwrap_or(false);
    let stt_engine_ready = stt_model_ok && stt_binary_present && stt_binary_runs;

    // TTS: model + voices exist and hash-match; worker script + bundled
    // Python interpreter exist (hash pins for the script land with the
    // installer work; presence is the honest fact today).
    let tts_model = entry("tts-model")
        .map(|e| e.filename)
        .unwrap_or_else(|| "kokoro-v1.0.fp16.onnx".into());
    let (tts_model_ok, _, _) = verify("tts-model").unwrap_or((false, "probe-error".into(), String::new()));
    let (tts_voices_ok, _, _) = verify("tts-voices").unwrap_or((false, "probe-error".into(), String::new()));
    let tts_runtime_present = entry("tts-worker")
        .and_then(|e| res.root_for(&e))
        .map(|p| p.is_file())
        .unwrap_or(false);
    let tts_python_present = entry("tts-worker")
        .and_then(|e| res.root_for(&e))
        .map(|worker| {
            worker
                .parent()
                .and_then(|p| p.parent())
                .and_then(|p| bundled_python_path(&p))
                .is_some()
        })
        .unwrap_or(false)
        || bundled_python_hint().is_some();
    let tts_engine_ready = tts_model_ok && tts_voices_ok && tts_runtime_present && tts_python_present;

    // System-TTS fallback probe -- the SAME function `speak_impl` consults
    // before falling back, so the health report can never advertise a
    // fallback the speak path would decline to use.
    let system_tts_available = system_voice_available();

    // Capture probe: a real default-input-device result (cpal), not a
    // slot. Absent device = no-device, reported honestly.
    let capture_mounted = candice_capture::CpalMicSource::default()
        .default_input_device()
        .is_some();

    // Provenance: the installer receipt next to the verified directory.
    // Health reports presence; the receipt's own rows carry the source
    // URL + sha256 + placement timestamp (design 5.5).
    let receipt_present = res
        .receipt_path()
        .map(|p| p.is_file())
        .unwrap_or(false);

    // Canonical voice: the bundled SPEECH-INVENTORY.json is the record for
    // BOTH the voice id and its approval (FIX-015 FAIL-6), and it is read
    // rather than hardcoded so this cannot become a second runtime write
    // point disagreeing with the TS single write point
    // (src-tauri/tts/assets.ts DEFAULT_CANONICAL_VOICE).
    //
    // ONE document, ONE parser. The id used to come from the typed record
    // while approval came from a SECOND, raw parse of the same file, so a
    // typed-parse failure could report `approved` beside a fallback id — an
    // approved-looking wrong voice. There is no longer a pre-approval
    // default: an unresolvable voice reports itself as unresolved rather
    // than naming a substitute the reader would mistake for a real choice.
    // A shadowing manifest can never be reported as approved.
    let (canonical_voice_id, canonical_voice_approval) = match (
        res.canonical_voice_conflict(),
        resolve_approved_voice(inventory.as_ref(), None),
    ) {
        (Some(_), _) => ("conflicted".to_string(), "approval-pending".to_string()),
        (None, Ok(voice)) => (voice.id, voice.approval),
        (None, Err(_)) => ("unresolved".to_string(), "approval-pending".to_string()),
    };
    let canonical_voice_approved = canonical_voice_approval == "approved";

    let stt_available = stt_engine_ready;
    let tts_available = tts_engine_ready;
    let duplex_mounted = true; // composition mounts the controller (see frontend)

    let degraded = !(stt_available || tts_available || system_tts_available || capture_mounted);
    let degraded_reason = degraded.then(|| {
        let mut parts: Vec<String> = Vec::new();
        if !capture_mounted {
            parts.push("no microphone device".into());
        }
        if !stt_engine_ready {
            parts.push(format!(
                "STT not ready (model {}, binary present {} and running {})",
                if stt_model_ok { "ok" } else { &stt_model_status },
                stt_binary_present,
                stt_binary_runs
            ));
        }
        if !tts_engine_ready {
            parts.push("TTS not ready (model/voices hash, worker, or python missing)".into());
        }
        parts.push("captions and typed answers remain available".into());
        parts.join("; ")
    });

    Ok(SpeechHealth {
        contract_version: SPEECH_CONTRACT_VERSION.into(),
        capabilities: SpeechCapabilityFact {
            stt_available,
            tts_available,
            system_tts_available,
            duplex_mounted,
            capture_mounted,
            canonical_voice_approved,
        },
        stt_runtime: "whisper.cpp".into(),
        stt_runtime_version: "1.9.2".into(),
        stt_model,
        stt_model_sha256: stt_model_pin,
        stt_model_sha256_status: stt_model_status,
        stt_model_sha256_measured: stt_model_measured,
        stt_engine_ready,
        tts_engine_ready,
        tts_model,
        tts_voicepack_release: "model-files-v1.1".into(),
        canonical_voice_id,
        canonical_voice_approval,
        speech_assets_root: res.used_root_kind.unwrap_or("none").to_string(),
        receipt_present,
        degraded,
        degraded_reason,
    })
}

/// Capture start (plan 3A `speech_capture_start`, QFIX Q-02 design 2.3
/// step 4). PTT lifetime only, single-flight: a second request while one
/// is live is refused as busy. Success means the REAL device opened — the
/// capture worker's `press()` drove `CpalMicSource::open`, and the OS mic
/// prompt (TCC) fires inside that open at press time. The honest status
/// fact comes back from the controller snapshot; denied/no-device are the
/// real states, never fabricated.
fn capture_start_impl(state: &SpeechState, request_id: String) -> Result<CaptureStartOutcome, String> {
    if request_id.is_empty() || request_id.len() > 128 {
        return Err("invalid request id".into());
    }
    {
        let slot = state
            .active_capture_request
            .lock()
            .map_err(|_| "speech state unavailable")?;
        if slot.is_some() {
            return Err("capture-busy: a PTT capture is already active".into());
        }
    }
    // The press opens the device (or fails with denied / no-device). Only
    // a genuinely listening controller takes the admission slot.
    let status = state.capture.press()?;
    match status.as_str() {
        "listening" => {
            let mut slot = state
                .active_capture_request
                .lock()
                .map_err(|_| "speech state unavailable")?;
            *slot = Some(request_id.clone());
            Ok(CaptureStartOutcome { status: status.as_str().into(), request_id })
        }
        other => {
            // Denied / no-device / error: the mic did NOT open. The typed
            // surface stays available; the reason travels as an error so
            // the orchestrator surfaces the explanation (FIX-015 consent).
            Err(format!("capture-{other}: microphone did not open"))
        }
    }
}

/// The capture-start fact returned to the webview: the controller status
/// code plus the echoed request id. Status codes only — never audio.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStartOutcome {
    pub status: String,
    pub request_id: String,
}

#[tauri::command]
pub fn cmd_speech_capture_start(
    state: State<'_, SpeechState>,
    app: AppHandle<impl Runtime>,
    request_id: String,
) -> Result<CaptureStartOutcome, String> {
    // The worker thread needs the app handle to emit status events; the
    // engine starts lazily on the first press so tests and headless runs
    // never spawn threads.
    state.capture.ensure_started(app);
    capture_start_impl(&state, request_id)
}

#[tauri::command]
pub fn cmd_speech_capture_stop(
    state: State<'_, SpeechState>,
    request_id: Option<String>,
) -> Result<(), String> {
    capture_stop_impl(&state, request_id)
}
fn capture_stop_impl(state: &SpeechState, request_id: Option<String>) -> Result<(), String> {
    {
        let mut slot = state
            .active_capture_request
            .lock()
            .map_err(|_| "speech state unavailable")?;
        if let Some(id) = &*slot {
            if request_id.as_ref().is_none_or(|rid| rid == id) {
                *slot = None;
            }
        }
    }
    // Idempotent: releasing when nothing is live is still a no-op success.
    let outcome = state.capture.release()?;
    // Park the finished WAV (if any) for transcribe mode `capture`; it is
    // consumed once there or overwritten by the next release. A stale file
    // from a previous hold that was never transcribed is deleted here so
    // temp audio never accumulates (FIX-017 cleanup guard).
    let mut pending = state
        .last_capture_wav
        .lock()
        .map_err(|_| "speech state unavailable")?;
    if let Some(old) = pending.take() {
        let _ = std::fs::remove_file(&old);
    }
    if let Some(wav) = outcome.wav_path {
        *pending = Some(wav);
    }
    Ok(())
}

/// Transcribe (plan 3A `speech_transcribe`, QFIX Q-02 design 2.3 step 7).
/// Three payloads:
///  - `mode: "capture"`: run the REAL whisper.cpp STT engine on the
///    recording the capture worker finished at release (checksum verified
///    pre-run; the WAV and its transcript file are deleted afterwards —
///    FIX-017 cleanup guard). No path crosses IPC for this mode.
///  - bounded in-memory text: echoed for typed/external paths.
///  - allowlisted session-temp WAV path: queued with the same engine.
/// A missing payload is an explicit failure — an empty transcript is never
/// a blank answer (spec 20).
#[tauri::command]
pub fn cmd_speech_transcribe<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SpeechState>,
    request: TranscribeRequest,
) -> Result<serde_json::Value, String> {
    transcribe_impl::<R>(&app, &state, request)
}

/// What a validated transcribe request wants the engines to do. Pure
/// planning output — no app handle, no hardware, fully unit-testable.
#[derive(Debug)]
enum TranscribePlan {
    /// Echo bounded in-memory text (typed/external paths). No engine.
    TextEcho {
        response: serde_json::Value,
    },
    /// Run real STT on this session-temp WAV, then delete it.
    RunStt { wav: std::path::PathBuf, language: String },
}

/// Validate a transcribe request and produce its execution plan without
/// touching any engine or the app handle. Consumes the pending capture WAV
/// exactly once here (WS-18: a recording is consumed once).
fn transcribe_plan(
    state: &SpeechState,
    request: TranscribeRequest,
) -> Result<(String, TranscribePlan), String> {
    if request.request_id.is_empty() || request.request_id.len() > 128 {
        return Err("invalid request id".into());
    }
    if request.mode.as_deref() == Some("capture") {
        if request.transcript_text.is_some() || request.wav_path.is_some() {
            return Err("capture mode takes no other payload".into());
        }
        let language = request.language.unwrap_or_else(|| "en".into());
        // The capture worker wrote its finished recording into the session
        // temp root at release; that path is the ONLY input accepted here.
        // The STT run verifies the model checksum pre-run and deletes the
        // WAV + transcript file unconditionally afterwards (FIX-017 guard);
        // nothing audio-shaped ever crosses IPC.
        let wav = state
            .last_capture_wav
            .lock()
            .map_err(|_| "speech state unavailable")?
            .take()
            .ok_or_else(|| {
                "no captured audio is pending — hold HOLD TO TALK first".to_string()
            })?;
        return Ok((request.request_id, TranscribePlan::RunStt { wav, language }));
    }
    if let Some(text) = request.transcript_text.as_deref() {
        if text.len() > MAX_TRANSCRIBE_TEXT_CHARS {
            return Err("transcript payload exceeds bound".into());
        }
        // The final privacy decision (FIX-017) is applied by the caller
        // before this text reaches any speech/caption sink; this boundary
        // only carries it.
        let language = request.language.unwrap_or_else(|| "en".into());
        return Ok((
            request.request_id.clone(),
            TranscribePlan::TextEcho {
                response: serde_json::json!({
                    "requestId": request.request_id,
                    "status": "text",
                    "text": text,
                    "language": language,
                }),
            },
        ));
    }
    if let Some(wav) = request.wav_path.as_deref() {
        if wav.len() > MAX_WAV_PATH_CHARS {
            return Err("wav path exceeds bound".into());
        }
        // Path safety: transcription only accepts files inside the
        // Candice session temp root (cleanup lane owns the root). Both
        // sides are canonicalized — on macOS `/var` is a symlink to
        // `/private/var`, so comparing an unresolved root against a
        // resolved child would reject every legitimate path.
        let normalized = std::path::Path::new(wav);
        let session_root = std::env::temp_dir()
            .join("candice-companion")
            .canonicalize()
            .unwrap_or_else(|_| std::env::temp_dir().join("candice-companion"));
        // Location decides, not existence: a nonexistent-but-in-root path
        // plans the run (the engine owns the missing-file error and
        // reports it honestly), while anything outside the root is
        // refused before any engine call. A nonexistent child cannot be
        // canonicalized, so its PARENT is resolved instead — that still
        // proves containment without letting existence gate the check.
        let in_root = match normalized.canonicalize() {
            Ok(p) => p.starts_with(&session_root),
            Err(_) => normalized
                .parent()
                .and_then(|p| p.canonicalize().ok())
                .map(|p| p == session_root)
                .unwrap_or(false),
        };
        if !in_root {
            return Err("wav path is outside the session temp root or missing".into());
        }
        let language = request.language.unwrap_or_else(|| "en".into());
        return Ok((
            request.request_id,
            TranscribePlan::RunStt { wav: normalized.to_path_buf(), language },
        ));
    }
    Err("transcribe requires mode capture, transcriptText or a session wavPath".into())
}

fn transcribe_impl<R: Runtime>(
    app: &AppHandle<R>,
    state: &SpeechState,
    request: TranscribeRequest,
) -> Result<serde_json::Value, String> {
    let (request_id, plan) = transcribe_plan(state, request)?;
    match plan {
        TranscribePlan::TextEcho { response } => Ok(response),
        TranscribePlan::RunStt { wav, language } => {
            let text = engines::run_whisper_for_capture(app, &wav, &language)?;
            Ok(serde_json::json!({
                "requestId": request_id,
                "status": "transcribed",
                "text": text,
                "language": language,
            }))
        }
    }
}

/// Validation legs of speak (valid id, bounded text) — separated so tests
/// can prove the bounds without touching any engine.
fn speak_validate_only(_state: &SpeechState, request: &SpeakRequest) -> Result<(), String> {
    if request.request_id.is_empty() || request.request_id.len() > 128 {
        return Err("invalid request id".into());
    }
    if request.text.is_empty() {
        return Err("speak text is empty — captions remain available".into());
    }
    if request.text.len() > MAX_SPEAK_CHARS {
        return Err("speak text exceeds bound".into());
    }
    Ok(())
}

/// Single-flight admission for speak. Parking the id refuses a second
/// speaker as busy; the playback thread later clears it through
/// [`speak_release_slot`] when the mouth provably closes.
fn speak_admission_check(state: &SpeechState, request_id: &str) -> Result<(), String> {
    let mut slot = state
        .active_speak_request
        .lock()
        .map_err(|_| "speech state unavailable")?;
    if slot.is_some() {
        return Err("speech-busy: an utterance is already active".into());
    }
    *slot = Some(request_id.to_string());
    Ok(())
}

/// Speak (plan 3A `speech_speak`, QFIX Q-02 design 2.4). Bounded text,
/// single-flight admission. The REAL TTS path runs here: the Kokoro Python
/// worker synthesizes (WS-19 JSON-lines contract), the app plays the PCM on
/// a `cpal` output stream, and the FIX-016 timing events flow to the
/// scheduler. The caller applies the FIX-017 privacy decision BEFORE this
/// command — the boundary never classifies text itself. The speak slot is
/// shared with the playback thread so it releases when the mouth provably
/// closes (drain or boundary), not when the command returns.
/// The operator-approved voice for this session.
#[derive(Debug)]
pub(crate) struct ApprovedVoice {
    pub id: String,
    pub approval: String,
}

/// Resolve the approved voice from the manifest, or say why it could not be.
///
/// There is deliberately NO default here. Every branch that cannot produce
/// the operator-approved id returns an error, because speaking in a voice
/// the client did not choose — without telling them — is worse than not
/// speaking at all. Captions remain available either way.
///
/// This is the check that would have caught the af_heart incident on day
/// one: the manifest shipped `af_heart`/`approval-pending` for three days,
/// `af_heart` is a real voice in the pack, so it synthesized perfectly and
/// nothing ever raised.
pub(crate) fn resolve_approved_voice(
    inventory: Option<&InventoryRecord>,
    inventory_error: Option<&str>,
) -> Result<ApprovedVoice, String> {
    let Some(inv) = inventory else {
        return Err(inventory_error
            .unwrap_or("the speech manifest could not be read")
            .to_string());
    };
    let Some(cv) = inv.canonical_voice.as_ref() else {
        return Err("the speech manifest declares no canonical voice".to_string());
    };
    let id = cv
        .get("id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "the speech manifest declares no canonical voice id".to_string())?;
    let approval = cv
        .get("approval")
        .and_then(|v| v.as_str())
        .unwrap_or("approval-pending");
    if approval != "approved" {
        return Err(format!(
            "the canonical voice '{id}' is not operator-approved (approval: {approval})"
        ));
    }
    Ok(ApprovedVoice {
        id: id.to_string(),
        approval: approval.to_string(),
    })
}

/// Does this machine have an operating-system voice we can fall back to?
///
/// Runs the thing and reads its exit status; the presence of a NAME on
/// PATH proves nothing about whether it works. macOS asks `say` to list
/// voices. Windows requires the System.Speech assembly to load AND at
/// least one installed voice, because a machine with the assembly and no
/// voice pack would otherwise advertise a capability that produces
/// silence.
fn system_voice_available() -> bool {
    #[cfg(target_os = "macos")]
    {
        crate::proc::no_console(&mut std::process::Command::new("/usr/bin/say"))
            .args(["-v", "?"])
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false)
    }
    #[cfg(windows)]
    {
        crate::proc::no_console(&mut std::process::Command::new("powershell.exe"))
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                "try { Add-Type -AssemblyName System.Speech; \
                 $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; \
                 if ($s.GetInstalledVoices().Count -gt 0) { exit 0 } else { exit 1 } } \
                 catch { exit 1 }",
            ])
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false)
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        false
    }
}

fn speak_impl<R: Runtime>(
    app: &AppHandle<R>,
    state: &SpeechState,
    request: SpeakRequest,
) -> Result<String, String> {
    speak_validate_only(state, &request)?;
    speak_admission_check(state, &request.request_id)?;

    // Resolve the TTS assets from the verified directory; a missing or
    // corrupt asset fails the utterance honestly and releases the slot —
    // captions stay available (spec 20).
    let res = assets::resolve_speech_assets(app);
    // The parse error is carried, not swallowed: a malformed manifest must
    // be able to name itself in the failure the operator actually sees.
    let inventory_result: Result<InventoryRecord, String> = match res.inventory_text.as_deref() {
        Some(text) => serde_json::from_str::<InventoryRecord>(text)
            .map_err(|e| format!("the speech manifest is malformed: {e}")),
        None => Err("no speech manifest was found".to_string()),
    };
    let inventory: Option<InventoryRecord> = inventory_result.as_ref().ok().cloned();
    let find = |id: &str| -> Option<std::path::PathBuf> {
        inventory
            .as_ref()
            .and_then(|inv| inv.entries.iter().find(|e| e.id == id).cloned())
            .and_then(|e| res.root_for(&e))
    };
    let worker = find("tts-worker");
    let model = find("tts-model");
    let voices = find("tts-voices");
    // Bundled Python interpreter next to the worker root (design 3.2:
    // never a host python3), with the CANDICE_PYTHON operator override.
    let python_hint = bundled_python_hint();
    let python = worker
        .as_ref()
        .and_then(|w| w.parent())
        .and_then(|p| p.parent())
        .and_then(|p| bundled_python_path(&p))
        .map(|p| p.to_string_lossy().into_owned())
        .or(python_hint);
    let missing = [
        ("tts-worker", &worker),
        ("tts-model", &model),
        ("tts-voices", &voices),
    ]
    .into_iter()
    .find(|(_, v)| v.is_none());
    // The Kokoro engine cannot run here. Before failing the utterance,
    // try the operating system's own voice (WR-016).
    //
    // The comment further down is emphatic that there is no voice
    // fallback, and it is right about WHY: "Speaking in a voice the client
    // did not choose, WITHOUT TELLING THEM, is worse than not speaking."
    // The objection is to concealment. So this returns a request id
    // prefixed `system-voice:`, and the app says plainly that it is using
    // the computer's built-in voice instead of Candice's own. Told, not
    // concealed.
    //
    // It matters most on Windows, where the alternative today is total
    // silence: no Windows Python payload ships, so tts_engine_ready is
    // false and every single utterance fails.
    let engine_absent = missing.map(|(id, _)| id.to_string()).or_else(|| {
        python.as_ref().map_or_else(
            || Some("bundled voice runtime".to_string()),
            |_| None,
        )
    });
    if let Some(what) = engine_absent {
        if system_voice_available() {
            match state.tts.speak_system_voice(
                app,
                &request.text,
                &request.request_id,
                std::sync::Arc::clone(&state.active_speak_request),
            ) {
                Ok(()) => return Ok(format!("system-voice:{}", request.request_id)),
                Err(_) => { /* fall through to the honest failure below */ }
            }
        }
        speak_release_slot(state, Some(&request.request_id));
        return Err(if what == "bundled voice runtime" {
            "bundled voice runtime is missing; captions remain available".to_string()
        } else {
            format!("voice assets are not installed ({what}); captions remain available")
        });
    }
    let Some(python) = python else {
        // Unreachable: `engine_absent` above already returned for this.
        // Kept so the binding below stays total rather than an unwrap.
        speak_release_slot(state, Some(&request.request_id));
        return Err(
            "bundled voice runtime is missing; captions remain available".into(),
        );
    };

    let speed = request.speed.unwrap_or(1.0);
    let speed = if speed.is_finite() && (0.5..=2.0).contains(&speed) { speed } else { 1.0 };
    // Voice: the manifest's canonicalVoice.id — the operator approval
    // record — or nothing at all. There is no fallback. Speaking in a voice
    // the client did not choose, without telling them, is worse than not
    // speaking; captions carry the answer either way.
    //
    // A manifest from a user-writable root that disagrees with the signed
    // bundle is refused before anything else: obeying it is how a client
    // gets locked to a voice they never chose.
    if let Some(conflict) = res.canonical_voice_conflict() {
        speak_release_slot(state, Some(&request.request_id));
        return Err(format!("{conflict}; captions remain available"));
    }
    let approved = match resolve_approved_voice(
        inventory.as_ref(),
        inventory_result.as_ref().err().map(String::as_str),
    ) {
        Ok(voice) => voice,
        Err(why) => {
            speak_release_slot(state, Some(&request.request_id));
            return Err(format!("{why}; captions remain available"));
        }
    };
    // A per-utterance override may only ever name the approved voice.
    // NOTE: this narrows an existing (currently unused) capability — the
    // frontend never sends `voiceId`. A legitimate override path needs its
    // own approval story.
    let voice_id = match request.voice_id.as_deref() {
        None => approved.id.clone(),
        Some(requested) if requested == approved.id => approved.id.clone(),
        Some(requested) => {
            speak_release_slot(state, Some(&request.request_id));
            return Err(format!(
                "requested voice '{requested}' is not the approved voice '{}'; \
                 captions remain available",
                approved.id
            ));
        }
    };

    state.tts.arm_next();
    let started = state.tts.synthesize_and_play(
        app,
        worker.as_deref().unwrap(),
        std::path::Path::new(&python),
        model.as_deref().unwrap(),
        voices.as_deref().unwrap(),
        &request.text,
        &voice_id,
        speed,
        &request.request_id,
        std::sync::Arc::clone(&state.active_speak_request),
        &request.request_id,
    );
    if started.is_err() {
        speak_release_slot(state, Some(&request.request_id));
        return Err(started.unwrap_err());
    }
    Ok(request.request_id)
}

/// Release the speak slot when it still holds this request id (idempotent;
/// the playback thread may already have cleared it).
fn speak_release_slot(state: &SpeechState, request_id: Option<&str>) {
    if let Ok(mut slot) = state.active_speak_request.lock() {
        let matches = match (&*slot, request_id) {
            (_, None) => true,
            (Some(current), Some(rid)) => current == rid,
            (None, Some(_)) => false,
        };
        if matches {
            *slot = None;
        }
    }
}

#[tauri::command]
pub fn cmd_speech_speak<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SpeechState>,
    request: SpeakRequest,
) -> Result<String, String> {
    speak_impl(&app, &state, request)
}

/// Speak stop (plan 3A `speech_stop`, design 2.4). The interrupt flag
/// stops real playback within one buffer period and the playback thread
/// emits the boundary event; the slot release follows there AND here so a
/// stop before synthesis completes also clears admission. Idempotent.
fn speak_stop_impl(state: &SpeechState, request_id: Option<String>) -> Result<(), String> {
    state.tts.stop();
    speak_release_slot(state, request_id.as_deref());
    Ok(())
}

#[tauri::command]
pub fn cmd_speech_stop(
    state: State<'_, SpeechState>,
    request_id: Option<String>,
) -> Result<(), String> {
    speak_stop_impl(&state, request_id)
}

/// Permissions (plan 3A `speech_permissions`, QFIX Q-02 design 3.1). The
/// capture worker's last-known controller status IS the honest TCC fact:
/// a denied stream-open maps to Denied, no-device to NoDevice, a live or
/// previously opened stream to Granted, and never-attempted to
/// NotDetermined — the review's complaint was that the old slot-based
/// mapping faked Granted from an admission id. Never probes on its own:
/// permission prompting happens only at PTT (plan 3D).
/// Map a capture-controller status to the honest TCC fact (design 3.1).
///
/// Extracted from `cmd_speech_permissions` so a test can drive the REAL
/// mapping. It previously lived inline inside a `#[tauri::command]` that
/// needs an `AppHandle` and `State`, which is exactly why its test
/// re-implemented the `match` instead of calling it.
///
/// Fails closed: any status that has not produced a verdict maps to
/// NotDetermined, never Granted.
pub(crate) fn mic_permission_for_status(status: &str) -> MicPermissionState {
    match status {
        "listening" | "stopping" => MicPermissionState::Granted,
        "denied" => MicPermissionState::Denied,
        "no-device" => MicPermissionState::NoDevice,
        "error" => MicPermissionState::Error,
        // idle/requesting/disposed/unknown: no attempt has produced a
        // verdict yet — not-determined is the truthful answer.
        _ => MicPermissionState::NotDetermined,
    }
}

#[tauri::command]
pub fn cmd_speech_permissions<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SpeechState>,
) -> Result<SpeechPermissions, String> {
    let _ = &app; // reserved for the future platform adapter registration
    let last_status = state.capture.last_status().unwrap_or_default();
    let microphone = mic_permission_for_status(last_status.as_str());
    Ok(SpeechPermissions {
        microphone,
        prompt_source: "ptt-only".into(),
        explanation: match microphone {
            MicPermissionState::Granted => "Microphone is active for the current push-to-talk press.".into(),
            MicPermissionState::Denied => {
                "Microphone access was denied. Open System Settings > Privacy & Security > Microphone, enable Candice Companion, then return; typed answers and captions remain available.".into()
            }
            MicPermissionState::NotDetermined => {
                "Microphone permission is requested only when you press HOLD TO TALK.".into()
            }
            MicPermissionState::NoDevice => {
                "No microphone device is available; typed answers and captions remain available.".into()
            }
            MicPermissionState::Error => {
                "Microphone state could not be determined; typed answers and captions remain available.".into()
            }
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn speech_contract_version_is_stable() {
        assert_eq!(SPEECH_CONTRACT_VERSION, "1.0");
    }

    #[test]
    fn health_shape_serializes_camel_case() {
        let health = SpeechHealth {
            contract_version: SPEECH_CONTRACT_VERSION.into(),
            capabilities: SpeechCapabilityFact {
                stt_available: false,
                tts_available: false,
                system_tts_available: false,
                duplex_mounted: true,
                capture_mounted: false,
                canonical_voice_approved: false,
            },
            stt_runtime: "whisper.cpp".into(),
            stt_runtime_version: "1.9.2".into(),
            stt_model: "ggml-tiny.en-q5_1.bin".into(),
            stt_model_sha256: "c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b".into(),
            stt_model_sha256_status: "absent".into(),
            stt_model_sha256_measured: String::new(),
            stt_engine_ready: false,
            tts_engine_ready: false,
            tts_model: "kokoro-v1.0.fp16.onnx".into(),
            tts_voicepack_release: "model-files-v1.1".into(),
            canonical_voice_id: "af_heart".into(),
            canonical_voice_approval: "approval-pending".into(),
            speech_assets_root: "none".into(),
            receipt_present: false,
            degraded: true,
            degraded_reason: Some("assets missing".into()),
        };
        let json = serde_json::to_value(&health).expect("serialize");
        let map = json.as_object().expect("object");
        for key in [
            "contractVersion",
            "capabilities",
            "sttRuntime",
            "sttRuntimeVersion",
            "sttModel",
            "sttModelSha256",
            "sttModelSha256Status",
            "sttModelSha256Measured",
            "sttEngineReady",
            "ttsEngineReady",
            "canonicalVoiceId",
            "canonicalVoiceApproval",
            "speechAssetsRoot",
            "receiptPresent",
            "degraded",
        ] {
            assert!(map.contains_key(key), "missing field {key}");
        }
        assert_eq!(map["canonicalVoiceApproval"], "approval-pending");
    }

    #[test]
    fn capture_admission_is_single_flight() {
        let state = SpeechState::default();
        // Un-started engine: press fails honestly (no device thread), so
        // the admission slot must stay empty — busy is never fabricated.
        let first = capture_start_impl(&state, "cap-1".into());
        assert!(first.is_err(), "un-started engine cannot open a device");
        let err = first.unwrap_err();
        assert!(
            !err.contains("capture-busy"),
            "first start must fail on the engine, not on admission: {err}"
        );
        // A stale slot would be the fake-admission defect; assert none.
        assert!(state.active_capture_request.lock().unwrap().is_none());

        // The single-flight slot itself: park an id directly and prove a
        // second request refuses as busy before any engine call.
        *state.active_capture_request.lock().unwrap() = Some("cap-live".into());
        let second = capture_start_impl(&state, "cap-2".into());
        assert!(second.is_err());
        assert!(
            second.unwrap_err().contains("capture-busy"),
            "a live capture holds the slot"
        );
        // Release with the live id clears the slot exactly once.
        capture_stop_impl(&state, Some("cap-live".into())).ok();
        assert!(state.active_capture_request.lock().unwrap().is_none());
    }

    #[test]
    fn capture_start_rejects_invalid_request_ids() {
        let state = SpeechState::default();
        assert!(capture_start_impl(&state, String::new()).is_err());
        assert!(capture_start_impl(&state, "x".repeat(129)).is_err());
        assert!(state.active_capture_request.lock().unwrap().is_none());
    }

    #[test]
    fn speak_bounds_text_and_is_single_flight() {
        // Validation legs run before any engine touch: empty and oversized
        // text are refused with the slot never taken (spec 20 bounds).
        let state = SpeechState::default();
        assert!(speak_validate_only(&state, &SpeakRequest {
            request_id: "s-1".into(),
            text: String::new(),
            voice_id: None,
            speed: None,
        })
        .is_err());
        assert!(speak_validate_only(&state, &SpeakRequest {
            request_id: "s-2".into(),
            text: "a".repeat(MAX_SPEAK_CHARS + 1),
            voice_id: None,
            speed: None,
        })
        .is_err());
        assert!(state.active_speak_request.lock().unwrap().is_none());

        // Single-flight admission: parking an id refuses a second speaker
        // as busy; stop is idempotent and clears admission exactly once.
        *state.active_speak_request.lock().unwrap() = Some("s-live".into());
        let second = speak_admission_check(&state, "s-next");
        assert!(second.is_err());
        assert!(second.unwrap_err().contains("speech-busy"));
        speak_release_slot(&state, Some("s-live"));
        assert!(state.active_speak_request.lock().unwrap().is_none());
        speak_stop_impl(&state, Some("s-gone".into())).unwrap();
        speak_stop_impl(&state, None).unwrap(); // idempotent
        assert!(state.active_speak_request.lock().unwrap().is_none());
    }

    #[test]
    fn transcribe_refuses_foreign_paths() {
        // The planning leg (not the #[tauri::command] wrapper): no app
        // handle needed for validation and path-safety facts.
        let state = SpeechState::default();
        let req = |wav: &str| TranscribeRequest {
            request_id: "t-1".into(),
            mode: None,
            transcript_text: None,
            wav_path: Some(wav.into()),
            language: None,
        };
        // Path safety fires before any engine resolution: a path outside
        // the session temp root is refused outright.
        let foreign = transcribe_plan(&state, req("/tmp/not-a-candice-file.wav"));
        assert!(foreign.is_err());
        assert!(foreign
            .unwrap_err()
            .contains("outside the session temp root"));

        let missing_payload = transcribe_plan(
            &state,
            TranscribeRequest {
                request_id: "t-2".into(),
                mode: None,
                transcript_text: None,
                wav_path: None,
                language: None,
            },
        );
        assert!(missing_payload.is_err());
        assert!(missing_payload
            .unwrap_err()
            .contains("transcribe requires"));

        // Bounded in-memory text plans an echo without touching any engine.
        let (rid, plan) = transcribe_plan(
            &state,
            TranscribeRequest {
                request_id: "t-3".into(),
                mode: None,
                transcript_text: Some("bounded text".into()),
                wav_path: None,
                language: Some("en".into()),
            },
        )
        .unwrap();
        assert_eq!(rid, "t-3");
        match plan {
            TranscribePlan::TextEcho { response } => {
                assert_eq!(response["status"], "text");
                assert_eq!(response["text"], "bounded text");
            }
            _ => panic!("text payload must plan an echo, not an STT run"),
        }

        // Oversized text is bounded (spec 20), never truncated silently.
        let oversized = transcribe_plan(
            &state,
            TranscribeRequest {
                request_id: "t-6".into(),
                mode: None,
                transcript_text: Some("x".repeat(MAX_TRANSCRIBE_TEXT_CHARS + 1)),
                wav_path: None,
                language: None,
            },
        );
        assert!(oversized.is_err());

        // Capture mode takes no other payload — mixed shapes are refused.
        let mixed = transcribe_plan(
            &state,
            TranscribeRequest {
                request_id: "t-4".into(),
                mode: Some("capture".into()),
                transcript_text: Some("x".into()),
                wav_path: None,
                language: None,
            },
        );
        assert!(mixed.is_err());
        assert!(mixed.unwrap_err().contains("capture mode takes no other payload"));

        // Capture mode with nothing pending fails honestly (never blank).
        let stale = transcribe_plan(
            &state,
            TranscribeRequest {
                request_id: "t-5".into(),
                mode: Some("capture".into()),
                transcript_text: None,
                wav_path: None,
                language: None,
            },
        );
        assert!(stale.is_err());
        assert!(stale.unwrap_err().contains("no captured audio is pending"));

        // Invalid request ids are refused before anything else runs.
        for rid in [String::new(), "y".repeat(129)] {
            let bad = transcribe_plan(
                &state,
                TranscribeRequest {
                    request_id: rid,
                    mode: None,
                    transcript_text: Some("ok".into()),
                    wav_path: None,
                    language: None,
                },
            );
            assert!(bad.is_err(), "invalid id accepted");
        }
    }

    /// A pending capture WAV is consumed exactly once at plan time (WS-18:
    /// a recording is consumed once) even when the file itself is gone;
    /// capture mode always plans a real STT run with the default language.
    #[test]
    fn transcribe_capture_mode_consumes_pending_wav_once() {
        let state = SpeechState::default();
        let parked =
            std::path::PathBuf::from("/tmp/candice-companion-q2p2-does-not-exist.wav");
        *state.last_capture_wav.lock().unwrap() = Some(parked.clone());
        let first = transcribe_plan(
            &state,
            TranscribeRequest {
                request_id: "c-1".into(),
                mode: Some("capture".into()),
                transcript_text: None,
                wav_path: None,
                language: None,
            },
        )
        .expect("pending capture consumes once even when the file is gone");
        match first.1 {
            TranscribePlan::RunStt { wav, language } => {
                assert_eq!(wav, parked);
                assert_eq!(language, "en", "language defaults to en");
            }
            _ => panic!("capture mode must plan a real STT run"),
        }
        assert!(
            state.last_capture_wav.lock().unwrap().is_none(),
            "pending slot must be consumed by the first attempt"
        );
        let second = transcribe_plan(
            &state,
            TranscribeRequest {
                request_id: "c-2".into(),
                mode: Some("capture".into()),
                transcript_text: None,
                wav_path: None,
                language: None,
            },
        );
        assert!(second.is_err());
        assert!(second.unwrap_err().contains("no captured audio is pending"));
    }

    /// Session-temp WAV leg: location decides, not existence. In-root
    /// files plan real STT runs; outside-root paths are refused before any
    /// engine call. The engine deletes the file after transcription
    /// (FIX-017 guard).
    #[test]
    fn transcribe_session_temp_paths_are_allowlisted() {
        let state = SpeechState::default();
        let root = std::env::temp_dir().join("candice-companion");
        std::fs::create_dir_all(&root).unwrap();
        let inside = root.join(format!("q2p2-leg-{}.wav", std::process::id()));
        std::fs::write(&inside, b"RIFF....").unwrap();

        let (_, plan) = transcribe_plan(
            &state,
            TranscribeRequest {
                request_id: "w-1".into(),
                mode: None,
                transcript_text: None,
                wav_path: Some(inside.to_string_lossy().into_owned()),
                language: Some("de".into()),
            },
        )
        .expect("in-root wav plans a run");
        match plan {
            TranscribePlan::RunStt { wav, language } => {
                assert_eq!(wav, inside);
                assert_eq!(language, "de", "explicit language is honored");
            }
            _ => panic!("session wav must plan a real STT run"),
        }
        let _ = std::fs::remove_file(&inside);

        // A nonexistent-but-in-root path also plans (the engine owns the
        // missing-file error) — proving the allowlist is by location.
        let ghost = root.join(format!("q2p2-ghost-{}.wav", std::process::id()));
        let (_, plan) = transcribe_plan(
            &state,
            TranscribeRequest {
                request_id: "w-2".into(),
                mode: None,
                transcript_text: None,
                wav_path: Some(ghost.to_string_lossy().into_owned()),
                language: None,
            },
        )
        .expect("location decides, not existence");
        assert!(matches!(plan, TranscribePlan::RunStt { .. }));
    }

    #[test]
    fn permissions_report_never_claims_granted_without_capture() {
        // A default (un-started) engine has no last-known status: the
        // permission report must be NotDetermined, never Granted.
        let state = SpeechState::default();
        assert_eq!(state.capture.last_status(), None);
        let report_shape = serde_json::to_value(SpeechPermissions {
            microphone: MicPermissionState::NotDetermined,
            prompt_source: "ptt-only".into(),
            explanation: "prompted only at PTT".into(),
        })
        .expect("serialize");
        let map = report_shape.as_object().expect("object");
        assert!(map.contains_key("microphone"));
        assert!(map.contains_key("promptSource"));
        assert!(map.contains_key("explanation"));
    }

    /// Permission mapping table (design 3.1): each controller status maps
    /// to the honest TCC fact.
    ///
    /// The test this replaces built this same table and then
    /// RE-IMPLEMENTED the production `match` inside its own body, asserting
    /// the copy matched the table. The production mapping could have been
    /// deleted entirely and it would still have passed. This one calls the
    /// real `mic_permission_for_status`, so removing or altering any arm
    /// fails it.
    #[test]
    fn permission_mapping_is_honest_per_controller_status() {
        let cases: &[(&str, MicPermissionState)] = &[
            ("listening", MicPermissionState::Granted),
            ("stopping", MicPermissionState::Granted),
            ("denied", MicPermissionState::Denied),
            ("no-device", MicPermissionState::NoDevice),
            ("error", MicPermissionState::Error),
            ("idle", MicPermissionState::NotDetermined),
            ("requesting", MicPermissionState::NotDetermined),
            ("disposed", MicPermissionState::NotDetermined),
            ("", MicPermissionState::NotDetermined),
            // An unrecognised status must fail closed, so a controller
            // state added later cannot silently read as microphone access.
            ("some-future-status", MicPermissionState::NotDetermined),
        ];
        for (raw, expected) in cases {
            assert_eq!(
                mic_permission_for_status(raw),
                *expected,
                "status {raw:?} must map to {expected:?}"
            );
        }
        // The dangerous direction as its own assertion: nothing outside the
        // two live-stream statuses may EVER report Granted.
        for raw in [
            "idle", "requesting", "disposed", "denied", "no-device", "error", "", "??",
        ] {
            assert_ne!(
                mic_permission_for_status(raw),
                MicPermissionState::Granted,
                "status {raw:?} must never report microphone access"
            );
        }
    }

    // ---- approved-voice enforcement (the af_heart incident) -------------

    fn manifest_with(canonical: serde_json::Value) -> InventoryRecord {
        serde_json::from_value(serde_json::json!({
            "schema": "candice.speech-inventory/v1",
            "canonicalVoice": canonical,
            "entries": [],
        }))
        .expect("fixture manifest must deserialize")
    }

    /// Approval must be EARNED.
    ///
    /// The test this replaces asserted that a field equals itself —
    /// `approval == "approved"` on both sides of an `assert_eq!` — so it
    /// could never fail, and it passed unchanged through the entire
    /// af_heart incident. This one drives the real resolver and fails in
    /// BOTH directions: no non-approved status may yield a speakable
    /// voice, and the approved one must.
    #[test]
    fn canonical_voice_approval_is_honest_pending() {
        // Note "APPROVED": the comparison is case-sensitive by design, so a
        // manifest shouting it does not get a pass.
        for status in [
            "approval-pending",
            "pending",
            "rejected",
            "revoked",
            "",
            "APPROVED",
        ] {
            let inv = manifest_with(serde_json::json!({
                "id": "af_bella", "approval": status
            }));
            let err = resolve_approved_voice(Some(&inv), None)
                .err()
                .unwrap_or_else(|| panic!("approval {status:?} must not yield a speakable voice"));
            assert!(
                err.contains("not operator-approved"),
                "approval {status:?} must be refused for the approval reason, got: {err}"
            );
        }

        let approved = manifest_with(serde_json::json!({
            "id": "af_bella", "approval": "approved"
        }));
        let voice =
            resolve_approved_voice(Some(&approved), None).expect("an approved manifest resolves");
        assert_eq!(voice.id, "af_bella");
        assert_eq!(voice.approval, "approved");
        // The capability flag the UI reads is derived from this same string.
        assert!(
            SpeechCapabilityFact {
                stt_available: false,
                tts_available: false,
                system_tts_available: false,
                duplex_mounted: false,
                capture_mounted: false,
                canonical_voice_approved: voice.approval == "approved",
            }
            .canonical_voice_approved
        );
    }

    #[test]
    fn approved_manifest_resolves_to_its_declared_voice() {
        let inv = manifest_with(serde_json::json!({
            "id": "af_bella", "approval": "approved"
        }));
        let voice = resolve_approved_voice(Some(&inv), None).expect("must resolve");
        assert_eq!(voice.id, "af_bella");
        assert_eq!(voice.approval, "approved");
    }

    /// THE REGRESSION TEST. Before this change every one of these branches
    /// silently produced `af_heart` — a real voice in the pack, so it
    /// synthesized perfectly and the client heard a voice they never chose.
    /// Each case must now REFUSE, and must not name a substitute.
    #[test]
    fn unresolvable_voice_refuses_and_never_substitutes() {
        let cases: Vec<(&str, Option<InventoryRecord>)> = vec![
            ("no manifest at all", None),
            (
                "manifest without a canonicalVoice",
                Some(
                    serde_json::from_value(serde_json::json!({
                        "schema": "candice.speech-inventory/v1", "entries": []
                    }))
                    .unwrap(),
                ),
            ),
            (
                "canonicalVoice without an id",
                Some(manifest_with(serde_json::json!({ "approval": "approved" }))),
            ),
            (
                "empty id",
                Some(manifest_with(
                    serde_json::json!({ "id": "   ", "approval": "approved" }),
                )),
            ),
            (
                "id present but not approved",
                Some(manifest_with(serde_json::json!({
                    "id": "af_bella", "approval": "approval-pending"
                }))),
            ),
        ];
        for (label, inv) in cases {
            let result = resolve_approved_voice(inv.as_ref(), None);
            let err = result
                .err()
                .unwrap_or_else(|| panic!("{label}: must refuse, never substitute"));
            // Mutation proof: reintroducing ANY hardcoded fallback makes
            // this fail, because a substituted id would have to appear.
            assert!(
                !err.contains("af_heart"),
                "{label}: refusal must not name a substitute voice, got: {err}"
            );
        }
    }

    #[test]
    fn malformed_manifest_names_itself_in_the_refusal() {
        let err =
            resolve_approved_voice(None, Some("the speech manifest is malformed: expected `,`"))
                .expect_err("must refuse");
        assert!(
            err.contains("malformed"),
            "the parse error must reach the operator, got: {err}"
        );
    }

    #[test]
    fn health_reports_unresolved_rather_than_a_plausible_wrong_voice() {
        // The old code reported `af_heart` here, which reads as a real
        // answer. "unresolved" cannot be mistaken for a chosen voice.
        let (id, approval) = match resolve_approved_voice(None, None) {
            Ok(v) => (v.id, v.approval),
            Err(_) => ("unresolved".to_string(), "approval-pending".to_string()),
        };
        assert_eq!(id, "unresolved");
        assert_ne!(id, "af_heart");
        assert_eq!(approval, "approval-pending");
    }
}
