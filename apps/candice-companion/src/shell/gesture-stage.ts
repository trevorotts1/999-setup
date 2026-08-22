/**
 * Gesture stage host (FIX-016).
 *
 * Mounts one animation host — the WS-13 GestureDriver — over a
 * transparent layer container, and binds it to the canonical state
 * machine (WS-08) so every real status transition updates the visible
 * state. The driver never changes status; this host never invents one.
 *
 * Approved-art rule (FIX-003 gate + ANIMATION-STATE-MAP rule 2):
 *  - A gesture layer mounts only when the asset manifest carries an
 *    operator-approved `body/*` entry for the gesture's canonical state
 *    key (GESTURE_STATE_KEYS). The welcome slot is bound to the
 *    canonical idle (`body/idle-standing`), so the approved idle layer
 *    is always present.
 *  - A status whose gesture has no approved layer falls back to the
 *    approved idle layer plus an explicit caption carrying the real
 *    state label. Placeholder art is never mounted and an unapproved or
 *    lookalike pose is never substituted.
 *  - When FIX-003 approves second-batch poses and records them under
 *    these same keys in asset-manifest.json stateMap, this host binds
 *    them without architectural change.
 *
 * Mouth motion (viseme) and registered face/eye layers are owned by the
 * WS-12/FIX-005 lanes; this lane drives body-layer swapping, breathing,
 * and glow only.
 *
 * @module
 */

import type { AssetEntry, AssetRegistry } from '../../assets/candice/loader.ts';
import canonicalIdleUrl from '../../assets/candice/source/operator-approved/01-fullbody-idle.png?url';
import {
  GESTURE_ACTIVE_CLASS,
  GESTURE_IDS,
  GESTURE_INACTIVE_CLASS,
  GLOW_STAGE_ATTR,
  createGestureDriver,
  gestureForStatus,
} from '../animation/gesture/index.ts';
import type { GestureDriver, GestureId } from '../animation/gesture/index.ts';
import { CANDICE_STATUS_LABELS } from '../state/status.ts';
import type { CandiceStatus } from '../state/status.ts';
import {
  CANONICAL_IDLE_ASSET_ID,
  IDLE_GESTURE,
  resolveCanonicalIdle,
  resolveGestureEntry,
  type GestureStageHost,
} from './candice-composition.ts';

/** Minimal document surface consumed; the real `document` satisfies it. */
export interface GestureStageDocumentLike {
  createElement(tagName: string): HTMLElement;
  getElementById(elementId: string): HTMLElement | null;
}

/** Layer-container class shared with index.html and styles.css. */
export const GESTURE_CHARACTER_CLASS = 'candice-character';

/** Caption surface id (explicit non-character state signal). */
export const GESTURE_CAPTION_ID = 'candice-state-caption';

/** Class + attribute applied to every mounted gesture layer image. */
const GESTURE_LAYER_CLASS = 'candice-gesture-layer';

export interface MountGestureStageOptions {
  document: GestureStageDocumentLike;
  /** The layer container carrying `data-candice-gesture-stage`. */
  character: HTMLElement;
  registry: AssetRegistry;
  /** Called when a layer image fails to load (shell-error path). */
  reportShellError?: () => void;
}

/**
 * Mount the gesture stage: layers over canonical manifest entries, one
 * GestureDriver bound to the container, and a caption surface. Never
 * throws (spec 20); an unresolvable idle throws here on purpose so the
 * caller's boot catch turns it into the text fallback.
 */
