//! Executable runtime-composition boundary (FIX-009).
//!
//! This module makes the native shell's current integration truth explicit.
//! It owns process-launch input and exposes a versioned capability contract to
//! the webview.  It deliberately does **not** pretend that the Node MCP
//! server can submit questions or answers yet: the authenticated, same-session
//! transport is owned by FIX-011.  Until then every bridge capability is
//! reported unavailable so Claude continues in its normal text path.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

pub const RUNTIME_CONTRACT_VERSION: &str = "1.0";
pub const RUNTIME_CAPABILITIES_EVENT: &str = "candice:runtime-capabilities";

const SUPPORTED_WAKE_COMMANDS: [&str; 5] = [
    "session-start",
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
            _ => index += 1,
        }
    }

    // Session identity is authoritative only when an authenticated bridge
    // verifies it. FIX-009 never labels this launch argument as a binding.
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
    capabilities: RuntimeCapabilities,
}

impl RuntimeState {
    pub fn capabilities(&self) -> RuntimeCapabilities {
        self.capabilities.clone()
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
        capabilities: capabilities.clone(),
    });
    app.emit(RUNTIME_CAPABILITIES_EVENT, capabilities)
        .map_err(|error| tauri::Error::Anyhow(error.into()))
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
    fn rejects_control_characters_in_session_ids() {
        assert_eq!(
            parse_runtime_launch(["--session-id", "bad\nvalue"])
                .rejected_reason
                .as_deref(),
            Some("invalid session id")
        );
    }
}
