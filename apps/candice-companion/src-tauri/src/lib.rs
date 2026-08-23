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

mod runtime;
mod shell;
mod speech_timing;

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
    // The state latch and event describe the same completed shell
    // initialization. The IPC health probe reads this fact; it must not be
    // the operation that first mutates it.
    app.state::<shell::ShellState>().mark_ready();
    app.emit(shell::SHELL_READY_EVENT, shell::ShellReadyPayload::default())
        .map_err(|e| tauri::Error::Anyhow(e.into()))
}

/// Tauri entry point (standard Tauri 2 shape). The builder registers
/// plugins, creates the window, and hands over to the runtime.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The MCP bridge launches the companion with an exact opaque session id,
    // endpoint and single-use capability token. `--wake` remains a separate
    // non-binding visual wake request.
    let launch = runtime::parse_runtime_launch(std::env::args().skip(1));
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        // FIX-022: in-app updater (tauri-plugin-updater, spec 21). The plugin
        // refuses non-https endpoints in release builds and verifies every
        // downloaded payload against the pinned public key before install.
        // Config (endpoints/pubkey/installMode) lives in tauri.conf.json; the
        // build fails hard unless TAURI_SIGNING_PRIVATE_KEY matches that
        // pubkey, so a keyless dev build must pass `--no-sign` explicitly —
        // which tauri-bundler refuses when updater artifacts are requested.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            shell::cmd_get_shell_info,
            shell::cmd_show_window,
            shell::cmd_hide_window,
            runtime::cmd_get_runtime_capabilities,
            runtime::cmd_submit_bridge_answer,
            runtime::cmd_cancel_bridge_question,
            runtime::cmd_release_bridge_question,
            runtime::cmd_set_answer_input_enabled,
            runtime::cmd_take_pending_bridge_question,
            runtime::cmd_load_profile,
            runtime::cmd_save_profile,
            speech_timing::cmd_speech_timing_start,
            speech_timing::cmd_speech_timing_boundary,
            speech_timing::cmd_speech_timing_drain,
        ])
        .setup(|app| {
            initialize_shell(app.handle())?;
            runtime::initialize_runtime(app.handle(), launch.clone())?;
            runtime::start_local_bridge(app.handle().clone(), launch);
            // Window starts hidden (tauri.conf.json); show the visual shell
            // while the authenticated bridge may later deliver a question.
            if let Some(win) = app.get_webview_window("main") {
                // A transparent webview still has rectangular native hit
                // bounds. Start click-through before front-end composition;
                // FIX-008 only enables bounded input after a native adapter
                // can prove it, so Terminal remains usable around Candice.
                let _ = win.set_ignore_cursor_events(true);
                let _ = win.show();
            }
            Ok(())
        })
        .run(generate_context())
        .expect("error while running Candice Companion");
}
