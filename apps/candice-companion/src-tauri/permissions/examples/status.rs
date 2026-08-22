//! WS-22 diagnostic CLI — prints every macOS permission state Candice
//! cares about and the resulting companion mode. Run with:
//!
//! ```sh
//! cargo run --features live --example status
//! ```
//!
//! Read-only: probes status only, never prompts, never writes. This is
//! the same surface the app's permission row renders (spec 0.3: plain
//! language, only when needed).

use candice_macos_permissions::{
    ModeDecision, PermissionKind, WindowReachability, floating_mode_notice, permission_copy,
    probe_accessibility, probe_microphone, probe_screen_capture,
};

fn main() {
    println!("=== Candice macOS permission status (WS-22) ===");

    let ax = probe_accessibility();
    println!("Accessibility : {}", if ax.granted { "GRANTED" } else { "NOT GRANTED" });

    let sc = probe_screen_capture();
    println!("Screen Capture: {}", if sc.granted { "GRANTED" } else { "NOT GRANTED" });

    let mic = probe_microphone();
    let mic_label = match mic.status {
        candice_macos_permissions::MicStatus::NotDetermined => "NOT DETERMINED",
        candice_macos_permissions::MicStatus::Denied => "DENIED",
        candice_macos_permissions::MicStatus::Restricted => "RESTRICTED",
        candice_macos_permissions::MicStatus::Authorized => "AUTHORIZED",
    };
    println!("Microphone    : {mic_label} (probe {})", if mic.callable { "ok" } else { "unavailable" });

    // Window reachability is the WS-21 lane's answer; the example
    // defaults to Unconfirmed (binding crate would supply this).
    let decision: ModeDecision = candice_macos_permissions::decide_mode(
        Some(ax.granted),
        mic.status,
        WindowReachability::Unconfirmed,
    );
    println!("Mode          : {:?} ({:?})", decision.mode, decision.reason.kind);
    println!();

    let (title, body) = permission_copy(PermissionKind::Accessibility);
    println!("Permission row: {title}");
    println!("  {body}");
    println!();
    println!("Floating notice:");
    println!("  {}", floating_mode_notice());
}
