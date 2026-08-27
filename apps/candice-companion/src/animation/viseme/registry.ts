/**
 * FIX-005 — layer anchor registry (runtime side).
 *
 * The data file `layer-anchor-registry.json` lives under
 * `assets/candice/layers/` (this lane's registered layer data). This module
 * is the runtime surface: zero dependencies, fail-loud validation, and a
 * hard guarantee that every registered state maps to a canonical
 * operator-original hash.
 *
 * The registry carries per-state measurement facts, not pixels: anchor
 * (opaque-subject top-left, normalized to the frame) and required scale
 * that pins the subject to the reference geometry
 * (`mouth-neutral-closed`, source 03). Renderers apply layers at the
 * reference geometry using these numbers; drift beyond the recorded
 * `maxDriftX/maxDriftY` bounds is a defect, not an art decision.
 *
 * Measurement tool (regeneration): `python3
 * assets/candice/layers/tools/measure-anchors.py <assetsCandiceRoot>
 * assets/candice/layers/layer-anchor-registry.json`.
 */

import type { VisemeId } from "./types.ts";

import registryJson from "../../../assets/candice/layers/layer-anchor-registry.json" with { type: "json" };

/** One registered mouth/eye layer state. */
export interface LayerAnchorState {
  stateId: string;
  group: "mouth" | "eye";
  phonemes: string[];
  sourceFile: string;
  sha256: string;
  frameWidth: number;
  frameHeight: number;
  /** Opaque-subject top-left X, normalized to the frame. */
  anchorX: number;
  /** Opaque-subject top-left Y, normalized to the frame. */
  anchorY: number;
  /** Scale vs the reference subject extents that pins this state. */
  requiredScaleX: number;
  requiredScaleY: number;
  /** Worst post-alignment residual drift, normalized to reference extents. */
  maxDriftX: number;
  maxDriftY: number;
}

/** Shape of `layer-anchor-registry.json`. */
export interface LayerAnchorRegistry {
  schemaVersion: number;
  authority: string;
  generatedAt: string;
  measuredWith: { tool: string; library: string };
  alphaThreshold: number;
  reference: {
    stateId: string;
    sourceFile: string;
    sha256: string;
    frameWidth: number;
    frameHeight: number;
  };
  driftPolicy: { maxDriftX: number; maxDriftY: number };
  states: LayerAnchorState[];
}

const SHA256_RE = /^[0-9a-f]{64}$/;
const STATE_ID_RE = /^(mouth|eye)-[a-z-]+$/;
const GENERATED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * SHA-256 of each canonical mouth/eye source, operator-approved originals.
 * Frozen data, never code: these are the WS-11 manifest hashes for the
 * seven canonical files under `source/operator-approved/` (mode 444).
 * A registration whose source hash does not match its row here is invalid
 * — there is no fallback to a lookalike.
 */
export const CANONICAL_SOURCE_SHA256: Readonly<Record<string, string>> = Object.freeze({
  "03-mouth-neutral-closed.png":
    "18b58e9fc40f3b39ee61b1cb83ea3bba61aacdf3860fd377012a0f47dbab2bd2",
  "04-mouth-slight-open.png":
    "e311fb3d13e99a20203612f3d4785b2f58da5688628df8aaabb15702073f93aa",
  "05-mouth-medium-open.png":
    "ac52f72aa66cf95c36dc7706e4006421e24b1d14a7fdcdda66f32354d493bc46",
  "06-mouth-wide-open.png":
    "9f4c28e095e5df0b833f18e941a89de6bf733fb7f8b8359f99cbac6f1653b388",
  "07-mouth-smile-closed.png":
    "cb4e740ba3401c2ecaae23a6cb2bdde4947f11ac6164653faea15941df6ef1a2",
  "08-mouth-smile-open.png":
    "c47646fd71a4138c51ec9212c69bc9f51aab2c4fa27a18cc382c42ae010bfa6e",
  "09-eye-open.png":
    "223a45d9af8107f46d698d3a2b9b630d08351b0ff33bfd2fd400e38bb952ae36",
  "11-eye-half-blink.png":
    "ac492c82877a01bbf910f42f7c08fa2365c323f8014b662807b11569c76593a5",
});

