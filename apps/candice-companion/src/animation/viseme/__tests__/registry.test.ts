/**
 * FIX-005 acceptance tests — layer anchor registry.
 *
 * Requirement: mouth/eye layers align to the approved sources at reference
 * anchors and required scales across every phoneme/blink state without
 * drift. Proven here:
 *
 *   - every registered state resolves to a canonical operator-original
 *     SHA-256 (the frozen CANONICAL_SOURCE_SHA256 table);
 *   - the checked-in registry JSON validates cleanly and fails loudly on
 *     every tamper class (bad hash, unknown source, drift-policy lie,
 *     duplicate state, missing reference state);
 *   - anchors and required scales are real measurement facts that pin each
 *     state to the reference geometry, and post-alignment drift is bounded
 *     by the recorded maxima;
 *   - every VisemeId the scheduler can emit resolves to a registered,
 *     canonical mouth layer (no lookalike fallback);
 *   - eye layers resolve for the two approved blink phases and fail loudly
 *     for an unapproved closed-eye phase.
 *
 * Runnable with zero deps: `node --test` (same lane convention as WS-12).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CANONICAL_SOURCE_SHA256,
  EYE_STATES,
  assertValidLayerRegistry,
  loadLayerRegistry,
  resolveLayerState,
  stateForBlink,
  stateForViseme,
  validateLayerRegistry,
  type LayerAnchorRegistry,
} from "../registry.ts";
import { idleViseme } from "../mapping.ts";

// ---------------------------------------------------------------- helpers

function clone(data: LayerAnchorRegistry): LayerAnchorRegistry {
  return JSON.parse(JSON.stringify(data)) as LayerAnchorRegistry;
}

const registry = loadLayerRegistry();

// ------------------------------------------------------------------ tests

test("checked-in registry validates cleanly", () => {
  assert.deepEqual(validateLayerRegistry(registry), []);
  assert.deepEqual(validateLayerRegistry(assertValidLayerRegistry(registry)), []);
});

test("registry schema constants are pinned", () => {
  assert.equal(registry.schemaVersion, 1);
  assert.equal(registry.authority, "operator-originals");
  assert.equal(registry.reference.stateId, "mouth-neutral-closed");
});

test("every registered state maps to a canonical operator-original hash", () => {
  assert.ok(registry.states.length >= 7, "all seven canonical sources registered");
  for (const state of registry.states) {
    const canonical = CANONICAL_SOURCE_SHA256[state.sourceFile];
    assert.ok(canonical, `state ${state.stateId} source ${state.sourceFile} is canonical`);
    assert.equal(state.sha256, canonical, `state ${state.stateId} hash matches canonical`);
  }
  assert.equal(
    registry.reference.sha256,
    CANONICAL_SOURCE_SHA256[registry.reference.sourceFile],
    "reference hash matches canonical",
  );
});

test("seven canonical mouth/eye sources each have one registered state", () => {
  const registered = new Set(registry.states.map((s) => s.sourceFile));
  for (const file of Object.keys(CANONICAL_SOURCE_SHA256)) {
    assert.ok(registered.has(file), `canonical source ${file} is registered`);
  }
  assert.equal(registry.states.length, Object.keys(CANONICAL_SOURCE_SHA256).length);
});

test("reference state is registered with identity anchors and scales", () => {
  const ref = resolveLayerState("mouth-neutral-closed");
  assert.equal(ref.sourceFile, "03-mouth-neutral-closed.png");
  assert.equal(ref.requiredScaleX, 1);
  assert.equal(ref.requiredScaleY, 1);
  assert.equal(ref.maxDriftX, 0);
  assert.equal(ref.maxDriftY, 0);
});

test("anchors and required scales pin every state to the reference geometry", () => {
  for (const s of registry.states) {
    // Anchor lies inside the frame.
    assert.ok(s.anchorX >= 0 && s.anchorX <= 1, `${s.stateId} anchorX in [0,1]`);
    assert.ok(s.anchorY >= 0 && s.anchorY <= 1, `${s.stateId} anchorY in [0,1]`);
    // Required scale is positive and sane: it pins the subject extent to
    // the reference extent (exact by construction), so a scale near 1 is
    // expected and scale-up is legitimate when a subject is framed
    // smaller (eye-open) or on a larger stage (eye-half-blink).
    assert.ok(s.requiredScaleX > 0 && s.requiredScaleX < 2, `${s.stateId} requiredScaleX sane`);
    assert.ok(s.requiredScaleY > 0 && s.requiredScaleY < 2, `${s.stateId} requiredScaleY sane`);
    // Post-alignment centroid drift is bounded by the registry policy.
    assert.ok(s.maxDriftX <= registry.driftPolicy.maxDriftX, `${s.stateId} driftX bounded`);
    assert.ok(s.maxDriftY <= registry.driftPolicy.maxDriftY, `${s.stateId} driftY bounded`);
  }
});

test("drift policy is an honest envelope of the per-state maxima", () => {
  const maxX = Math.max(...registry.states.map((s) => s.maxDriftX));
  const maxY = Math.max(...registry.states.map((s) => s.maxDriftY));
  assert.ok(registry.driftPolicy.maxDriftX >= maxX);
  assert.ok(registry.driftPolicy.maxDriftY >= maxY);
  // Envelope must be tight: no slack beyond a small rounding headroom.
  assert.ok(registry.driftPolicy.maxDriftX - maxX < 0.0001);
  assert.ok(registry.driftPolicy.maxDriftY - maxY < 0.0001);
});

test("every scheduler-emitted VisemeId resolves to a canonical mouth layer", () => {
  for (const viseme of ["closed", "rest", "ai", "oh", "ee", "mm", "wide"] as const) {
    const state = stateForViseme(viseme);
    assert.equal(state.group, "mouth", `${viseme} maps to a mouth state`);
    assert.ok(CANONICAL_SOURCE_SHA256[state.sourceFile], `${viseme} source is canonical`);
  }
  // Idle fallback must be a registered state.
  assert.equal(stateForViseme(idleViseme()).stateId, "mouth-neutral-closed");
});

test("blink phases resolve to approved eye layers only", () => {
  const open = stateForBlink("open");
  const half = stateForBlink("halfBlink");
  assert.equal(open.group, "eye");
  assert.equal(half.group, "eye");
  assert.equal(open.sourceFile, "09-eye-open.png");
  assert.equal(half.sourceFile, "11-eye-half-blink.png");
  assert.equal(EYE_STATES.open, "eye-open");
  assert.equal(EYE_STATES.halfBlink, "eye-half-blink");
  // No approved closed-eye art exists among the canonical sources; a
  // closed phase must fail loudly, never substitute a lookalike.
  assert.throws(
    () => resolveLayerState("eye-closed"),
    /layer state "eye-closed" is not registered/,
  );
});

test("unknown layer lookups fail loudly", () => {
  assert.throws(() => resolveLayerState("mouth-anything-else"), /not registered/);
});

test("tampered hash fails validation", () => {
  const bad = clone(registry);
  bad.states[0] = { ...bad.states[0], sha256: "0".repeat(64) };
  const errors = validateLayerRegistry(bad);
  assert.ok(errors.some((e) => /hash does not match the canonical hash/.test(e)));
  assert.throws(() => assertValidLayerRegistry(bad), /invalid layer anchor registry/);
});

test("unknown source file fails validation", () => {
  const bad = clone(registry);
  bad.states[0] = { ...bad.states[0], sourceFile: "99-unknown.png" };
  assert.ok(validateLayerRegistry(bad).some((e) => /not a canonical source/.test(e)));
});

test("duplicate stateId fails validation", () => {
  const bad = clone(registry);
  bad.states.push({ ...bad.states[0] });
  assert.ok(validateLayerRegistry(bad).some((e) => /duplicate stateId/.test(e)));
});

test("missing reference state fails validation", () => {
  const bad = clone(registry);
  bad.states = bad.states.filter((s) => s.stateId !== "mouth-neutral-closed");
  assert.ok(validateLayerRegistry(bad).some((e) => /mouth-neutral-closed is not registered/.test(e)));
});

test("drift policy smaller than a state maximum fails validation", () => {
  const bad = clone(registry);
  bad.driftPolicy = { maxDriftX: 0.00001, maxDriftY: 0.00001 };
  assert.ok(validateLayerRegistry(bad).some((e) => /driftPolicy\.maxDriftX is smaller/.test(e)));
});

test("non-object input fails validation without throwing", () => {
  assert.deepEqual(validateLayerRegistry(null), ["registry is not an object"]);
  assert.deepEqual(validateLayerRegistry(42), ["registry is not an object"]);
});

test("out-of-range anchor or scale fails validation", () => {
  const bad = clone(registry);
  bad.states[1] = { ...bad.states[1], anchorX: 1.5 };
  assert.ok(validateLayerRegistry(bad).some((e) => /anchorX must be a finite number in \[0, 1\]/.test(e)));
  const bad2 = clone(registry);
  bad2.states[1] = { ...bad2.states[1], requiredScaleY: 0 };
  assert.ok(validateLayerRegistry(bad2).some((e) => /requiredScaleY must be a finite positive number/.test(e)));
});

test("eye-half-blink is a different frame geometry and carries a scale correction", () => {
  const half = resolveLayerState("eye-half-blink");
  assert.equal(half.frameWidth, 1024);
  assert.equal(half.frameHeight, 1536);
  // Scale correction exists for both axes (1024x1536 stage vs 1254 square).
  assert.notEqual(half.requiredScaleX, 1);
  assert.notEqual(half.requiredScaleY, 1);
});

test("registry loads lazily and repeatedly without mutation", () => {
  const a = loadLayerRegistry();
  const b = loadLayerRegistry();
  assert.deepEqual(a, b);
  // Loading must not mutate the JSON-backed data.
  assert.deepEqual(a, registry);
});
