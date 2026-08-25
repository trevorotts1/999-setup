/**
 * Face (bust) stage — the surface FIX-005's registered layers were built
 * for and never given.
 *
 * FIX-005 baked a base/mouth/eye layer set against a 1254x1254 bust
 * (`registration.json`, `baseFrame: 03-mouth-neutral-closed`) with fixed
 * rects and zero placement tolerance. Nothing ever mounted them:
 * `viseme/layers.ts` was imported only by its own barrel, and no code
 * created `[data-candice-eye]` or `[data-candice-head]`, so
 * `driver.ts:194/223` queried for motion targets that did not exist and did
 * nothing every frame. The gesture stage renders FULL-BODY poses
 * (941x1672 / 1024x1536), and the face cutouts cannot register onto those —
 * their head is roughly 150px wide against a 1254px bust. Operator ruling
 * (c): body for idle and pose changes, bust while speaking.
 *
 * Placement contract: the rects are expressed as PERCENTAGES of the base
 * square, so "zero tolerance by construction" survives being scaled to the
 * window. A state change swaps the image inside a fixed rect; the rect
 * never moves.
 *
 * Ownership: this module builds the surface and the element contract.
 * Viseme -> mouth rendering and blink behaviour inside it belong to the
 * animation lane, which drives `[data-candice-mouth]` and `[data-candice-eye]`.
 *
 * @module
 */

import layerManifest from '../../assets/candice/layers/build/manifest.json' with { type: 'json' };
import registration from '../../assets/candice/layers/build/registration.json' with { type: 'json' };
import { REDUCED_MOTION_CLASS } from '../animation/gesture/config.ts';
import type { CandiceStatus } from '../state/status.ts';

/** The only approval value that may ever reach the screen (FIX-002). */
const APPROVED = 'operator-approved';

/**
 * Vite-resolved URLs for the baked layers.
 *
 * Required, not stylistic: the manifest stores repo-relative paths, and a
 * repo path does not exist inside the .app. That is exactly why every
 * non-idle body pose 404'd until the same fix was applied to the gesture
 * stage. A raw manifest path here would fail the same way.
 *
 * Deliberately inside a function rather than at module scope.
 * `import.meta.glob` is a Vite compile-time construct with no runtime
 * equivalent, so evaluating it at import time makes this module unloadable
 * under plain node — which is precisely why the gesture stage has never had
 * a test. Callers may inject a map instead (see `MountFaceStageOptions`),
 * and then this is never called and the surface becomes testable.
 */
function defaultLayerUrls(): Record<string, string> {
  return import.meta.glob<string>('../../assets/candice/layers/assets/*.png', {
    eager: true,
    query: '?url',
    import: 'default',
  });
}

/** Container and layer selectors published to the animation lane. */
export const FACE_STAGE_ATTR = 'data-candice-face';
export const FACE_HEAD_ATTR = 'data-candice-head';
export const FACE_BASE_ATTR = 'data-candice-face-base';
export const FACE_MOUTH_ATTR = 'data-candice-mouth';
export const FACE_EYE_ATTR = 'data-candice-eye';

const FACE_STAGE_CLASS = 'candice-face';
const FACE_LAYER_CLASS = 'candice-face-layer';
const FACE_ACTIVE_CLASS = 'candice-face-active';
const FACE_STYLE_ID = 'candice-face-stage-style';

/** The only status that shows the bust; everything else holds the body. */
const FACE_STATUS: CandiceStatus = 'speaking';

/** Minimal document surface consumed; the real `document` satisfies it. */
export interface FaceStageDocumentLike {
  createElement(tagName: string): HTMLElement;
  getElementById(elementId: string): HTMLElement | null;
  head?: { appendChild(node: unknown): unknown } | null;
}

export interface MountFaceStageOptions {
  document: FaceStageDocumentLike;
  /** The layer container that also holds the gesture layers. */
  character: HTMLElement;
  /** Called when a face layer image fails to load. */
  reportLayerError?: (state: string) => void;
  /**
   * Override the bundled-URL map. Production omits it and gets the Vite
   * glob; tests inject so the module can load outside a Vite build.
   */
  layerUrls?: Record<string, string>;
}

export interface FaceStageHost {
  /** Show the bust for `speaking`, hold the body otherwise. */
  setStatus(status: CandiceStatus): void;
  /** Swap the mouth cutout. Unknown states are ignored (spec 20). */
  setMouthState(state: string): void;
  /**
   * Swap the eye cutout. Unknown states are ignored (spec 20), and states
   * whose art is not `operator-approved` are REFUSED.
   *
   * ⚠️ BLINK MUST NOT USE THIS. Blink is a `scaleY` transform applied by the
   * gesture driver to the approved `eye/open` cutout — a spec-10 transform
   * that needs no other art. Converting it to a swap through `half` and
   * `closed` will look like the obvious improvement, and it is not: both of
   * those frames are `synthesized: true, approval: pending-operator`, so the
   * gate below will refuse them and the blink will silently stop closing.
   * Only convert if Trevor approves those two frames.
   */
  setEyeState(state: string): void;
  /** True while the bust is the visible surface. */
  readonly visible: boolean;
  /** The mounted container, or null when the DOM was unusable. */
  readonly element: HTMLElement | null;
  destroy(): void;
}

