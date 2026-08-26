//! WS-23 — macOS signing/notarization helper crate for Candice Companion.
//!
//! Owned lane: `apps/candice-companion/scripts/package-macos/**` (PROJECT-MANIFEST
//! 9.2, WR-015 row, WS-23 glob). Platform modules own only signing/package
//! format and startup details (Master Spec 18 boundary); everything else
//! stays in the shared shell.
//!
//! Scope discipline: this crate is READ-ONLY diagnostics plus the packaging
//! contract. Actual signing/notarization executes through the scripts in
//! `apps/candice-companion/scripts/package-macos/**` on the build machine (CI),
//! never at runtime on a customer machine, and never by disabling
//! Gatekeeper (Master Spec 23).

pub mod signature;

pub use signature::{macos_signature_state, SignatureReport};
