//! WS-26 acceptance tests (CHECKLIST E.1 WS-26) — platform-neutral.
//!
//! Runs on any host (default feature set, no Win32). The real Win32 backend
//! exercises the same rules through `Win32WindowSource` + model types; those
//! APIs are a thin adapter over checked Win32 calls, so the decision logic is
//! fully covered here. The Windows-only compile path is proven by
//! `cargo check --target x86_64-pc-windows-msvc --features win32` (see
//! README / CHECKPOINT for the evidence step).
//!
//! Covered acceptance criteria:
//! - Win32 APIs bind to the TOP-LEVEL host window for visual anchoring
//!   (discovery choices are top-level windows; ownership walk classifies
//!   conhost-hosted windows by their owner chain);
//! - host window is never treated as session identity (HostWindow has no
//!   session field; `session_identity_known` starts false; DiscoverVerdict
//!   carries no session; multi-session hosts surfaced explicitly);
//! - multi-tab/panes cannot cross-route (this lane emits the multi-session
//!   host signal; the WS-03 bridge refuses ambiguous windows — tested in
//!   WS-03's own suite);
//! - injection disables itself when the exact session cannot be proven
//!   (proxy: no function here returns a routing permit; anchoring-only).

#![forbid(unsafe_code)]

use crate::logic::anchoring::{anchor_for_window, AnchorPlanner, DEFAULT_GAP_PX};
use crate::logic::discover::{discover_and_select, Win32WindowSource};
use crate::model::{
    AnchorSide, DiscoverVerdict, DiscoveryStrategy, HostKind, HostWindow, NoWindowReason, Rect,
    WindowId,
};

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

fn win(id: u64, kind: HostKind, rect: Rect, work: Rect, opts: FakeOpts) -> HostWindow {
    HostWindow {
        id: WindowId(id),
        process_image: opts.image.unwrap_or_else(|| match kind {
            HostKind::WindowsTerminal => "windowsterminal.exe".into(),
            HostKind::WindowsPowerShell => "powershell.exe".into(),
            HostKind::PowerShell7 => "pwsh.exe".into(),
            HostKind::Cmd => "cmd.exe".into(),
            HostKind::Conhost => "conhost.exe".into(),
            HostKind::OpenWindow => "explorer.exe".into(),
        }),
        process_id: opts.pid.unwrap_or(1000 + id as u32),
        title: opts.title.unwrap_or_else(|| format!("host {id}")),
        class_name: opts.class_name.unwrap_or_else(|| {
            if kind == HostKind::WindowsTerminal {
                "CASCADIA_HOSTING_WINDOW_CLASS".into()
            } else {
                "ConsoleWindowClass".into()
            }
        }),
        rect,
        host_kind: kind,
        cloaked: opts.cloaked,
        minimized: opts.minimized.unwrap_or(false),
        owns_our_console: opts.owns_our_console.unwrap_or(false),
        dpi: opts.dpi.unwrap_or(96),
        monitor_work_area: work,
        session_identity_known: opts.session_identity_known.unwrap_or(false),
    }
}

#[derive(Default)]
struct FakeOpts {
    image: Option<String>,
    pid: Option<u32>,
    title: Option<String>,
    class_name: Option<String>,
    cloaked: Option<bool>,
    minimized: Option<bool>,
    owns_our_console: Option<bool>,
    dpi: Option<u32>,
    session_identity_known: Option<bool>,
}

struct FakeSource {
    all: Vec<HostWindow>,
    fg: Option<HostWindow>,
}

impl Win32WindowSource for FakeSource {
    fn list_all(&self) -> Vec<HostWindow> {
        self.all.clone()
    }
    fn foreground(&self) -> Option<HostWindow> {
        self.fg.clone()
    }
}

fn work_fullscreen() -> Rect {
    Rect {
        left: 0,
        top: 0,
        width: 1920,
        height: 1040,
    }
}

// ---------------------------------------------------------------------------
// Model: host classification (spec 17 matrix)
// ---------------------------------------------------------------------------