/**
 * Structural validation of a parsed registry. Returns every defect found;
 * an empty array means the registry is structurally sound. This mirrors
 * the WS-11 `validateManifest()` convention: shape errors are collected,
 * never thrown, so a caller can report the full set.
 */
export function validateLayerRegistry(data: unknown): string[] {
  const errors: string[] = [];
  if (typeof data !== "object" || data === null) {
    return ["registry is not an object"];
  }
  const d = data as Record<string, unknown>;

  if (d.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (d.authority !== "operator-originals") {
    errors.push('authority must be "operator-originals"');
  }
  if (typeof d.generatedAt !== "string" || !GENERATED_AT_RE.test(d.generatedAt)) {
    errors.push("generatedAt must be an ISO-8601 UTC timestamp");
  }
  if (!Number.isInteger(d.alphaThreshold) || (d.alphaThreshold as number) < 0 || (d.alphaThreshold as number) > 255) {
    errors.push("alphaThreshold must be an integer in [0, 255]");
  }

  const ref = d.reference as Record<string, unknown> | undefined;
  if (typeof ref !== "object" || ref === null) {
    errors.push("reference is required");
  } else {
    if (ref.stateId !== "mouth-neutral-closed") errors.push("reference.stateId must be mouth-neutral-closed");
    if (typeof ref.sha256 !== "string" || !SHA256_RE.test(ref.sha256)) errors.push("reference.sha256 must be a sha256 hex digest");
    if (typeof ref.sourceFile !== "string" || !(ref.sourceFile in CANONICAL_SOURCE_SHA256)) {
      errors.push(`reference.sourceFile is not a canonical source: ${String(ref.sourceFile)}`);
    } else if (CANONICAL_SOURCE_SHA256[ref.sourceFile] !== ref.sha256) {
      errors.push(`reference hash does not match the canonical hash for ${ref.sourceFile}`);
    }
  }

  const policy = d.driftPolicy as Record<string, unknown> | undefined;
  if (typeof policy !== "object" || policy === null) {
    errors.push("driftPolicy is required");
  } else {
    for (const k of ["maxDriftX", "maxDriftY"] as const) {
      const v = policy[k];
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > 1) {
        errors.push(`driftPolicy.${k} must be a finite number in (0, 1]`);
      }
    }
  }

  if (!Array.isArray(d.states) || d.states.length === 0) {
    errors.push("states must be a non-empty array");
    return errors;
  }

  const seen = new Set<string>();
  let maxDriftX = 0;
  let maxDriftY = 0;
  for (const entry of d.states) {
    if (typeof entry !== "object" || entry === null) {
      errors.push("states contains a non-object entry");
      continue;
    }
    const s = entry as Record<string, unknown>;
    const id = String(s.stateId ?? "");
    if (!STATE_ID_RE.test(id)) {
      errors.push(`state ${id || "(missing)"}: stateId must match mouth-*/eye-*`);
    } else if (seen.has(id)) {
      errors.push(`state ${id}: duplicate stateId`);
    } else {
      seen.add(id);
    }
    if (s.group !== "mouth" && s.group !== "eye") {
      errors.push(`state ${id}: group must be mouth or eye`);
    }
    if (typeof s.sha256 !== "string" || !SHA256_RE.test(s.sha256)) {
      errors.push(`state ${id}: sha256 must be a sha256 hex digest`);
    }
    if (typeof s.sourceFile !== "string" || !(s.sourceFile in CANONICAL_SOURCE_SHA256)) {
      errors.push(`state ${id}: sourceFile is not a canonical source: ${String(s.sourceFile)}`);
    } else if (s.sha256 !== CANONICAL_SOURCE_SHA256[s.sourceFile]) {
      errors.push(
        `state ${id}: hash does not match the canonical hash for ${s.sourceFile}`,
      );
    }
    for (const k of ["frameWidth", "frameHeight"] as const) {
      if (!Number.isInteger(s[k]) || (s[k] as number) < 1) {
        errors.push(`state ${id}: ${k} must be a positive integer`);
      }
    }
    for (const k of ["anchorX", "anchorY"] as const) {
      const v = s[k];
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
        errors.push(`state ${id}: ${k} must be a finite number in [0, 1]`);
      }
    }
    for (const k of ["requiredScaleX", "requiredScaleY"] as const) {
      const v = s[k];
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
        errors.push(`state ${id}: ${k} must be a finite positive number`);
      }
    }
    for (const k of ["maxDriftX", "maxDriftY"] as const) {
      const v = s[k];
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
        errors.push(`state ${id}: ${k} must be a finite non-negative number`);
      } else {
        if (k === "maxDriftX") maxDriftX = Math.max(maxDriftX, v as number);
        else maxDriftY = Math.max(maxDriftY, v as number);
      }
    }
  }

  if (typeof policy === "object" && policy !== null) {
    const px = policy.maxDriftX as number;
    const py = policy.maxDriftY as number;
    if (typeof px === "number" && Number.isFinite(px) && px < maxDriftX) {
      errors.push("driftPolicy.maxDriftX is smaller than a state's maxDriftX");
    }
    if (typeof py === "number" && Number.isFinite(py) && py < maxDriftY) {
      errors.push("driftPolicy.maxDriftY is smaller than a state's maxDriftY");
    }
  }

  const hasRef = seen.has("mouth-neutral-closed");
  if (!hasRef) errors.push("the reference state mouth-neutral-closed is not registered");
  return errors;
}

