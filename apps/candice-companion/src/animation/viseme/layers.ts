/**
 * FIX-005 — registered mouth/eye layer contract (viseme lane).
 *
 * The build tool `assets/candice/layers/tools/build_layers.py` bakes the
 * seven canonical mouth/eye sources into base-space layers and writes
 * `assets/candice/layers/build/registration.json`. This module exposes
 * that record as data: fixed rects, per-state files, source/output
 * hashes. Placement tolerance is zero BY CONSTRUCTION — a state change
 * swaps the image inside a fixed rect; the rect never moves.
 *
 * The face-state registration precondition (registration.ts) is satisfied
 * by this record: registration was measured at build time from eye-pair
 * landmarks across all seven canonical frames and baked into the assets.
 * Loading this module does not flip the guard — the render lane must call
 * `recordRegistrationMeasured()` after it has loaded these layers.
 */

import registration from "../../../assets/candice/layers/build/registration.json" with { type: "json" };
import { stateForViseme } from "./registry.ts";
import type { VisemeId } from "./types.ts";

/** One fixed placement rect in base-canvas space. [x, y, x1, y1]. */
export type LayerRect = readonly [number, number, number, number];

/** Mouth states beyond the viseme set (smile expressions). */
export type MouthState = VisemeId | "smile-closed" | "smile-open";

/** Eye states. "half" and "closed" are derived from 09 (approval-required). */
export type EyeState = "open" | "half" | "closed";

/** Shape of the build record (registration.json). */
export interface LayerRegistration {
  baseFrame: string;
  baseCanvas: readonly [number, number];
  zOrder: readonly string[];
  mouthRect: LayerRect;
  eyeRect: LayerRect;
  transforms: Readonly<Record<string, number[][]>>;
  eyeBoxesBase: number[][];
  mouthStates: Readonly<Record<string, { source: string; file: string }>>;
  eyeStates: Readonly<Record<string, string>>;
  notes: string[];
}

const REG: LayerRegistration = registration;

/** Frozen view of the build record. */
export const LAYER_REGISTRATION: Readonly<LayerRegistration> = Object.freeze({
  ...REG,
  baseCanvas: Object.freeze([...REG.baseCanvas]),
  zOrder: Object.freeze([...REG.zOrder]),
  mouthRect: Object.freeze([...REG.mouthRect]),
  eyeRect: Object.freeze([...REG.eyeRect]),
  transforms: Object.freeze(REG.transforms),
  eyeBoxesBase: Object.freeze(REG.eyeBoxesBase.map((b) => Object.freeze([...b]))),
  mouthStates: Object.freeze({ ...REG.mouthStates }),
  eyeStates: Object.freeze({ ...REG.eyeStates }),
  notes: Object.freeze([...REG.notes]),
});

/**
 * Viseme → mouth layer file. Derived from the anchor registry's
 * `stateForViseme` (the measurement authority): the registry state's
 * canonical source number (03–08) selects the matching `mouthStates`
 * entry in the build record. A viseme whose registry state has no
 * matching mouth-state entry throws at module load — the two mappings
 * can never silently diverge.
 */
export const VISEME_LAYER_FILES: Readonly<Record<VisemeId, string>> = Object.freeze({
  closed: mouthFileForViseme("closed"),
  rest: mouthFileForViseme("rest"),
  mm: mouthFileForViseme("mm"),
  ai: mouthFileForViseme("ai"),
  ee: mouthFileForViseme("ee"),
  oh: mouthFileForViseme("oh"),
  wide: mouthFileForViseme("wide"),
});

/** Registry state → build-record mouth-state file, fail-loud on mismatch. */
function mouthFileForViseme(viseme: VisemeId): string {
  const state = stateForViseme(viseme);
  const sourceNum = state.sourceFile.split("-")[0];
  const entry = Object.values(REG.mouthStates).find((m) => m.source === sourceNum);
  if (!entry) {
    throw new Error(
      `viseme "${viseme}" resolves to registry state "${state.stateId}" ` +
        `(source ${state.sourceFile}) with no mouthStates entry in the build record`,
    );
  }
  return entry.file;
}

/** Mouth rect from the build record. */
export function mouthRect(): LayerRect {
  return LAYER_REGISTRATION.mouthRect;
}

/** Eye rect from the build record. */
export function eyeRect(): LayerRect {
  return LAYER_REGISTRATION.eyeRect;
}

/** Eye state → layer file (frozen data). */
export function eyeLayerFile(state: EyeState): string {
  return LAYER_REGISTRATION.eyeStates[state];
}

/** True when the layer's rect has not changed since the build record. */
export function assertRectUnchanged(rect: LayerRect, kind: "mouth" | "eye"): boolean {
  const expected = kind === "mouth" ? LAYER_REGISTRATION.mouthRect : LAYER_REGISTRATION.eyeRect;
  return (
    rect.length === 4 &&
    rect[0] === expected[0] &&
    rect[1] === expected[1] &&
    rect[2] === expected[2] &&
    rect[3] === expected[3]
  );
}
