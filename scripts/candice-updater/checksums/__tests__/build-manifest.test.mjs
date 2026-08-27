import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = fileURLToPath(new URL(".", import.meta.url));
const builder = join(here, "..", "build-manifest.mjs");

test("manifest builder never regenerates a quarantined Candice application entry", () => {
  const out = join(mkdtempSync(join(tmpdir(), "candice-manifest-")), "bundled-components.json");
  execFileSync(process.execPath, [builder, "--out", out], { encoding: "utf8" });
  const manifest = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(manifest.components["candice-companion"], undefined);
  assert.ok(manifest.components["candice-integration"]);
  assert.ok(manifest.components["stt-assets"]);
});
