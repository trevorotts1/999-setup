//! Executable runtime-composition boundary (FIX-009).
//!
//! This module owns process-launch input and exposes a versioned capability
//! contract to the webview. FIX-011 adds a local authenticated same-session
//! transport; capability fields become true only after the matching handshake
//! succeeds, and return to false when that transport disconnects.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

pub const RUNTIME_CONTRACT_VERSION: &str = "1.0";
pub const RUNTIME_CAPABILITIES_EVENT: &str = "candice:runtime-capabilities";
/// FIX-013 S4: explicit bridge lifecycle events for the webview —
/// `connected`, `disconnected`, `reconnecting`, `recovered`, `ended`.
pub const RUNTIME_LIFECYCLE_EVENT: &str = "candice:bridge-lifecycle";

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
    pub bridge_token_file: Option<String>,
    pub bridge_version: Option<String>,
    pub activation_id: Option<String>,
    pub activation_issued_at: Option<String>,
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
                    launch.rejected_reason = Some("--bridge-endpoint requires a loopback TCP endpoint".into());
                    break;
                };
                if valid_bridge_endpoint(endpoint) {
                    launch.bridge_endpoint = Some(endpoint.clone());
                    index += 2;
                } else {
                    launch.rejected_reason = Some("invalid bridge endpoint".into());
                    break;
                }
            }
            "--bridge-token-file" => {
                let Some(token_file) = args.get(index + 1) else {
                    launch.rejected_reason = Some("--bridge-token-file requires an absolute owner-only file path".into());
                    break;
                };
                if Path::new(token_file).is_absolute() && token_file.len() <= 240 && !token_file.contains('\0') {
                    launch.bridge_token_file = Some(token_file.clone());
                    index += 2;
                } else {
                    launch.rejected_reason = Some("invalid bridge token file".into());
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
            "--activation-id" => {
                let Some(activation_id) = args.get(index + 1) else {
                    launch.rejected_reason = Some("--activation-id requires an opaque activation value".into());
                    break;
                };
                if valid_opaque_id(activation_id) {
                    launch.activation_id = Some(activation_id.clone());
                    index += 2;
                } else {
                    launch.rejected_reason = Some("invalid activation id".into());
                    break;
                }
            }
            "--activation-issued-at" => {
                let Some(issued_at) = args.get(index + 1) else {
                    launch.rejected_reason = Some("--activation-issued-at requires an epoch-milliseconds value".into());
                    break;
                };
                if issued_at.len() <= 16 && issued_at.bytes().all(|byte| byte.is_ascii_digit()) {
                    launch.activation_issued_at = Some(issued_at.clone());
                    index += 2;
                } else {
                    launch.rejected_reason = Some("invalid activation issue time".into());
                    break;
                }
            }
            _ => index += 1,
        }
    }

    launch
}

fn valid_session_id(value: &str) -> bool {
    valid_opaque_id(value)
}

fn valid_bridge_endpoint(value: &str) -> bool {
    let Some(port) = value.strip_prefix("tcp://127.0.0.1:") else { return false };
    port.parse::<u16>().map(|port| port != 0).unwrap_or(false)
}

fn valid_opaque_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| matches!(byte, b'!'..=b'~'))
}

