/**
 * FIX-005 acceptance tests for the registered layer contract.
 *
 * Placement tolerance zero by construction: fixed rects from the build
 * record, state change swaps only the image inside the rect. These tests
 * prove the record is complete, coherent, and immutable.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  LAYER_REGISTRATION,
  VISEME_LAYER_FILES,
  assertRectUnchanged,
  eyeLayerFile,
  eyeRect,
  mouthRect,
} from "../layers.ts";
import { stateForViseme } from "../registry.ts";
import type { VisemeId } from "../types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..", "..", "..", "..");
const LAYERS_DIR = join(APP, "assets", "candice", "layers");

test("registration record is complete", () => {
  assert.equal(LAYER_REGISTRATION.baseFrame, "03-mouth-neutral-closed");
  assert.deepEqual([...LAYER_REGISTRATION.baseCanvas], [1254, 1254]);
  assert.deepEqual([...LAYER_REGISTRATION.zOrder], ["base", "mouth", "eye"]);
  assert.equal(LAYER_REGISTRATION.mouthRect.length, 4);
  assert.equal(LAYER_REGISTRATION.eyeRect.length, 4);
  // every rect coordinate is an integer inside the canvas
  for (const rect of [LAYER_REGISTRATION.mouthRect, LAYER_REGISTRATION.eyeRect]) {
    for (const v of rect) {
      assert.ok(Number.isInteger(v), `rect coordinate must be integer, got ${v}`);
    }
    assert.ok(rect[0] >= 0 && rect[1] >= 0 && rect[2] <= 1254 && rect[3] <= 1254);
    assert.ok(rect[2] > rect[0] && rect[3] > rect[1]);
  }
  // mouth rect sits inside the eye rect's vertical span, below the eyes
  const m = LAYER_REGISTRATION.mouthRect;
  const e = LAYER_REGISTRATION.eyeRect;
  assert.ok(m[1] > e[1], "mouth rect must be below the eye rect top");
});

test("mouth rect has non-trivial size and lies in lower face", () => {
  const m = mouthRect();
  const w = m[2] - m[0];
  const h = m[3] - m[1];
  assert.ok(w > 100 && h > 60, `mouth rect too small: ${w}x${h}`);
  assert.ok(m[1] > 400, "mouth rect must be in lower face");
});

test("every viseme maps to a mouth layer file", () => {
  const visemes: VisemeId[] = ["closed", "rest", "ai", "oh", "ee", "mm", "wide"];
  for (const v of visemes) {
    const f = VISEME_LAYER_FILES[v];
    assert.equal(typeof f, "string");
    assert.match(f, /^assets\//);
  }
  // conservative mapping: no viseme drives the smile states
  for (const v of visemes) {
    assert.ok(!VISEME_LAYER_FILES[v].includes("smile"), `${v} must not drive a smile layer`);
  }
});

test("VISEME_LAYER_FILES agrees with the registry's stateForViseme for every viseme", () => {
  // Cross-consistency guard (FIX-005 recheck defect): the registry's
  // measurement data is the authority for viseme → mouth-state mapping.
  // VISEME_LAYER_FILES is derived from it; this test fails loudly if the
  // two ever diverge (e.g. a hand-edited mapping one notch more open).
  const visemes: VisemeId[] = ["closed", "rest", "ai", "oh", "ee", "mm", "wide"];
  for (const v of visemes) {
    const state = stateForViseme(v);
    const sourceNum = state.sourceFile.split("-")[0];
    const entry = Object.values(LAYER_REGISTRATION.mouthStates).find(
      (m) => m.source === sourceNum,
    );
    assert.ok(entry, `viseme ${v}: registry state ${state.stateId} has a mouthStates entry`);
    assert.equal(
      VISEME_LAYER_FILES[v],
      entry.file,
      `viseme ${v}: VISEME_LAYER_FILES must match registry state ${state.stateId}`,
    );
  }
});

test("mouth state files exist on disk", () => {
  const files = new Set(Object.values(VISEME_LAYER_FILES));
  for (const f of files) {
    const path = join(LAYERS_DIR, f.replace("assets/", "assets/"));
    readFileSync(path); // throws if missing
  }
});

test("eye states exist and derived states are flagged pending approval", () => {
  assert.equal(eyeLayerFile("open"), LAYER_REGISTRATION.eyeStates["open"]);
  assert.equal(eyeLayerFile("half"), LAYER_REGISTRATION.eyeStates["half"]);
  assert.equal(eyeLayerFile("closed"), LAYER_REGISTRATION.eyeStates["closed"]);
  const manifest = JSON.parse(
    readFileSync(join(LAYERS_DIR, "build", "manifest.json"), "utf8"),
  );
  const byId = new Map(manifest.layers.map((l: { id: string }) => [l.id, l]));
  for (const id of ["eye-half", "eye-closed"]) {
    assert.equal(byId.get(id)?.synthesized, true);
    assert.equal(byId.get(id)?.approval, "pending-operator");
  }
  for (const id of ["03", "04", "05", "06", "07", "08", "09"]) {
    assert.equal(byId.get(id)?.approval, "operator-approved");
  }
});

test("assertRectUnchanged rejects any rect drift", () => {
  const m = mouthRect();
  const e = eyeRect();
  assert.equal(assertRectUnchanged([...m], "mouth"), true);
  assert.equal(assertRectUnchanged([...e], "eye"), true);
  assert.equal(assertRectUnchanged([m[0] + 1, m[1], m[2], m[3]], "mouth"), false);
  assert.equal(assertRectUnchanged([e[0], e[1], e[2] - 1, e[3]], "eye"), false);
  assert.equal(assertRectUnchanged([0, 0, 0, 0], "mouth"), false);
});

test("registration record is immutable", () => {
  assert.throws(
    () => {
      (LAYER_REGISTRATION as unknown as { mouthRect: number[] }).mouthRect[0] = 999;
    },
    TypeError,
  );
  assert.throws(
    () => {
      (VISEME_LAYER_FILES as unknown as { closed: string }).closed = "nope";
    },
    TypeError,
  );
});
