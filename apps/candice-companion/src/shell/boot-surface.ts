/**
 * Boot-surface lifecycle helpers.
 *
 * The boot surface exists only until a real visual stage is mounted. Keeping
 * it afterwards competes with the hologram for the fixed companion viewport.
 */
export function dismissBootSurface(root: HTMLElement): void {
  root.querySelector<HTMLElement>('.boot')?.remove();
}
