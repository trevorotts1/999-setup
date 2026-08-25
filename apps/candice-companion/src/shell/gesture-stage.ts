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

/**
 * Build-time URL for EVERY operator-approved source, not just the idle.
 *
 * The idle alone had a static `?url` import, so the idle alone was emitted as
 * a bundled asset. Every other pose fell through to `loadImage`'s fallback,
 * `sourceDirectory + file` — i.e. `source/operator-approved/<file>.png`, a
 * path that exists in the repo and NOT inside the .app. In the packaged shell
 * those all 404 and fire the layer `error` listener, so binding the four poses
 * in the manifest could never have put them on screen by itself.
 *
 * `import.meta.glob` is resolved by Vite at build time, so each approved PNG
 * gets a real hashed asset URL. Keys are module paths; match on the trailing
 * `/<file>` so the manifest's `file` field stays the single source of truth.
 */
const BUNDLED_SOURCE_URLS = import.meta.glob<string>(
  '../../assets/candice/source/operator-approved/*.png',
  { eager: true, query: '?url', import: 'default' },
);

/**
 * The bundled URL for a manifest entry, or `undefined` to let the registry
 * apply its own fallback. Never throws: an unresolvable layer must degrade
 * through the existing `error` path, not break the mount (spec 20).
 */
function bundledUrlFor(entry: AssetEntry): string | undefined {
  const suffix = `/${entry.file}`;
  for (const [modulePath, url] of Object.entries(BUNDLED_SOURCE_URLS)) {
    if (modulePath.endsWith(suffix)) return url;
  }
  return undefined;
}
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
import { mountFaceStage } from './face-stage.ts';
import { createMouthRenderer } from '../animation/viseme/mouth-renderer.ts';
import type { MouthRenderer, VisemeSource } from '../animation/viseme/mouth-renderer.ts';

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
  /**
   * The live WS-12 scheduler (created in main.ts, fed real phoneme timings
   * by speech-timing.ts). Optional: without it the bust still mounts and
   * still blinks, the mouth simply rests closed. Tests and headless runs
   * omit it.
   */
  visemeScheduler?: VisemeSource;
}

/**
 * Mount the gesture stage: layers over canonical manifest entries, one
 * GestureDriver bound to the container, and a caption surface. Never
 * throws (spec 20); an unresolvable idle throws here on purpose so the
 * caller's boot catch turns it into the text fallback.
 */
export function mountGestureStage(options: MountGestureStageOptions): GestureStageHost {
  const { document, character, registry, reportShellError, visemeScheduler } = options;
  const driver = createGestureDriver();
  const layers: HTMLElement[] = [];
  const mountedGestures = new Set<GestureId>();
  /**
   * Gestures whose approved layer could not be decoded at runtime. Kept as
   * evidence rather than silently forgotten: the stage publishes the count so
   * a packaged run can be asked whether it is showing everything it bound.
   */
  const failedGestures = new Set<GestureId>();

  /**
   * Publish what is ACTUALLY on screen, not what the manifest bound.
   * A packaged run has no console, so this attribute is the only way to ask
   * whether a pose that is bound is also reachable.
   */
  function publishLayerEvidence(): void {
    character.dataset.candiceGestureLayers = String(mountedGestures.size);
    if (failedGestures.size > 0) {
      character.dataset.candiceGestureFailed = [...failedGestures].sort().join(',');
    } else {
      delete character.dataset.candiceGestureFailed;
    }
  }

  const mountLayer = (gesture: GestureId, entry: AssetEntry): HTMLElement => {
    // Every approved layer now rides a Vite-bundled URL, not just the idle.
    // The idle keeps its explicit static import as the guaranteed floor: if
    // the glob ever stops matching, the canonical idle must still resolve or
    // the shell has no character at all.
    const img = registry.loadImage(
      entry,
      bundledUrlFor(entry) ??
        (entry.id === CANONICAL_IDLE_ASSET_ID ? canonicalIdleUrl : undefined),
    );
    img.className = GESTURE_LAYER_CLASS;
    img.setAttribute('data-candice-gesture', gesture);
    img.setAttribute('data-candice-body', '');
    img.dataset.assetId = entry.id;
    img.dataset.assetSha256 = entry.sha256;
    img.alt = entry.semanticPose;
    img.decoding = 'async';
    img.addEventListener('error', () => {
      // ONLY the idle layer failing is a shell error.
      //
      // Every layer used to report, so one unreachable pose dropped the whole
      // companion to text mode — the approved idle would load perfectly and
      // then be thrown away because a DIFFERENT layer 404'd. That is the
      // opposite of ANIMATION-STATE-MAP rule 2, which says an unavailable
      // state degrades to the approved idle. A non-idle failure now does
      // exactly what an unbound pose already does: it leaves the set, so
      // `setStatus` falls back to the idle layer plus an honest caption.
      if (gesture === IDLE_GESTURE) {
        reportShellError?.();
        return;
      }
      mountedGestures.delete(gesture);
      failedGestures.add(gesture);
      publishLayerEvidence();
      img.remove();
      const index = layers.indexOf(img);
      if (index !== -1) layers.splice(index, 1);
      // The driver may be showing this layer right now; re-resolve so the
      // character is never left on a broken image.
      if (character.getAttribute('data-candice-gesture-active') === gesture) {
        setStatus(driver.status);
      }
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

  // Do not rely on CSS :has() for the actual visibility contract: the
  // desktop WebView may not support it at the app's deployment version.
  // This is set only after the approved idle layer mounted successfully.
  character.dataset.candiceGestureMounted = 'true';
  publishLayerEvidence();

  // The bust surface (FIX-005): base + mouth + eye at measured registration.
  // Mounted HERE rather than in the composition root because the container
  // the face needs is the same one the gesture driver is already bound to —
  // which is why blink and head drift reach it with no driver change at all.
  // Fails closed to an inert host, so a face that cannot mount never costs
  // the body pose.
  const faceStage = mountFaceStage({ document, character });

  // The WS-12 output stage. `visemeAt` is a PULL api: until something polls
  // it, the real phoneme timings speech-timing.ts already feeds in are never
  // read and the mouth cannot move however good those timings are. Owned
  // here so the surface and its renderer share one lifetime — `detach()`
  // cannot leave a renderer polling a destroyed face.
  const mouthRenderer: MouthRenderer | null =
    visemeScheduler === undefined
      ? null
      : createMouthRenderer({ scheduler: visemeScheduler, surface: faceStage });
  mouthRenderer?.start();

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
    // Forwarded FIRST, ahead of every early return below. `text-fallback`
    // returns before the driver line, and the bust must hide on that path
    // too. Framing ruling (c) — bust while speaking, body otherwise — is
    // face-stage.ts's decision to make, not this file's.
    faceStage.setStatus(status);
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
    get faceStage() {
      return faceStage;
    },
    setStatus,
    detach: () => {
      mouthRenderer?.stop();
      faceStage.destroy();
      driver.detach();
      delete character.dataset.candiceGestureMounted;
      showCaption('idle', '');
    },
  };
}
