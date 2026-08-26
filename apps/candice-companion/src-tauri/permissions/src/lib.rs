//! macOS permissions + degraded floating mode — Candice Companion
//! (Master Spec 0E WS-22, sections 0.3 / 17 / 20 / 27).
//!
//! Owned by WR-015 lane (ownership map 9.2):
//! `apps/candice-companion/src-tauri/permissions/**`.
//!
//! WS-22 owns the macOS permission model and the degraded floating
//! companion policy:
//!
//!   - request Accessibility/microphone permissions **in plain language
//!     only when needed** (spec 0.3);
//!   - if Accessibility permission is denied, **fall back to an
//!     independent movable floating Candice** and explain the optional
//!     permission in plain language (spec 17);
//!   - **Claude never stops** — every entry point is total; no permission
//!     state, probe failure, or missing hardware may panic or block
//!     (spec 20 failure doctrine: "Window tracking permission denied →
//!     use movable floating mode").
//!
//! What this crate is NOT:
//!
//!   - it is not a window anchor (WS-21 `binding/macos` owns discovery and
//!     anchor geometry; this crate consumes a confidence signal from it);
//!   - it is not the window itself (WS-07 owns window appearance/behavior;
//!     this crate only decides WHICH mode the app should run in);
//!   - it is not the TCC prompt UI. Every status probe in this crate is
//!     read-only: `AXIsProcessTrusted()` (never the `WithOptions` prompt
//!     variant), `CGPreflightScreenCaptureAccess()` (never `CGRequest*`),
//!     `[AVCaptureDevice authorizationStatusForMediaType:]` (never
//!     `requestAccessForMediaType`). Interactive prompts are the app
//!     layer's job because only the app owns the plain-language UX and
//!     can decide WHEN a permission is actually needed (spec 0.3:
//!     "request ... only when needed").
//!
//! Feature model (mirrors WS-21): `default` = pure policy/model/copy,
//! fully testable with no OS permission and no hardware; `live` = the
//! real macOS probes behind the optional CoreGraphics/objc2 deps.

mod copy;
mod floating;
mod permission;
mod snapshot;

pub use copy::{
    accessibility_explanation, floating_mode_notice, microphone_explanation,
    permission_copy, screen_capture_explanation,
};
pub use floating::{
    CompanionMode, ModeDecision, ModeDecisionKind, ModeReason, WindowReachability, decide_mode,
};
pub use permission::{MicStatus, PermissionKind, mic_status_from_raw, mic_status_label};
pub use snapshot::PermissionSnapshot;

// The real macOS probes are only compiled with the `live` feature; the
// crate always builds and tests without them (spec 20: the app must keep
// running even when the probe layer cannot be built or linked).
#[cfg(feature = "live")]
pub mod live;
#[cfg(feature = "live")]
pub use live::{probe_accessibility, probe_microphone, probe_screen_capture};
