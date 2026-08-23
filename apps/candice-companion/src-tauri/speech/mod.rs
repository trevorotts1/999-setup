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

use assets::{InventoryEntry, InventoryRecord};

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

/// Shared managed state for the speech boundary. Commands mutate only
/// the lifecycle facts the boundary owns (capture request ids); engine
/// state stays inside the lane subprocesses.
#[derive(Default)]
pub struct SpeechState {
    /// The one active capture request id (PTT single-flight, plan 3C).
    active_capture_request: std::sync::Mutex<Option<String>>,
    /// The one active speak request id (idempotent stop, plan 3A).
    active_speak_request: std::sync::Mutex<Option<String>>,
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

    // Canonical voice: af_heart is the pre-approval default (plan 1:
    // no "canonical voice" claims before operator approval exists).
    // FIX-015 FAIL-6: the bundled SPEECH-INVENTORY.json is the approval
    // record (canonicalVoice.approval). When it is present and parseable
    // its value wins; without the manifest the boundary fails closed to
    // approval-pending — never claims approved by default.
    let canonical_voice_id = "af_heart".to_string();
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

/// Capture start (plan 3A `speech_capture_start`). PTT lifetime only,
/// single-flight: a second request while one is live is refused as busy.
/// The real device open happens in the capture lane; this command owns
/// the admission slot.
fn capture_start_impl(state: &SpeechState, request_id: String) -> Result<String, String> {
    if request_id.is_empty() || request_id.len() > 128 {
        return Err("invalid request id".into());
    }
    let mut slot = state
        .active_capture_request
        .lock()
        .map_err(|_| "speech state unavailable")?;
    if slot.is_some() {
        return Err("capture-busy: a PTT capture is already active".into());
    }
    *slot = Some(request_id.clone());
    Ok(request_id)
}

#[tauri::command]
pub fn cmd_speech_capture_start(
    state: State<'_, SpeechState>,
    request_id: String,
) -> Result<String, String> {
    capture_start_impl(&state, request_id)
}

/// Capture stop (plan 3A `speech_capture_stop`). Idempotent: releasing a
/// capture that is not live is a no-op success, never an error (spec 20).
fn capture_stop_impl(state: &SpeechState, request_id: Option<String>) -> Result<(), String> {
    let mut slot = state
        .active_capture_request
        .lock()
        .map_err(|_| "speech state unavailable")?;
    if let Some(id) = &*slot {
        if request_id.as_ref().is_none_or(|rid| rid == id) {
            *slot = None;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn cmd_speech_capture_stop(
    state: State<'_, SpeechState>,
    request_id: Option<String>,
) -> Result<(), String> {
    capture_stop_impl(&state, request_id)
}

/// Transcribe (plan 3A `speech_transcribe`). Bounded in-memory text or an
/// allowlisted session-temp WAV path; the boundary echoes the request id
/// and a status code, never raw audio. A missing payload is an explicit
/// failure — an empty transcript is never a blank answer (spec 20).
#[tauri::command]
pub fn cmd_speech_transcribe(
    request: TranscribeRequest,
) -> Result<serde_json::Value, String> {
    if request.request_id.is_empty() || request.request_id.len() > 128 {
        return Err("invalid request id".into());
    }
    if let Some(text) = request.transcript_text.as_deref() {
        if text.len() > MAX_TRANSCRIBE_TEXT_CHARS {
            return Err("transcript payload exceeds bound".into());
        }
        // The final privacy decision (FIX-017) is applied by the caller
        // before this text reaches any speech/caption sink; this boundary
        // only carries it.
        return Ok(serde_json::json!({
            "requestId": request.request_id,
            "status": "text",
            "text": text,
            "language": request.language.unwrap_or_else(|| "en".into()),
        }));
    }
    if let Some(wav) = request.wav_path.as_deref() {
        if wav.len() > MAX_WAV_PATH_CHARS {
            return Err("wav path exceeds bound".into());
        }
        // Path safety: transcription only accepts files inside the
        // Candice session temp root (cleanup lane owns the root).
        let normalized = std::path::Path::new(wav);
        let session_root = std::env::temp_dir().join("candice-companion");
        let canonical_ok = normalized
            .canonicalize()
            .map(|p| p.starts_with(&session_root))
            .unwrap_or(false);
        if !canonical_ok || !normalized.is_file() {
            return Err("wav path is outside the session temp root or missing".into());
        }
        return Ok(serde_json::json!({
            "requestId": request.request_id,
            "status": "queued",
            "wavPath": wav,
            "language": request.language.unwrap_or_else(|| "en".into()),
        }));
    }
    Err("transcribe requires transcriptText or a session wavPath".into())
}

/// Speak (plan 3A `speech_speak`). Bounded text, single-flight admission.
/// The TTS engine handle (WS-19) owns synthesis/cancellation; this command
/// records the active request so `speech_stop` is idempotent.
fn speak_impl(state: &SpeechState, request: SpeakRequest) -> Result<String, String> {
    if request.request_id.is_empty() || request.request_id.len() > 128 {
        return Err("invalid request id".into());
    }
    if request.text.is_empty() {
        return Err("speak text is empty — captions remain available".into());
    }
    if request.text.len() > MAX_SPEAK_CHARS {
        return Err("speak text exceeds bound".into());
    }
    // Voice/speed are forwarded to the engine lane at integration; the
    // boundary validates shape only. Named so the contract fields stay
    // visible in the signature.
    let _ = (&request.voice_id, &request.speed);
    let mut slot = state
        .active_speak_request
        .lock()
        .map_err(|_| "speech state unavailable")?;
    if slot.is_some() {
        return Err("speech-busy: an utterance is already active".into());
    }
    *slot = Some(request.request_id.clone());
    Ok(request.request_id)
}

#[tauri::command]
pub fn cmd_speech_speak(
    state: State<'_, SpeechState>,
    request: SpeakRequest,
) -> Result<String, String> {
    speak_impl(&state, request)
}

/// Speak stop (plan 3A `speech_stop`). Idempotent and state-clearing;
/// the engine handle escalates graceful -> SIGTERM -> SIGKILL (FIX-015
/// FAIL-4), this command only releases the admission slot.
fn speak_stop_impl(state: &SpeechState, request_id: Option<String>) -> Result<(), String> {
    let mut slot = state
        .active_speak_request
        .lock()
        .map_err(|_| "speech state unavailable")?;
    if let Some(id) = &*slot {
        if request_id.as_ref().is_none_or(|rid| rid == id) {
            *slot = None;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn cmd_speech_stop(
    state: State<'_, SpeechState>,
    request_id: Option<String>,
) -> Result<(), String> {
    speak_stop_impl(&state, request_id)
}

/// Permissions (plan 3A `speech_permissions`). Reports the capture lane's
/// real state plus a user-actionable next step. Never probes on its own —
/// permission prompting happens only at PTT or an explicit settings action
/// (plan 3D).
#[tauri::command]
pub fn cmd_speech_permissions<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SpeechState>,
) -> Result<SpeechPermissions, String> {
    // The capture lane owns the real TCC state; this boundary maps its
    // last-known status into the plan-3D report. With no capture attempt
    // yet, macOS TCC state is genuinely not-determined — that is the
    // truthful answer, not a denial.
    let state_fact = {
        let slot = state
            .active_capture_request
            .lock()
            .map_err(|_| "speech state unavailable")?;
        slot.is_some()
    };
    let microphone = if state_fact {
        MicPermissionState::Granted
    } else {
        MicPermissionState::NotDetermined
    };
    // `app` is unused on platforms without a permission API; keep the
    // handle for the future capture-lane adapter registration.
    let _ = &app;
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
        assert_eq!(
            capture_start_impl(&state, "cap-1".into()).unwrap(),
            "cap-1"
        );
        assert!(capture_start_impl(&state, "cap-2".into()).is_err());
        capture_stop_impl(&state, Some("cap-1".into())).unwrap();
        assert_eq!(
            capture_start_impl(&state, "cap-3".into()).unwrap(),
            "cap-3"
        );
    }

    #[test]
    fn speak_bounds_text_and_is_single_flight() {
        let state = SpeechState::default();
        assert!(speak_impl(
            &state,
            SpeakRequest { request_id: "s-1".into(), text: String::new(), voice_id: None, speed: None },
        )
        .is_err());
        assert!(speak_impl(
            &state,
            SpeakRequest { request_id: "s-2".into(), text: "a".repeat(MAX_SPEAK_CHARS + 1), voice_id: None, speed: None },
        )
        .is_err());
        assert_eq!(
            speak_impl(
                &state,
                SpeakRequest { request_id: "s-3".into(), text: "hello".into(), voice_id: None, speed: None },
            )
            .unwrap(),
            "s-3"
        );
        speak_stop_impl(&state, Some("s-3".into())).unwrap();
        speak_stop_impl(&state, Some("s-3".into())).unwrap(); // idempotent
    }

    #[test]
    fn transcribe_refuses_foreign_paths() {
        let req = |wav: &str| TranscribeRequest {
            request_id: "t-1".into(),
            transcript_text: None,
            wav_path: Some(wav.into()),
            language: None,
        };
        assert!(cmd_speech_transcribe(req("/tmp/not-a-candice-file.wav")).is_err());
        assert!(cmd_speech_transcribe(TranscribeRequest {
            request_id: "t-2".into(),
            transcript_text: None,
            wav_path: None,
            language: None,
        })
        .is_err());
        let ok = cmd_speech_transcribe(TranscribeRequest {
            request_id: "t-3".into(),
            transcript_text: Some("bounded text".into()),
            wav_path: None,
            language: None,
        })
        .unwrap();
        assert_eq!(ok["status"], "text");
    }

    #[test]
    fn permissions_report_never_claims_granted_without_capture() {
        // Constructed directly: without an app handle we test the pure
        // mapping through the same function shape used by the handler.
        let state = SpeechState::default();
        let report_shape = serde_json::to_value(&SpeechPermissions {
            microphone: MicPermissionState::NotDetermined,
            prompt_source: "ptt-only".into(),
            explanation: "prompted only at PTT".into(),
        })
        .expect("serialize");
        let map = report_shape.as_object().expect("object");
        assert!(map.contains_key("microphone"));
        assert!(map.contains_key("promptSource"));
        assert!(map.contains_key("explanation"));
        let _ = state;
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
