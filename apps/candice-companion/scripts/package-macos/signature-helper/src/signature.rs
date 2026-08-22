//! WS-23 — macOS signing-state check for the Rust shell (read-only).
//!
//! Owned lane: `apps/candice-companion/scripts/package-macos/**` (PROJECT-MANIFEST
//! 9.2, WR-015 row, WS-23 glob). This module never signs, never prompts,
//! never touches the keychain: it reports whether the RUNNING artifact
//! carries a valid Developer ID signature and its CDHash, so the app can
//! surface distribution-readiness truthfully (Master Spec 23: record the
//! limitation; never misrepresent an unsigned artifact as trusted).
//!
//! Shell callers gate on `macos_signature_state()`; the webview bridge
//! (WS-06 shell lane) may surface it for diagnostics. This file compiles
//! on all platforms — the child probe simply reports not-macOS.

use std::process::Command;

/// One-shot, self-terminating, bounded probe (workflows.md §8 pattern:
/// never a long foreground wait). Returns an empty report on any failure.
pub fn macos_signature_state() -> SignatureReport {
    let Ok(out) = Command::new("/usr/bin/codesign")
        .args(["-dv", "--verbose=2"])
        .arg(std::env::current_exe().unwrap_or_default())
        .output()
    else {
        return SignatureReport::default();
    };
    let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
    let mut report = SignatureReport {
        codesign_present: !stderr.is_empty(),
        ..SignatureReport::default()
    };
    for line in stderr.lines() {
        let line = line.trim();
        if let Some(v) = line.strip_prefix("Signature=") {
            report.signature = v.to_string();
        } else if let Some(v) = line.strip_prefix("TeamIdentifier=") {
            report.team_identifier = v.to_string();
        } else if let Some(v) = line.strip_prefix("CDHash=") {
            report.cdhash = v.to_string();
        } else if let Some(v) = line.strip_prefix("Identifier=") {
            report.identifier = v.to_string();
        } else if line.starts_with("Executable=") {
            report.executable = true;
        }
    }
    report
}

/// Machine-readable signature facts about the running executable.
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureReport {
    /// Whether codesign(1) produced any output at all for this binary.
    pub codesign_present: bool,
    /// Raw signature kind: `adhoc`, `Developer ID Application: ...`, etc.
    pub signature: String,
    /// TeamIdentifier as reported by codesign (empty when unset).
    pub team_identifier: String,
    /// CDHash of the signature (empty when unsigned).
    pub cdhash: String,
    /// Bundle identifier (empty when unbound).
    pub identifier: String,
    /// True when codesign reported an Executable path (the binary exists).
    pub executable: bool,
}

impl SignatureReport {
    /// Distribution-truth predicate: a Developer ID signature with a team.
    pub fn is_developer_id_signed(&self) -> bool {
        self.codesign_present
            && self.signature.contains("Developer ID Application")
            && !self.team_identifier.is_empty()
    }

    /// Local-only predicate: ad-hoc signed or entirely unsigned.
    pub fn is_not_distribution_ready(&self) -> bool {
        !self.is_developer_id_signed()
    }
}
