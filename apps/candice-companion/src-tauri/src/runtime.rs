//! Executable runtime-composition boundary (FIX-009).
//!
//! This module owns process-launch input and exposes a versioned capability
//! contract to the webview. FIX-011 adds a local authenticated same-session
//! transport; capability fields become true only after the matching handshake
//! succeeds, and return to false when that transport disconnects.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

pub const RUNTIME_CONTRACT_VERSION: &str = "1.0";
pub const RUNTIME_CAPABILITIES_EVENT: &str = "candice:runtime-capabilities";

const SUPPORTED_WAKE_COMMANDS: [&str; 4] = [
    "/spec-protocol",
    "/kaizen",
    "/eli5",
    "/bro",
];

/// A validated request sent by the non-blocking plugin wake hook.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RuntimeLaunch {
    pub wake_command: Option<String>,
    pub session_id: Option<String>,
    pub rejected_reason: Option<String>,
    pub bridge_endpoint: Option<String>,
    pub bridge_token: Option<String>,
    pub bridge_version: Option<String>,
}

impl RuntimeLaunch {
    pub fn wake_received(&self) -> bool {
        self.wake_command.is_some()
    }
}

/// Parse only Candice-owned launch arguments. Unknown arguments are ignored so
/// a shell/framework argument can never prevent Claude from continuing.
pub fn parse_runtime_launch<I, S>(args: I) -> RuntimeLaunch
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let args: Vec<String> = args.into_iter().map(|value| value.as_ref().to_string()).collect();
    let mut launch = RuntimeLaunch::default();
    let mut index = 0;

    while index < args.len() {
        match args[index].as_str() {
            "--wake" => {
                let Some(command) = args.get(index + 1) else {
                    launch.rejected_reason = Some("--wake requires a supported command".into());
                    break;
                };
                if SUPPORTED_WAKE_COMMANDS.contains(&command.as_str()) {
                    launch.wake_command = Some(command.clone());
                    index += 2;
                } else {
                    launch.rejected_reason = Some(format!("unsupported wake command: {command}"));
                    break;
                }
            }
            "--session-id" => {
                let Some(session_id) = args.get(index + 1) else {
                    launch.rejected_reason = Some("--session-id requires an opaque session value".into());
                    break;
                };
                if valid_session_id(session_id) {
                    launch.session_id = Some(session_id.clone());
                    index += 2;
                } else {
                    launch.rejected_reason = Some("invalid session id".into());
                    break;
                }
            }
            "--bridge-endpoint" => {
                let Some(endpoint) = args.get(index + 1) else {
                    launch.rejected_reason = Some("--bridge-endpoint requires an absolute local socket path".into());
                    break;
                };
                if endpoint.starts_with('/') && endpoint.len() <= 240 && !endpoint.contains('\0') {
                    launch.bridge_endpoint = Some(endpoint.clone());
                    index += 2;
                } else {
                    launch.rejected_reason = Some("invalid bridge endpoint".into());
                    break;
                }
            }
            "--bridge-token" => {
                let Some(token) = args.get(index + 1) else {
                    launch.rejected_reason = Some("--bridge-token requires a capability token".into());
                    break;
                };
                if token.len() == 64 && token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                    launch.bridge_token = Some(token.clone());
                    index += 2;
                } else {
                    launch.rejected_reason = Some("invalid bridge token".into());
                    break;
                }
            }
            "--bridge-version" => {
                let Some(version) = args.get(index + 1) else {
                    launch.rejected_reason = Some("--bridge-version requires a protocol version".into());
                    break;
                };
                if version == "1.0" {
                    launch.bridge_version = Some(version.clone());
                    index += 2;
                } else {
                    launch.rejected_reason = Some("unsupported bridge protocol version".into());
                    break;
                }
            }
            _ => index += 1,
        }
    }

    launch
}

