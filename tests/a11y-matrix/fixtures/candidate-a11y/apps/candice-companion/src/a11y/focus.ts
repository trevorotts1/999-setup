/**
 * Focus and keyboard accessibility helpers (Master Spec 0E WS-14).
 *
 * Candice is a floating always-on-top companion used beside a live
 * terminal: every interactive element must be reachable by keyboard
 * (Tab order) and must expose its state to assistive tech (explicit
 * `aria-*` attributes and a live caption region — see the captions lane).
 *
 * Failure behavior (spec 20): missing document/window degrades to no-op,
 * never a throw.
 *
 * @module
 */

/** Guard: mark an element as focusable only by keyboard (never by click). */
export function setKeyboardOnlyFocusable(el: HTMLElement | null, on: boolean): void {
  if (el === null) return;
  const attr = 'tabindex';
  if (on) el.setAttribute(attr, '0');
  else el.removeAttribute(attr);
}

/** Guard: ensure the element carries an a11y name for screen readers. */
export function ensureAriaLabel(el: HTMLElement | null, label: string): void {
  if (el === null || label === '') return;
  if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', label);
}

/** Guard: keep the live region declaration only on the caption root. */
export function setLiveRegion(el: HTMLElement | null, polite: boolean): void {
  if (el === null) return;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', polite ? 'polite' : 'assertive');
}