type RawRegistration = {
  baseCanvas: number[];
  mouthRect: number[];
  eyeRect: number[];
  mouthStates: Record<string, { source: string; file: string }>;
  eyeStates: Record<string, string>;
};

const REG = registration as RawRegistration;

type LayerRecord = { file: string; approval?: string; synthesized?: boolean };

/**
 * Approval index, file basename -> approval value, from the build manifest.
 *
 * The glob at `defaultLayerUrls` deliberately supplies a URL for EVERY baked
 * layer, including the two that are not approved:
 *
 *   eye-half.png    synthesized: true   approval: pending-operator
 *   eye-closed.png  synthesized: true   approval: pending-operator
 *
 * and `registration.json.eyeStates` maps `half` and `closed` straight to
 * them. A URL therefore proves a file was BUNDLED, never that the operator
 * approved it. The manifest is the approval authority; the glob is only a
 * URL source. Without this index, `setEyeState('half')` would silently mount
 * art nobody approved — which is the exact class of failure the FIX-002 line
 * exists to prevent, and it would not announce itself.
 */
const APPROVAL_BY_FILE: ReadonlyMap<string, string> = new Map(
  ((layerManifest as { layers?: LayerRecord[] }).layers ?? []).map((l) => [
    (l.file ?? '').split('/').pop() ?? '',
    l.approval ?? '',
  ]),
);

/**
 * Whether a build-record file may be mounted.
 *
 * Fails CLOSED: a file absent from the manifest has unproven provenance and
 * is refused exactly like an explicitly pending one.
 */
function isApproved(file: string): boolean {
  return APPROVAL_BY_FILE.get(file.split('/').pop() ?? '') === APPROVED;
}

/** Resolve a build-record path (`assets/eye-open.png`) to a bundled URL. */
function layerUrl(urls: Record<string, string>, file: string): string | undefined {
  const suffix = `/${file.split('/').pop() ?? file}`;
  for (const [modulePath, url] of Object.entries(urls)) {
    if (modulePath.endsWith(suffix)) return url;
  }
  return undefined;
}

/** A rect as percentages of the base canvas, so scaling cannot drift it. */
function rectStyle(rect: number[]): string {
  const [w, h] = REG.baseCanvas;
  const [x0, y0, x1, y1] = rect as [number, number, number, number];
  const pct = (v: number, total: number): string => `${((v / total) * 100).toFixed(4)}%`;
  return [
    `left:${pct(x0, w!)}`,
    `top:${pct(y0, h!)}`,
    `width:${pct(x1 - x0, w!)}`,
    `height:${pct(y1 - y0, h!)}`,
  ].join(';');
}

function injectStyle(doc: FaceStageDocumentLike): void {
  if (doc.getElementById(FACE_STYLE_ID) !== null) return;
  const style = doc.createElement('style');
  style.setAttribute('id', FACE_STYLE_ID);
  // Spec 10: opacity is the only transition primitive. No zoom, no scale,
  // no push-in — one 180ms cross-fade, matching .candice-gesture-layer.
  style.textContent = `
.${FACE_STAGE_CLASS} {
  position: absolute;
  inset: 0;
  margin: auto;
  aspect-ratio: 1 / 1;
  max-width: min(100%, 520px);
  max-height: 100%;
  opacity: 0;
  pointer-events: none;
  transition: opacity 180ms ease-out;
}
.${FACE_STAGE_CLASS}.${FACE_ACTIVE_CLASS} { opacity: 1; }
.${FACE_STAGE_CLASS}[hidden] { display: none; }
.${FACE_STAGE_CLASS} [${FACE_HEAD_ATTR}] {
  position: absolute;
  inset: 0;
}
.${FACE_LAYER_CLASS} {
  position: absolute;
  display: block;
  filter: drop-shadow(0 0 22px rgba(124, 92, 255, 0.42));
}
.${FACE_LAYER_CLASS}[${FACE_BASE_ATTR}] { inset: 0; width: 100%; height: 100%; }
/* Mouth and eye carry their registered rects inline; only the image
   inside them ever changes. The eye squashes from its own centre so a
   scaleY blink closes the lid rather than sliding it. */
.${FACE_LAYER_CLASS}[${FACE_MOUTH_ATTR}],
.${FACE_LAYER_CLASS}[${FACE_EYE_ATTR}] { filter: none; }
.${FACE_LAYER_CLASS}[${FACE_EYE_ATTR}] { transform-origin: 50% 50%; }
`;
  doc.head?.appendChild(style);
}