fn valid_session_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| matches!(byte, b'!'..=b'~'))
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCapabilities {
    pub contract_version: String,
    pub runtime_composition_active: bool,
    pub wake_received: bool,
    pub wake_command: Option<String>,
    /// A launch argument is not a verified session binding.
    pub session_binding_active: bool,
    /// FIX-011 must replace this with an authenticated local transport.
    pub bridge_available: bool,
    pub answer_round_trip_available: bool,
    pub single_instance_routing_available: bool,
    pub rejected_launch_reason: Option<String>,
}

impl RuntimeCapabilities {
    fn from_launch(launch: &RuntimeLaunch) -> Self {
        Self {
            contract_version: RUNTIME_CONTRACT_VERSION.into(),
            runtime_composition_active: true,
            wake_received: launch.wake_received(),
            wake_command: launch.wake_command.clone(),
            session_binding_active: false,
            bridge_available: false,
            answer_round_trip_available: false,
            single_instance_routing_available: false,
            rejected_launch_reason: launch.rejected_reason.clone(),
        }
    }
}

pub struct RuntimeState {
    capabilities: Mutex<RuntimeCapabilities>,
    pending_question: Mutex<Option<Value>>,
    bridge_session_id: Option<String>,
    #[cfg(unix)]
    bridge_writer: Mutex<Option<std::os::unix::net::UnixStream>>,
}

impl RuntimeState {
    pub fn capabilities(&self) -> RuntimeCapabilities {
        self.capabilities.lock().expect("runtime capabilities mutex poisoned").clone()
    }

    fn set_bridge_connected(&self, connected: bool) {
        let mut capabilities = self.capabilities.lock().expect("runtime capabilities mutex poisoned");
        capabilities.bridge_available = connected;
        capabilities.answer_round_trip_available = connected;
        capabilities.session_binding_active = connected && self.bridge_session_id.is_some();
        // A socket per MCP launch prevents cross-session leakage, but this
        // build does not yet prove reuse/routing of an existing app instance.
        capabilities.single_instance_routing_available = false;
    }

    fn set_question_bound(&self, bound: bool) {
        self.capabilities.lock().expect("runtime capabilities mutex poisoned").session_binding_active = bound;
    }
}

/// Start and publish the composition boundary before the webview is shown.
/// There is intentionally no network listener, answer store, or claim of
/// bridge readiness in this FIX-009 state.
pub fn initialize_runtime<R: Runtime>(
    app: &AppHandle<R>,
    launch: RuntimeLaunch,
) -> tauri::Result<()> {
    let capabilities = RuntimeCapabilities::from_launch(&launch);
    app.manage(RuntimeState {
        capabilities: Mutex::new(capabilities.clone()),
        pending_question: Mutex::new(None),
        bridge_session_id: launch.session_id.clone(),
        #[cfg(unix)]
        bridge_writer: Mutex::new(None),
    });
    app.emit(RUNTIME_CAPABILITIES_EVENT, capabilities)
        .map_err(|error| tauri::Error::Anyhow(error.into()))
}

