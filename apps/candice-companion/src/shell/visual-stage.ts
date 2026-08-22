/**
 * Candice visual stage placeholder (WS-06 shell).
 *
 * The WS-06 shell reserves the visual stage container and the CSS class
 * contract the character lanes consume. It renders a clearly marked
 * development placeholder only (a neutral glow disc) — never the final
 * artwork, never a fake Candice.
 *
 * Final-art integration is WR-013's asset contract (spec 11): the 16
 * supplied RGBA PNGs bind here through `assets/candice/asset-manifest.json`
 * once that lane lands. Until then the placeholder proves the stage mounts
 * and the DOM contract is stable. Spec 0: do not redesign the architecture
 * when the artwork arrives — only bind the final assets into the prepared
 * asset contract.
 */

export const VISUAL_STAGE_ID = 'candice-stage';

export function mountVisualStage(root: HTMLElement): void {
  if (document.getElementById(VISUAL_STAGE_ID)) {
    return; // already mounted (HMR re-entry)
  }
  const stage = document.createElement('div');
  stage.id = VISUAL_STAGE_ID;
  stage.setAttribute('role', 'img');
  stage.setAttribute(
    'aria-label',
    'Candice companion character stage — final artwork pending',
  );
  stage.innerHTML =
    '<div class="candice-placeholder" data-placeholder="dev-art"></div>';
  root.append(stage);
}