/**
 * Fail-loud validation + canonical-hash guarantee. Returns the validated
 * registry as a typed object, or throws with the full defect list. This is
 * the single load path: no renderer may consume layer registrations that
 * do not resolve to canonical operator-original hashes.
 */
export function assertValidLayerRegistry(data: unknown): LayerAnchorRegistry {
  const errors = validateLayerRegistry(data);
  if (errors.length > 0) {
    throw new Error(`invalid layer anchor registry:\n- ${errors.join("\n- ")}`);
  }
  return data as LayerAnchorRegistry;
}

/**
 * Lazily loaded, already-validated registry. Throws on first use if the
 * checked-in JSON is defective — fail loud at module load, not mid-render.
 */
export function loadLayerRegistry(): LayerAnchorRegistry {
  return assertValidLayerRegistry(registryJson as unknown);
}

/** Resolve one registered state by id; throws for unknown ids. */
export function resolveLayerState(stateId: string): LayerAnchorState {
  const registry = loadLayerRegistry();
  const state = registry.states.find((s) => s.stateId === stateId);
  if (!state) {
    throw new Error(`layer state "${stateId}" is not registered`);
  }
  return state;
}

/**
 * Viseme → registered mouth-layer state. Every VisemeId resolves to an
 * operator-approved source; there is no lookalike fallback. The approved
 * speaking range is 03–06 plus smile variants:
 *
 * - closed/rest/mm → mouth-neutral-closed (03)
 * - ai/ee         → mouth-slight-open (04)
 * - oh            → mouth-medium-open (05)
 * - wide          → mouth-wide-open (06)
 */
export function stateForViseme(viseme: VisemeId): LayerAnchorState {
  switch (viseme) {
    case "closed":
    case "rest":
    case "mm":
      return resolveLayerState("mouth-neutral-closed");
    case "ai":
    case "ee":
      return resolveLayerState("mouth-slight-open");
    case "oh":
      return resolveLayerState("mouth-medium-open");
    case "wide":
      return resolveLayerState("mouth-wide-open");
  }
}

/** Registered eye states (blink sequence authority). */
export const EYE_STATES: Readonly<Record<"open" | "halfBlink", string>> = Object.freeze({
  open: "eye-open",
  halfBlink: "eye-half-blink",
});

/**
 * Blink phase → registered eye layer. There is NO approved fully-closed
 * eye art among the canonical sources, so an "eye-closed" lookup fails
 * loud instead of substituting a lookalike (state-map rule 2: degrade to
 * non-character signals, never to an unapproved pose).
 */
export function stateForBlink(phase: "open" | "halfBlink"): LayerAnchorState {
  return resolveLayerState(EYE_STATES[phase]);
}