/// Start the authenticated per-launch client. The bridge is a Unix-domain
/// socket, so it is local to the current user account; the random capability
/// token and protocol handshake are still required before it becomes ready.
#[cfg(unix)]
pub fn start_local_bridge<R: Runtime>(app: AppHandle<R>, launch: RuntimeLaunch) {
    let (Some(endpoint), Some(token), Some(version)) = (
        launch.bridge_endpoint,
        launch.bridge_token,
        launch.bridge_version,
    ) else { return };
    std::thread::spawn(move || {
        let Ok(mut stream) = std::os::unix::net::UnixStream::connect(endpoint) else { return };
        let hello = json!({ "type": "hello", "version": version, "token": token });
        if writeln!(stream, "{}", hello).is_err() { return }
        let Ok(read_stream) = stream.try_clone() else { return };
        let mut reader = BufReader::new(read_stream);
        let mut line = String::new();
        if reader.read_line(&mut line).ok().filter(|count| *count > 0).is_none() { return }
        let Ok(ready) = serde_json::from_str::<Value>(&line) else { return };
        if ready.get("type").and_then(Value::as_str) != Some("ready") || ready.get("version").and_then(Value::as_str) != Some("1.0") { return }
        {
            let state = app.state::<RuntimeState>();
            if let Ok(writer) = stream.try_clone() { *state.bridge_writer.lock().expect("bridge writer mutex poisoned") = Some(writer); }
            state.set_bridge_connected(true);
            let _ = app.emit(RUNTIME_CAPABILITIES_EVENT, state.capabilities());
        }
        loop {
            line.clear();
            if reader.read_line(&mut line).ok().filter(|count| *count > 0).is_none() { break }
            let Ok(message) = serde_json::from_str::<Value>(&line) else { break };
            if message.get("type").and_then(Value::as_str) == Some("question") {
                let valid = message.get("version").and_then(Value::as_str) == Some("1.0")
                    && message.get("question").map(Value::is_object).unwrap_or(false)
                    && message.get("question").and_then(|q| q.get("sessionId")).and_then(Value::as_str).is_some()
                    && message.get("question").and_then(|q| q.get("questionKey")).and_then(Value::as_str).is_some();
                let expected_session = app.state::<RuntimeState>().bridge_session_id.clone();
                let session_matches = expected_session.as_deref() == message.get("question").and_then(|q| q.get("sessionId")).and_then(Value::as_str);
                if valid && session_matches {
                    let state = app.state::<RuntimeState>();
                    *state.pending_question.lock().expect("pending question mutex poisoned") = Some(message.clone());
                    state.set_question_bound(true);
                    let _ = app.emit(RUNTIME_CAPABILITIES_EVENT, state.capabilities());
                    let _ = app.emit("candice:bridge-question", message.clone());
                    let ack = json!({ "type": "delivered", "sessionId": message["question"]["sessionId"], "questionKey": message["question"]["questionKey"] });
                    let _ = writeln!(stream, "{}", ack);
                }
            }
        }
        let state = app.state::<RuntimeState>();
        *state.bridge_writer.lock().expect("bridge writer mutex poisoned") = None;
        state.set_bridge_connected(false);
        let _ = app.emit(RUNTIME_CAPABILITIES_EVENT, state.capabilities());
    });
}

/// Consume the one pending authenticated question. This closes the WebView
/// startup race: a companion may bind before the frontend registers its event
/// listener, but the first question is never silently acknowledged then lost.
#[tauri::command]
pub fn cmd_take_pending_bridge_question(state: State<'_, RuntimeState>) -> Result<Option<Value>, String> {
    state.pending_question.lock().map(|mut pending| pending.take()).map_err(|_| "bridge state unavailable".into())
}

#[cfg(not(unix))]
pub fn start_local_bridge<R: Runtime>(_app: AppHandle<R>, _launch: RuntimeLaunch) {}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeAnswerRequest {
    pub session_id: String,
    pub question_key: String,
    pub answer: Value,
}

/// The webview can submit only an already-confirmed structured answer. The
/// server validates it against the open exact `(sessionId, questionKey)` slot.
#[tauri::command]
pub fn cmd_submit_bridge_answer(
    state: State<'_, RuntimeState>,
    request: BridgeAnswerRequest,
) -> Result<(), String> {
    #[cfg(unix)] {
        let mut writer = state.bridge_writer.lock().map_err(|_| "bridge state unavailable")?;
        let stream = writer.as_mut().ok_or_else(|| "bridge unavailable".to_string())?;
        serde_json::to_writer(&mut *stream, &json!({
            "type": "answer", "sessionId": request.session_id, "questionKey": request.question_key, "answer": request.answer,
        })).map_err(|_| "bridge write failed")?;
        stream.write_all(b"\n").map_err(|_| "bridge unavailable")?;
        return Ok(());
    }
    #[cfg(not(unix))]
    { let _ = (state, request); Err("local bridge unsupported on this platform".into()) }
}

