/**
 * Browser-safe Candice visual composition contract.
 *
 * This is deliberately limited to the visual root.  It proves which
 * operator-approved artwork the shell may mount; it does not claim that a
 * Claude/session/native bridge is connected or ready.
 */

import {
  AssetManifestError,
  AssetRegistry,
  type AssetEntry,
} from '../../assets/candice/loader.ts';

/** The one canonical image that the initial composition is permitted to use. */
export const CANONICAL_IDLE_ASSET_ID = '01-fullbody-idle' as const;

/**
 * Resolve the initial, standing Candice image from the canonical registry.
 * Keeping this check at the composition boundary prevents a caller from
 * silently substituting experimental KIE material or an unapproved pose.
 */
export function resolveCanonicalIdle(
  registry: Pick<AssetRegistry, 'resolve'> = AssetRegistry.create(),
): AssetEntry {
  const entry = registry.resolve('body', 'idle-standing');
  if (
    entry.id !== CANONICAL_IDLE_ASSET_ID ||
    entry.approval !== 'operator-approved' ||
    entry.role !== 'body/idle-standing'
  ) {
    throw new AssetManifestError(
      'canonical idle composition must resolve the approved full-body idle asset',
    );
  }
  return entry;
}
