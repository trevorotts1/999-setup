#!/usr/bin/env node
/**
 * Candice release-artifact resolver (FIX-018).
 *
 * Owned glob: `scripts/candice-bootstrap/**` (PROJECT-MANIFEST 9.2 WR-017).
 *
 * The ONLY authority for the app record is release-authority output:
 * `scripts/candice-release/status.mjs` (which must accept the exact
 * candidate) plus `CONTROL/bundled-components.json` (which may carry app
 * records only via the FIX-022 lane's release-authority output). A
 * caller-supplied path or custom manifest is rejected. FIX-022 owns
 * release-artifact creation, signing, notarization, and authority records;
 * this lane consumes only what the authority accepts — it never invents a
 * candidate.
 *
 * The resolver returns the exact per-(platform, arch) app record or fails
 * closed. A missing, malformed, or placeholder record is a hard failure in
 * release mode, never a skipped leg.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, "..", "..");
export const BUNDLED_MANIFEST = join(REPO_ROOT, "CONTROL", "bundled-components.json");
export const RELEASE_STATUS = join(REPO_ROOT, "scripts", "candice-release", "status.mjs");
export const MANIFEST_SCHEMA = "candice.bundled-components/v1";
export const APP_ID = "candice-companion";

/** Placeholder checksum: unverifiable by construction (WS-33 doctrine). */
export const PLACEHOLDER_SHA256 = "0".repeat(64);

function result(ok, message, extra = {}) {
  return { ok, message, ...extra };
}

/** Read + schema-check the bundled-components manifest. */
export function readManifest(path = BUNDLED_MANIFEST) {
  if (!existsSync(path)) {
    return result(false, `bundled-components manifest missing: ${path}`);
  }
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return result(false, `bundled-components manifest unreadable: ${e.message}`);
  }
  if (doc.schema !== MANIFEST_SCHEMA) {
    return result(false, `bundled-components schema is ${doc.schema ?? "MISSING"}, expected ${MANIFEST_SCHEMA}`);
  }
  return result(true, "manifest readable", { doc });
}

/**
 * Run the release authority for the current checkout. The authority is the
 * only mechanism allowed to approve distribution; there are no environment
 * overrides. Returns {ok, message, stdout}.
 */
export function runReleaseAuthority(opts = {}) {
  const statusScript = opts.statusScript || RELEASE_STATUS;
  const root = opts.repoRoot || REPO_ROOT;
  try {
    const out = execFileSync(process.execPath, [statusScript, "--root", root], {
      encoding: "utf8",
      timeout: 120000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return result(true, "release authority accepted the candidate", { stdout: out.trim() });
  } catch (e) {
    const out = String(e.stdout ?? "") + String(e.stderr ?? "");
    return result(false, `release authority refused the candidate (exit ${e.status ?? 1}): ${out.trim().split("\n")[0] || "no output"}`);
  }
}

/**
 * Resolve the exact app record for (platform, arch).
 *
 * @param {object} opts
 *   platform: "darwin" | "win32" (others fail closed)
 *   arch: "arm64" | "x64" | "x86" (defaults to process.arch)
 *   manifestPath: test override for the bundled-components manifest
 *   statusScript: test override for the release-authority script
 *   repoRoot: test override for the repository root
 *   authority: pre-computed authority result (tests inject a fake authority;
 *     production callers must never pass this)
 * @returns {{ok:boolean, message:string, record?:object, authority?:object}}
 */
export function resolveAppRecord(opts = {}) {
  const platform = opts.platform || process.platform;
  const arch = opts.arch || process.arch;
  if (platform !== "darwin" && platform !== "win32") {
    return result(false, `unsupported platform ${platform} — no release-authorized app record exists`);
  }

  // 1. Release authority must accept the exact candidate first.
  const authority = opts.authority || runReleaseAuthority(opts);
  if (!authority.ok) {
    return result(false, `app record refused: ${authority.message}`, { authority });
  }

  // 2. The record comes only from the in-repository manifest.
  const manifest = readManifest(opts.manifestPath || BUNDLED_MANIFEST);
  if (!manifest.ok) {
    return result(false, `app record refused: ${manifest.message}`, { authority });
  }
  const components = manifest.doc.components || {};
  const appEntries = components[APP_ID];
  if (!Array.isArray(appEntries) || appEntries.length === 0) {
    return result(false, `no ${APP_ID} record in the release manifest — refusing app install (fail closed)`, { authority });
  }

  // 3. Exact (platform, arch) match only. "any" is not a valid app platform.
  const hit = appEntries.find((c) => c.platform === platform && c.arch === arch);
  if (!hit) {
    return result(false, `no ${APP_ID} record for platform=${platform} arch=${arch} — refusing app install (fail closed)`, { authority });
  }

  // 4. Every required provenance field must be present and non-placeholder.
  const required = ["version", "file", "sha256", "sizeBytes", "sourceUrl", "signature", "notarization", "executablePath"];
  const missing = required.filter((f) => hit[f] === undefined || hit[f] === null || hit[f] === "");
  if (missing.length > 0) {
    return result(false, `${APP_ID} record incomplete: missing ${missing.join(", ")} — refusing (fail closed)`, { authority });
  }
  if (!/^[a-f0-9]{64}$/.test(hit.sha256) || hit.sha256 === PLACEHOLDER_SHA256) {
    return result(false, `${APP_ID} record sha256 is not a real checksum — refusing (fail closed)`, { authority });
  }
  if (!Number.isInteger(hit.sizeBytes) || hit.sizeBytes <= 0) {
    return result(false, `${APP_ID} record sizeBytes invalid — refusing (fail closed)`, { authority });
  }
  if (!/^https:\/\//.test(hit.sourceUrl)) {
    return result(false, `${APP_ID} record sourceUrl is not https — refusing (fail closed)`, { authority });
  }
  if (typeof hit.signature !== "string" || hit.signature.length === 0) {
    return result(false, `${APP_ID} record signature missing — refusing (fail closed)`, { authority });
  }
  if (typeof hit.notarization !== "string" || hit.notarization.length === 0) {
    return result(false, `${APP_ID} record notarization posture missing — refusing (fail closed)`, { authority });
  }

  return result(true, `${APP_ID}@${hit.version} resolved for ${platform}/${arch}`, {
    record: { ...hit, platform, arch, id: APP_ID },
    authority,
  });
}