#[tauri::command]
pub fn cmd_cancel_bridge_question(
    state: State<'_, RuntimeState>,
    session_id: String,
    question_key: String,
) -> Result<(), String> {
    #[cfg(unix)] {
        let mut writer = state.bridge_writer.lock().map_err(|_| "bridge state unavailable")?;
        let stream = writer.as_mut().ok_or_else(|| "bridge unavailable".to_string())?;
        serde_json::to_writer(&mut *stream, &json!({ "type": "cancel", "sessionId": session_id, "questionKey": question_key }))
            .map_err(|_| "bridge write failed")?;
        stream.write_all(b"\n").map_err(|_| "bridge unavailable")?;
        return Ok(());
    }
    #[cfg(not(unix))]
    { let _ = (state, session_id, question_key); Err("local bridge unsupported on this platform".into()) }
}

/// The transparent companion is click-through unless a delivered question
/// owns the visible answer controls. This is intentionally toggled only by
/// the authenticated bridge lifecycle, never by window focus or arbitrary JS.
#[tauri::command]
pub fn cmd_set_answer_input_enabled<R: Runtime>(app: AppHandle<R>, enabled: bool) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or_else(|| "candice: main window missing".to_string())?;
    window.set_ignore_cursor_events(!enabled).map_err(|error| format!("candice: input policy failed: {error}"))
}

/// Webview capability probe. A result is always truthful and serializable;
/// callers must not infer unavailable features from a successful probe.
#[tauri::command]
pub fn cmd_get_runtime_capabilities(
    state: State<'_, RuntimeState>,
) -> Result<RuntimeCapabilities, String> {
    Ok(state.capabilities())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_supported_wake_command() {
        let launch = parse_runtime_launch(["--wake", "/spec-protocol"]);
        assert_eq!(launch.wake_command.as_deref(), Some("/spec-protocol"));
        assert!(launch.rejected_reason.is_none());
        let capabilities = RuntimeCapabilities::from_launch(&launch);
        assert!(capabilities.runtime_composition_active);
        assert!(capabilities.wake_received);
        assert!(!capabilities.bridge_available);
        assert!(!capabilities.answer_round_trip_available);
    }

    #[test]
    fn rejects_incomplete_or_unknown_wake_commands_without_panicking() {
        assert_eq!(
            parse_runtime_launch(["--wake"]).rejected_reason.as_deref(),
            Some("--wake requires a supported command")
        );
        assert!(parse_runtime_launch(["--wake", "/unknown"])
            .rejected_reason
            .is_some());
    }

    #[test]
    fn records_a_wake_session_argument_without_claiming_a_binding() {
        let launch = parse_runtime_launch([
            "--wake",
            "/kaizen",
            "--session-id",
            "opaque-session-42",
        ]);
        assert_eq!(launch.session_id.as_deref(), Some("opaque-session-42"));
        let capabilities = RuntimeCapabilities::from_launch(&launch);
        assert!(!capabilities.session_binding_active);
        assert!(!capabilities.single_instance_routing_available);
    }

    #[test]
    fn accepts_only_a_complete_authenticated_bridge_launch() {
        let launch = parse_runtime_launch([
            "--bridge-endpoint", "/tmp/candice.sock",
            "--bridge-token", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            "--bridge-version", "1.0",
        ]);
        assert!(launch.rejected_reason.is_none());
        assert_eq!(launch.bridge_version.as_deref(), Some("1.0"));
        assert_eq!(parse_runtime_launch(["--bridge-token", "nope"]).rejected_reason.as_deref(), Some("invalid bridge token"));
    }

    #[test]
    fn rejects_control_characters_in_session_ids() {
        assert_eq!(
            parse_runtime_launch(["--session-id", "bad\nvalue"])
                .rejected_reason
                .as_deref(),
            Some("invalid session id")
        );
    }
}