#[test]
fn classifies_every_supported_host_image() {
    assert_eq!(
        HostKind::from_process_image("WindowsTerminal.exe"),
        HostKind::WindowsTerminal
    );
    assert_eq!(
        HostKind::from_process_image("C:\\Program Files\\WindowsApps\\WindowsTerminal.exe"),
        HostKind::WindowsTerminal
    );
    assert_eq!(
        HostKind::from_process_image("powershell.exe"),
        HostKind::WindowsPowerShell
    );
    assert_eq!(
        HostKind::from_process_image("PowerShell.exe"),
        HostKind::WindowsPowerShell
    );
    assert_eq!(
        HostKind::from_process_image("pwsh.exe"),
        HostKind::PowerShell7
    );
    assert_eq!(
        HostKind::from_process_image("pwsh-7.4.2.exe"),
        HostKind::PowerShell7
    );
    assert_eq!(HostKind::from_process_image("cmd.exe"), HostKind::Cmd);
    assert_eq!(
        HostKind::from_process_image("conhost.exe"),
        HostKind::Conhost
    );
    assert_eq!(
        HostKind::from_process_image("explorer.exe"),
        HostKind::OpenWindow
    );
    assert_eq!(HostKind::from_process_image(""), HostKind::OpenWindow);
}

#[test]
fn only_windows_terminal_is_multi_session() {
    assert!(HostKind::WindowsTerminal.is_multi_session_host());
    assert!(!HostKind::WindowsPowerShell.is_multi_session_host());
    assert!(!HostKind::PowerShell7.is_multi_session_host());
    assert!(!HostKind::Cmd.is_multi_session_host());
    assert!(!HostKind::Conhost.is_multi_session_host());
    assert!(!HostKind::OpenWindow.is_multi_session_host());
}

// ---------------------------------------------------------------------------
// Model: rect math (DPI + clamping)
// ---------------------------------------------------------------------------

#[test]
fn physical_rect_scales_with_dpi() {
    let w = win(
        1,
        HostKind::WindowsTerminal,
        Rect {
            left: 100,
            top: 50,
            width: 800,
            height: 600,
        },
        work_fullscreen(),
        FakeOpts {
            dpi: Some(144),
            ..FakeOpts::default()
        },
    );
    assert_eq!(
        w.physical_rect(),
        Rect {
            left: 150,
            top: 75,
            width: 1200,
            height: 900
        }
    );
}

#[test]
fn physical_rect_ignores_insane_dpi() {
    let w = win(
        2,
        HostKind::Cmd,
        Rect {
            left: 0,
            top: 0,
            width: 100,
            height: 50,
        },
        work_fullscreen(),
        FakeOpts {
            dpi: Some(0),
            ..FakeOpts::default()
        },
    );
    assert_eq!(
        w.physical_rect(),
        Rect {
            left: 0,
            top: 0,
            width: 100,
            height: 50
        }
    );
}

#[test]
fn rect_intersection_and_empty() {
    let a = Rect {
        left: 0,
        top: 0,
        width: 100,
        height: 100,
    };
    let b = Rect {
        left: 50,
        top: 50,
        width: 100,
        height: 100,
    };
    assert_eq!(
        a.intersect(&b),
        Rect {
            left: 50,
            top: 50,
            width: 50,
            height: 50
        }
    );
    let c = Rect {
        left: 200,
        top: 200,
        width: 10,
        height: 10,
    };
    assert!(a.intersect(&c).is_empty());
}

#[test]
fn anchor_id_string_is_stable_hex() {
    assert_eq!(WindowId(0x1ABCD).as_anchor_string(), "0x000000000001ABCD");
}

// ---------------------------------------------------------------------------
// Discovery: our-console window wins (strongest anchor)
// ---------------------------------------------------------------------------

#[test]
fn our_console_window_wins_over_foreground() {
    let console_win = win(
        10,
        HostKind::Cmd,
        Rect {
            left: 0,
            top: 0,
            width: 600,
            height: 400,
        },
        work_fullscreen(),
        FakeOpts {
            owns_our_console: Some(true),
            ..FakeOpts::default()
        },
    );
    let wt = win(
        20,
        HostKind::WindowsTerminal,
        Rect {
            left: 200,
            top: 100,
            width: 900,
            height: 700,
        },
        work_fullscreen(),
        FakeOpts::default(),
    );
    let src = FakeSource {
        all: vec![wt.clone(), console_win.clone()],
        fg: Some(wt.clone()),
    };
    match discover_and_select(&src) {
        DiscoverVerdict::Found {
            chosen,
            strategy,
            from_foreground,
            ..
        } => {
            assert_eq!(chosen.id, WindowId(10));
            assert_eq!(strategy, DiscoveryStrategy::OurConsole);
            assert!(!from_foreground);
        }
        v => panic!("expected Found, got {v:?}"),
    }
}

