#!/usr/bin/env node
/**
 * Candice updater payload verifier (WS-33).
 *
 * Verifies a downloaded payload against the pin registry:
 *   - SHA-256 must match exactly,
 *   - size must match the recorded sizeBytes when > 0,
 *   - refuses to verify when NO record exists (fail closed — an unverifiable
 *     payload is never accepted).
 *
 * Reads only. Never downloads. The downloader lane (WS-31/WS-32 family) calls
 * this module after fetching; the regression lane (WS-49) uses it to prove
 * corrupt files are rejected.
 *
 * Exit codes:
 *   0  verified OK
 *   1  verification failed (corrupt, size mismatch, or unknown component)
 *   2  usage error
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolveComponent, PLACEHOLDER_SHA256 } from "./components.mjs";

const args = process.argv.slice(2);
const readArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const filePath = readArg("--file");
const id = readArg("--id");
const version = readArg("--version");
const platform = readArg("--platform");
const expectSha = readArg("--sha256");

if (!filePath) {
  console.error(
    "usage: node verify.mjs --file <payload> [--id <component>] [--version <v>] [--platform <p>] [--sha256 <hex>]",
  );
  process.exit(2);
}

function sha256Of(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

const actual = sha256Of(filePath);
const size = statSync(filePath).size;

if (expectSha) {
  // Explicit expectation path (fixture/corrupt tests or manifest-driven callers).
  if (actual === expectSha) {
    console.log(`OK ${filePath} sha256=${actual} size=${size}`);
    process.exit(0);
  }
  console.error(`FAIL ${filePath} sha256 mismatch: got ${actual} expected ${expectSha}`);
  process.exit(1);
}

if (!id || !version) {
  console.error("usage: --sha256 <hex> is required, or --id + --version for registry lookup");
  process.exit(2);
}

const entry = resolveComponent(id, version, platform || "any");
if (!entry) {
  console.error(`FAIL no checksum record for ${id}@${version}@${platform || "any"} — refusing unverified payload`);
  process.exit(1);
}

const expected = entry.payload.sha256;
if (!expected) {
  console.error(`FAIL no SHA-256 recorded for ${id}@${version}@${entry.platform} — refusing`);
  process.exit(1);
}

if (expected === PLACEHOLDER_SHA256) {
  console.error(
    `FAIL placeholder checksum for ${id}@${version}@${entry.platform} — real hash owed (NSIS: Windows build) — refusing unverified payload`,
  );
  process.exit(1);
}

if (actual !== expected) {
  console.error(`FAIL ${filePath} sha256 mismatch: got ${actual} expected ${expected}`);
  process.exit(1);
}

if (entry.payload.sizeBytes > 0 && size !== entry.payload.sizeBytes) {
  console.error(`FAIL ${filePath} size mismatch: got ${size} expected ${entry.payload.sizeBytes}`);
  process.exit(1);
}

console.log(`OK ${filePath} sha256=${actual} size=${size}`);
process.exit(0);
