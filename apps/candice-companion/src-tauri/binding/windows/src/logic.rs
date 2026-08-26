//! Deterministic WS-26 discovery/filter/anchoring logic.
//!
//! All decisions live here, pure and unit-testable off-Windows. The real
//! Win32 backend (`win32`) implements `HostWindowSource`; tests use a fake.
//!
//! Guardrail (spec 17): a window is NEVER a routing authority. Everything
//! in this module returns visual-anchor data plus an "unknown session
//! identity" signal; injection enablement is decided by the WS-03 bridge
//! from session proof only.

#![forbid(unsafe_code)]

pub mod anchoring;
pub mod discover;

pub use anchoring::{anchor_for_window, AnchorPlanner};
pub use discover::{discover_and_select, Win32WindowSource};