export function mountGestureStage(options: MountGestureStageOptions): GestureStageHost {
  const { document, character, registry, reportShellError } = options;
  const driver = createGestureDriver();
  const layers: HTMLElement[] = [];
  const mountedGestures = new Set<GestureId>();

  const mountLayer = (gesture: GestureId, entry: AssetEntry): HTMLElement => {
    // The canonical idle rides a Vite-bundled URL (the only source URL
    // the packaged shell can resolve); FIX-003-bound layers will arrive
    // through the same manifest-backed loader path.
    const img = registry.loadImage(
      entry,
      entry.id === CANONICAL_IDLE_ASSET_ID ? canonicalIdleUrl : undefined,
    );
    img.className = GESTURE_LAYER_CLASS;
    img.setAttribute('data-candice-gesture', gesture);
    img.setAttribute('data-candice-body', '');
    img.dataset.assetId = entry.id;
    img.dataset.assetSha256 = entry.sha256;
    img.alt = entry.semanticPose;
    img.decoding = 'async';
    img.addEventListener('error', () => {
      reportShellError?.();
    });
    character.append(img);
    layers.push(img);
    mountedGestures.add(gesture);
    return img;
  };

  // The idle layer is canonical and always mounts first (fail-closed:
  // resolveCanonicalIdle throws when the manifest cannot prove the
  // approved idle, and the boot catch turns that into text fallback).
  mountLayer(IDLE_GESTURE, resolveCanonicalIdle(registry));

  // Remaining gesture ids bind only to canonical manifest layers.
  for (const gesture of GESTURE_IDS) {
    if (gesture === IDLE_GESTURE) continue;
    const entry = resolveGestureEntry(registry, gesture);
    if (entry) mountLayer(gesture, entry);
  }

  // Register every mounted layer with the driver; a gesture with no
  // canonical layer is never registered and never gets placeholder art.
  for (const gesture of mountedGestures) {
    driver.registerLayer({ id: gesture, kind: 'layer-swap', holdMs: 0 });
  }

  const glow = document.createElement('div');
  glow.setAttribute(GLOW_STAGE_ATTR, '');
  glow.setAttribute('aria-hidden', 'true');
  glow.style.position = 'absolute';
  glow.style.inset = '0';
  glow.style.pointerEvents = 'none';
  glow.style.opacity = '0';
  character.append(glow);

  const caption = document.createElement('p');
  caption.id = GESTURE_CAPTION_ID;
  caption.className = 'candice-state-caption';
  caption.setAttribute('role', 'status');
  caption.setAttribute('aria-live', 'polite');
  caption.hidden = true;
  (character.parentElement ?? character).append(caption);

  const showCaption = (status: CandiceStatus, text: string): void => {
    caption.textContent = text;
    caption.hidden = text.length === 0;
    if (!caption.hidden) caption.dataset.status = status;
  };

  const activateIdleFallback = (): void => {
    for (const layer of layers) {
      const isIdle = layer.getAttribute('data-candice-gesture') === IDLE_GESTURE;
      layer.classList.toggle(GESTURE_ACTIVE_CLASS, isIdle);
      layer.classList.toggle(GESTURE_INACTIVE_CLASS, !isIdle);
    }
    character.setAttribute('data-candice-gesture-active', IDLE_GESTURE);
  };

  function setStatus(status: CandiceStatus): void {
    character.dataset.candiceState = status;
    if (status === 'text-fallback') {
      driver.detach();
      showCaption(status, '');
      return;
    }
    const gesture = gestureForStatus(status);
    // The driver always receives the real status so glow intensity and
    // status attributes stay truthful (speaking/listening/processing).
    driver.setStatus(status);
    const dedicated = gesture !== IDLE_GESTURE && mountedGestures.has(gesture);
    if (dedicated) {
      showCaption(status, '');
      return;
    }
    // Unresolved state: approved idle layer + explicit caption. Idle and
    // compact are idle-equivalent poses and stay uncaptioned.
    activateIdleFallback();
    showCaption(
      status,
      status === 'idle' || status === 'compact' ? '' : CANDICE_STATUS_LABELS[status],
    );
  }

  driver.attach(character);
  setStatus('idle');

  return {
    get driver() {
      return driver;
    },
    setStatus,
    detach: () => {
      driver.detach();
      showCaption('idle', '');
    },
  };
}