fn valid_question_key(value: &str) -> bool {
    let mut bytes = value.bytes();
    matches!(bytes.next(), Some(b'A'..=b'Z'))
        && bytes.all(|byte| matches!(byte, b'A'..=b'Z' | b'0'..=b'9' | b'_' | b'-'))
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
    /// The one question that this single-surface companion has admitted.
    /// A second question must never be acknowledged as delivered while this
    /// slot is occupied: the webview deliberately presents one answer flow.
    active_question: Mutex<Option<BridgeQuestionIdentity>>,
    bridge_session_id: Option<String>,
    bridge_writer: Mutex<Option<TcpStream>>,
    /// FIX-013 S4 lifecycle: connected / disconnected / reconnecting /
    /// recovered / ended, plus the one bounded replay lease and the
    /// exactly-once ended latch. `ended` accepts no further hello.
    lifecycle: Mutex<LifecycleState>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct LifecycleState {
    phase: String,
    replayable: bool,
    lease_id: Option<String>,
    ended: bool,
    /// Set once the SAME authenticated process reconnects and replays the
    /// one unacknowledged operation; cleared when the webview acknowledges
    /// the replay (the `recovered` handoff).
    replay_pending_operation_id: Option<String>,
    replay_pending_question_key: Option<String>,
}

impl LifecycleState {
    fn new() -> Self {
        Self {
            phase: "none".into(),
            replayable: false,
            lease_id: None,
            ended: false,
            replay_pending_operation_id: None,
            replay_pending_question_key: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BridgeQuestionIdentity {
    pub session_id: String,
    pub question_key: String,
    pub operation_id: Option<String>,
}

impl BridgeQuestionIdentity {
    fn from_question_message(message: &Value, expected_session: Option<&str>) -> Option<Self> {
        if message.get("type").and_then(Value::as_str) != Some("question")
            || message.get("version").and_then(Value::as_str) != Some("1.0") {
            return None;
        }
        let question = message.get("question")?.as_object()?;
        let session_id = question.get("sessionId")?.as_str()?;
        let question_key = question.get("questionKey")?.as_str()?;
        if !valid_session_id(session_id)
            || !valid_question_key(question_key)
            || question.get("schemaVersion").and_then(Value::as_str) != Some("1.0")
            || question.get("text").and_then(Value::as_str).filter(|value| !value.is_empty()).is_none()
            || question.get("allowedInputModes").and_then(Value::as_array).is_none()
            || expected_session != Some(session_id) {
            return None;
        }
        // FIX-013 S4: the frame carries the one operation identity; a replay
        // of the same (sessionId, questionKey) carries the same operationId.
        let operation_id = message.get("operationId").and_then(Value::as_str)
            .filter(|value| valid_opaque_id(value))
            .map(str::to_string);
        Some(Self { session_id: session_id.into(), question_key: question_key.into(), operation_id })
    }

    fn from_cancel_message(message: &Value, expected_session: Option<&str>) -> Option<Self> {
        if message.get("type").and_then(Value::as_str) != Some("cancel") { return None; }
        let session_id = message.get("sessionId")?.as_str()?;
        let question_key = message.get("questionKey")?.as_str()?;
        if !valid_session_id(session_id)
            || !valid_question_key(question_key)
            || expected_session != Some(session_id) {
            return None;
        }
        let operation_id = message.get("operationId").and_then(Value::as_str)
            .filter(|value| valid_opaque_id(value))
            .map(str::to_string);
        Some(Self { session_id: session_id.into(), question_key: question_key.into(), operation_id })
    }

    fn matches_message(&self, message: &Value) -> bool {
        message.get("question").and_then(|question| question.get("sessionId")).and_then(Value::as_str) == Some(self.session_id.as_str())
            && message.get("question").and_then(|question| question.get("questionKey")).and_then(Value::as_str) == Some(self.question_key.as_str())
    }
}

/// The lifecycle event the native shell emits to the webview for every
/// transport/durable phase (FIX-013 S4): connected, disconnected,
/// reconnecting, recovered, ended.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeLifecycleEvent {
    pub lifecycle: String,
    pub session_id: Option<String>,
    pub activation_id: Option<String>,
    pub lease_id: Option<String>,
    pub operation_id: Option<String>,
    pub question_key: Option<String>,
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

    /// Emit one explicit lifecycle event to the webview (FIX-013 S4).
    fn emit_lifecycle<R: Runtime>(&self, app: &AppHandle<R>, event: BridgeLifecycleEvent) {
        let _ = app.emit(RUNTIME_LIFECYCLE_EVENT, event);
    }

    fn lifecycle_phase(&self) -> String {
        self.lifecycle.lock().expect("lifecycle mutex poisoned").phase.clone()
    }

    fn lifecycle_ended(&self) -> bool {
        self.lifecycle.lock().expect("lifecycle mutex poisoned").ended
    }

    fn set_lifecycle(&self, phase: &str) {
        let mut lifecycle = self.lifecycle.lock().expect("lifecycle mutex poisoned");
        lifecycle.phase = phase.to_string();
    }

    /// Mark the lifecycle ended exactly once. Returns false when it was
    /// already ended (the ended event fires exactly once).
    fn mark_ended(&self) -> bool {
        let mut lifecycle = self.lifecycle.lock().expect("lifecycle mutex poisoned");
        if lifecycle.ended { return false }
        lifecycle.ended = true;
        lifecycle.phase = "ended".to_string();
        lifecycle.replayable = false;
        lifecycle.lease_id = None;
        true
    }

    fn begin_replay(&self, operation_id: &str, question_key: &str, lease_id: &str) {
        let mut lifecycle = self.lifecycle.lock().expect("lifecycle mutex poisoned");
        lifecycle.phase = "reconnecting".to_string();
        lifecycle.replayable = true;
        lifecycle.lease_id = Some(lease_id.to_string());
        lifecycle.replay_pending_operation_id = Some(operation_id.to_string());
        lifecycle.replay_pending_question_key = Some(question_key.to_string());
    }

    /// The webview acknowledged the exact replayed operation: the recovery
    /// lease is consumed and the lifecycle moves to `recovered`.
    fn consume_replay(&self) -> Option<(String, String)> {
        let mut lifecycle = self.lifecycle.lock().expect("lifecycle mutex poisoned");
        if !lifecycle.replayable { return None }
        lifecycle.replayable = false;
        lifecycle.lease_id = None;
        let pending = lifecycle.replay_pending_operation_id.take()
            .zip(lifecycle.replay_pending_question_key.take());
        if pending.is_some() { lifecycle.phase = "recovered".to_string(); }
        pending
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
        active_question: Mutex::new(None),
        bridge_session_id: launch.session_id.clone(),
        bridge_writer: Mutex::new(None),
        lifecycle: Mutex::new(LifecycleState::new()),
    });
    app.emit(RUNTIME_CAPABILITIES_EVENT, capabilities)
        .map_err(|error| tauri::Error::Anyhow(error.into()))
}

/// Start the authenticated per-launch client. The server is IPv4 loopback
/// only, so the exact protocol is available to both macOS and Windows builds.
/// The token and exact activation acknowledgement are the authorization
/// boundary; an endpoint alone is never authority.
pub fn start_local_bridge<R: Runtime>(app: AppHandle<R>, launch: RuntimeLaunch) {
    let (Some(endpoint), Some(token_file), Some(version), Some(session_id), Some(activation_id), Some(activation_issued_at)) = (
        launch.bridge_endpoint,
        launch.bridge_token_file,
        launch.bridge_version,
        launch.session_id,
        launch.activation_id,
        launch.activation_issued_at,
    ) else { return };
    std::thread::spawn(move || {
        // A launch argument is visible to local process inspection. The
        // capability itself therefore lives in the owner-only token file;
        // refuse the bridge rather than weakening the authentication boundary.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let Ok(metadata) = fs::metadata(&token_file) else { return };
            if metadata.permissions().mode() & 0o077 != 0 { return }
        }
        let Ok(token) = fs::read_to_string(&token_file) else { return };
        if token.len() != 64 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) { return }
        let Some(port) = endpoint.strip_prefix("tcp://127.0.0.1:") else { return };
        // The PID is not authorization. It is only an instance identity that
        // the authenticated broker echoes in its binding acknowledgement.
        let instance_id = format!("candice-{}", std::process::id());
        let hello = json!({
            "type": "hello", "version": version, "token": token,
            "sessionId": session_id, "activationId": activation_id,
            "activationIssuedAt": activation_issued_at, "instanceId": instance_id,
        });
        // FIX-013 S4: one bounded reconnect window. If the MCP process
        // restarts and creates a fresh listener on the same loopback port,
        // this app re-authenticates the SAME session/activation/instance and
        // resumes; the broker refuses the hello if anything mismatched is
        // replayed. The reconnect loop is bounded — a dead server never
        // spins this thread forever.
        let mut attempt = 0u32;
        loop {
            if attempt > 0 && attempt >= 30 { break }
            attempt += 1;
            let Ok(mut stream) = TcpStream::connect(format!("127.0.0.1:{port}")) else {
                if attempt >= 3 { break }
                std::thread::sleep(std::time::Duration::from_millis(200));
                continue;
            };
            if writeln!(stream, "{}", hello).is_err() {
                std::thread::sleep(std::time::Duration::from_millis(200));
                continue;
            }
            let Ok(read_stream) = stream.try_clone() else { break };
            let mut reader = BufReader::new(read_stream);
            let mut line = String::new();
            if reader.read_line(&mut line).ok().filter(|count| *count > 0).is_none() {
                std::thread::sleep(std::time::Duration::from_millis(200));
                continue;
            }
            let Ok(ready) = serde_json::from_str::<Value>(&line) else { break };
            if ready.get("type").and_then(Value::as_str) != Some("ready")
                || ready.get("version").and_then(Value::as_str) != Some("1.0")
                || ready.get("sessionId").and_then(Value::as_str) != Some(session_id.as_str())
                || ready.get("activationId").and_then(Value::as_str) != Some(activation_id.as_str())
                || ready.get("instanceId").and_then(Value::as_str) != Some(instance_id.as_str())
                || ready.get("bindingId").and_then(Value::as_str).filter(|value| valid_opaque_id(value)).is_none()
            { break }
            let state = app.state::<RuntimeState>();
            if state.lifecycle_ended() { break }
            {
                if let Ok(writer) = stream.try_clone() { *state.bridge_writer.lock().expect("bridge writer mutex poisoned") = Some(writer); }
                state.set_bridge_connected(true);
                let _ = app.emit(RUNTIME_CAPABILITIES_EVENT, state.capabilities());
            }
            // Re-authentication succeeded: the exact ready echo (same session,
            // activation, instance) proves this is the SAME launch — a
            // replayed or mismatched credential set never passes the ready
            // validation above. A reconnect therefore re-enters `connected`.
            state.set_lifecycle("connected");
            state.emit_lifecycle(&app, BridgeLifecycleEvent {
                lifecycle: "connected".into(),
                session_id: Some(session_id.clone()),
                activation_id: Some(activation_id.clone()),
                lease_id: None,
                operation_id: None,
                question_key: None,
            });
            let connected = run_bridge_message_loop(app.clone(), stream, state, &instance_id);
            if connected.is_ended() { break }
            // Transport lost. The lifecycle is re-connectable for the SAME
            // process; the bounded loop above re-authenticates. Capability
            // flags drop immediately; the reconnect window is the loop bound.
            let state = app.state::<RuntimeState>();
            *state.bridge_writer.lock().expect("bridge writer mutex poisoned") = None;
            state.set_bridge_connected(false);
            let _ = app.emit(RUNTIME_CAPABILITIES_EVENT, state.capabilities());
            state.set_lifecycle("disconnected");
            state.emit_lifecycle(&app, BridgeLifecycleEvent {
                lifecycle: "disconnected".into(),
                session_id: Some(session_id.clone()),
                activation_id: Some(activation_id.clone()),
                lease_id: None,
                operation_id: None,
                question_key: None,
            });
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
        let state = app.state::<RuntimeState>();
        *state.bridge_writer.lock().expect("bridge writer mutex poisoned") = None;
        state.set_bridge_connected(false);
        let _ = app.emit(RUNTIME_CAPABILITIES_EVENT, state.capabilities());
    });
}

/// One authenticated connection's message loop. Returns `ConnectedOutcome`
/// distinguishing `Ended` (the app requested shutdown) from `Lost`.
fn run_bridge_message_loop<R: Runtime>(
    app: AppHandle<R>,
    mut stream: TcpStream,
    state: tauri::State<'_, RuntimeState>,
    _instance_id: &str,
) -> ConnectedOutcome {
    let Ok(read_stream) = stream.try_clone() else { return ConnectedOutcome::Lost };
    let mut reader = BufReader::new(read_stream);
    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line).ok().filter(|count| *count > 0).is_none() { return ConnectedOutcome::Lost }
        let Ok(message) = serde_json::from_str::<Value>(&line) else { return ConnectedOutcome::Lost };
        let expected_session = state.bridge_session_id.as_deref();
        if message.get("type").and_then(Value::as_str) == Some("ended") {
            // The app initiated normal shutdown: end the lifecycle EXACTLY
            // ONCE (idempotent latch), close bindings, drop the slot and the
            // pending question. Temp-audio sweep and protected pending state
            // removal are the MCP side's shutdown hooks.
            if state.mark_ended() {
                let _ = app.emit(RUNTIME_LIFECYCLE_EVENT, BridgeLifecycleEvent {
                    lifecycle: "ended".into(),
                    session_id: state.bridge_session_id.clone(),
                    activation_id: None,
                    lease_id: None,
                    operation_id: None,
                    question_key: None,
                });
                state.set_question_bound(false);
                *state.pending_question.lock().expect("pending question mutex poisoned") = None;
                *state.active_question.lock().expect("active question mutex poisoned") = None;
            }
            return ConnectedOutcome::Ended;
        }
        if let Some(identity) = BridgeQuestionIdentity::from_question_message(&message, expected_session) {
            let replayed = message.get("replayed").and_then(Value::as_bool) == Some(true);
            let replay_lease = message.get("leaseId").and_then(Value::as_str)
                .filter(|value| valid_opaque_id(value))
                .map(str::to_string);
            let admitted = {
                let mut active = state.active_question.lock().expect("active question mutex poisoned");
                if active.is_none() {
                    *active = Some(identity.clone());
                    Some(true)
                } else {
                    // A retry of the same question can safely receive its
                    // original acknowledgement; a distinct question is
                    // explicitly refused rather than silently overwritten.
                    (active.as_ref() == Some(&identity)).then_some(false)
                }
            };
            let Some(newly_admitted) = admitted else {
                let unavailable = json!({
                    "type": "unavailable", "sessionId": identity.session_id,
                    "questionKey": identity.question_key, "code": "companion-busy",
                });
                let _ = writeln!(stream, "{}", unavailable);
                continue;
            };
            if replayed {
                // FIX-013 S4: the ONE unacknowledged operation is replayed
                // under a bounded recovery lease. The webview surface is
                // raised exactly like a fresh delivery but carries the
                // operation identity and the lease; an acknowledged replay
                // is never replayed again.
                if let Some(lease) = replay_lease.as_deref() {
                    let operation_id = identity.operation_id.clone().unwrap_or_default();
                    state.begin_replay(&operation_id, &identity.question_key, lease);
                }
                state.emit_lifecycle(&app, BridgeLifecycleEvent {
                    lifecycle: "reconnecting".into(),
                    session_id: Some(identity.session_id.clone()),
                    activation_id: None,
                    lease_id: replay_lease.clone(),
                    operation_id: identity.operation_id.clone(),
                    question_key: Some(identity.question_key.clone()),
                });
            }
            if newly_admitted {
                *state.pending_question.lock().expect("pending question mutex poisoned") = Some(message.clone());
                state.set_question_bound(true);
                let _ = app.emit(RUNTIME_CAPABILITIES_EVENT, state.capabilities());
                let _ = app.emit("candice:bridge-question", message.clone());
            }
            let mut ack = json!({ "type": "delivered", "sessionId": identity.session_id, "questionKey": identity.question_key });
            if let Some(operation_id) = identity.operation_id.as_deref() {
                ack["operationId"] = json!(operation_id);
            }
            if let Some(lease) = replay_lease.as_deref() {
                ack["leaseId"] = json!(lease);
            }
            let _ = writeln!(stream, "{}", ack);
        } else if let Some(identity) = BridgeQuestionIdentity::from_cancel_message(&message, expected_session) {
            let cancelled = {
                let mut active = state.active_question.lock().expect("active question mutex poisoned");
                if active.as_ref() == Some(&identity) {
                    *active = None;
                    true
                } else {
                    false
                }
            };
            if cancelled {
                let mut pending = state.pending_question.lock().expect("pending question mutex poisoned");
                if pending.as_ref().map(|value| identity.matches_message(value)).unwrap_or(false) {
                    *pending = None;
                }
                let mut cancel = json!({
                    "sessionId": identity.session_id, "questionKey": identity.question_key,
                });
                if let Some(operation_id) = identity.operation_id.as_deref() {
                    cancel["operationId"] = json!(operation_id);
                }
                let _ = app.emit("candice:bridge-cancel", cancel);
            }
        } else if message.get("type").and_then(Value::as_str) == Some("recovered-result") {
            // The server acknowledged the exact replayed operation handoff.
            let operation_id = message.get("operationId").and_then(Value::as_str)
                .filter(|value| valid_opaque_id(value));
            let question_key = message.get("questionKey").and_then(Value::as_str)
                .filter(|value| valid_question_key(value));
            if let (Some(operation_id), Some(question_key)) = (operation_id, question_key) {
                if state.consume_replay().is_some() {
                    state.emit_lifecycle(&app, BridgeLifecycleEvent {
                        lifecycle: "recovered".into(),
                        session_id: state.bridge_session_id.clone(),
                        activation_id: None,
                        lease_id: None,
                        operation_id: Some(operation_id.to_string()),
                        question_key: Some(question_key.to_string()),
                    });
                    let _ = writeln!(stream, "{}", json!({
                        "type": "lifecycle", "lifecycle": "recovered",
                        "sessionId": state.bridge_session_id.clone().unwrap_or_default(),
                    }));
                }
            }
        }
    }
}

