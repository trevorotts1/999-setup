# candice-win32-bind — WS-26 Windows Win32 window discovery/binding

Candice Companion's Windows host-window binding crate (Master Spec section 17,
workstream WS-26). Owned glob:
`apps/candice-companion/src-tauri/binding/windows/**` (manifest 9.2 WR-016).

## What it does

Finds the **top-level host window** of the terminal that invoked Candice
(Windows Terminal, standalone PowerShell/pwsh, CMD/conhost) and computes the
companion's anchored placement. Rules (spec 17, binding):

1. **Bind to the top-level host window** — never assume the shell process
   owns the visible window. Windows Terminal tabs/panes mean one window hosts
   many sessions, so:
2. **Host window is a visual anchor ONLY.** Session identity is the WS-03
   bridge's authority. This crate's types carry no session field; every
   discovered window is born with `session_identity_known: false`.
3. **Windows Terminal is marked `multi-session`** — the WS-03 bridge refuses
   to route on a window that maps to multiple sessions (tab/pane switching can
   never cross-route Candice answers).
4. **No injection permits here.** No function in this crate returns a routing
   or injection authorization; injection enablement requires bridge session
   proof, which this crate never fabricates.
5. **Fallback is a movable floating companion**, never a stopped Claude
   session (spec 20). `NoneFound` verdicts tell the caller which fallback
   path to take.

## Host matrix

| Process image (owning window) | HostKind |
|---|---|
| `WindowsTerminal.exe` | `WindowsTerminal` (multi-session) |
| `powershell.exe` | `WindowsPowerShell` |
| `pwsh.exe` | `PowerShell7` |
| `cmd.exe` | `Cmd` |
| `conhost.exe` | `Conhost` (owner-walk resolves the real host) |
| any other | `OpenWindow` (floating-companion territory) |

## Layout

```
src/lib.rs      crate root; module wiring
src/model.rs    platform-neutral types: WindowId, Rect, HostKind, HostWindow,
                DiscoverVerdict, Anchor — #![forbid(unsafe_code)]
src/logic.rs    pure decision modules (discover + anchoring), safe code
src/logic/discover.rs   Win32WindowSource trait + discover_and_select
src/logic/anchoring.rs  side/gap placement + work-area clamping
src/win32/mod.rs        REAL Win32 backend (#[cfg(windows)] + feature "win32"):
                        EnumWindows, GetWindowTextW, GetClassNameW,
                        QueryFullProcessImageNameW, DWM extended frame bounds,
                        DWMWA_CLOAKED, IsIconic, GetDpiForWindow,
                        MonitorFromWindow/GetMonitorInfoW, GetConsoleWindow
src/tests.rs    26 acceptance tests (platform-neutral, run on any host)
```

The `win32` module is the ONLY unsafe code in the crate; the module header
documents its safety discipline (synchronous callback context, bounded
buffers, opaque HWNDs).

## Build/test

```sh
# Logic + tests on any host (no Windows SDK, offline-friendly):
cargo test
cargo clippy --all-targets

# Real Win32 backend compiles on Windows targets:
cargo check  --target x86_64-pc-windows-msvc --features win32
cargo clippy --all-targets --features win32 --target x86_64-pc-windows-msvc
```

Default features are EMPTY: `cargo test` downloads nothing. The `win32`
feature is additionally `#[cfg(windows)]`-gated so a non-Windows host can
never link user32/dwmapi accidentally.

## Integration contract (for fan-in)

- **Discovery**: call `discover_and_select(&Win32Backend::new())` -> a
  `DiscoverVerdict` (Found/NoneFound). Found carries `chosen`, full
  `candidates`, the selection `strategy` (provenance for logs), and
  `from_foreground`.
- **Enrichment**: attach WS-03 bridge session proof; `chosen.host_kind`
  tells the caller whether multi-session ambiguity rules apply. The crate
  itself never routes.
- **Anchoring**: `AnchorPlanner` computes the companion rect (side + gap,
  clamped to the monitor work area). Re-run on each host-window geometry
  change for follow-move/follow-resize behavior.
- **Fallback**: `NoneFound { reason }` -> movable floating companion
  (with the `reason` surfaced in a caption).
- **DPI**: `HostWindow::physical_rect()` converts logical DIPs to physical
  pixels via the window's DPI; the renderer should place the Tauri window
  in physical coordinates.
