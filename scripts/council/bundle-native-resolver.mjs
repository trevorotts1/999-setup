// Council of Wise Elders: the 999 bundle's native resolver (CWE-040).
//
// This file is copied into the per-user runtime prefix at install time
// (scripts/council-runtime-install.sh) and supplies the
// ClaudeNineNativeResolver the generated host wrapper composes with.
//
// Resolution semantics are the bridge's own pinned-route semantics
// (PinnedClaudeNineResolver from the vendored runtime): the selected
// route is reported as attempted exactly as selected, and a selected
// combination reports no member, because the harness may hide which
// configured member served the request; the bridge then states the
// hidden-identity sentence instead of inventing one.
//
// When the harness itself exposes a resolution report (a JSON file in
// the ClaudeNineResolutionReport shape written by the harness's native
// skills), the bundle reads it from the file named by the
// BLACKCEO_COUNCIL_NINE_REPORT environment variable and reports it
// verbatim. The bundle never scrapes tokens, cookies, or settings to
// manufacture a report.

import { readFileSync } from "node:fs";
import { PinnedClaudeNineResolver } from "./runtime/dist/bridges/claude-nine.js";

const pinned = new PinnedClaudeNineResolver();

function harnessReport() {
  const path = process.env.BLACKCEO_COUNCIL_NINE_REPORT;
  if (!path) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed && typeof parsed === "object" && "attemptedModelId" in parsed) {
      return parsed;
    }
  } catch {
    // An unreadable or malformed report is no report: fall through to
    // the pinned semantics rather than failing the session.
  }
  return null;
}

export const bundleNativeResolver = {
  reportResolution(selection, request) {
    return harnessReport() ?? pinned.reportResolution(selection, request);
  },
};
