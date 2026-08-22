# WS-07 contract — transparent/frameless window behavior

Stable surface other lanes may consume. Changes to these signatures are
breaking changes; propose them via CROSS-LANE-FINDING to the WR-012/WS-07
owner before shipping a replacement.

## Module: `src/window/index.ts`

### Constants

| Constant | Value | Meaning |
|---|---|---|
| `MAIN_WINDOW_LABEL` | `'main'` | Window label the shell declares in `tauri.conf.json`; the runtime window must carry this label for the layer to be "available". |
| `WINDOW_CONTRACT_VERSION` | `1` | Bump only on breaking surface changes. |
| `WINDOW_APPEARANCE` | `{transparent: true, decorations: false, alwaysOnTop: true, shadow: false, movable: true}` | The E.1 WS-07 declaration. |
| `WINDOW_EVENTS.ready` | `'candice:window-ready'` | Fired when the window layer is confirmed. |
| `WINDOW_EVENTS.unavailable` | `'candice:window-unavailable'` | Fired when the layer cannot be reached (text fallback, spec 20). |
| `WINDOW_READY_CLASS` | `'candice-window-ready'` | Class on `<html>` when the layer is available. |
| `DRAG_REGION_ATTRIBUTE` | `'data-tauri-drag-region'` | Tauri 2 drag-region attribute. |
| `DRAG_SURFACE_CLASS` | `'candice-drag-surface'` | Class on the marked drag element. |

### Types

- `WindowAppearanceConfig` — `{transparent, decorations, alwaysOnTop, shadow, movable}` booleans.
- `WindowAppearanceState` — `{contractVersion, declared, measured: {transparent, frameless, alwaysOnTop, visible}, windowAvailable}`.
- `WindowLike` — the minimal Tauri window surface consumed: `label`, `isVisible()`, `isAlwaysOnTop()`, `isDecorated()`, `setAlwaysOnTop(flag)`, `startDragging()`. WS-06 shell provides the real handle; tests provide fakes.
- `DragSurfaceController` — `{attach(el), detach(), active, element}`.
- `DraggableWindowLike` — `{startDragging(): Promise<void>}`.

### Functions

| Signature | Purpose |
|---|---|
| `measureWindowAppearance(win): Promise<WindowAppearanceState>` | Probe the window object; never throws; null/broken window -> `windowAvailable: false`. |
| `applyWindowAppearance(win): Promise<WindowAppearanceState>` | Re-assert always-on-top; returns measured state; never throws. |
| `readyWindowAppearance(win): Promise<WindowAppearanceState>` | Apply styles, flip ready class, emit ready/unavailable event, return measured state. Idempotent. Wrong label -> unavailable. |
| `assertNoBakedBackground(): boolean` | Live-DOM invariant: html background transparent AND the WS-07 style tag attached. |
| `markDragSurface(el)` / `unmarkDragSurface(el)` | Mark/unmark an element as the drag surface. |
| `createDragSurface(win): DragSurfaceController` | Frameless drag controller; null win allowed (text fallback). |
| `applyWindowStyles()` | Inject the no-background style text once (idempotent). |

## Runtime behavior contract

1. The webview never paints a root background: `WINDOW_STYLE_TEXT` forces
   `html.candice-window-ready, html.candice-window-ready body { background: transparent !important; }`.
   No hex/rgba/url background may exist in the style contract (test-enforced).
2. The window is always-on-top; `readyWindowAppearance` re-asserts it after
   creation so platform defaults cannot silently drop the flag.
3. The window is frameless; the character stage is the drag surface via
   `data-tauri-drag-region="deep"` (Tauri 2 handles OS dragging; no manual
   mouse math). Clickable children (buttons, inputs, roles) block dragging.
4. Failures degrade to `windowAvailable: false` + `candice:window-unavailable`
   — never a throw, never a stop of Claude (spec 20).
5. Positioning/anchoring is NOT this lane's concern (WR-015 macOS /
   WR-016 Windows). The appearance contract is cross-platform.

## Environment

- No env overrides. The lane reads only the window object handed to it and
  the DOM.
