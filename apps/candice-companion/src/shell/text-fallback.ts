/**
 * Candice text fallback surface (WS-06 shell).
 *
 * Master Spec 20: failure must never stop Claude. When the companion cannot
 * boot (webview error, bridge unavailable, shell error), the window shows a
 * plain text surface instead of hanging. The user can always return to
 * direct Claude input in the terminal; this surface never blocks the
 * session and never accepts interview answers.
 */

export function showTextFallback(root: HTMLElement | null, detail?: string): void {
  if (!root) return;
  root.replaceChildren();

  const card = document.createElement('div');
  card.className = 'fallback';
  card.setAttribute('role', 'status');
  card.setAttribute('aria-live', 'polite');

  const title = document.createElement('p');
  title.className = 'fallback-title';
  title.textContent = 'Candice companion unavailable';

  const hint = document.createElement('p');
  hint.className = 'fallback-hint';
  hint.textContent =
    'Continue in Claude text mode — your session is unaffected.';

  card.append(title, hint);
  if (detail) {
    const reason = document.createElement('p');
    reason.className = 'fallback-hint';
    reason.textContent = detail;
    card.append(reason);
  }
  root.append(card);
}
