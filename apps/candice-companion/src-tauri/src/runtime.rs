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
use std::path::{Path, PathBuf};
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
    /// one unacknowledged operation; cleared only when an acknowledgement
    /// matches the complete four-field replay identity (the `recovered`
    /// handoff). A partial or mismatched acknowledgement never clears these
    /// (Q-07): the record stays under recovery for the honest handoff.
    replay_pending_operation_id: Option<String>,
    replay_pending_question_key: Option<String>,
    replay_pending_session_id: Option<String>,
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
            replay_pending_session_id: None,
        }
    }
}

/// The complete identity of the active recovery replay. Every field must
/// match exactly before any `consume_replay` may run (Q-07): a partial
/// acknowledgement is a mismatch and is refused without mutating state.
#[derive(Clone, Debug, PartialEq, Eq)]
struct ReplayIdentity {
    session_id: String,
    operation_id: String,
    question_key: String,
    lease_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum ReplayConsumeError {
    /// No replay lease is outstanding (never armed, already consumed, or ended).
    NoOutstandingLease,
    /// The acknowledgement did not carry the complete four-field identity
    /// (session ID, operation ID, question key, lease ID) or one of the four
    /// fields did not match the active replay state. The discriminant names
    /// the field; the payload is never attached (redaction: no
    /// session/lease/operation values enter the diagnostic).
    FieldMismatch(&'static str),
}

impl ReplayConsumeError {
    /// Redacted diagnostic: names the failing class only. No identity value
    /// is ever rendered, so a hostile or stale acknowledgement cannot leak
    /// session, operation, question, or lease material into logs.
    fn message(&self) -> String {
        match self {
            ReplayConsumeError::NoOutstandingLease => "no replay lease is outstanding".to_string(),
            ReplayConsumeError::FieldMismatch(field) => format!("replay {field} mismatch"),
        }
    }
}

#[derive(Clone, Debug, Eq)]
struct BridgeQuestionIdentity {
    session_id: String,
    question_key: String,
    operation_id: Option<String>,
}

impl PartialEq for BridgeQuestionIdentity {
    /// The active-question slot is keyed by `(sessionId, questionKey)` only.
    /// `operationId` participates in replay identity (Q-07) but never in slot
    /// matching, so a submit/cancel/release built without the optional
    /// operation field still matches the admitted question exactly as before
    /// the replay fields existed.
    fn eq(&self, other: &Self) -> bool {
        self.session_id == other.session_id && self.question_key == other.question_key
    }
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
        lifecycle.replay_pending_operation_id = None;
        lifecycle.replay_pending_question_key = None;
        lifecycle.replay_pending_session_id = None;
        true
    }

    /// Arm the ONE bounded replay lease (FIX-013 S4). The complete identity
    /// is recorded so any later acknowledgement must match all four fields
    /// exactly (Q-07).
    fn begin_replay(&self, session_id: &str, operation_id: &str, question_key: &str, lease_id: &str) {
        let mut lifecycle = self.lifecycle.lock().expect("lifecycle mutex poisoned");
        lifecycle.phase = "reconnecting".to_string();
        lifecycle.replayable = true;
        lifecycle.lease_id = Some(lease_id.to_string());
        lifecycle.replay_pending_session_id = Some(session_id.to_string());
        lifecycle.replay_pending_operation_id = Some(operation_id.to_string());
        lifecycle.replay_pending_question_key = Some(question_key.to_string());
    }

    /// Validate an acknowledgement against the active replay state and, only
    /// on exact equality of session ID, operation ID, question key, and lease
    /// ID, consume the lease. Any mismatch returns the named field error
    /// WITHOUT clearing or mutating replay state (Q-07): the record stays
    /// under recovery so the honest acknowledgement can still land.
    fn consume_replay(&self, expected: &ReplayIdentity) -> Result<(), ReplayConsumeError> {
        let mut lifecycle = self.lifecycle.lock().expect("lifecycle mutex poisoned");
        if !lifecycle.replayable { return Err(ReplayConsumeError::NoOutstandingLease) }
        let pending_session = lifecycle.replay_pending_session_id.as_deref();
        let pending_operation = lifecycle.replay_pending_operation_id.as_deref();
        let pending_question = lifecycle.replay_pending_question_key.as_deref();
        let pending_lease = lifecycle.lease_id.as_deref();
        // Q-07: all four identity fields must be PRESENT in the active
        // replay state. The bridge only arms the lease through the complete
        // `begin_replay` (all four recorded together), so this also protects
        // against any partial arming or field-specific clearing.
        if pending_session.is_none() {
            return Err(ReplayConsumeError::FieldMismatch("session id"));
        }
        if pending_operation.is_none() {
            return Err(ReplayConsumeError::FieldMismatch("operation id"));
        }
        if pending_question.is_none() {
            return Err(ReplayConsumeError::FieldMismatch("question key"));
        }
        if pending_lease.is_none() {
            return Err(ReplayConsumeError::FieldMismatch("lease id"));
        }
        if pending_session != Some(expected.session_id.as_str()) {
            return Err(ReplayConsumeError::FieldMismatch("session id"));
        }
        if pending_operation != Some(expected.operation_id.as_str()) {
            return Err(ReplayConsumeError::FieldMismatch("operation id"));
        }
        if pending_question != Some(expected.question_key.as_str()) {
            return Err(ReplayConsumeError::FieldMismatch("question key"));
        }
        if pending_lease != Some(expected.lease_id.as_str()) {
            return Err(ReplayConsumeError::FieldMismatch("lease id"));
        }
        lifecycle.replayable = false;
        lifecycle.lease_id = None;
        lifecycle.replay_pending_session_id = None;
        lifecycle.replay_pending_operation_id = None;
        lifecycle.replay_pending_question_key = None;
        lifecycle.phase = "recovered".to_string();
        Ok(())
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
        let Ok(mut stream) = TcpStream::connect(format!("127.0.0.1:{port}")) else { return };
        // The PID is not authorization. It is only an instance identity that
        // the authenticated broker echoes in its binding acknowledgement.
        let instance_id = format!("candice-{}", std::process::id());
        let hello = json!({
            "type": "hello", "version": version, "token": token,
            "sessionId": session_id, "activationId": activation_id,
            "activationIssuedAt": activation_issued_at, "instanceId": instance_id,
        });
        if writeln!(stream, "{}", hello).is_err() { return }
        let Ok(read_stream) = stream.try_clone() else { return };
        let mut reader = BufReader::new(read_stream);
        let mut line = String::new();
        if reader.read_line(&mut line).ok().filter(|count| *count > 0).is_none() { return }
        let Ok(ready) = serde_json::from_str::<Value>(&line) else { return };
        if ready.get("type").and_then(Value::as_str) != Some("ready")
            || ready.get("version").and_then(Value::as_str) != Some("1.0")
            || ready.get("sessionId").and_then(Value::as_str) != Some(session_id.as_str())
            || ready.get("activationId").and_then(Value::as_str) != Some(activation_id.as_str())
            || ready.get("instanceId").and_then(Value::as_str) != Some(instance_id.as_str())
            || ready.get("bindingId").and_then(Value::as_str).filter(|value| valid_opaque_id(value)).is_none()
        { return }
        {
            let state = app.state::<RuntimeState>();
            if let Ok(writer) = stream.try_clone() { *state.bridge_writer.lock().expect("bridge writer mutex poisoned") = Some(writer); }
            state.set_bridge_connected(true);
            let _ = app.emit(RUNTIME_CAPABILITIES_EVENT, state.capabilities());
            state.set_lifecycle("connected");
            state.emit_lifecycle(&app, BridgeLifecycleEvent {
                lifecycle: "connected".into(),
                session_id: Some(session_id.clone()),
                activation_id: Some(activation_id.clone()),
                lease_id: None,
                operation_id: None,
                question_key: None,
            });
        }
        loop {
            line.clear();
            if reader.read_line(&mut line).ok().filter(|count| *count > 0).is_none() { break }
            let Ok(message) = serde_json::from_str::<Value>(&line) else { break };
            let state = app.state::<RuntimeState>();
            let expected_session = state.bridge_session_id.as_deref();
            if message.get("type").and_then(Value::as_str) == Some("ended") {
                // The server requests normal shutdown: end the lifecycle
                // EXACTLY ONCE (idempotent latch) and drop the replay record.
                if state.mark_ended() {
                    state.emit_lifecycle(&app, BridgeLifecycleEvent {
                        lifecycle: "ended".into(),
                        session_id: state.bridge_session_id.clone(),
                        activation_id: None,
                        lease_id: None,
                        operation_id: None,
                        question_key: None,
                    });
                }
                break;
            }
            if let Some(identity) = BridgeQuestionIdentity::from_question_message(&message, expected_session) {
                let replayed = message.get("replayed").and_then(Value::as_bool) == Some(true);
                let replay_lease = message.get("leaseId").and_then(Value::as_str)
                    .filter(|value| valid_opaque_id(value))
                    .map(str::to_string);
                if replayed {
                    // FIX-013 S4: the ONE unacknowledged operation is replayed
                    // under a bounded recovery lease. Q-07: the replay record
                    // is armed with the complete four-field identity (session,
                    // operation, question key, lease) — the later
                    // acknowledgement must match every field exactly or the
                    // record stays armed for the honest handoff.
                    if let (Some(lease), Some(operation_id)) = (replay_lease.as_deref(), identity.operation_id.as_deref()) {
                        state.begin_replay(&identity.session_id, operation_id, &identity.question_key, lease);
                        state.emit_lifecycle(&app, BridgeLifecycleEvent {
                            lifecycle: "reconnecting".into(),
                            session_id: Some(identity.session_id.clone()),
                            activation_id: None,
                            lease_id: replay_lease.clone(),
                            operation_id: Some(operation_id.to_string()),
                            question_key: Some(identity.question_key.clone()),
                        });
                    }
                }
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
                    let _ = app.emit("candice:bridge-cancel", json!({
                        "sessionId": identity.session_id, "questionKey": identity.question_key,
                    }));
                }
            } else if message.get("type").and_then(Value::as_str) == Some("recovered-result") {
                // The broker acknowledges the exact replayed operation
                // handoff. Q-07: EVERY identity field in this frame must match
                // the active replay record exactly — session, operation,
                // question key, AND lease. A syntactically valid frame that
                // does not match is rejected without consuming the lease and
                // the diagnostic is redacted (field class only).
                let session_id = message.get("sessionId").and_then(Value::as_str)
                    .filter(|value| valid_opaque_id(value));
                let operation_id = message.get("operationId").and_then(Value::as_str)
                    .filter(|value| valid_opaque_id(value));
                let question_key = message.get("questionKey").and_then(Value::as_str)
                    .filter(|value| valid_question_key(value));
                let lease_id = message.get("leaseId").and_then(Value::as_str)
                    .filter(|value| valid_opaque_id(value));
                if let (Some(session_id), Some(operation_id), Some(question_key), Some(lease_id)) =
                    (session_id, operation_id, question_key, lease_id)
                {
                    let expected = ReplayIdentity {
                        session_id: session_id.to_string(),
                        operation_id: operation_id.to_string(),
                        question_key: question_key.to_string(),
                        lease_id: lease_id.to_string(),
                    };
                    match state.consume_replay(&expected) {
                        Ok(()) => {
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
                        Err(error) => {
                            // Q-07: reject WITHOUT clearing or mutating replay
                            // state, and emit only the redacted reason.
                            let _ = writeln!(stream, "{}", json!({
                                "type": "error", "reason": error.message(),
                            }));
                        }
                    }
                }
            }
        }
        let state = app.state::<RuntimeState>();
        *state.bridge_writer.lock().expect("bridge writer mutex poisoned") = None;
        state.set_bridge_connected(false);
        let _ = app.emit(RUNTIME_CAPABILITIES_EVENT, state.capabilities());
        if !state.lifecycle_ended() {
            state.set_lifecycle("disconnected");
            state.emit_lifecycle(&app, BridgeLifecycleEvent {
                lifecycle: "disconnected".into(),
                session_id: state.bridge_session_id.clone(),
                activation_id: None,
                lease_id: None,
                operation_id: None,
                question_key: None,
            });
        }
    });
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
    pub answer: Value,
}

