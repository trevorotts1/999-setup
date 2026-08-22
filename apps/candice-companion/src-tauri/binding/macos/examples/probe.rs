//! WS-21 live window probe — diagnostic tool (Master Spec 0E WS-21,
//! section 17). Run with the `live-probe` feature:
//!
//! ```sh
//! cargo run --features live-probe --example probe -- [--from-pid <pid>]
//! ```
//!
//! Reads the window-server list, reports the Terminal.app / iTerm2
//! windows it sees, and prints the anchor rectangle that the companion
//! would get beside the matched terminal on the main display.
//!
//! This is the same discovery + anchoring code path the app uses at
//! runtime (the only difference is the display frame: the app asks the
//! actual display the terminal sits on; this example uses the main
//! display for a deterministic probe).

#[cfg(feature = "live-probe")]
mod live {
    use candice_macos_binding::{
        classify_host, compute_anchor, discover_terminal_window, CompanionSize, DiscoverOptions,
        DiscoveredWindow, PointLike, RectLike, ScaleHint, TerminalKind,
    };

    pub fn run() {
        let from_pid: Option<i32> = std::env::args().nth(1).and_then(|s| s.parse().ok());

        let records: Vec<DiscoveredWindow> = match candice_macos_binding::read_window_records() {
            Ok(r) => r,
            Err(e) => {
                eprintln!("probe-error: {}", e);
                std::process::exit(2);
            }
        };

        let matches = discover_terminal_window(
            &records,
            &DiscoverOptions { caller_pid: from_pid, display_id: None },
        );
        println!("window-count={}", records.len());

        for r in &records {
            if classify_host(&r.owner_name, None) != TerminalKind::Unknown {
                println!(
                    "candidate pid={} id={} owner={} layer={} onscreen={} bounds=({:.0},{:.0},{:.0},{:.0})",
                    r.pid, r.window_id, r.owner_name, r.layer, r.on_screen,
                    r.bounds.x, r.bounds.y, r.bounds.width, r.bounds.height
                );
            }
        }

        println!(
            "confidence={:?} candidates={} note={}",
            matches.confidence, matches.candidate_count, matches.note
        );

        if let Some(win) = &matches.best {
            // Main-display frame (the runtime computes the terminal's
            // actual display; the probe uses the main display).
            let frame = RectLike { x: 0.0, y: 0.0, width: 1440.0, height: 900.0 };
            let companion = CompanionSize::new(420.0, 640.0);
            let spec = compute_anchor(
                &win.bounds,
                &frame,
                &companion,
                None,
                PointLike { x: 0.0, y: 0.0 },
                ScaleHint::default(),
            );
            println!(
                "anchor=({:.0},{:.0},{:.0},{:.0}) fallback={} side={:?}",
                spec.rect.x, spec.rect.y, spec.rect.width, spec.rect.height,
                spec.is_fallback, spec.side
            );
        } else {
            println!("anchor=none");
        }
    }
}

fn main() {
    #[cfg(feature = "live-probe")]
    live::run();
    #[cfg(not(feature = "live-probe"))]
    {
        eprintln!("probe-example requires --features live-probe (CGWindowListCopyWindowInfo)");
        std::process::exit(2);
    }
}
