/**
 * Gesture registry + status mapping (WS-13, Master Spec 11/11A/11B).
 *
 * Late-bound by design: this lane knows the canonical gesture ids and the
 * status -> gesture mapping, but layer DOM (asset URLs, sprite coords)
 * arrives lazily through the WS-11 loader path. Until final art lands,
 * the layer is a transparent placeholder element — the lane is functional
 * today and the loader swaps the layer source without architectural
 * change (spec 11 "without architectural changes").
 *
 * E.1 proof-of-shape: layer-swap is the ONLY gesture mechanism. The
 * registry state machine allows exactly one active gesture at a time and
 * the driver is a pure mapping, testable without any DOM.
 *
 * @module
 */

import type { CandiceStatus } from '../../state/status.ts';
import {
  ANIMATION_KINDS,
  BOOT_GESTURES,
  GESTURE_IDS,
  GESTURE_TIMING,
} from './config.ts';
import type { AnimationKind, GestureId } from './config.ts';

/** A registered gesture layer (render-agnostic registry entry). */
export interface GestureLayer {
  /** Canonical gesture id (manifest key shape, Master Spec 11). */
  id: GestureId;
  /** The only animation kind allowed on gesture layers. */
  kind: AnimationKind;
  /** Hold display duration (ms) before the layer may swap out. */
  holdMs: number;
  /** Registry state (boot or lazy registration), not art identity. */
  registered?: boolean;
}

/** A gesture with no visual mapping (missing final art) is a placeholder. */
export interface GesturePlan {
  gesture: GestureId;
  layer: GestureLayer | null;
}

/** Pure status -> gesture mapping. Never throws; unknown => idle. */
export function gestureForStatus(status: CandiceStatus): GestureId {
  switch (status) {
    case 'listening':
      return 'listening';
    case 'thinking':
      return 'thinking';
    case 'speaking':
      return 'presenting';
    case 'idle':
      return 'welcome';
    default:
      return 'welcome';
  }
}

/**
 * Placeholder layer for a gesture whose final art is not registered yet.
 * Deliberately transparent: painting an opaque fallback would violate
 * spec 28 (no baked terminal/UI background) on light AND dark desktops.
 */
export function placeholderLayer(id: GestureId): GestureLayer {
  return {
    id,
    kind: 'layer-swap',
    holdMs: GESTURE_TIMING.blinkClosedMs, // no real hold before art lands
    registered: false,
  };
}

/**
 * Canonical registry: every id in the contract exists; boot gestures are
 * registered, the rest are placeholders until the loader path (WS-11)
 * registers the final layer. The "Affirmative celebration" gesture is
 * intentionally NOT in the auto-mapping — it fires from a real explicit
 * event (answer confirmation), never from status alone (never invented).
 */
export function createGestureRegistry(): {
  planFor(status: CandiceStatus): GesturePlan;
  register(layer: GestureLayer): boolean;
  reset(): void;
  known(): readonly GestureId[];
} {
  const layers = new Map<GestureId, GestureLayer>();
  for (const id of GESTURE_IDS) {
    layers.set(
      id,
      BOOT_GESTURES.includes(id)
        ? { ...placeholderLayer(id), registered: true }
        : placeholderLayer(id),
    );
  }

  return {
    planFor(status: CandiceStatus): GesturePlan {
      const gesture = gestureForStatus(status);
      const layer = layers.get(gesture) ?? null;
      return { gesture, layer };
    },
    register(layer: GestureLayer): boolean {
      if (!GESTURE_IDS.includes(layer.id)) return false;
      if (!ANIMATION_KINDS.includes(layer.kind)) return false;
      if (!Number.isFinite(layer.holdMs) || layer.holdMs < 0) return false;
      layers.set(layer.id, { ...layer, registered: true });
      return true;
    },
    reset(): void {
      for (const id of GESTURE_IDS) layers.set(id, placeholderLayer(id));
    },
    known(): readonly GestureId[] {
      return [...GESTURE_IDS];
    },
  };
}
