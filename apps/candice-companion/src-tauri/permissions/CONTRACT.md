# WS-22 Contract — macOS permissions + degraded floating mode

Owned glob (manifest 9.2): `apps/candice-companion/src-tauri/permissions/**`
Lane: WR-015 / WS-22. Deps: WS-06 (Tauri shell), WS-21 (window discovery).

## What this crate is

The macOS permission model and degraded floating mode policy for the
Candice Companion: which permissions Candice can need, their current TCC
state, the plain-language copy shown when a permission is asked for, and
the decision that switches the companion between anchored and floating
mode.

## What this crate will NEVER do (binding rules)

1. **Trigger a TCC prompt of its own.** Every live probe is read-only:
   `AXIsProcessTrusted()` (never the `WithOptions` prompt variant),
   `CGPreflightScreenCaptureAccess()` (never `CGRequest*`),
   `authorizationStatusForMediaType:` (never `requestAccess`). Spec 0.3
   says "request Accessibility/microphone permissions in plain language
   only when needed" — deciding WHEN is the app layer's UX job; this
   crate supplies the status and the copy, never the dialog.
2. **Anchoring or geometry.** WS-21 (`binding/macos`) owns window
   discovery and anchor math. This crate consumes the WS-21 confidence
   signal (`WindowReachability`) and returns a mode; it never touches
   windows.
3. **Panic or abort.** All entries are total: probes degrade to
   conservative readings, the AVFoundation call is wrapped in
   `objc2::exception::catch` (a foreign ObjC exception cannot unwind into
   Rust — spec 20: no Candice failure stops Claude), and every input
   combination of `decide_mode` yields a decision.
4. **Claim a permission state it did not measure.** When the live feature
   is absent or a probe fails, statuses are reported as unknown
   (`None`/`NotDetermined`), never as granted or denied.

## Behavior contract (CHECKLIST E.1 WS-22)

Evidence-grader checklist — each item maps to a test:

| Requirement (spec 0.3/17/20) | Where it lives | Test |
|---|---|---|
| Accessibility permission requested in plain language | `copy.rs::accessibility_explanation` | `every_copy_blob_is_nonempty_and_substantive` |
| Mic permission requested in plain language | `copy.rs::microphone_explanation` | `every_copy_blob_is_nonempty_and_substantive` |
| Accessibility denied → movable floating companion | `floating.rs::decide_mode` | `accessibility_denied_always_floats` |
| Claude never stops (no probe failure blocks) | `live.rs` total probes | `probe_functions_exist_and_are_total` (real hardware), 36-combo totality test |
| Optional permission explained, never required | `copy.rs` all copy | `no_permission_is_required_for_the_core_flow` |
| Mic denied → typing remains | `permission.rs` model + `copy.rs` | `copy_explains_what_happens_without_permission` |
| No prompt from the crate itself | code inspection: only preflight/status APIs | — (documented in Cargo.toml + lib.rs) |
| Mode decision is total (spec 20) | `floating.rs` | `decision_is_total_over_all_input_combinations` (36 combos) |
| AVFoundation failure degrades, not aborts | `live.rs::probe_microphone` exception catch | live run + `Err` branch |
| Live probes return real OS state on hardware | `live.rs` + `examples/status.rs` | live run on this Mac (evidence in CHECKPOINT) |

## Feature flags

- `default` (empty): pure policy/model/copy, fixture-tested, no OS
  permission, no network, no ObjC call. `cargo test` / `cargo clippy`
  green everywhere.
- `live`: enables `core-graphics` (screen-capture preflight),
  `objc2` + `objc2-foundation` (AVFoundation mic status), and the raw
  ApplicationServices `AXIsProcessTrusted` link. Used by
  `examples/status.rs` and by CI smoke tests on real Mac hardware; the
  runtime app crate wires this feature at fan-in (9.3 integration owner).

## Interop contract (consumed at fan-in by the app crate)

The app crate (WR-012) wires this crate with `--features live` and:

1. calls the three probes and packs them into `PermissionSnapshot`;
2. feeds the WS-21 `WindowMatches` confidence into
   `WindowReachability` (`Anchored` when confidence is a match,
   `Unconfirmed` when `None`, `NotFound` when discovery reports nothing);
3. renders `CompanionMode` from `snapshot.decide()`;
4. shows `permission_copy(...)` / `floating_mode_notice()` text verbatim
   (single home for copy — do not reword in the UI).

## Provenance / evidence (2026-08-21)

- `cargo test` (default): 20 passed, 0 failed.
- `cargo test --features live`: 21 passed, 0 failed.
- `cargo clippy --features live --all-targets -- -D warnings`: 0
  errors/warnings. Same for default features.
- `cargo run --features live --example status` on this Mac:
  Accessibility GRANTED, Screen Capture GRANTED, Microphone AUTHORIZED
  (real TCC state, read-only), mode decision Floating (example feeds a
  default `Unconfirmed` window signal), plain-language copy printed.
- AVFoundation media-type discovery: the naive `@"auio"` constant was
  rejected by the runtime (`NSInvalidArgumentException: The passed media
  type 'auio' is not supported`); corrected to the `@"soun"` constant
  (AVMediaTypeAudio) and the call is exception-caught so a wrong or
  future-rejected constant degrades to `callable=false`, never an abort.
