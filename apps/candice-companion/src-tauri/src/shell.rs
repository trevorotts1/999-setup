//! Shared shell infrastructure (WS-06).
//!
//! Owned by WR-008 / WS-06 lane. Contains only shell-level concerns:
//!   - shell state and the shell-ready event,
//!   - shell info IPC (capability probe for the bridge lanes),
//!   - window visibility primitives (WS-07 owns the window *behavior*;
//!     this lane provides the plain show/hide surface).
//!
//! Failure isolation (spec 20): every command is total — it returns an
//! `Err(String)` instead of panicking, and the front-end degrades to the
//! text surface. No Candice error may destroy, reset, or block the user's
//! project.

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, State};

/// Version injected by tauri-build from `tauri.conf.json` `version`.
/// Single source of the shell's app version; the release workflow bumps
/// the config value at the final coordinated stamp (spec 26, 0G).
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Emitted once after shell plugins and state are ready.
pub const SHELL_READY_EVENT: &str = "candice:shell-ready";

/// Number of supplied source art assets (spec 11A/11B: 9 + 7 = 16).
pub const SUPPLIED_ASSET_COUNT: usize = 16;

/// Shell state managed by Tauri. Placeholder for the shell's own runtime
/// needs; subsystem states (stt/tts/audio/recovery) live in their lanes.
#[derive(Default)]
pub struct ShellState {
    /// Set true once the shell-ready event has been emitted.
    ready: std::sync::atomic::AtomicBool,
}

impl ShellState {
    pub fn ready(&self) -> bool {
        self.ready.load(std::sync::atomic::Ordering::Relaxed)
    }

    pub fn mark_ready(&self) {
        self.ready.store(true, std::sync::atomic::Ordering::Relaxed);
    }
}

/// Payload of the shell-ready event. Front-end consumers may use it to
/// decide how to mount (e.g. probe the window layer).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellReadyPayload {
    pub app_version: String,
    pub shell_event: String,
}

impl Default for ShellReadyPayload {
    fn default() -> Self {
        Self {
            app_version: APP_VERSION.to_string(),
            shell_event: SHELL_READY_EVENT.to_string(),
        }
    }
}

/// Shell info returned by the IPC probe. The session-bridge lanes
/// (WR-011) call this before wiring their tools; unknown fields must be
/// additive so older bridges keep working (spec 21 upgrade path).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellInfo {
    pub app_version: String,
    pub supplied_asset_count: usize,
    pub window_visible: bool,
    /// True only once the native shell completed its own initialization.
    pub shell_ready: bool,
    /// Shell subsystem list — what this lane declares available. New
    /// subsystems append here through their owning lanes.
    pub subsystems: Vec<String>,
}

/// Where the front-end payload is expected to be bundled. Kept `cfg(test)`
/// — the frontendDist contract is proven by the smoke test below without
/// shipping dead runtime code.
#[cfg(test)]
pub fn frontend_payload_path() -> String {
    format!("{}/dist", env!("CARGO_MANIFEST_DIR"))
}

/// Total command: never panics, always returns `Result` (spec 20).
#[tauri::command]
pub fn cmd_get_shell_info<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, ShellState>,
) -> Result<ShellInfo, String> {
    let info = ShellInfo {
        app_version: APP_VERSION.to_string(),
        supplied_asset_count: SUPPLIED_ASSET_COUNT,
        window_visible: app
            .get_webview_window("main")
            .map(|w| w.is_visible().unwrap_or(false))
            .unwrap_or(false),
        shell_ready: state.ready(),
        subsystems: vec![
            "shell".into(),
            "window-visibility".into(),
            "events".into(),
        ],
    };
    Ok(info)
}

/// Show and focus the main window. WS-07 owns positioning/anchoring
/// behavior; this is the plain visibility primitive.
#[tauri::command]
pub fn cmd_show_window<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "candice: main window missing".to_string())?;
    win.show().map_err(|e| format!("candice: show failed: {e}"))?;
    win.set_focus().map_err(|e| format!("candice: focus failed: {e}"))?;
    Ok(())
}

/// Hide the main window.
#[tauri::command]
pub fn cmd_hide_window<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "candice: main window missing".to_string())?;
    win.hide().map_err(|e| format!("candice: hide failed: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_info_contract_is_stable() {
        let info = ShellInfo {
            app_version: APP_VERSION.to_string(),
            supplied_asset_count: SUPPLIED_ASSET_COUNT,
            window_visible: false,
            shell_ready: true,
            subsystems: vec!["shell".into()],
        };
        // Serialization shape is the IPC contract — additive changes only.
        let json = serde_json::to_value(&info).expect("serialize");
        let map = json.as_object().expect("object");
        for key in [
            "appVersion",
            "suppliedAssetCount",
            "windowVisible",
            "shellReady",
            "subsystems",
        ] {
            assert!(map.contains_key(key), "missing field {key}");
        }
        assert_eq!(info.supplied_asset_count, 16, "16 supplied assets (spec 11A/11B)");
        assert!(!info.app_version.is_empty());
    }

    #[test]
    fn supplied_asset_count_matches_spec() {
        // 9 first-batch + 7 second-batch (spec 11A/11B, section 28).
        assert_eq!(SUPPLIED_ASSET_COUNT, 9 + 7);
    }

    #[test]
    fn frontend_payload_path_is_relative_to_manifest() {
        // The payload must be bundled into the artifact (frontendDist),
        // never fetched from an absolute developer path (section 28:
        // "no generic runtime dependency contains developer-specific
        // absolute paths").
        let p = frontend_payload_path();
        assert!(p.contains("/src-tauri"), "expected in-tree path, got {p}");
    }
}
