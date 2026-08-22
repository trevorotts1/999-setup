/**
 * Candice window behavior — CSS contract for the transparent window
 * (Master Spec 0E WS-07, sections 10 / 11 / 28).
 *
 * The webview payload must NEVER paint a baked background. The acceptance
 * criterion (CHECKLIST E.1 WS-07) is "no baked terminal/UI background": the
 * only pixels the window owns are Candice's character alpha and the
 * floating UI layer — everything else stays transparent so the desktop
 * shows through (spec 11: "do not place a rectangular UI background behind
 * the character"; 11B: "preserve the source alpha; do not flatten onto
 * black").
 *
 * WS-06's `styles.css` intentionally leaves a translucent surface for the
 * boot surface; this lane flips the root to fully transparent and keeps the
 * character stage as the only visible content. The boot placeholder is
 * replaced by the real character (WR-013) and the controls UI (WR-009)
 * later; those lanes mount INSIDE this transparent root and inherit the
 * no-background contract.
 */

/** Style text injected once on window-ready. Kept in one place so tests can
 *  assert the contract without touching the live DOM. */
export const WINDOW_STYLE_TEXT = `
/* WS-07 transparent-window contract — no baked background. */
html.candice-window-ready,
html.candice-window-ready body {
  background: transparent !important;
}
html.candice-window-ready body {
  color-scheme: light dark;
}
`;

/** Class name applied to the drag surface (Tauri 2 drag-region attribute). */
export const DRAG_SURFACE_CLASS = 'candice-drag-surface' as const;

/** Mount the WS-07 style sheet once into the document head. Idempotent. */
export function applyWindowStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('candice-window-style')) return;
  const style = document.createElement('style');
  style.id = 'candice-window-style';
  style.textContent = WINDOW_STYLE_TEXT;
  document.head.append(style);
}
