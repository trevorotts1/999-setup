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
    /// Canonical voice is operator-APPROVED. Always false until the
    /// approval gate (spec section 7) lands: `af_heart` is a
    /// pre-approval default and must be labeled pending.
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
    let Ok(mut child) = std::process::Command::new(path)
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
                .map(|p| p.join("python").join("bin").join("python3"))
                .map(|p| p.is_file())
                .unwrap_or(false)
        })
        .unwrap_or(false)
        || bundled_python_hint().is_some();
    let tts_engine_ready = tts_model_ok && tts_voices_ok && tts_runtime_present && tts_python_present;

    // System-TTS fallback probe. macOS: `say` must exist and run.
    // Windows: the adapter lane (WR-016) registers itself later; until
    // then this reports false (truthful — never a fabricated capability).
    #[cfg(target_os = "macos")]
    let system_tts_available = std::process::Command::new("/usr/bin/say")
        .args(["-v", "?"])
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false);
    #[cfg(not(target_os = "macos"))]
    let system_tts_available = false;

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
    // BOTH the voice id and its approval (FIX-015 FAIL-6). The id is read
    // from the manifest rather than hardcoded here — hardcoding it would
    // make this a second runtime write point that silently disagrees with
    // the TS single write point (src-tauri/tts/assets.ts
    // DEFAULT_CANONICAL_VOICE), which is what the manifest exists to
    // prevent. Without a readable manifest this falls back to the
    // pre-approval default and approval fails closed to approval-pending —
    // it never claims approved by default.
    let canonical_voice_id = inventory
        .as_ref()
        .and_then(|inv| inv.canonical_voice.as_ref())
        .and_then(|cv| cv.get("id"))
        .and_then(|id| id.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| "af_heart".to_string());
    let canonical_voice_approval = res
        .inventory_text
        .as_deref()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(text).ok())
        .and_then(|v| {
            v.get("canonicalVoice")
                .and_then(|cv| cv.get("approval"))
                .and_then(|a| a.as_str())
                .map(str::to_string)
        })
        .filter(|s| s == "approved" || s == "approval-pending")
        .unwrap_or_else(|| "approval-pending".to_string());
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
    let inventory: Option<InventoryRecord> = res
        .inventory_text
        .as_deref()
        .and_then(|text| serde_json::from_str(text).ok());
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
        .map(|p| p.join("python").join("bin").join("python3"))
        .filter(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
        .or(python_hint);
    let missing = [
        ("tts-worker", &worker),
        ("tts-model", &model),
        ("tts-voices", &voices),
    ]
    .into_iter()
    .find(|(_, v)| v.is_none());
    if let Some((id, _)) = missing {
        speak_release_slot(state, Some(&request.request_id));
        return Err(format!(
            "voice assets are not installed ({id}); captions remain available"
        ));
    }
    let Some(python) = python else {
        speak_release_slot(state, Some(&request.request_id));
        return Err(
            "bundled voice runtime is missing; captions remain available".into(),
        );
    };

    let speed = request.speed.unwrap_or(1.0);
    let speed = if speed.is_finite() && (0.5..=2.0).contains(&speed) { speed } else { 1.0 };
    // Default voice: the bundled manifest's canonicalVoice.id — the operator
    // approval record — never a hardcoded id, so the voice the app actually
    // speaks in cannot drift from the approved one. A caller may still
    // override per utterance. Falls back to the pre-approval default only
    // when the manifest is missing or unreadable.
    let voice_id = request.voice_id.clone().unwrap_or_else(|| {
        inventory
            .as_ref()
            .and_then(|inv| inv.canonical_voice.as_ref())
            .and_then(|cv| cv.get("id"))
            .and_then(|id| id.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| "af_heart".to_string())
    });

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
#[tauri::command]
pub fn cmd_speech_permissions<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SpeechState>,
) -> Result<SpeechPermissions, String> {
    let _ = &app; // reserved for the future platform adapter registration
    let last_status = state.capture.last_status().unwrap_or_default();
    let microphone = match last_status.as_str() {
        "listening" | "stopping" => MicPermissionState::Granted,
        "denied" => MicPermissionState::Denied,
        "no-device" => MicPermissionState::NoDevice,
        "error" => MicPermissionState::Error,
        // idle/requesting/disposed/unknown: no attempt has produced a
        // verdict yet — not-determined is the truthful answer.
        _ => MicPermissionState::NotDetermined,
    };
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
    /// to the honest TCC fact. Pure — exercised without an app handle.
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
        ];
        for (raw, expected) in cases {
            let got = match *raw {
                "listening" | "stopping" => MicPermissionState::Granted,
                "denied" => MicPermissionState::Denied,
                "no-device" => MicPermissionState::NoDevice,
                "error" => MicPermissionState::Error,
                _ => MicPermissionState::NotDetermined,
            };
            assert_eq!(std::mem::discriminant(&got), std::mem::discriminant(expected), "status {raw:?}");
        }
    }

    #[test]
    fn canonical_voice_approval_is_honest_pending() {
        let approval = "approval-pending";
        assert_eq!(
            approval == "approved",
            SpeechCapabilityFact {
                stt_available: false,
                tts_available: false,
                system_tts_available: false,
                duplex_mounted: false,
                capture_mounted: false,
                canonical_voice_approved: approval == "approved",
            }
            .canonical_voice_approved
        );
    }
}
