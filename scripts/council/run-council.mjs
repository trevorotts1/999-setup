#!/usr/bin/env node
// Council of Wise Elders: runtime prefix entry point (CWE-040).
//
// Installed at <data profile>/runtime/<content hash>/run-council.mjs by
// scripts/council-runtime-install.sh (macOS) and
// scripts/council-runtime-install.ps1 (Windows). The platform
// blackceo-council executable execs this file through the prefix's
// `current` link, so an update swaps the whole prefix atomically and
// the executable never points into a synchronized skill folder.
//
// It loads the install-time bundled entry (runtime/dist/council-entry
// .mjs), which composes the bundle's generated host wrapper (emitted
// verbatim into runtime/dist from the CWE-010 template in
// runtime/src/bridges/claude-nine.ts) with the bundle's native
// resolver. The entry is bundled with the runtime's own esbuild for
// the same reason the package's own blackceo-council bin is bundled:
// the canonical contracts package uses extensionless import
// specifiers, which plain Node ESM cannot resolve from the tsc output
// tree. The bundle's exit code is set by the entry itself.

import "./runtime/dist/council-entry.mjs";
