/**
 * Historical payload records deliberately excluded from updater resolution.
 *
 * They are retained for auditability, but `resolveComponent()` cannot return
 * them. FIX-022 must replace these with candidate-specific signed artifacts
 * only after the fail-closed release authority passes.
 */
import { RELEASE_CHANNEL, PLACEHOLDER_SHA256 } from "./components.mjs";

export const QUARANTINED_PAYLOADS = {
  "candice-companion@0.2.0@darwin": {
    id: "candice-companion",
    version: "0.2.0",
    platform: "darwin",
    status: "QUARANTINED",
    reason: "Not release-authorized; package lacks final independent QC, release gate PASS, and signing/notarization evidence.",
    payload: {
      file: "Candice Companion_0.2.0_aarch64.dmg",
      sha256: "f24f4bcb9a267129c856e333c3bb79c687ec4dc11b47558b301f1f0cf6b0dbaf",
      sizeBytes: 2686932,
      sourceUrl: `${RELEASE_CHANNEL}/download/v0.2.0/Candice%20Companion_0.2.0_aarch64.dmg`,
    },
  },
  "candice-companion@0.2.0@win32": {
    id: "candice-companion",
    version: "0.2.0",
    platform: "win32",
    status: "QUARANTINED",
    reason: "Not release-authorized; installer is unsigned and has no verified Windows artifact hash.",
    payload: {
      file: "Candice Companion_0.2.0_x64-setup.exe",
      sha256: PLACEHOLDER_SHA256,
      sizeBytes: 0,
      sourceUrl: `${RELEASE_CHANNEL}/download/v0.2.0/Candice%20Companion_0.2.0_x64-setup.exe`,
    },
  },
};
