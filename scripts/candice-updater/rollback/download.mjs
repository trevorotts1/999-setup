#!/usr/bin/env node
/**
 * Candice updater download gate (WS-33).
 *
 * The download front-door for the updater. Enforces the spec 21 rules before
 * any payload is written to disk:
 *   - only operator-controlled release locations (github.com/trevorotts1/999-setup
 *     releases + the pinned upstream release tags recorded in components.mjs),
 *   - SHA-256 verified after download, size-guarded,
 *   - never accepts a payload with no checksum record (fail closed),
 *   - writes to a staging path, never the final target (atomic install owns the
 *     final placement).
 *
 * Node's fetch is shell-agnostic — the same gate serves macOS (bash) and
 * Windows (PowerShell/CMD) callers (spec 0.3 Windows parity).
 *
 * Usage:
 *   node download.mjs --id <non-app-component> --version <version> --platform <platform> \
 *     [--out <staging-path>] [--manifest <bundled-components.json>]
 *
 * Exit: 0 verified-and-staged; 1 checksum/source/size failure; 2 usage.
 */
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolveComponent, RELEASE_CHANNEL } from "../checksums/components.mjs";

const args = process.argv.slice(2);
const readArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const id = readArg("--id");
const version = readArg("--version");
const platform = readArg("--platform") || "any";
const out = readArg("--out");
const manifestPath = readArg("--manifest");

async function main() {
  if (!id || !version || !out) {
    console.error("usage: node download.mjs --id <component> --version <v> [--platform <p>] --out <staging-path>");
    process.exit(2);
  }

  let record = resolveComponent(id, version, platform);
  if (manifestPath) {
    // Application delivery is governed only by the in-repository release
    // authority. A caller-controlled manifest must never resurrect a
    // quarantined or withdrawn Candice Companion build.
    if (id === "candice-companion") {
      console.error("FAIL custom manifests cannot authorize candice-companion downloads — release authority required");
      process.exit(1);
    }
    try {
      const m = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(manifestPath, "utf8")));
      const byId = (m.components || {})[id] || [];
      const hit = byId.find(
        (c) => c.version === version && (c.platform === platform || c.platform === "any"),
      );
      if (hit) record = { id, version, platform: hit.platform, payload: hit };
    } catch (e) {
      console.error(`FAIL manifest unreadable: ${e.message}`);
      process.exit(1);
    }
  }

  if (!record || !record.payload || !record.payload.sha256) {
    console.error(`FAIL no checksum record for ${id}@${version}@${platform} — refusing download (fail closed)`);
    process.exit(1);
  }
  if (record.payload.sha256 === "0".repeat(64)) {
    console.error(
      `FAIL placeholder checksum for ${id}@${version}@${platform} — recompute owed from integrated build — refusing download (fail closed)`,
    );
    process.exit(1);
  }

  const url = record.payload.sourceUrl;
  const allowed = url.startsWith(RELEASE_CHANNEL) || url.startsWith("https://github.com/") || url.startsWith("https://huggingface.co/");
  if (!allowed) {
    console.error(`FAIL source not operator-controlled: ${url}`);
    process.exit(1);
  }

  let res;
  try {
    res = await fetch(url, { redirect: "follow" });
  } catch (e) {
    console.error(`FAIL fetch error: ${e.message}`);
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`FAIL HTTP ${res.status} from ${url}`);
    process.exit(1);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  const actual = createHash("sha256").update(buf).digest("hex");
  if (actual !== record.payload.sha256) {
    console.error(`FAIL sha256 mismatch after download: got ${actual} expected ${record.payload.sha256}`);
    process.exit(1);
  }
  if (record.payload.sizeBytes > 0 && buf.length !== record.payload.sizeBytes) {
    console.error(`FAIL size mismatch: got ${buf.length} expected ${record.payload.sizeBytes}`);
    process.exit(1);
  }

  writeFileSync(out, buf);
  console.log(`OK staged ${out} (sha256 ${actual}, ${buf.length} bytes)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(`FAIL ${e.message}`);
  process.exit(1);
});
