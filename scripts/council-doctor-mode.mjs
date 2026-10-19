#!/usr/bin/env node
// Council doctor mode derivation, shared by both runtime installers.
//
//   node council-doctor-mode.mjs --root <dir>
//   -> prints "distribution" or "source", exit 0
//   -> prints "ERROR <refusal>" on stderr, exit 1 when the resolved tree
//      is NEITHER a source package NOR an extracted distribution.
//
// The installer derives the mode; it never hardcodes one and never lets
// the doctor pick its own mode.
//
// Rule (evaluated on the tree that will actually be staged):
//   ARCHIVE = <root>/council-of-wise-elders.skill
//   A. ARCHIVE is a regular file AND manifest.archive.status == "generated"
//        -> source. The doctor then binds ARCHIVE's SHA-256 to the manifest.
//   B. ARCHIVE is absent AND manifest.archive.status == "extracted_distribution"
//        -> distribution. This is the packaged vendored tree exactly as
//           scripts/build-bundles.mjs writes it (build-bundles.mjs:327-330).
//   C. Anything else -> refuse. A relabelled manifest with no archive
//      reaches neither branch, so it cannot select the weaker mode.
//
// Why relabelling alone cannot spoof it:
//   - Weakening direction (strip ARCHIVE, keep status): rule C refuses.
//     Nothing in the tree says which mode to trust; the installer decides,
//     and its only two arms are each locked to one (archive, status) pair.
//   - Strengthening direction (relabel status "generated", ARCHIVE also
//     present): rule A selects source and the doctor MUST bind ARCHIVE to
//     the manifest SHA-256, so a stale or foreign archive is refused.
//   - The archive and manifest.json are both excluded from the tree
//     aggregate, so relabelling cannot disturb the aggregate hash; the
//     derivation therefore reads facts the aggregate was never meant to
//     carry, and the archive byte binding is what the distribution leg
//     deliberately does not have.
//   - Residual, reported not hidden: if a tree has the correct archive AND
//     a "generated" status, it is a source package and is treated as one
//     (the stronger mode). No weaker outcome is reachable by relabelling.
//
// This is package consistency checking, not a signature or publisher
// attestation.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export const ARCHIVE_NAME = "council-of-wise-elders.skill";

export function deriveDoctorMode(root) {
  const manifestPath = join(root, "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    return { error: `cannot read ${manifestPath}: ${error instanceof Error ? error.message : String(error)}` };
  }
  const archivePath = join(root, ARCHIVE_NAME);
  let hasArchive = false;
  if (existsSync(archivePath)) {
    if (!statSync(archivePath).isFile()) {
      return { error: `${ARCHIVE_NAME} exists but is not a regular file` };
    }
    hasArchive = true;
  }
  const status = manifest.archive?.status ?? "(missing)";
  if (hasArchive && status === "generated") {
    return { mode: "source", reason: `archive present and status=generated; the doctor binds the archive SHA-256` };
  }
  if (!hasArchive && status === "extracted_distribution") {
    return { mode: "distribution", reason: `no archive and status=extracted_distribution (extracted distribution)` };
  }
  if (hasArchive && status === "extracted_distribution") {
    return { error: `source tree is neither a source package (generated + archive) nor an extracted distribution; found status=extracted_distribution WITH ${ARCHIVE_NAME} present` };
  }
  return { error: `source tree is neither a source package (generated + archive) nor an extracted distribution; found status=${status} with ${hasArchive ? "" : "no "}${ARCHIVE_NAME}` };
}

// CLI entry point for the shell installer.
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--root");
  const root = i >= 0 ? resolve(args[i + 1]) : null;
  if (!root) {
    console.error("ERROR --root <dir> is required");
    process.exit(1);
  }
  const result = deriveDoctorMode(root);
  if (result.error) {
    console.error(`ERROR ${result.error}`);
    process.exit(1);
  }
  console.log(result.mode);
}
