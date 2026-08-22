/**
 * Candice window behavior — public surface (Master Spec 0E WS-07).
 *
 * The window layer owns: transparent + frameless + always-on-top appearance
 * verification (E.1 WS-07), the no-baked-background style invariant, and
 * the frameless drag surface. It does NOT own: show/hide primitives
 * (WS-06 shell), positioning/anchoring (WR-015 macOS / WR-016 Windows
 * platform lanes), or the tauri.conf.json file itself (9.3 within-run
 * shared file — shell lane applies final versions).
 *
 * Consumers:
 * - WS-06 shell boot: calls readyWindowAppearance(win) once the window
 *   handle is available and consumes the measured appearance state.
 * - WR-009/WS-10 UI lanes: attach the drag surface to the character stage.
 * - WR-020 test lanes: consume the contract surface declared here.
 */

export {
  MAIN_WINDOW_LABEL,
  WINDOW_APPEARANCE,
  WINDOW_CONTRACT_VERSION,
  WINDOW_EVENTS,
  WINDOW_READY_CLASS,
  DRAG_REGION_ATTRIBUTE,
  DRAG_SURFACE_CLASS,
} from './config.ts';

export {
  measureWindowAppearance,
  applyWindowAppearance,
  readyWindowAppearance,
  assertNoBakedBackground,
  markDragSurface,
  unmarkDragSurface,
} from './behavior.ts';

export { createDragSurface } from './dragging.ts';
export { applyWindowStyles, WINDOW_STYLE_TEXT } from './style.ts';

export type {
  WindowAppearanceConfig,
  WindowAppearanceState,
  WindowLike,
} from './behavior.ts';
export type { DragSurfaceController, DraggableWindowLike } from './dragging.ts';
