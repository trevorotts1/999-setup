/**
 * Candice visual stage (FIX-006).
 *
 * The stage mounts the canonical, operator-approved standing idle image
 * through AssetRegistry. It is visual-only: no data attribute, caption, or
 * state here asserts that a backend, session bridge, microphone, or model is
 * ready. Those claims belong to their respective integration lanes.
 */

import { AssetRegistry } from '../../assets/candice/loader.ts';
import canonicalIdleUrl from '../../assets/candice/source/operator-approved/01-fullbody-idle.png?url';
import { resolveCanonicalIdle } from './candice-composition.ts';

export const VISUAL_STAGE_ID = 'candice-stage';

/** Mount the browser visual composition. Safe as a no-op outside a DOM. */
export function mountVisualStage(root: HTMLElement): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(VISUAL_STAGE_ID)) {
    return; // already mounted (HMR re-entry)
  }

  const registry = AssetRegistry.create();
  const entry = resolveCanonicalIdle(registry);
  const stage = document.createElement('div');
  stage.id = VISUAL_STAGE_ID;
  stage.dataset.assetId = entry.id;
  stage.dataset.assetSha256 = entry.sha256;

  const image = registry.loadImage(entry, canonicalIdleUrl);
  image.className = 'candice-character-image';
  image.alt = 'Candice holographic assistant, standing idle';
  image.decoding = 'async';
  image.addEventListener('error', () => {
    // An unavailable visual is a shell failure, not a reason to invent a
    // substitute character. The main shell turns this into text fallback.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('candice:shell-error'));
    }
  });
  stage.append(image);
  root.append(stage);
}
