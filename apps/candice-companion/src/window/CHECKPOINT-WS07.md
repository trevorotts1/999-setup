# CHECKPOINT — WS-07 (transparent/frameless window behavior)

Builder: B-WR-011-WS-07 (opus/max) — first Candice production fan-out.
Worktree: `worktrees/wr001-bootstrap` @ `aa23ed9` (branch `candice/wr001-bootstrap`).
Date: 2026-08-21.

## Files created (all under owned glob `apps/candice-companion/src/window/**`)

Source:
- `src/window/config.ts` — canonical WS-07 declaration:
  `WINDOW_APPEARANCE = { transparent: true, decorations: false,
  alwaysOnTop: true, shadow: false, movable: true }`; `MAIN_WINDOW_LABEL =
  'main'` (lockstep with WS-06 `tauri.conf.json` window label and the WS-06
  shell capability surface); `WINDOW_CONTRACT_VERSION = 1`; event names
  `candice:window-ready` / `candice:window-unavailable`; ready class
  `candice-window-ready`; drag-region attribute + surface class;
  `PLATFORM_NOTES` (macOS `macOSPrivateApi` requirement, Windows WebView2
  transparency note).
- `src/window/style.ts` — no-baked-background style contract:
  `WINDOW_STYLE_TEXT` forces `html.candice-window-ready` and body
  background transparent (`!important`), with no hex/rgba/url background
  allowed (test-enforced); `applyWindowStyles()` idempotent injector.
- `src/window/behavior.ts` — `measureWindowAppearance` (probe + measured
  state; never throws), `applyWindowAppearance` (re-assert always-on-top),
  `readyWindowAppearance` (styles + ready class + event + measured state;
  wrong label degrades to unavailable), `assertNoBakedBackground` (live-DOM
  invariant), `markDragSurface` / `unmarkDragSurface`. All entries degrade
  to unavailable instead of throwing (spec 20).
- `src/window/dragging.ts` — frameless drag surface: `createDragSurface`
  attaches `data-tauri-drag-region="deep"` to the character stage, delegates
  to Tauri 2 OS dragging (no manual mouse math), blocks clickable children,
  null-window safe (text fallback), idempotent attach/detach.
- `src/window/index.ts` — public surface (types + functions re-exported).

Tests + docs:
- `src/window/__tests__/window.test.ts` — 13 tests: E.1 WS-07 appearance
  declaration (transparent + frameless + always-on-top + no shadow),
  measurement on healthy/broken/null windows, always-on-top re-assert,
  ready-path events, wrong-label drift guard, no-baked-background style
  invariant (no hex/rgba/url), drag surface attach/detach/idempotence,
  null-window fallback, cross-lane label lockstep.
- `src/window/__tests__/README.md` — what is proven here vs. owned by other
  lanes (WS-15 visual harness, WR-015/WR-016 platform lanes, WS-06 config
  file), run command.
- `src/window/CONTRACT.md` — stable API contract for consuming lanes.
- `src/window/CHECKPOINT-WS07.md` — this file.

## Evidence of verification

- `node --test apps/candice-companion/src/window/__tests__/window.test.ts`
  — 13/13 PASS (run on this worktree; see verification output).
- Source-level scan: the lane declares no hex/rgba/url backgrounds, never
  edits `tauri.conf.json` (9.3 within-run shared file), never touches
  `src/platform/**` (WR-015/WR-016 globs), never imports Tauri IPC
  statically (window object is injected), and contains no absolute
  developer paths (spec 28: "no generic runtime dependency contains
  developer-specific absolute paths").

## Cross-lane findings

```text
CROSS-LANE-FINDING
source workflow/lane: WR-011 WS-07 (window behavior)
affected unit: WR-011/WS-06 shell lane (apps/candice-companion/tauri.conf.json —
9.3 within-run shared file, shell lane applies final versions)
evidence: WS-07 acceptance (CHECKLIST E.1 WS-07) requires a transparent,
frameless, always-on-top window. tauri.conf.json app.windows[0] currently
declares only label/title/width/height/resizable/center/visible — none of
transparent, decorations:false, alwaysOnTop, or shadow:false. Verified in the
vendored Tauri 2.11.5 source: config transparent:true on macOS additionally
requires the tauri.macOSPrivateApi flag (tauri-utils config.rs serde rename
"macOSPrivateApi"; tauri-runtime-wry lib.rs only applies transparency under
cfg macos-private-api; the tauri Cargo.toml maps that config flag to the
cargo feature of the same name). Without it, macOS builds the window opaque
and the E.1 criterion fails on the reference platform.
recommended action: the WS-06 shell lane (single writer for the 9.3 config
file) should add to app.windows[0]: "transparent": true, "decorations": false,
"alwaysOnTop": true, "shadow": false, and set app."macOSPrivateApi": true (or
alias "macos-private-api"). Do NOT apply from this lane — config file is the
shell lane's within-run shared write.
```

```text
CROSS-LANE-FINDING
source workflow/lane: WR-011 WS-07 (window behavior)
affected unit: WR-011/WS-06 shell lane (apps/candice-companion/src-tauri/
capabilities/main.json — WS-06 root Tauri file)
evidence: this lane's runtime path (behavior.ts readyWindowAppearance) re-
asserts always-on-top through setAlwaysOnTop, and the drag surface forwards
startDragging; both are `core:window` commands. Verified in the vendored
tauri 2.11.5 build.rs PLUGINS table: all `core:window` SETTERS default to
false in the `core:default` permission set (set_always_on_top: false,
start_dragging: false), while getters used by measurement (is_visible,
is_decorated, is_always_on_top) default true. The current capability file
grants only "core:default", so setAlwaysOnTop and startDragging would be
denied by the ACL at runtime and the drag surface would silently fail.
recommended action: the WS-06 shell lane should add
"core:window:allow-set-always-on-top" and "core:window:allow-start-dragging"
to capabilities/main.json permissions (main-capability). Do NOT apply from
this lane (capability file is a WS-06 root Tauri file).
```

```text
CROSS-LANE-FINDING
source workflow/lane: WR-011 WS-07 (window behavior)
affected unit: WR-011/WS-06 shell lane (apps/candice-companion/src/styles.css —
WS-06 root-level app entry file)
evidence: styles.css body { background: var(--candice-surface) } paints an
opaque (0.92-alpha) surface over the whole window. WS-07's style contract
forces transparent with !important once the ready class is on <html>, so the
final window is transparent — but until the WS-07 ready path runs (a few
frames after first paint) the boot surface renders an opaque rounded
rectangle that reads as a baked UI background, and the WS-06 boot surface
(.boot-glow) is a solid disc. Spec 11/28: no baked terminal/UI background.
recommended action: optional polish for the WS-06 lane — make the boot
surface transparent-accent only (no solid fill) so no frame ever shows a
baked rectangle. Not a defect in the final state; severity low.
```

## Notes for the conductor

- No commit made (per builder instructions). Branch `candice/wr001-bootstrap`
  remains at `aa23ed9`; all files are working-tree additions under
  `apps/candice-companion/src/window/**`.
- No root release files, CONTROL/ carriers, CHANGELOG.md, README.md,
  VERSION, tags, .github/ touched. `tauri.conf.json` and
  `src-tauri/capabilities/main.json` NOT edited (9.3 within-run shared /
  WS-06 root files — findings filed above instead).
- The lane is dependency-free by design (node:test only) and typechecks
  under the app tsconfig when the toolchain is present.