enum ConnectedOutcome {
    Lost,
    Ended,
}

impl ConnectedOutcome {
    fn is_ended(&self) -> bool {
        matches!(self, ConnectedOutcome::Ended)
    }
}

/// Consume the one pending authenticated question. This closes the WebView
/// startup race: a companion may bind before the frontend registers its event
/// listener, but the first question is never silently acknowledged then lost.
#[tauri::command]
pub fn cmd_take_pending_bridge_question(state: State<'_, RuntimeState>) -> Result<Option<Value>, String> {
    state.pending_question.lock().map(|mut pending| pending.take()).map_err(|_| "bridge state unavailable".into())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeAnswerRequest {
    pub session_id: String,
    pub question_key: String,
    pub operation_id: Option<String>,
    pub answer: Value,
}

fn sanitize_optional_operation_id(value: Option<String>) -> Option<String> {
    value.filter(|value| valid_opaque_id(value))
}

fn identity_with_optional_operation(identity: BridgeQuestionIdentity, operation_id: Option<String>) -> BridgeQuestionIdentity {
    let operation_id = sanitize_optional_operation_id(operation_id);
    BridgeQuestionIdentity {
        session_id: identity.session_id,
        question_key: identity.question_key,
        operation_id: operation_id.or(identity.operation_id),
    }
}

/// The webview can submit only an already-confirmed structured answer. The
/// server validates it against the open exact `(sessionId, questionKey)`
/// slot and, when both carry an operation id, requires an exact match.
#[tauri::command]
pub fn cmd_submit_bridge_answer(
    state: State<'_, RuntimeState>,
    request: BridgeAnswerRequest,
) -> Result<(), String> {
    let identity = BridgeQuestionIdentity { session_id: request.session_id.clone(), question_key: request.question_key.clone(), operation_id: None };
    {
        let active = state.active_question.lock().map_err(|_| "bridge state unavailable")?;
        match active.as_ref() {
            Some(active_identity) if active_identity.session_id == identity.session_id && active_identity.question_key == identity.question_key => {
                if let Some(requested) = sanitize_optional_operation_id(request.operation_id.clone()) {
                    match active_identity.operation_id.as_deref() {
                        Some(expected) if expected != requested => {
                            return Err("bridge question operation id mismatch".into())
                        }
                        _ => {}
                    }
                }
            }
            _ => return Err("bridge question is no longer active".into()),
        }
    }
    let mut writer = state.bridge_writer.lock().map_err(|_| "bridge state unavailable")?;
    let stream = writer.as_mut().ok_or_else(|| "bridge unavailable".to_string())?;
    let mut answer = json!({
        "type": "answer", "sessionId": request.session_id, "questionKey": request.question_key, "answer": request.answer,
    });
    if let Some(operation_id) = sanitize_optional_operation_id(request.operation_id) {
        answer["operationId"] = json!(operation_id);
    }
    serde_json::to_writer(&mut *stream, &answer).map_err(|_| "bridge write failed")?;
    stream.write_all(b"\n").map_err(|_| "bridge unavailable")?;
    Ok(())
}

#[tauri::command]
pub fn cmd_cancel_bridge_question(
    state: State<'_, RuntimeState>,
    session_id: String,
    question_key: String,
    operation_id: Option<String>,
) -> Result<(), String> {
    let identity = BridgeQuestionIdentity { session_id: session_id.clone(), question_key: question_key.clone(), operation_id: None };
    {
        let active = state.active_question.lock().map_err(|_| "bridge state unavailable")?;
        match active.as_ref() {
            Some(active_identity) if active_identity.session_id == identity.session_id && active_identity.question_key == identity.question_key => {
                if let Some(requested) = sanitize_optional_operation_id(operation_id.clone()) {
                    match active_identity.operation_id.as_deref() {
                        Some(expected) if expected != requested => {
                            return Err("bridge question operation id mismatch".into())
                        }
                        _ => {}
                    }
                }
            }
            _ => return Err("bridge question is no longer active".into()),
        }
    }
    let mut writer = state.bridge_writer.lock().map_err(|_| "bridge state unavailable")?;
    let stream = writer.as_mut().ok_or_else(|| "bridge unavailable".to_string())?;
    let mut cancel = json!({ "type": "cancel", "sessionId": session_id, "questionKey": question_key });
    if let Some(operation_id) = sanitize_optional_operation_id(operation_id) {
        cancel["operationId"] = json!(operation_id);
    }
    serde_json::to_writer(&mut *stream, &cancel).map_err(|_| "bridge write failed")?;
    stream.write_all(b"\n").map_err(|_| "bridge unavailable")?;
    Ok(())
}

/// The frontend calls this only after it has destroyed the old controls and
/// restored click-through. Keeping admission closed until that point prevents
/// a concurrent question being acknowledged in the tiny submit/teardown gap.
#[tauri::command]
pub fn cmd_release_bridge_question(
    state: State<'_, RuntimeState>,
    session_id: String,
    question_key: String,
    operation_id: Option<String>,
) -> Result<(), String> {
    let identity = identity_with_optional_operation(
        BridgeQuestionIdentity { session_id, question_key, operation_id: None },
        operation_id,
    );
    let mut active = state.active_question.lock().map_err(|_| "bridge state unavailable")?;
    let release = match active.as_ref() {
        Some(active_identity) if active_identity.session_id == identity.session_id && active_identity.question_key == identity.question_key => {
            match (&identity.operation_id, &active_identity.operation_id) {
                (Some(requested), Some(expected)) => requested == expected,
                _ => true,
            }
        }
        _ => false,
    };
    if release { *active = None; }
    Ok(())
}

/// The webview acknowledges the exact replayed operation handoff (FIX-013
/// S4). The recovery lease is consumed only for the exact operation identity;
/// a mismatched operation or lease is refused and the record stays under
/// recovery. On success the native side emits the `recovered` lifecycle
/// event and sends the `recovered` acknowledgement frame to the server.
#[tauri::command]
pub fn cmd_ack_replayed_question<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, RuntimeState>,
    session_id: String,
    question_key: String,
    operation_id: Option<String>,
    lease_id: Option<String>,
) -> Result<(), String> {
    let identity = identity_with_optional_operation(
        BridgeQuestionIdentity { session_id, question_key, operation_id: None },
        operation_id,
    );
    {
        let lifecycle = state.lifecycle.lock().map_err(|_| "bridge state unavailable")?;
        if !lifecycle.replayable { return Err("no replay lease is outstanding".into()) }
        if let (Some(pending), Some(requested)) = (lifecycle.replay_pending_operation_id.as_deref(), identity.operation_id.as_deref()) {
            if pending != requested { return Err("replay operation id mismatch".into()) }
        } else if identity.operation_id.is_none() {
            return Err("replay operation id required".into())
        }
        if let (Some(expected_lease), Some(requested_lease)) = (lifecycle.lease_id.as_deref(), lease_id.as_deref()) {
            if expected_lease != requested_lease { return Err("replay lease mismatch".into()) }
        } else if lease_id.is_none() {
            return Err("replay lease required".into())
        }
    }
    if state.consume_replay().is_none() { return Err("replay lease already consumed".into()) }
    state.emit_lifecycle(&app, BridgeLifecycleEvent {
        lifecycle: "recovered".into(),
        session_id: state.bridge_session_id.clone(),
        activation_id: None,
        lease_id: None,
        operation_id: identity.operation_id.clone(),
        question_key: Some(identity.question_key.clone()),
    });
    let mut writer = state.bridge_writer.lock().map_err(|_| "bridge state unavailable")?;
    let stream = writer.as_mut().ok_or_else(|| "bridge unavailable".to_string())?;
    let mut ack = json!({
        "type": "recovered", "sessionId": identity.session_id, "questionKey": identity.question_key,
    });
    if let Some(operation_id) = identity.operation_id.as_deref() {
        ack["operationId"] = json!(operation_id);
    }
    serde_json::to_writer(&mut *stream, &ack).map_err(|_| "bridge write failed")?;
    stream.write_all(b"\n").map_err(|_| "bridge unavailable")?;
    Ok(())
}

