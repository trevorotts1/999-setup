/**
 * WS-20 startup sweep — stale temp audio left by crashes.
 *
 * Owned lane (manifest 9.2 WR-014 / WS-20):
 *   `apps/candice-companion/src-tauri/audio/cleanup/**`
 *
 * Master Spec section 8 step 6: "Run startup cleanup for stale temp audio
 * left by crashes" — with the companion rule "Never allow abandoned audio
 * to accumulate over time."
 *
 * Safety rules:
 *  - only directories UNDER `candice-companion/<root>` are ever removed;
 *  - only directories carrying the Candice marker file are considered (a
 *    naming coincidence never causes a delete);
 *  - a directory younger than `staleAfterMs` is kept (a live session may
 *    simply be between questions);
 *  - removal is bounded by `maxRemovals` per sweep and always removes the
 *    OLDEST dirs first (a crash storm must not threaten new live sessions);
 *  - a removal failure is counted and returned, never swallowed silently.
 */

import type { FsAdapter, StaleDirEntry, SweepPolicy, SweepResult } from "./types.ts";
import { SESSION_MARKER, CANDICE_TEMP_ROOT } from "./session-temp.ts";
import { SWEEP_DEFAULTS } from "./types.ts";

export type { StaleDirEntry, SweepPolicy, SweepResult } from "./types.ts";

export interface SweepOptions {
  fs: FsAdapter;
  baseRoot: string;
  nowMs?: number;
  policy?: Partial<SweepPolicy>;
}

/**
 * Startup cleanup. Idempotent — running it twice removes nothing twice —
 * and safe while sessions are running: only marker-carrying dirs older
 * than the staleness window are touched.
 */
export async function sweepStaleTempAudio(options: SweepOptions): Promise<SweepResult> {
  const { fs, baseRoot } = options;
  const now = options.nowMs ?? Date.now();
  const policy: Required<SweepPolicy> = { ...SWEEP_DEFAULTS, ...(options.policy ?? {}) };

  const root = await pathJoin(fs, baseRoot, CANDICE_TEMP_ROOT);
  const rootExists = await fs.exists(root).catch(() => false);
  if (!rootExists) {
    // Fresh machine: nothing to sweep.
    return { scanned: 0, removed: 0, kept: 0, failed: 0, oldestKeptAgeMs: null };
  }

  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    // Unreadable root: report failed truthfully; never delete blindly.
    return { scanned: 0, removed: 0, kept: 0, failed: 1, oldestKeptAgeMs: null };
  }

  const stale: StaleDirEntry[] = [];
  const keptAges: number[] = [];

  for (const name of entries) {
    const dirPath = await pathJoin(fs, root, name);
    const dirStat = await fs.stat(dirPath).catch(() => null);
    if (!dirStat || dirStat.isDirectory !== true) {
      // Non-directory junk under the candice root is not an owned audio
      // container: never removed by this lane.
      continue;
    }
    // Ownership proof: the marker file must exist. Without it the delete
    // cannot fire, regardless of how old the directory looks.
    const markerPath = await pathJoin(fs, dirPath, policy.markerName);
    const hasMarker = await fs.exists(markerPath).catch(() => false);
    if (!hasMarker) {
      continue;
    }
    const ageMs = Math.max(0, now - dirStat.mtimeMs);
    if (ageMs >= policy.staleAfterMs) {
      stale.push({ dirPath, sessionId: name, ageMs });
    } else {
      keptAges.push(ageMs);
    }
  }

  // Oldest first: a crash storm keeps the freshest orphans for the next sweep.
  stale.sort((a, b) => b.ageMs - a.ageMs);
  const removeCount = Math.min(stale.length, policy.maxRemovals);
  let removed = 0;
  let failed = 0;
  for (let i = 0; i < removeCount; i += 1) {
    try {
      await fs.rm(stale[i].dirPath, { recursive: true });
      removed += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    scanned: entries.length,
    removed,
    // kept = fresh marker dirs + stale dirs beyond this sweep's bound.
    kept: keptAges.length + (stale.length - removed),
    failed,
    oldestKeptAgeMs: keptAges.length > 0 ? Math.min(...keptAges) : null,
  };
}

async function pathJoin(fs: FsAdapter, ...parts: string[]): Promise<string> {
  const sep = (await import("node:path")).sep;
  return parts.join(sep);
}
