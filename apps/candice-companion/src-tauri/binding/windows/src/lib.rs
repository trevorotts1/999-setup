//! WS-26 — Windows Win32 window discovery/binding (Candice Companion).
//!
//! Owned by WR-016 lane (ownership map 9.2):
//! `apps/candice-companion/src-tauri/binding/windows/**`.
//!
//! Master Spec section 17 (window binding) is the binding authority:
//!
//!   - Windows support is REQUIRED in V1, not deferred.
//!   - Candice must bind to the TOP-LEVEL HOST WINDOW — never assume the
//!     shell process itself owns the visible window (PowerShell inside
//!     Windows Terminal binds to the Windows Terminal window, not to the
//!     console host).
//!   - A top-level Windows Terminal window can host many tabs and panes:
//!     the Claude SESSION ID / bridge binding (WS-03) is the authority for
//!     which conversation Candice belongs to; the host window is used ONLY
//!     for visual anchoring.
//!   - Never assume "foreground Windows Terminal window" means "correct
//!     Claude session".
//!   - If the exact active tab/pane/session target cannot be proven,
//!     DISABLE injection and use the same-session MCP/bridge path or
//!     "Answer in Claude instead" (this lane never enables injection on a
//!     window match alone).
//!   - Switching tabs/panes must never send a Candice answer to another
//!     Claude session — the WS-03 bridge already refuses ambiguous windows;
//!     this lane surfaces the ambiguity signal (`multi_session_window`)
//!     that the bridge consumes.
//!   - If exact host tracking cannot be established: fall back to a movable
//!     floating companion; never stop the Claude session (spec 20).
//!
//! # Layering
//!
//! - `model` — platform-neutral data types and the `HostWindowSource` trait
//!   (the spec-18 platform boundary: this crate's backends implement it).
//! - `logic` — deterministic discover/filter/anchor decisions, pure and
//!   unit-testable off-Windows (fake `HostWindowSource` in tests).
//! - `win32` — the real Win32 backend (`#[cfg(windows)]` + `feature = "win32"`):
//!   EnumWindows + process-image filtering for the top-level host window,
//!   GetForegroundWindow for the foreground probe, DWM extended frame bounds
//!   for the pixel-accurate visible rect, monitor work-area for clamping.
//!
//! # Windows host identification
//!
//! Host kind is inferred from the window's owning process image name:
//!   - `WindowsTerminal.exe`   -> Windows Terminal (tabs/panes: window is
//!     shared by many sessions — the WS-03 bridge's multi-session rule applies)
//!   - `powershell.exe`/`pwsh.exe` -> standalone PowerShell console host
//!   - `conhost.exe`            -> classic console host (CMD or a console
//!     app; the exact host is the closest ancestor window)
//!   - `cmd.exe`                -> standalone Command Prompt console host
//!   - anything else            -> `OpenWindow` (floating-companion fallback
//!     territory; the caller still anchors, never routes)
//!
//! Session identity is NEVER derived here. Every structure this crate emits
//! carries `session_identity_known: false` unless the caller supplied proof
//! from the WS-03 bridge; the app's discover flow therefore can never make
//! a routing decision from a window alone.

// Safe modules (`model`, `logic`) carry their own `#![forbid(unsafe_code)]`;
// only the `win32` backend module may contain `unsafe`, and it requires
// `unsafe_op_in_unsafe_fn` (explicit unsafe blocks everywhere).
#![forbid(unsafe_op_in_unsafe_fn)]

pub mod logic;
pub mod model;
#[cfg(all(windows, feature = "win32"))]
pub mod win32;

#[cfg(test)]
mod tests;

pub use logic::{anchoring::*, discover::*};
pub use model::*;