/**
 * Mount the bust surface into the character container.
 *
 * Mounted alongside the gesture layers on purpose: the gesture driver binds
 * to that container and queries it for `[data-candice-eye]` and
 * `[data-candice-head]`, so mounting here connects the blink and head-drift
 * loops that have been running against nothing.
 *
 * Never throws (spec 20). An unusable DOM yields an inert host and the body
 * pose simply keeps rendering.
 */
export function mountFaceStage(options: MountFaceStageOptions): FaceStageHost {
  const inert: FaceStageHost = {
    setStatus() {},
    setMouthState() {},
    setEyeState() {},
    get visible() {
      return false;
    },
    element: null,
    destroy() {},
  };

  const doc = options.document;
  const character = options.character;
  if (doc == null || character == null) return inert;

  let root: HTMLElement | null = null;
  let mouth: HTMLElement | null = null;
  let eye: HTMLElement | null = null;
  let shown = false;
  let destroyed = false;

  const urls = options.layerUrls ?? defaultLayerUrls();
  const baseUrl = layerUrl(urls, 'base-neutral.png');
  // Fail closed: without the approved base there is no bust to show, and a
  // mouth floating over the body pose would be worse than no face at all.
  if (baseUrl === undefined) return inert;

  try {
    injectStyle(doc);

    root = doc.createElement('div');
    root.className = FACE_STAGE_CLASS;
    root.setAttribute(FACE_STAGE_ATTR, '');
    root.setAttribute('aria-hidden', 'true');
    // Stays in the tree from mount onward, resting at opacity 0. `hidden`
    // would remove it from layout and defeat the cross-fade on first show.
    root.hidden = false;

    const head = doc.createElement('div');
    head.setAttribute(FACE_HEAD_ATTR, '');

    const base = doc.createElement('img') as HTMLImageElement;
    base.className = FACE_LAYER_CLASS;
    base.setAttribute(FACE_BASE_ATTR, '');
    base.src = baseUrl;
    base.alt = '';
    base.decoding = 'async';
    head.appendChild(base);

    // zOrder from the build record is [base, mouth, eye]; append order is
    // the paint order, so the eye must be last.
    mouth = doc.createElement('img');
    mouth.className = FACE_LAYER_CLASS;
    mouth.setAttribute(FACE_MOUTH_ATTR, '');
    mouth.setAttribute('style', rectStyle(REG.mouthRect));
    (mouth as HTMLImageElement).alt = '';
    head.appendChild(mouth);

    eye = doc.createElement('img');
    eye.className = FACE_LAYER_CLASS;
    eye.setAttribute(FACE_EYE_ATTR, '');
    eye.setAttribute('style', rectStyle(REG.eyeRect));
    (eye as HTMLImageElement).alt = '';
    head.appendChild(eye);

    root.appendChild(head);
    character.appendChild(root);

    setMouthState('closed');
    setEyeState('open');
  } catch {
    return inert;
  }

  function swap(el: HTMLElement | null, file: string | undefined, state: string): void {
    if (el === null || file === undefined) return;
    // Approval is checked BEFORE the URL, because a URL only proves the file
    // was bundled. Refusing leaves the last approved image up rather than
    // blanking her, which keeps an unapproved state visually inert instead
    // of turning it into a missing-face defect.
    if (!isApproved(file)) {
      options.reportLayerError?.(`${state}:not-operator-approved`);
      return;
    }
    const url = layerUrl(urls, file);
    if (url === undefined) {
      options.reportLayerError?.(state);
      return;
    }
    (el as HTMLImageElement).src = url;
  }

  function setMouthState(state: string): void {
    if (destroyed) return;
    swap(mouth, REG.mouthStates?.[state]?.file, `mouth:${state}`);
  }

  function setEyeState(state: string): void {
    if (destroyed) return;
    swap(eye, REG.eyeStates?.[state], `eye:${state}`);
  }

  function reducedMotion(): boolean {
    const docEl = (character.ownerDocument as Document | null)?.documentElement;
    return docEl?.classList?.contains(REDUCED_MOTION_CLASS) === true;
  }

  return {
    setStatus(status: CandiceStatus): void {
      if (destroyed || root === null) return;
      // Under reduced motion / animation-off the bust never takes over:
      // the body pose is held, per the operator constraint. This reads the
      // class the a11y runtime owns; it never writes it.
      const want = status === FACE_STATUS && !reducedMotion();
      if (want === shown) return;
      shown = want;
      // The class alone carries the fade. `hidden` is NOT toggled here:
      // flipping `display` and `opacity` in the same frame gives the browser
      // no start value to animate from, so the cross-fade would be skipped
      // and the bust would pop. The container rests at opacity 0 with
      // `pointer-events: none`, so leaving it in the tree costs no input and
      // shows nothing.
      if (want) {
        root.classList.add(FACE_ACTIVE_CLASS);
      } else {
        root.classList.remove(FACE_ACTIVE_CLASS);
      }
    },
    setMouthState,
    setEyeState,
    get visible() {
      return shown;
    },
    element: root,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      shown = false;
      root?.remove?.();
      root = null;
      mouth = null;
      eye = null;
    },
  };
}
