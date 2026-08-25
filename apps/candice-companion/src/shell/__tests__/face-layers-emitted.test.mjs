/**
 * Emission guard for the FIX-005 face layers.
 *
 * This is the trap that killed the whole hologram once already: a layer can
 * be bound, registered and perfectly correct in source, and still 404 inside
 * the .app because Vite never emitted it. `gesture-stage.ts` imported exactly
 * one PNG statically, so Vite emitted exactly one, and every other pose fell
 * through to a repo path that does not exist in the packaged bundle.
 *
 * A dev-server check cannot catch that. In dev, `import.meta.glob` resolves
 * to URLs that LOOK like repo paths, so the broken and the working case are
 * indistinguishable. Only a production build proves emission, so this test
 * runs the real production config through Vite's JS API with `write: false`:
 * a true rollup asset graph, in memory, touching neither `src-tauri/dist`
 * nor anyone else's build.
 *
 * It also proves the mount is load-bearing: `face-stage.ts` only contributes
 * its glob when something imports it. Unmount it and these assets stop being
 * emitted, which is exactly what "built but never wired" looked like.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { build } from "vite";

/** The ten baked layers the build record says the face surface needs. */
const layerManifest = JSON.parse(
  readFileSync(
    new URL("../../../assets/candice/layers/build/manifest.json", import.meta.url),
    "utf8",
  ),
);

/** Stem of `assets/mouth-open-small.png` -> `mouth-open-small`. */
function stem(file) {
  return (file.split("/").pop() ?? file).replace(/\.png$/, "");
}

let emittedPromise;
function emittedAssets() {
  emittedPromise ??= (async () => {
    const result = await build({
      root: process.cwd(),
      configFile: "vite.config.build.ts",
      logLevel: "silent",
      build: { write: false, emptyOutDir: false },
    });
    const outputs = Array.isArray(result)
      ? result.flatMap((r) => r.output)
      : result.output;
    return outputs
      .map((o) => o.fileName)
      .filter((name) => typeof name === "string" && name.endsWith(".png"))
      .map((name) => name.split("/").pop());
  })();
  return emittedPromise;
}

test("every baked face layer is emitted by a real production build", async () => {
  const emitted = await emittedAssets();
  const missing = [];
  for (const layer of layerManifest.layers) {
    const want = stem(layer.file);
    // Hashed filenames: `base-neutral.png` emits as `base-neutral-<hash>.png`.
    const hit = emitted.find((name) => name.startsWith(`${want}-`) || name === `${want}.png`);
    if (!hit) missing.push(layer.file);
  }
  assert.deepEqual(
    missing,
    [],
    `these face layers were NOT emitted and would 404 inside the .app: ${missing.join(", ")}`,
  );
});

test("the face layers are content-hashed, not raw repo paths", async () => {
  const emitted = await emittedAssets();
  for (const layer of layerManifest.layers) {
    const want = stem(layer.file);
    const hit = emitted.find((name) => name.startsWith(`${want}-`));
    assert.ok(
      hit,
      `"${layer.file}" is not emitted under a content-hashed name; an ` +
        `unhashed or absent asset is the 404 signature`,
    );
  }
});

test("the whole approved mouth set the renderer can select is emitted", async () => {
  const emitted = await emittedAssets();
  // The six cutouts the viseme renderer swaps between. If any one of these is
  // missing, lip sync silently degrades to a blank or stuck mouth.
  const mouthLayers = layerManifest.layers.filter((l) => l.role?.startsWith("mouth/"));
  assert.ok(mouthLayers.length >= 6, `expected the six mouth cutouts, saw ${mouthLayers.length}`);
  for (const layer of mouthLayers) {
    assert.ok(
      emitted.some((name) => name.startsWith(`${stem(layer.file)}-`)),
      `mouth cutout "${layer.file}" is not in the built bundle`,
    );
  }
});
