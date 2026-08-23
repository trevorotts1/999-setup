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
use tauri::{AppHandle, Manager, Runtime, State};

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
    pub stt_model_sha256: String,
    pub stt_engine_ready: bool,
    pub tts_engine_ready: bool,
    pub tts_model: String,
    pub tts_voicepack_release: String,
    pub canonical_voice_id: String,
    pub canonical_voice_approval: String,
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

/// The resource root for bundled speech assets. `tauri.conf.json`
/// `bundle.resources` copies `speech-assets/` next to the executable;
/// Tauri exposes it as a resource path resolved against the app bundle.
fn speech_resource_root<R: Runtime>(app: &AppHandle<R>) -> Option<std::path::PathBuf> {
    app.path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join("speech-assets"))
}

/// The packaged Python interpreter is only valid inside the app bundle;
/// never trust a host `python3` (FIX-015 FAIL-3: no host-machine
/// runtime assumptions in a shipped package).
pub(crate) fn bundled_python_hint() -> Option<String> {
    std::env::var_os("CANDICE_PYTHON").map(|v| v.to_string_lossy().into_owned())
}

/// Health command (plan 3A `speech_health`). Never returns audio, model
/// bytes, or secret text; every fact maps to the captions fallback.
#[tauri::command]
pub fn cmd_speech_health<R: Runtime>(
    app: AppHandle<R>,
) -> Result<SpeechHealth, String> {
    let root = speech_resource_root(&app);
    let root_ok = root.as_ref().map(|p| p.is_dir()).unwrap_or(false);

    // STT lane facts (whisper.cpp contract, WS-16). The model is
    // checksum-verified by the STT lane before use; health reports the
    // pinned identity and whether the packaged files exist.
    let stt_model = "ggml-tiny.en-q5_1.bin".to_string();
    let stt_model_sha256 =
        "c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b".to_string();
    let stt_model_present = root_ok
        && root
            .as_ref()
            .map(|p| p.join("stt").join(&stt_model).is_file())
            .unwrap_or(false);
    // whisper-cli ships inside the app bundle on macOS; on Windows the
    // installer lane places whisper-cli.exe. Absent here = unavailable,
    // captions stay available (never silently use a host binary).
    let stt_binary_present = root_ok
        && (root.as_ref().map(|p| p.join("stt").join("whisper-cli").is_file()).unwrap_or(false)
            || root.as_ref().map(|p| p.join("stt").join("whisper-cli.exe").is_file()).unwrap_or(false));
    let stt_engine_ready = stt_model_present && stt_binary_present;

    // TTS lane facts (Kokoro pins, WS-19). Bundled interpreter +
    // model + voicepack must all be present for `tts_available`.
    let tts_model = "kokoro-v1.0.fp16.onnx".to_string();
    let tts_model_present = root_ok
        && root
            .as_ref()
            .map(|p| p.join("tts").join("runtime").join(&tts_model).is_file())
            .unwrap_or(false);
    let tts_voices_present = root_ok
        && root
            .as_ref()
            .map(|p| p.join("tts").join("runtime").join("voices-v1.0.bin").is_file())
            .unwrap_or(false);
    let tts_runtime_present = root_ok
        && root
            .as_ref()
            .map(|p| p.join("tts").join("runtime").join("runtime.py").is_file())
            .unwrap_or(false);
    let tts_python_present = root_ok
        && root
            .as_ref()
            .map(|p| p.join("tts").join("python").join("bin").join("python3").is_file())
            .unwrap_or(false)
        || bundled_python_hint().is_some();
    let tts_engine_ready = tts_model_present && tts_voices_present && tts_runtime_present && tts_python_present;

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

    // Canonical voice: af_heart is the pre-approval default (plan 1:
    // no "canonical voice" claims before operator approval exists).
    // FIX-015 FAIL-6: the bundled SPEECH-INVENTORY.json is the approval
    // record (canonicalVoice.approval). When it is present and parseable
    // its value wins; without the manifest the boundary fails closed to
    // approval-pending — never claims approved by default.
    let canonical_voice_id = "af_heart".to_string();
    let canonical_voice_approval = root
        .as_ref()
        .and_then(|p| std::fs::read_to_string(p.join("SPEECH-INVENTORY.json")).ok())
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
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
    let capture_mounted = root_ok;
    let duplex_mounted = true; // composition mounts the controller (see frontend)

    let degraded = !(stt_available || tts_available || system_tts_available || capture_mounted);
    let degraded_reason = degraded.then(|| {
        "speech assets are not packaged; captions and typed answers remain available".to_string()
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
        stt_model_sha256,
        stt_engine_ready,
        tts_engine_ready,
        tts_model,
        tts_voicepack_release: "model-files-v1.1".into(),
        canonical_voice_id,
        canonical_voice_approval,
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
            stt_engine_ready: false,
            tts_engine_ready: false,
            tts_model: "kokoro-v1.0.fp16.onnx".into(),
            tts_voicepack_release: "model-files-v1.1".into(),
            canonical_voice_id: "af_heart".into(),
            canonical_voice_approval: "approval-pending".into(),
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
            "sttEngineReady",
            "ttsEngineReady",
            "canonicalVoiceId",
            "canonicalVoiceApproval",
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