/// The webview requests normal shutdown (user quit): the lifecycle ends
/// exactly once, bridge bindings close, and the `ended` frame tells the MCP
/// side to run its shutdown hooks (temp-audio sweep, protected pending state
/// removal).
#[tauri::command]
pub fn cmd_end_bridge_lifecycle<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, RuntimeState>,
) -> Result<(), String> {
    if state.mark_ended() {
        state.emit_lifecycle(&app, BridgeLifecycleEvent {
            lifecycle: "ended".into(),
            session_id: state.bridge_session_id.clone(),
            activation_id: None,
            lease_id: None,
            operation_id: None,
            question_key: None,
        });
        state.set_question_bound(false);
        *state.pending_question.lock().map_err(|_| "bridge state unavailable")? = None;
        *state.active_question.lock().map_err(|_| "bridge state unavailable")? = None;
        let mut writer = state.bridge_writer.lock().map_err(|_| "bridge state unavailable")?;
        if let Some(stream) = writer.as_mut() {
            let _ = writeln!(stream, "{}", json!({
                "type": "ended", "sessionId": state.bridge_session_id.clone().unwrap_or_default(),
            }));
        }
        *writer = None;
    }
    Ok(())
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
        let ordinary_session = parse_runtime_launch(["--wake", "session-start"]);
        assert_eq!(ordinary_session.wake_command, None);
        assert_eq!(ordinary_session.rejected_reason.as_deref(), Some("unsupported wake command: session-start"));
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
            "--bridge-endpoint", "tcp://127.0.0.1:34123",
            "--bridge-token-file", "/tmp/candice-token",
            "--bridge-version", "1.0",
            "--session-id", "session-42",
            "--activation-id", "activation-42",
            "--activation-issued-at", "1760000000000",
        ]);
        assert!(launch.rejected_reason.is_none());
        assert_eq!(launch.bridge_version.as_deref(), Some("1.0"));
        assert_eq!(launch.bridge_token_file.as_deref(), Some("/tmp/candice-token"));
        assert_eq!(launch.activation_id.as_deref(), Some("activation-42"));
        assert_eq!(parse_runtime_launch(["--bridge-endpoint", "http://127.0.0.1:34123"]).rejected_reason.as_deref(), Some("invalid bridge endpoint"));
        assert_eq!(parse_runtime_launch(["--bridge-token-file", "relative-token"]).rejected_reason.as_deref(), Some("invalid bridge token file"));
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

    #[test]
    fn accepts_only_a_complete_exact_question_and_cancel_identity() {
        let question = json!({
            "type": "question", "version": "1.0", "question": {
                "schemaVersion": "1.0", "sessionId": "session-a", "questionKey": "PROJECT_NAME",
                "text": "What is the project name?", "allowedInputModes": ["typed"],
            }
        });
        let identity = BridgeQuestionIdentity::from_question_message(&question, Some("session-a")).expect("valid question");
        assert_eq!(identity.question_key, "PROJECT_NAME");
        assert!(BridgeQuestionIdentity::from_question_message(&question, Some("other-session")).is_none());

        let cancel = json!({ "type": "cancel", "sessionId": "session-a", "questionKey": "PROJECT_NAME" });
        assert_eq!(BridgeQuestionIdentity::from_cancel_message(&cancel, Some("session-a")), Some(identity));
        assert!(BridgeQuestionIdentity::from_cancel_message(&cancel, Some("other-session")).is_none());

        let malformed = json!({ "type": "question", "version": "1.0", "question": {
            "schemaVersion": "1.0", "sessionId": "session-a", "questionKey": "PROJECT_NAME"
        }});
        assert!(BridgeQuestionIdentity::from_question_message(&malformed, Some("session-a")).is_none());
        let lower_key = json!({ "type": "cancel", "sessionId": "session-a", "questionKey": "project-name" });
        assert!(BridgeQuestionIdentity::from_cancel_message(&lower_key, Some("session-a")).is_none());
    }

    #[test]
    fn question_identity_carries_the_operation_id() {
        let question = json!({
            "type": "question", "version": "1.0",
            "operationId": "op-0123456789abcdef01234567",
            "question": {
                "schemaVersion": "1.0", "sessionId": "session-a", "questionKey": "PROJECT_NAME",
                "text": "What is the project name?", "allowedInputModes": ["typed"],
            }
        });
        let identity = BridgeQuestionIdentity::from_question_message(&question, Some("session-a")).expect("valid question");
        assert_eq!(identity.operation_id.as_deref(), Some("op-0123456789abcdef01234567"));
        // An unbounded operation id is never accepted into the identity.
        let bad = json!({
            "type": "question", "version": "1.0",
            "operationId": "bad\nid",
            "question": {
                "schemaVersion": "1.0", "sessionId": "session-a", "questionKey": "PROJECT_NAME",
                "text": "What is the project name?", "allowedInputModes": ["typed"],
            }
        });
        let identity2 = BridgeQuestionIdentity::from_question_message(&bad, Some("session-a")).expect("valid question");
        assert_eq!(identity2.operation_id, None, "unbounded operation id is dropped, never trusted");
    }

    #[test]
    fn lifecycle_marks_ended_exactly_once_and_consume_replay_is_single_use() {
        let state = RuntimeState {
            capabilities: Mutex::new(RuntimeCapabilities::from_launch(&RuntimeLaunch::default())),
            pending_question: Mutex::new(None),
            active_question: Mutex::new(None),
            bridge_session_id: Some("session-a".into()),
            bridge_writer: Mutex::new(None),
            lifecycle: Mutex::new(LifecycleState::new()),
        };
        // begin_replay arms the ONE replay lease for the exact operation.
        state.begin_replay("op-a", "PROJECT_NAME", "lease-1");
        assert_eq!(state.lifecycle_phase(), "reconnecting");
        // consume_replay returns the exact pending operation and consumes the lease.
        let consumed = state.consume_replay();
        assert_eq!(consumed, Some(("op-a".to_string(), "PROJECT_NAME".to_string())));
        assert_eq!(state.lifecycle_phase(), "recovered", "the acknowledged handoff moves the lifecycle to recovered");
        assert_eq!(state.consume_replay(), None, "the recovery lease is single-use; a second replay is never consumed");

        // Ended is a latch: the second mark reports false (exactly once).
        assert!(state.mark_ended());
        assert!(!state.mark_ended());
        assert_eq!(state.lifecycle_phase(), "ended");
    }
}