/// The webview can submit only an already-confirmed structured answer. The
/// server validates it against the open exact `(sessionId, questionKey)` slot.
#[tauri::command]
pub fn cmd_submit_bridge_answer(
    state: State<'_, RuntimeState>,
    request: BridgeAnswerRequest,
) -> Result<(), String> {
    let identity = BridgeQuestionIdentity { session_id: request.session_id.clone(), question_key: request.question_key.clone(), operation_id: None };
    {
        let active = state.active_question.lock().map_err(|_| "bridge state unavailable")?;
        if active.as_ref() != Some(&identity) { return Err("bridge question is no longer active".into()) }
    }
    let mut writer = state.bridge_writer.lock().map_err(|_| "bridge state unavailable")?;
    let stream = writer.as_mut().ok_or_else(|| "bridge unavailable".to_string())?;
    serde_json::to_writer(&mut *stream, &json!({
        "type": "answer", "sessionId": request.session_id, "questionKey": request.question_key, "answer": request.answer,
    })).map_err(|_| "bridge write failed")?;
    stream.write_all(b"\n").map_err(|_| "bridge unavailable")?;
    Ok(())
}

#[tauri::command]
pub fn cmd_cancel_bridge_question(
    state: State<'_, RuntimeState>,
    session_id: String,
    question_key: String,
) -> Result<(), String> {
    let identity = BridgeQuestionIdentity { session_id: session_id.clone(), question_key: question_key.clone(), operation_id: None };
    {
        let active = state.active_question.lock().map_err(|_| "bridge state unavailable")?;
        if active.as_ref() != Some(&identity) { return Err("bridge question is no longer active".into()) }
    }
    let mut writer = state.bridge_writer.lock().map_err(|_| "bridge state unavailable")?;
    let stream = writer.as_mut().ok_or_else(|| "bridge unavailable".to_string())?;
    serde_json::to_writer(&mut *stream, &json!({ "type": "cancel", "sessionId": session_id, "questionKey": question_key }))
        .map_err(|_| "bridge write failed")?;
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
) -> Result<(), String> {
    let identity = BridgeQuestionIdentity { session_id, question_key, operation_id: None };
    let mut active = state.active_question.lock().map_err(|_| "bridge state unavailable")?;
    if active.as_ref() == Some(&identity) { *active = None; }
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

// ---------------------------------------------------------------------------
// Local preference profile IO (FIX-014, spec 9). Dumb IO only: the native
// side reads/writes the raw JSON document and never interprets its fields.
// The WS-34 migration authority stays in TypeScript (the webview migrates
// and normalizes the returned document). Failure degrades to defaults, never
// blocks the session (spec 20).
// ---------------------------------------------------------------------------

const PREFS_DIR_OVERRIDE_ENV: &str = "CANDICE_PREFS_DIR";
const PREFS_FILENAME: &str = "profile.json";
const PREFS_LOCK_FILENAME: &str = "profile.json.lock";
const PREFS_LOCK_STALE_MS: u128 = 10_000;
const PREFS_LOCK_WAIT_MS: u128 = 1_500;

/// Spec-9 recommended location: macOS
/// `~/Library/Application Support/BlackCEO/999/Candice/`, Windows
/// `%LOCALAPPDATA%\BlackCEO\999\Candice\`. `CANDICE_PREFS_DIR` overrides
/// both for tests and sandboxes. The crate has no `dirs` dependency, so the
/// resolution is explicit here.
fn prefs_dir() -> Option<PathBuf> {
    if let Ok(override_dir) = std::env::var(PREFS_DIR_OVERRIDE_ENV) {
        if !override_dir.is_empty() {
            return Some(PathBuf::from(override_dir));
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            if !local_app_data.is_empty() {
                return Some(PathBuf::from(local_app_data).join("BlackCEO").join("999").join("Candice"));
            }
        }
        if let Ok(user_profile) = std::env::var("USERPROFILE") {
            if !user_profile.is_empty() {
                return Some(PathBuf::from(user_profile).join("AppData").join("Local").join("BlackCEO").join("999").join("Candice"));
            }
        }
        return None;
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(home) = std::env::var("HOME") {
            if !home.is_empty() {
                return Some(PathBuf::from(home).join("Library").join("Application Support").join("BlackCEO").join("999").join("Candice"));
            }
        }
        return None;
    }
}

/// Load the raw profile document. Corruption is backed up (never deleted)
/// and reset to defaults; a missing file is defaults. The webview runs the
/// WS-34 migration chain on the returned document.
#[tauri::command]
pub fn cmd_load_profile() -> Value {
    let Some(dir) = prefs_dir() else {
        return json!({ "ok": false, "doc": null, "recoveredFromCorruption": false, "error": "profile directory could not be resolved" });
    };
    if dir.exists() && !dir.is_dir() {
        return json!({ "ok": false, "doc": null, "recoveredFromCorruption": false, "error": "profile directory path is not a directory" });
    }
    let file = dir.join(PREFS_FILENAME);
    let text = match fs::read_to_string(&file) {
        Ok(text) => text,
        Err(_) => return json!({ "ok": true, "doc": null, "recoveredFromCorruption": false }),
    };
    match serde_json::from_str::<Value>(&text) {
        Ok(doc) if doc.is_object() => json!({ "ok": true, "doc": doc, "recoveredFromCorruption": false }),
        _ => {
            // Back up the unreadable file, then start fresh. Do not log its
            // content. Best-effort: a failed backup still resets to defaults.
            let backup = format!("{}.corrupt-{}", file.display(), std::process::id());
            let _ = fs::rename(&file, &backup);
            json!({ "ok": true, "doc": null, "recoveredFromCorruption": true })
        }
    }
}

/// Persist the raw profile document atomically (write-temp-then-rename)
/// under a per-process lock. The lock is never fatal: a stale lock is
/// broken; a contended fresh lock is bypassed after a bounded wait so the
/// app cannot block (spec 20). Returns true when the write landed.
#[tauri::command]
pub fn cmd_save_profile(doc: Value) -> bool {
    if !doc.is_object() {
        return false;
    }
    let Some(dir) = prefs_dir() else { return false };
    if fs::create_dir_all(&dir).is_err() {
        return false;
    }
    let lock_file = dir.join(PREFS_LOCK_FILENAME);
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(PREFS_LOCK_WAIT_MS as u64);
    loop {
        match fs::OpenOptions::new().write(true).create_new(true).open(&lock_file) {
            Ok(mut lock) => {
                let _ = writeln!(lock, "{}", std::process::id());
                break;
            }
            Err(_) => {
                let stale = fs::metadata(&lock_file)
                    .and_then(|metadata| metadata.modified())
                    .map(|modified| modified.elapsed().map(|elapsed| elapsed.as_millis() > PREFS_LOCK_STALE_MS).unwrap_or(true))
                    .unwrap_or(true);
                if stale {
                    let _ = fs::remove_file(&lock_file);
                } else if std::time::Instant::now() > deadline {
                    // Bounded wait exhausted: proceed without the lock rather
                    // than block the session (spec 20).
                    break;
                } else {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
            }
        }
    }
    let file = dir.join(PREFS_FILENAME);
    let tmp = dir.join(format!(".{}.tmp", PREFS_FILENAME));
    let result = (|| -> std::io::Result<()> {
        let serialized = serde_json::to_string_pretty(&doc).map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
        fs::write(&tmp, format!("{serialized}\n"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600))?;
        }
        fs::rename(&tmp, &file)?;
        Ok(())
    })();
    let _ = fs::remove_file(&lock_file);
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
        return false;
    }
    true
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
    fn prefs_round_trip_through_the_native_seam() {
        let dir = std::env::temp_dir().join(format!("candice-prefs-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        std::env::set_var(PREFS_DIR_OVERRIDE_ENV, &dir);

        // Missing file: ok with a null doc, no corruption flag.
        let loaded = cmd_load_profile();
        assert_eq!(loaded.get("ok"), Some(&Value::Bool(true)));
        assert_eq!(loaded.get("doc"), Some(&Value::Null));
        assert_eq!(loaded.get("recoveredFromCorruption"), Some(&Value::Bool(false)));

        // Save a raw document, then load it back byte-for-byte in shape.
        let doc = json!({ "schemaVersion": 3, "preferredName": "Trevor", "textSize": "large" });
        assert!(cmd_save_profile(doc.clone()));
        let loaded = cmd_load_profile();
        assert_eq!(loaded.get("ok"), Some(&Value::Bool(true)));
        assert_eq!(loaded.get("doc"), Some(&doc));

        // Corruption is backed up, never deleted, and resets to defaults.
        let file = dir.join(PREFS_FILENAME);
        fs::write(&file, "{ not json").expect("write corrupt profile");
        let loaded = cmd_load_profile();
        assert_eq!(loaded.get("ok"), Some(&Value::Bool(true)));
        assert_eq!(loaded.get("doc"), Some(&Value::Null));
        assert_eq!(loaded.get("recoveredFromCorruption"), Some(&Value::Bool(true)));
        let backup = format!("{}.corrupt-{}", file.display(), std::process::id());
        assert!(Path::new(&backup).exists(), "corrupt file must be backed up, not deleted");

        // Non-object documents are refused by the save command.
        assert!(!cmd_save_profile(json!([1, 2, 3])));

        let _ = fs::remove_dir_all(&dir);
        std::env::remove_var(PREFS_DIR_OVERRIDE_ENV);
    }

    // -----------------------------------------------------------------------
    // Q-07: replay acknowledgement must bind EVERY identity field before any
    // consume_replay. Each negative case below proves (a) the consume is
    // refused, (b) replay state is NOT cleared or mutated, and (c) the
    // diagnostic is redacted (names only the failing field class).
    // -----------------------------------------------------------------------

    fn replay_state() -> RuntimeState {
        RuntimeState {
            capabilities: Mutex::new(RuntimeCapabilities::from_launch(&RuntimeLaunch::default())),
            pending_question: Mutex::new(None),
            active_question: Mutex::new(None),
            bridge_session_id: None,
            bridge_writer: Mutex::new(None),
            lifecycle: Mutex::new(LifecycleState::new()),
        }
    }

    const REPLAY_SESSION: &str = "session-replay-1";
    const REPLAY_OPERATION: &str = "operation-replay-1";
    const REPLAY_QUESTION: &str = "PROJECT_NAME";
    const REPLAY_LEASE: &str = "lease-replay-1";

    fn replay_identity() -> ReplayIdentity {
        ReplayIdentity {
            session_id: REPLAY_SESSION.into(),
            operation_id: REPLAY_OPERATION.into(),
            question_key: REPLAY_QUESTION.into(),
            lease_id: REPLAY_LEASE.into(),
        }
    }

    /// Prove the full four-field identity is present in the active replay
    /// state after a mismatched consume (Q-07: no clearing, no mutation).
    fn assert_replay_untouched(state: &RuntimeState) {
        let lifecycle = state.lifecycle.lock().expect("lifecycle mutex poisoned");
        assert!(lifecycle.replayable, "mismatch must not consume the replay lease");
        assert_eq!(lifecycle.lease_id.as_deref(), Some(REPLAY_LEASE));
        assert_eq!(lifecycle.replay_pending_session_id.as_deref(), Some(REPLAY_SESSION));
        assert_eq!(lifecycle.replay_pending_operation_id.as_deref(), Some(REPLAY_OPERATION));
        assert_eq!(lifecycle.replay_pending_question_key.as_deref(), Some(REPLAY_QUESTION));
        assert_eq!(lifecycle.phase, "reconnecting");
    }

    fn begin_replay_for_test(state: &RuntimeState) {
        state.begin_replay(REPLAY_SESSION, REPLAY_OPERATION, REPLAY_QUESTION, REPLAY_LEASE);
    }

    /// Diagnostic redaction: the error message names only the field class.
    /// No session, operation, question, or lease VALUE may appear in it.
    fn assert_redacted(error: &ReplayConsumeError) {
        let message = error.message();
        assert!(!message.contains(REPLAY_SESSION), "redacted diagnostic leaked session id: {message}");
        assert!(!message.contains(REPLAY_OPERATION), "redacted diagnostic leaked operation id: {message}");
        assert!(!message.contains(REPLAY_QUESTION), "redacted diagnostic leaked question key: {message}");
        assert!(!message.contains(REPLAY_LEASE), "redacted diagnostic leaked lease id: {message}");
    }

    #[test]
    fn q07_wrong_session_is_rejected_without_mutating_replay_state() {
        let state = replay_state();
        begin_replay_for_test(&state);
        let mut attempt = replay_identity();
        attempt.session_id = "session-other".into();
        let error = state.consume_replay(&attempt).expect_err("wrong session must be rejected");
        assert_eq!(error, ReplayConsumeError::FieldMismatch("session id"));
        assert_redacted(&error);
        assert_replay_untouched(&state);
    }

    #[test]
    fn q07_wrong_operation_is_rejected_without_mutating_replay_state() {
        let state = replay_state();
        begin_replay_for_test(&state);
        let mut attempt = replay_identity();
        attempt.operation_id = "operation-other".into();
        let error = state.consume_replay(&attempt).expect_err("wrong operation must be rejected");
        assert_eq!(error, ReplayConsumeError::FieldMismatch("operation id"));
        assert_redacted(&error);
        assert_replay_untouched(&state);
    }

    #[test]
    fn q07_wrong_question_key_is_rejected_without_mutating_replay_state() {
        let state = replay_state();
        begin_replay_for_test(&state);
        let mut attempt = replay_identity();
        attempt.question_key = "OTHER_QUESTION".into();
        let error = state.consume_replay(&attempt).expect_err("wrong question key must be rejected");
        assert_eq!(error, ReplayConsumeError::FieldMismatch("question key"));
        assert_redacted(&error);
        assert_replay_untouched(&state);
    }

    #[test]
    fn q07_wrong_lease_is_rejected_without_mutating_replay_state() {
        let state = replay_state();
        begin_replay_for_test(&state);
        let mut attempt = replay_identity();
        attempt.lease_id = "lease-other".into();
        let error = state.consume_replay(&attempt).expect_err("wrong lease must be rejected");
        assert_eq!(error, ReplayConsumeError::FieldMismatch("lease id"));
        assert_redacted(&error);
        assert_replay_untouched(&state);
    }

    #[test]
    fn q07_stale_recovered_result_after_consume_is_rejected() {
        let state = replay_state();
        begin_replay_for_test(&state);
        // The honest acknowledgement consumes the lease exactly once.
        state.consume_replay(&replay_identity()).expect("exact identity must consume");
        // A stale or replayed `recovered-result` frame (re-transmit, or an
        // old handoff racing the new lifecycle) must be rejected and must
        // NOT resurrect or mutate the now-consumed replay state.
        let error = state.consume_replay(&replay_identity()).expect_err("stale recovered result must be rejected");
        assert_eq!(error, ReplayConsumeError::NoOutstandingLease);
        let lifecycle = state.lifecycle.lock().expect("lifecycle mutex poisoned");
        assert!(!lifecycle.replayable);
        assert!(lifecycle.lease_id.is_none());
        assert_eq!(lifecycle.phase, "recovered");
    }

    #[test]
    fn q07_duplicated_acknowledgement_is_rejected() {
        let state = replay_state();
        begin_replay_for_test(&state);
        state.consume_replay(&replay_identity()).expect("first acknowledgement must consume");
        let error = state.consume_replay(&replay_identity()).expect_err("duplicated acknowledgement must be rejected");
        assert_eq!(error, ReplayConsumeError::NoOutstandingLease);
        assert!(!state.lifecycle.lock().expect("lifecycle mutex poisoned").replayable);
    }
}