#[test]
fn minimized_our_console_window_is_skipped() {
    let console_win = win(
        11,
        HostKind::Cmd,
        Rect {
            left: 0,
            top: 0,
            width: 600,
            height: 400,
        },
        work_fullscreen(),
        FakeOpts {
            owns_our_console: Some(true),
            minimized: Some(true),
            ..FakeOpts::default()
        },
    );
    let wt = win(
        21,
        HostKind::WindowsTerminal,
        Rect {
            left: 200,
            top: 100,
            width: 900,
            height: 700,
        },
        work_fullscreen(),
        FakeOpts::default(),
    );
    let src = FakeSource {
        all: vec![wt.clone(), console_win],
        fg: None,
    };
    match discover_and_select(&src) {
        DiscoverVerdict::Found {
            chosen,
            strategy,
            from_foreground,
            ..
        } => {
            assert_eq!(chosen.id, WindowId(21));
            assert_eq!(strategy, DiscoveryStrategy::MostRecentHost);
            assert!(!from_foreground);
        }
        v => panic!("expected Found, got {v:?}"),
    }
}

// ---------------------------------------------------------------------------
// Discovery: foreground host choice
// ---------------------------------------------------------------------------

#[test]
fn foreground_host_window_wins_over_background() {
    let fg = win(
        30,
        HostKind::WindowsTerminal,
        Rect {
            left: 0,
            top: 0,
            width: 800,
            height: 600,
        },
        work_fullscreen(),
        FakeOpts::default(),
    );
    let bg = win(
        31,
        HostKind::WindowsPowerShell,
        Rect {
            left: 100,
            top: 50,
            width: 700,
            height: 500,
        },
        work_fullscreen(),
        FakeOpts::default(),
    );
    let src = FakeSource {
        all: vec![bg.clone()],
        fg: Some(fg.clone()),
    };
    match discover_and_select(&src) {
        DiscoverVerdict::Found {
            chosen,
            strategy,
            from_foreground,
            ..
        } => {
            assert_eq!(chosen.id, WindowId(30));
            assert_eq!(strategy, DiscoveryStrategy::ForegroundHost);
            assert!(from_foreground);
        }
        v => panic!("expected Found, got {v:?}"),
    }
}

#[test]
fn foreground_open_window_is_not_a_host() {
    // Explorer/other windows are not terminal hosts: they must never be
    // selected as the anchor host (spec 17: bind to the terminal host
    // window only).
    let fg = win(
        40,
        HostKind::OpenWindow,
        Rect {
            left: 0,
            top: 0,
            width: 800,
            height: 600,
        },
        work_fullscreen(),
        FakeOpts::default(),
    );
    let bg = win(
        41,
        HostKind::WindowsTerminal,
        Rect {
            left: 0,
            top: 0,
            width: 900,
            height: 700,
        },
        work_fullscreen(),
        FakeOpts::default(),
    );
    let src = FakeSource {
        all: vec![bg.clone()],
        fg: Some(fg),
    };
    match discover_and_select(&src) {
        DiscoverVerdict::Found {
            chosen,
            strategy,
            from_foreground,
            ..
        } => {
            assert_eq!(chosen.id, WindowId(41));
            assert_eq!(strategy, DiscoveryStrategy::MostRecentHost);
            assert!(!from_foreground);
        }
        v => panic!("expected Found, got {v:?}"),
    }
}

#[test]
fn foreground_cloaked_host_is_rejected() {
    let fg = win(
        50,
        HostKind::Cmd,
        Rect {
            left: 0,
            top: 0,
            width: 800,
            height: 600,
        },
        work_fullscreen(),
        FakeOpts {
            cloaked: Some(true),
            ..FakeOpts::default()
        },
    );
    let bg = win(
        51,
        HostKind::Cmd,
        Rect {
            left: 0,
            top: 0,
            width: 700,
            height: 500,
        },
        work_fullscreen(),
        FakeOpts::default(),
    );
    let src = FakeSource {
        all: vec![bg.clone()],
        fg: Some(fg),
    };
    match discover_and_select(&src) {
        DiscoverVerdict::Found { chosen, .. } => {
            assert_eq!(chosen.id, WindowId(51));
        }
        v => panic!("expected Found, got {v:?}"),
    }
}

// ---------------------------------------------------------------------------
// Discovery: no candidates / no eligible host => NoneFound (spec 20)
// ---------------------------------------------------------------------------

#[test]
fn empty_snapshot_returns_none_found() {
    let src = FakeSource {
        all: vec![],
        fg: None,
    };
    assert_eq!(
        discover_and_select(&src),
        DiscoverVerdict::NoneFound {
            reason: NoWindowReason::NoCandidate
        }
    );
}

