//! Candice Companion — Rust shell (Master Spec 0E WS-06, Tauri 2).
//!
//! Owned by WR-008 / WS-06 lane (ownership map 9.2): root-level `src-tauri`
//! files plus `src-tauri/src/**` shell code. Platform adapters
//! (`binding/`, `permissions/`, `stt/`, `tts/`, `audio/`, `recovery/`) and
//! window behavior (`window-config/`) are owned by their own lanes and are
//! deliberately NOT present here.
//!
//! Division of labor (spec 2): Candice is the face, voice, ears, and
//! lightweight UI. The active Claude Code session and invoked skill remain
//! the brain, rules, memory, and source of truth. This shell is
//! presentation infrastructure: a failure here must never stop Claude
//! (spec 20).

mod shell;

use tauri::{Emitter, Manager};

/// generate_context!() resolves tauri.conf.json against the crate dir,
/// i.e. the mirror the build script copies from the app-root config
/// (spec 12 layout). Both the CLI and the macro then resolve every
/// relative path (frontendDist, icons) against src-tauri — one consistent
/// base, no double-prefix traps.
fn generate_context() -> tauri::Context {
    tauri::generate_context!("tauri.conf.json")
}

/// Install the shared shell plugins and initialize the shell state.
/// Kept separate from the builder so tests can exercise it without a
/// full app instance.
pub fn initialize_shell(app: &tauri::AppHandle) -> tauri::Result<()> {
    app.manage(shell::ShellState::default());
    app.emit(shell::SHELL_READY_EVENT, shell::ShellReadyPayload::default())
        .map_err(|e| tauri::Error::Anyhow(e.into()))
}

/// Tauri entry point (standard Tauri 2 shape). The builder registers
/// plugins, creates the window, and hands over to the runtime.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            shell::cmd_get_shell_info,
            shell::cmd_show_window,
            shell::cmd_hide_window,
        ])
        .setup(|app| {
            initialize_shell(app.handle())?;
            // Window starts hidden (tauri.conf.json); the session bridge
            // raises it on the first candice event. Until the bridge lane
            // lands, show on setup so the shell is visible and provable.
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
            }
            Ok(())
        })
        .run(generate_context())
        .expect("error while running Candice Companion");
}
