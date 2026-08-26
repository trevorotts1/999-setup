// WS-23 — macOS signing-state helper tests (real codesign(1), no mocks).

use candice_macos_signature::macos_signature_state;

/// The running test binary is at least linker-signed or ad-hoc signed —
/// an unsigned Mach-O is no longer produced on modern toolchains — and
/// codesign(1) must have produced output. This proves the probe path
/// (child process, stderr parse) works against the real tool.
#[test]
fn probe_returns_real_output_for_test_binary() {
    let report = macos_signature_state();
    assert!(
        report.codesign_present,
        "codesign produced no output for the test binary"
    );
    // A fresh build is always signed in some form (linker or ad-hoc), so a
    // truthfully-empty signature string is itself a failure of the parse.
    assert!(
        !report.signature.is_empty(),
        "signature kind was not parsed from codesign output"
    );
}

/// The report must classify truthfully: whatever this binary is, the
/// distribution predicates must be mutually consistent.
#[test]
fn classification_is_truthful() {
    let report = macos_signature_state();
    assert_ne!(
        report.is_developer_id_signed(),
        report.is_not_distribution_ready(),
        "the two predicates must never agree — a report that is both or neither lies"
    );
}