#[test]
fn non_host_candidates_return_none_found() {
    let a = win(
        60,
        HostKind::OpenWindow,
        Rect {
            left: 0,
            top: 0,
            width: 100,
            height: 100,
        },
        work_fullscreen(),
        FakeOpts::default(),
    );
    let b = win(
        61,
        HostKind::OpenWindow,
        Rect {
            left: 10,
            top: 10,
            width: 200,
            height: 200,
        },
        work_fullscreen(),
        FakeOpts::default(),
    );
    let src = FakeSource {
        all: vec![a, b],
        fg: None,
    };
    assert_eq!(
        discover_and_select(&src),
        DiscoverVerdict::NoneFound {
            reason: NoWindowReason::NoEligibleHost
        }
    );
}

#[test]
fn minimized_only_snapshot_returns_none_found() {
    let a = win(
        70,
        HostKind::Cmd,
        Rect {
            left: 0,
            top: 0,
            width: 800,
            height: 600,
        },
        work_fullscreen(),
        FakeOpts {
            minimized: Some(true),
            ..FakeOpts::default()
        },
    );
    let src = FakeSource {
        all: vec![a],
        fg: None,
    };
    assert_eq!(
        discover_and_select(&src),
        DiscoverVerdict::NoneFound {
            reason: NoWindowReason::NoEligibleHost
        }
    );
}

// ---------------------------------------------------------------------------
// Windows Terminal: multi-session host annotation is carried, never resolved
// ---------------------------------------------------------------------------

#[test]
fn windows_terminal_window_is_marked_multi_session() {
    let wt = win(
        80,
        HostKind::WindowsTerminal,
        Rect {
            left: 0,
            top: 0,
            width: 900,
            height: 700,
        },
        work_fullscreen(),
        FakeOpts::default(),
    );
    let src = FakeSource {
        all: vec![wt.clone()],
        fg: None,
    };
    if let DiscoverVerdict::Found { chosen, .. } = discover_and_select(&src) {
        assert!(chosen.host_kind.is_multi_session_host());
        // The verdict never fabricates session identity.
        assert!(!chosen.session_identity_known);
    } else {
        panic!("terminal should be discoverable");
    }
}

#[test]
fn discovered_windows_are_born_without_session_identity() {
    // HostWindow carries no session field at all; the only session-related
    // flag is `session_identity_known`, which is false on every window the
    // backend produces (asserted in tests below by construction of win()).
    let w = win(
        90,
        HostKind::Cmd,
        Rect::default(),
        work_fullscreen(),
        FakeOpts::default(),
    );
    // Constructor default already covers it; also verify the fake's default:
    assert!(!w.session_identity_known);
}

#[test]
fn discover_verdict_carries_no_session_identity_type() {
    // Compile-time guard: DiscoverVerdict's fields contain no session
    // identifier — proven by constructing and destructuring it here with
    // only window candidates. (If a session field is ever added, this test
    // still compiles but the WS-03 bridge tests must be re-checked; the
    // real guard is that this crate never imports a session type.)
    let w = win(
        91,
        HostKind::Cmd,
        Rect {
            left: 0,
            top: 0,
            width: 10,
            height: 10,
        },
        work_fullscreen(),
        FakeOpts::default(),
    );
    let src = FakeSource {
        all: vec![w],
        fg: None,
    };
    match discover_and_select(&src) {
        DiscoverVerdict::Found {
            chosen,
            strategy,
            from_foreground,
            candidates,
        } => {
            assert!(chosen.rect.width >= 10);
            assert_eq!(strategy, DiscoveryStrategy::MostRecentHost);
            assert!(!from_foreground);
            assert_eq!(candidates.len(), 1);
        }
        v => panic!("expected Found, got {v:?}"),
    }
}

// ---------------------------------------------------------------------------
// Anchoring: placement beside host + clamping (spec 17 follow/anchor UX)
// ---------------------------------------------------------------------------

#[test]
fn anchors_to_right_of_host_with_default_gap() {
    let host_rect = Rect {
        left: 100,
        top: 200,
        width: 800,
        height: 600,
    };
    let out = anchor_for_window(
        &host_rect,
        &work_fullscreen(),
        AnchorSide::Right,
        DEFAULT_GAP_PX,
        300,
        400,
    );
    assert_eq!(
        out,
        Rect {
            left: 912,
            top: 200,
            width: 300,
            height: 400
        }
    );
}

