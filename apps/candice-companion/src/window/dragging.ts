/**
 * Candice window behavior — frameless drag surface (Master Spec 0E WS-07).
 *
 * A frameless window has no OS title bar, so the character surface itself
 * must be draggable. Tauri 2 handles this with the `data-tauri-drag-region`
 * attribute (bare value: only direct clicks on the marked element drag;
 * `deep`: whole subtree drags; clickable children block dragging unless
 * they carry the attribute themselves) — no manual mouse tracking, no
 * window-position math in this lane.
 *
 * Failures degrade: if the drag bridge is unreachable the window simply
 * cannot be dragged until the runtime recovers (spec 20 — Candice failure
 * never blocks Claude). The window object is optional at construction so
 * the plain-web boot path never imports Tauri IPC.
 */

import { DRAG_REGION_ATTRIBUTE, DRAG_SURFACE_CLASS } from './config.ts';
import { unmarkDragSurface } from './behavior.ts';

/** Minimal window surface needed for dragging. */
export interface DraggableWindowLike {
  startDragging(): Promise<void>;
}

export interface DragSurfaceController {
  /** Enable the drag surface on the given element. Idempotent. */
  attach(root: Element): void;
  /** Disable the drag surface. Idempotent. */
  detach(): void;
  /** True while a drag surface is attached. */
  readonly active: boolean;
  /** The currently attached element, if any. */
  readonly element: Element | null;
}

/**
 * Create a drag-surface controller for the frameless window. `win` may be
 * null (plain-web / text fallback): attach() then only marks the DOM, and
 * drag attempts no-op instead of importing Tauri IPC.
 */
export function createDragSurface(win: DraggableWindowLike | null): DragSurfaceController {
  let element: Element | null = null;

  async function beginDrag(): Promise<void> {
    if (win == null) return;
    try {
      await win.startDragging();
    } catch (err) {
      console.warn('[candice] window drag unavailable', err);
    }
  }

  /** Listeners are delegated on the document so re-mounts survive. The
   *  handler is a no-op in a headless run (no document) — the controller
   *  still tracks its element and degrades gracefully (spec 20). */
  function onPointerDown(e: PointerEvent): void {
    if (element == null) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (!element.contains(target)) return;
    if (!target.closest(`[${DRAG_REGION_ATTRIBUTE}]`)) return;
    // Clickable children (buttons, inputs, roles) block dragging — the
    // Tauri drag-region script enforces this itself; this handler only
    // mirrors the guard for the no-Tauri path.
    if (isClickable(target)) return;
    if (e.button !== 0) return;
    e.preventDefault();
    void beginDrag();
  }

  function detach(): void {
    if (typeof document !== 'undefined') {
      document.removeEventListener('pointerdown', onPointerDown, true);
    }
    if (element != null) unmarkDragSurface(element);
    element = null;
  }

  return {
    attach(root: Element): void {
      if (element === root) return;
      detach();
      root.setAttribute(DRAG_REGION_ATTRIBUTE, 'deep');
      root.classList.add(DRAG_SURFACE_CLASS);
      element = root;
      if (typeof document !== 'undefined') {
        document.addEventListener('pointerdown', onPointerDown, true);
      }
    },
    detach(): void {
      detach();
    },
    get active(): boolean {
      return element != null;
    },
    get element(): Element | null {
      return element;
    },
  };
}

const CLICKABLE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY']);
const INTERACTIVE_ROLES = new Set(['button', 'link', 'menuitem', 'tab', 'checkbox', 'radio', 'switch', 'option']);

function isClickable(el: Element): boolean {
  if (CLICKABLE_TAGS.has(el.tagName)) return true;
  if (el.hasAttribute('contenteditable') && el.getAttribute('contenteditable') !== 'false') return true;
  if (el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1') return true;
  const role = el.getAttribute('role');
  if (role != null && INTERACTIVE_ROLES.has(role)) return true;
  return false;
}
