#!/usr/bin/env node
/**
 * Candice versioned health-report schema (FIX-018).
 *
 * Owned glob: `scripts/candice-bootstrap/**` (PROJECT-MANIFEST 9.2 WR-017).
 *
 * One schema, one definition: both the bootstrap health probe
 * (scripts/candice-bootstrap/health.mjs) and the public orchestrator report
 * derive from this module. The public setup orchestrators forward a
 * sanitized projection of this document (P1-01).
 *
 * Classification: every leg is `required` or `optional` (both for the
 * current platform). The report `ok` is the conjunction of every REQUIRED
 * leg. A missing, unknown, or nonzero result is FAIL, never OK. A leg
 * without an explicit classification is rejected by the parser (fail
 * closed): an unclassified leg can never be silently tolerated.
 */
export const HEALTH_SCHEMA = "candice.health-report/v1";

/** Per-leg result values. */
export const LEG_OK = "PASS";
export const LEG_FAIL = "FAIL";
export const LEG_UNKNOWN = "UNKNOWN";

export const LEG_VALUES = Object.freeze([LEG_OK, LEG_FAIL, LEG_UNKNOWN]);

/**
 * The fixed leg inventory for schema v1. A leg not listed here is UNKNOWN
 * by construction (fail closed) and never contributes to `ok`.
 */
export const KNOWN_LEGS = Object.freeze([
  "app-provenance", // immutable app record: artifact URL, version, SHA-256, size, signature/notarization posture, expected executable path
  "app-hash", // installed executable hash matches the provenance record
  "app-executable", // expected executable path exists
  "app-launch", // bounded actual launch of the installed app
  "bridge-ipc", // IPC readiness round trip through the FIX-011 bridge seam
  "plugin-registered", // one effective registration in the shared Claude config root(s)
  "plugin-loaded", // plugin manifest parses and the recorded registration points at the installed tree
  "plugin-hooks", // hooks.json parses and only the four supported wake matchers are present
  "plugin-mcp", // .mcp.json parses with the candice server command
  "asset-stt-model", // exact (platform, arch) STT model hash/size
  "asset-stt-runtime", // STT runtime hash/size (platform-required only)
  "asset-tts-model", // exact TTS model hash/size
  "asset-tts-voice", // exact TTS voicepack hash/size
  "stt-runtime-capability", // capability probe through the FIX-009 seam
  "tts-runtime-capability", // capability probe through the FIX-009 seam
  "launch-command", // recorded launch command points at an existing executable
  "permissions", // required permission posture (FIX-013-owned semantics)
  "state-record", // signed state/attestation validates against on-disk facts
  "skill-tree", // bundled skill trees present at pinned versions
]);

/**
 * Per-platform leg classification (schema v1).
 * `required` legs gate `ok`; `optional` legs report without gating.
 * `win32` also requires the STT runtime leg; `darwin` does not.
 */
export function legClasses(platform) {
  const required = [
    "app-provenance",
    "app-hash",
    "app-executable",
    "app-launch",
    "bridge-ipc",
    "plugin-registered",
    "plugin-loaded",
    "plugin-hooks",
    "plugin-mcp",
    "asset-stt-model",
    "asset-tts-model",
    "asset-tts-voice",
    "stt-runtime-capability",
    "tts-runtime-capability",
    "launch-command",
    "permissions",
    "state-record",
    "skill-tree",
  ];
  if (platform === "win32") required.push("asset-stt-runtime");
  const requiredSet = new Set(required);
  const out = {};
  for (const leg of KNOWN_LEGS) {
    out[leg] = requiredSet.has(leg) ? "required" : "optional";
  }
  return out;
}

/** @typedef {{ leg: string, status: "PASS"|"FAIL"|"UNKNOWN", detail?: string }} LegReport */

/**
 * Build the canonical empty report. Every known leg starts UNKNOWN.
 * `ok` is the conjunction of required legs only — UNKNOWN/FAIL never pass.
 */
export function emptyReport(platform) {
  const classes = legClasses(platform);
  const legs = {};
  for (const leg of KNOWN_LEGS) {
    legs[leg] = { leg, classification: classes[leg], status: LEG_UNKNOWN };
  }
  return {
    schema: HEALTH_SCHEMA,
    platform,
    generatedAt: new Date().toISOString(),
    legs,
  };
}

/**
 * Validate an incoming report document (fail-closed parse):
 *  - schema identifier must match exactly,
 *  - every leg must carry an explicit classification that matches the
 *    schema's platform classes,
 *  - every status must be one of PASS/FAIL/UNKNOWN,
 *  - unknown legs in the document are rejected (a document that smuggles
 *    an unclassified leg is invalid).
 * @returns {{ok:boolean, report?:object, errors:string[]}}
 */
export function validateReport(doc) {
  const errors = [];
  if (!doc || typeof doc !== "object") {
    return { ok: false, errors: ["report document missing or not an object"] };
  }
  if (doc.schema !== HEALTH_SCHEMA) {
    errors.push(`schema is ${doc.schema ?? "MISSING"}, expected ${HEALTH_SCHEMA}`);
  }
  if (typeof doc.platform !== "string" || doc.platform.length === 0) {
    errors.push("platform missing");
    return { ok: false, errors };
  }
  const classes = legClasses(doc.platform);
  const legs = doc.legs;
  if (!legs || typeof legs !== "object" || Array.isArray(legs)) {
    errors.push("legs missing or malformed");
    return { ok: false, errors };
  }
  const seen = new Set();
  for (const [leg, rec] of Object.entries(legs)) {
    if (!KNOWN_LEGS.includes(leg)) {
      errors.push(`unknown leg ${leg} — rejected (fail closed)`);
      continue;
    }
    seen.add(leg);
    if (!rec || typeof rec !== "object") {
      errors.push(`leg ${leg} record malformed`);
      continue;
    }
    if (rec.classification !== classes[leg]) {
      errors.push(`leg ${leg} classification ${rec.classification ?? "MISSING"}, expected ${classes[leg]}`);
    }
    if (!LEG_VALUES.includes(rec.status)) {
      errors.push(`leg ${leg} status ${rec.status ?? "MISSING"} is not PASS|FAIL|UNKNOWN`);
    }
  }
  for (const leg of KNOWN_LEGS) {
    if (!seen.has(leg)) {
      errors.push(`leg ${leg} missing from report (schema requires every leg)`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Compute `ok` for a validated report: conjunction of required legs only. */
export function reportOk(report) {
  const classes = legClasses(report.platform);
  for (const leg of KNOWN_LEGS) {
    if (classes[leg] === "required" && report.legs[leg].status !== LEG_OK) {
      return false;
    }
  }
  return true;
}

/** First required leg that is not PASS, or null. */
export function firstFailingRequiredLeg(report) {
  const classes = legClasses(report.platform);
  for (const leg of KNOWN_LEGS) {
    if (classes[leg] === "required" && report.legs[leg].status !== LEG_OK) {
      return leg;
    }
  }
  return null;
}

/**
 * Sanitized projection for the public setup orchestrators (P1-01):
 * leg names + status only — no paths, no detail strings, no internal state.
 */
export function sanitizeReport(report) {
  const legs = {};
  for (const [leg, rec] of Object.entries(report.legs)) {
    legs[leg] = { classification: rec.classification, status: rec.status };
  }
  return {
    schema: report.schema,
    platform: report.platform,
    ok: reportOk(report),
    legs,
  };
}