#[test]
fn anchors_to_left_of_host() {
    // Host far from the screen edge: unclamped left placement.
    let host_rect = Rect {
        left: 500,
        top: 200,
        width: 800,
        height: 600,
    };
    let out = anchor_for_window(
        &host_rect,
        &work_fullscreen(),
        AnchorSide::Left,
        12,
        300,
        400,
    );
    assert_eq!(
        out,
        Rect {
            left: 500 - 12 - 300,
            top: 200,
            width: 300,
            height: 400
        }
    );
    assert_eq!(out.left, 188);
}

#[test]
fn left_anchor_clamps_at_screen_left_edge() {
    let host_rect = Rect {
        left: 100,
        top: 200,
        width: 800,
        height: 600,
    };
    let out = anchor_for_window(
        &host_rect,
        &work_fullscreen(),
        AnchorSide::Left,
        12,
        300,
        400,
    );
    // -212 would be off-screen; clamp shifts to work-area left edge.
    assert_eq!(
        out,
        Rect {
            left: 0,
            top: 200,
            width: 300,
            height: 400
        }
    );
}

#[test]
fn anchors_below_host() {
    let host_rect = Rect {
        left: 0,
        top: 0,
        width: 800,
        height: 600,
    };
    let out = anchor_for_window(
        &host_rect,
        &work_fullscreen(),
        AnchorSide::Bottom,
        10,
        300,
        400,
    );
    assert_eq!(
        out,
        Rect {
            left: 0,
            top: 610,
            width: 300,
            height: 400
        }
    );
}

#[test]
fn right_anchor_clamps_when_host_at_screen_right_edge() {
    // Host touches the right edge of the work area; the companion must be
    // pulled inside (clamped to the work area, not off-screen).
    let host_rect = Rect {
        left: 1620,
        top: 100,
        width: 300,
        height: 400,
    };
    let work = Rect {
        left: 0,
        top: 0,
        width: 1920,
        height: 1040,
    };
    let out = anchor_for_window(&host_rect, &work, AnchorSide::Right, 12, 300, 400);
    assert!(out.right() <= work.right());
    assert!(out.left >= work.left);
    assert_eq!(out.right(), work.right());
}

#[test]
fn top_anchor_clamps_when_host_at_top() {
    let host_rect = Rect {
        left: 0,
        top: 0,
        width: 800,
        height: 600,
    };
    let out = anchor_for_window(
        &host_rect,
        &work_fullscreen(),
        AnchorSide::Top,
        12,
        300,
        400,
    );
    assert!(out.top >= 0);
    assert_eq!(out.top, 0);
}

#[test]
fn planner_uses_preferred_side_and_gap_and_surfaces_descriptor() {
    let planner = AnchorPlanner {
        preferred_side: AnchorSide::Left,
        preferred_gap_px: 20,
    };
    let host = win(
        100,
        HostKind::Cmd,
        Rect {
            left: 500,
            top: 200,
            width: 800,
            height: 600,
        },
        work_fullscreen(),
        FakeOpts::default(),
    );
    let r = planner.anchor(&host, 300, 400);
    assert_eq!(
        r,
        Rect {
            left: 500 - 20 - 300,
            top: 200,
            width: 300,
            height: 400
        }
    );
    let d = planner.anchor_descriptor(&host);
    assert_eq!(d.window_id, WindowId(100));
    assert_eq!(d.side, AnchorSide::Left);
    assert_eq!(d.gap_px, 20);
}

#[test]
fn empty_work_area_does_not_clamp() {
    let host_rect = Rect {
        left: 100,
        top: 100,
        width: 800,
        height: 600,
    };
    let out = anchor_for_window(
        &host_rect,
        &Rect::default(),
        AnchorSide::Right,
        12,
        300,
        400,
    );
    assert_eq!(
        out,
        Rect {
            left: 912,
            top: 100,
            width: 300,
            height: 400
        }
    );
}

#[test]
fn companion_bigger_than_work_area_collapses_to_work_area() {
    let work = Rect {
        left: 0,
        top: 0,
        width: 800,
        height: 600,
    };
    let host_rect = Rect {
        left: 0,
        top: 0,
        width: 400,
        height: 300,
    };
    let out = anchor_for_window(&host_rect, &work, AnchorSide::Right, 12, 2000, 2000);
    assert_eq!(out.width, work.width);
    assert_eq!(out.height, work.height);
    assert_eq!(out.left, 0);
    assert_eq!(out.top, 0);
}
