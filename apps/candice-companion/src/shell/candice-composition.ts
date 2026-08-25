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
import type { GestureDriver, GestureId } from '../animation/gesture/index.ts';
import type { CandiceStateMachine } from '../state/machine.ts';
import type { CandiceStatus } from '../state/status.ts';
import type { FaceStageHost } from './face-stage.ts';

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

/**
 * FIX-016 canonical gesture -> manifest stateMap binding contract.
 *
 * The welcome slot deliberately resolves `body/idle-standing` (the
 * operator-approved idle) and not `body/welcome-wave`: the machine has no
 * greeting status yet, and an unmapped status must degrade to the approved
 * idle (ANIMATION-STATE-MAP rule 2), never to a wave that would read as a
 * greeting. FIX-003 records second-batch poses under the remaining keys;
 * this table is the binding that must not be renamed without a manifest
 * change on the other side.
 */
export const GESTURE_STATE_KEYS: Readonly<
  Record<GestureId, { group: string; key: string }>
> = {
  welcome: { group: 'body', key: 'idle-standing' },
  presenting: { group: 'body', key: 'presenting-pose' },
  listening: { group: 'body', key: 'listening-pose' },
  thinking: { group: 'body', key: 'thinking-pose' },
  affirmative: { group: 'body', key: 'affirmative-pose' },
};

/** The gesture slot that carries the approved idle fallback layer. */
export const IDLE_GESTURE: GestureId = 'welcome';

/**
 * Resolve a gesture's canonical, operator-approved body layer.
 * Returns null (never throws) when the manifest has no binding for the
 * gesture's state key, the entry is not operator-approved, or the role is
 * not a full-body layer — all of which degrade to the idle fallback.
 */
export function resolveGestureEntry(
  registry: AssetRegistry,
  gesture: GestureId,
): AssetEntry | null {
  const binding = GESTURE_STATE_KEYS[gesture];
  let entry: AssetEntry;
  try {
    entry = registry.resolve(binding.group, binding.key);
  } catch {
    return null; // no canonical binding yet (FIX-003 approval pending)
  }
  if (entry.approval !== 'operator-approved') return null;
  if (!entry.role.startsWith('body/')) return null;
  return entry;
}

/** Host surface the gesture stage exposes to the composition root. */
export interface GestureStageHost {
  /** Apply a machine status. Idempotent; null-DOM safe. */
  setStatus(status: CandiceStatus): void;
  /** Detach all loops and DOM references. Idempotent. */
  detach(): void;
  /** The mounted WS-13 driver (glow/breathing/layer-swap owner). */
  readonly driver: GestureDriver;
  /**
   * The bust surface (FIX-005 mouth/eye targets). Always present: the face
   * stage returns an inert host when it cannot mount, so callers never have
   * to null-check a surface that failed closed.
   */
  readonly faceStage: FaceStageHost;
}

/**
 * Bind the mounted gesture stage to the machine. Every real transition
 * updates the visible state; ignored/no-op transitions never repaint.
 * Returns an unbind that restores the original transition method.
 */
export function bindStatusFlow(
  machine: CandiceStateMachine,
  host: GestureStageHost,
): () => void {
  const original = machine.transition.bind(machine);
  machine.transition = (event) => {
    const result = original(event);
    if (result) host.setStatus(result.status);
    return result;
  };
  host.setStatus(machine.getState().status);
  return () => {
    machine.transition = original;
  };
}
