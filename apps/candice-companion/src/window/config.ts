/**
 * Candice window behavior — canonical window configuration (Master Spec 0E
 * WS-07, sections 12 / 17 / 28).
 *
 * WS-07 owns the window BEHAVIOR contract: transparent + frameless +
 * always-on-top + no baked terminal/UI background, with a movable drag
 * surface on the frameless window. The shell lane (WS-06) owns the plain
 * show/hide primitives and the Tauri config file itself
 * (`tauri.conf.json` — a 9.3 within-run shared file); this lane consumes the
 * configuration through the runtime window object and never edits the config
 * file directly.
 *
 * The values here are the DECLARED defaults the runtime must observe, and
 * the exact names the shell config must carry for the acceptance criterion
 * (CHECKLIST E.1 WS-07). If `tauri.conf.json` and this module ever diverge,
 * the config file is the wire truth for the OS window and this lane is
 * repaired through CROSS-LANE-FINDING — never silently.
 *
 * Why these values:
 * - `transparent: true`  — Candice is a holographic companion composited
 *   over the user's desktop (spec 10/11B: preserve source alpha, never
 *   flatten onto black). No baked terminal/UI background (spec 11, 28:
 *   "Final character is transparent and has no baked-in terminal/UI").
 * - `decorations: false` — frameless: no OS chrome, no title bar. The
 *   character IS the window edge (spec 10: no rectangular UI background
 *   behind the character).
 * - `alwaysOnTop: true`  — the companion stays visible above the terminal
 *   it anchors beside while the user works (spec 17, 28: "transparent
 *   always-on-top window behavior").
 * - `shadow: false`      — macOS NSWindow `setHasShadow(false)`; on a
 *   transparent hologram the system drop shadow reads as a baked rectangle
 *   behind the character. Windows undecorated windows draw their own border
 *   handling via the drag surface (WS-07 dragging.ts).
 */

/** Exact window label the shell declares in `tauri.conf.json`. */
export const MAIN_WINDOW_LABEL = 'main' as const;

/** WS-07 contract version. Bump only on breaking surface changes (additive
 *  changes keep version 1 — the IPC/window surface is consumed by other
 *  lanes and by the bridge). */
export const WINDOW_CONTRACT_VERSION = 1 as const;

/** Declared window attributes the acceptance criterion requires. */
export interface WindowAppearanceConfig {
  /** OS-level transparent window (alpha composited over the desktop). */
  transparent: boolean;
  /** Frameless: no system decorations / title bar / traffic lights. */
  decorations: boolean;
  /** Always visible above other windows (floating companion level). */
  alwaysOnTop: boolean;
  /** No system drop shadow (hologram edge, not a baked rectangle). */
  shadow: boolean;
  /** Whether the user can drag the window from the character surface. */
  movable: boolean;
}

/** The canonical WS-07 declaration. Tests assert these exact values. */
export const WINDOW_APPEARANCE: WindowAppearanceConfig = {
  transparent: true,
  decorations: false,
  alwaysOnTop: true,
  shadow: false,
  movable: true,
} as const;

/** DOM attribute the drag surface uses (Tauri 2 drag-region contract). */
export const DRAG_REGION_ATTRIBUTE = 'data-tauri-drag-region' as const;

/** CSS class set on <html> when the window layer is available. */
export const WINDOW_READY_CLASS = 'candice-window-ready' as const;

/** CSS class marking the drag surface element (character stage). */
export const DRAG_SURFACE_CLASS = 'candice-drag-surface' as const;

/** Event names emitted by this lane on the window object. */
export const WINDOW_EVENTS = {
  /** Fired when the runtime window layer is confirmed available. */
  ready: 'candice:window-ready',
  /** Fired when the runtime window layer cannot be reached (text fallback). */
  unavailable: 'candice:window-unavailable',
} as const;

/**
 * Per-platform notes the runtime must honor (spec 17, 12): the values above
 * are cross-platform. Platform-specific anchoring/positioning lives in the
 * platform lanes (WR-015 `src/platform/macos/**`, WR-016
 * `src/platform/windows/**`) — WS-07 only guarantees the appearance
 * contract, never OS-specific geometry.
 */
export const PLATFORM_NOTES = [
  'macOS: transparent requires the tauri macOSPrivateApi config flag (Tauri 2 docs; App Store distribution is not a Candice requirement).',
  'Windows: WebView2 default background must stay transparent; the front-end never paints a root background (style.ts enforces it).',
] as const;
