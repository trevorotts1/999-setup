# CHECKPOINT — WS-26 (Windows Win32 window discovery/binding)

Builder: B-WR-016-WS-26 (opus/max), W2 wave, worktree `wr001-bootstrap`
(branch `candice/wr001-bootstrap`). Date: 2026-08-21.

## Acceptance criterion (CHECKLIST E.1 WS-26)

> PASS: Win32 APIs bind to the top-level host window for visual anchoring;
> host window is never treated as session identity; multi-tab/panes cannot
> cross-route Candice input between Claude sessions; injection disables
> itself when the exact target session cannot be proven.

## Files created (all inside owned glob `apps/candice-companion/src-tauri/binding/windows/**`, per PROJECT-MANIFEST 9.2 WR-016)

| File | Role |
|---|---|
| `binding/windows/Cargo.toml` | standalone crate `candice-win32-bind` v0.1.0; default features EMPTY (offline tests, no Windows SDK); `win32` feature pulls `windows` 0.62.2 with only the needed feature flags; the real backend module is additionally `#[cfg(windows)]`-gated |
| `binding/windows/src/lib.rs` | crate root + module wiring; only the `win32` module may contain unsafe code |
| `binding/windows/src/model.rs` | platform-neutral types: `WindowId` (anchor id, hex string form), `Rect` (DPI + intersection + work-area clamp), `HostKind` (+ `from_process_image` pure classifier + `is_multi_session_host`), `HostWindow` (NEVER carries a session id; `session_identity_known` starts false), `DiscoverVerdict`, `NoWindowReason`, `DiscoveryStrategy`, `Anchor`/`AnchorSide` |
| `binding/windows/src/logic/discover.rs` | `Win32WindowSource` trait (spec-18 platform boundary) + `discover_and_select` deterministic selection: (1) our-console window, (2) foreground known-host window, (3) background best-ranked host; OpenWindow never eligible as host anchor; `NoneFound` reasons for the floating-companion fallback |
| `binding/windows/src/logic/anchoring.rs` | `AnchorPlanner` + `anchor_for_window`: side/gap placement, work-area clamping, friendlier-than-scratch geometry; descriptor carries dpi scale |
| `binding/windows/src/win32/mod.rs` | REAL Win32 backend: EnumWindows (synchronous LPARAM-context callback), IsWindowVisible, GetWindowTextW/GetClassNameW (display metadata only, capped 1024/256 chars), GetWindowThreadProcessId + QueryFullProcessImageNameW (PROCESS_QUERY_LIMITED_INFORMATION — no debug handle), DwmGetWindowAttribute EXTENDED_FRAME_BOUNDS + CLOAKED, GetWindowRect fallback, IsIconic, GetDpiForWindow, MonitorFromWindow + GetMonitorInfoW work area, GetConsoleWindow + GA_ROOT owner-walk for owns-our-console and conhost hosting |
| `binding/windows/src/tests.rs` | 26 acceptance tests — host matrix classification, multi-session marking, our-console priority, foreground-host pick, OpenWindow rejection, cloaked rejection, minimized skip, NoneFound paths, DPI math, anchor clamping (left/right/top/oversize/empty-work-area), planner descriptor, anchor-id stability, verdict carries no session identity |
| `binding/windows/README.md` | contract + integration notes for fan-in |
| `binding/windows/CHECKPOINT-WS26.md` | this note |

## Verification (primary-source evidence, rustc/cargo 1.97.1, ran in crate dir)

```text
$ cargo test                                    -> 26 passed, 0 failed
$ cargo clippy --all-targets                    -> 0 warnings, 0 errors
$ cargo check --target x86_64-pc-windows-msvc --features win32 --offline
                                                -> Finished (real Win32 path compiles)
$ cargo clippy --all-targets --features win32 --target x86_64-pc-windows-msvc --offline
                                                -> 0 warnings, 0 errors
$ cargo fmt --check                             -> clean
```

`windows` 0.62.2 (cached registry) is the Win32 binding; every API used was
verified present with its exact signature/features before writing:
EnumWindows/GetWindowTextW/GetWindowTextLengthW/GetClassNameW/GetForegroundWindow/
GetWindowRect/GetWindowThreadProcessId/IsWindowVisible/IsIconic/GetAncestor/
GetWindow/GA_ROOT/GW_OWNER (UI::WindowsAndMessaging),
GetDpiForWindow (UI::HiDpi), DwmGetWindowAttribute/DWMWA_EXTENDED_FRAME_BOUNDS/
DWMWA_CLOAKED (Graphics::Dwm), MonitorFromWindow/GetMonitorInfoW/MONITORINFO/
MONITOR_DEFAULTTONEAREST (Graphics::Gdi), GetConsoleWindow (System::Console),
OpenProcess/QueryFullProcessImageNameW/PROCESS_QUERY_LIMITED_INFORMATION/
PROCESS_NAME_WIN32 (System::Threading), RECT/HWND/LPARAM (Foundation).

QC correction 2026-08-21 (wf_c3b3ed8b-978): the original list claimed
`GetWindowLongPtrW`/`GWL_STYLE`/`WS_*`, which this crate never calls (the
rect comes from DWM extended frame bounds or GetWindowRect; the owner walk
uses GetAncestor/GetWindow only). List above corrected to the exact call
surface.

## Design decisions / boundary notes

- **Session identity is structurally absent.** `HostWindow` has no session
  field; `DiscoverVerdict` has none. The only session-related flag is
  `session_identity_known: bool`, always false on backend output. Routing and
  injection enablement remain WS-03 bridge responsibilities (its suite already
  covers ambiguous-window refusal); this lane surfaces the ambiguity signal
  (`host_kind.is_multi_session_host()`) that the bridge consumes. Windows
  Terminal is the only `multi_session` host.
- **Injection disablement:** no function here grants injection; `NoneFound`
  + `session_identity_known=false` and multi-session marking are the explicit
  data the app layer uses to refuse the injected path when proof is missing.
- **Floating fallback:** `NoneFound { reason }` is explicit (NoCandidate /
  NoEligibleHost), so the app can caption why; Claude never stops (spec 20).
- **Top-level host choice:** conhost-owned windows are resolved to their real
  host by a bounded (8-step) owner walk; `owns_our_console` (GetConsoleWindow
  + GA_ROOT compare) wins selection without ever becoming a routing input.
- **9.3 integration:** the run integration owner wires `candice-win32-bind ~>
  path` into the WR-012-owned app `Cargo.toml` at fan-in (same pattern as
  WS-17 `candice-capture`). No shared/root files touched by this lane.
- **Windows-runtime limitation:** the Win32 path compiles (cross-check clean)
  but executes only on Windows; the interactive host-binding smoke is the
  WS-46 interactive Windows desktop gate (spec 27), not this lane's claim.
  The deterministic selection/anchoring logic is fully covered by the 26
  platform-neutral tests here.
- Real Win32 calls are wrapped in explicit `unsafe {}`; callback context
  pointer lives only inside the synchronous EnumWindows call; buffers capped
  (title 1024, class 256, image 260); HWNDs opaque. Clippy `field_reassign`
  warning fixed via struct-update initializer (QC lessons from WS-17 applied).
