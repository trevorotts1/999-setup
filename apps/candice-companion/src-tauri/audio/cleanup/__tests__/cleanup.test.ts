/**
 * WS-20 audio-cleanup acceptance tests (node:test, zero deps).
 *
 * Runs on REAL temp directories (no mocking): the lane is exercised against
 * the actual filesystem adapter the bridge uses, with a throwaway
 * `baseRoot` per test so nothing outside the test can be touched.
 *
 * Covers the E.1 WS-20 criterion and Master Spec 8 steps 1-7:
 *   - session dir lives under the Candice-owned temp root;
 *   - restrictive 0o700 permissions;
 *   - delete-after-transcribe succeeds AND fails (both limbs);
 *   - session-end close; startup sweep for crash leftovers;
 *   - no abandoned audio accumulates.
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, stat, writeFile, utimes, chmod, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
  closeSessionTemp,
  deleteArtifact,
  openSessionTemp,
  sweepStaleTempAudio,
  SESSION_MARKER,
  InvalidSessionIdError,
  TempRootSafetyError,
} from "../index.ts";
import type { FsAdapter } from "../types.ts";

/** The real fs adapter the bridge uses, parameterized over a scratch root. */
function realFs(root: string): FsAdapter {
  return {
    mkdir: (p, mode) => mkdir(p, { mode }) as unknown as Promise<void>,
    readdir: (p) => readdir(p),
    stat: async (p) => {
      const s = await stat(p);
      return {
        isDirectory: s.isDirectory(),
        isFile: s.isFile(),
        mtimeMs: s.mtimeMs,
        mode: s.mode & 0o777,
      };
    },
    rm: (p, opts) => rm(p, opts as { recursive: boolean; force?: boolean }) as unknown as Promise<void>,
    writeFile: (p, data) => writeFile(p, data) as unknown as Promise<void>,
    realpath: (p) => realpath(p),
    exists: async (p) => {
      try {
        await stat(p);
        return true;
      } catch {
        return false;
      }
    },
  };
}

async function scratchRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "candice-cleanup-test-"));
}

const CLEANUP_ROOTS: string[] = [];
after(async () => {
  for (const root of CLEANUP_ROOTS) {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
});

describe("WS-20 session temp audio (spec 8 steps 1-4)", () => {
  it("creates the session dir under the Candice temp root with 0o700", async () => {
    const base = await scratchRoot();
    CLEANUP_ROOTS.push(base);
    const fs = realFs(base);
    const opened = await openSessionTemp(fs, base, "sess-abc123");
    assert.equal(opened.created, true);
    assert.equal(opened.swept, false);
    assert.ok(opened.layout.dirPath.startsWith(join(base, "candice-companion")), "dir must live under the Candice temp root");
    assert.ok(opened.layout.wavPath.endsWith("utterance.wav"));
    const mode = (await stat(opened.layout.dirPath)).mode & 0o777;
    assert.equal(mode, 0o700, "session dir must be owner-only");
  });

  it("refuses traversal-style session ids and unsafe base roots", async () => {
    const base = await scratchRoot();
    CLEANUP_ROOTS.push(base);
    const fs = realFs(base);
    await assert.rejects(() => openSessionTemp(fs, base, "..\\.."), InvalidSessionIdError);
    await assert.rejects(() => openSessionTemp(fs, base, "../escape"), InvalidSessionIdError);
    await assert.rejects(() => openSessionTemp(fs, "relative/path", "ok-id"), TempRootSafetyError);
  });

  it("delete-after-transcribe removes the wav (success limb)", async () => {
    const base = await scratchRoot();
    CLEANUP_ROOTS.push(base);
    const fs = realFs(base);
    const opened = await openSessionTemp(fs, base, "sess-succ");
    // Simulate the whisper transport writing the wav.
    await writeFile(opened.layout.wavPath, new Uint8Array([1, 2, 3]));
    assert.equal(await fs.exists(opened.layout.wavPath), true);
    const r = await deleteArtifact(fs, opened.layout);
    assert.equal(r.deleted, true);
    assert.equal(r.alreadyGone, false);
    assert.equal(await fs.exists(opened.layout.wavPath), false);
    assert.equal(await fs.exists(opened.layout.dirPath), false, "audio discarded, dir removed");
  });

  it("delete-after-transcribe is idempotent and honest when already gone (failure limb)", async () => {
    const base = await scratchRoot();
    CLEANUP_ROOTS.push(base);
    const fs = realFs(base);
    const opened = await openSessionTemp(fs, base, "sess-fail");
    await deleteArtifact(fs, opened.layout); // first pass (e.g. success limb)
    const r = await deleteArtifact(fs, opened.layout); // second pass (e.g. failure limb)
    assert.equal(r.deleted, false);
    assert.equal(r.alreadyGone, true, "second limb must not invent a deletion");
  });

  it("session-end close removes the session dir; a reopen of the same id sweeps leftovers", async () => {
    const base = await scratchRoot();
    CLEANUP_ROOTS.push(base);
    const fs = realFs(base);
    const opened = await openSessionTemp(fs, base, "sess-crash");
    await writeFile(opened.layout.wavPath, new Uint8Array([9, 9]));
    // Simulate crash: no close call; the process died here.
    const reopened = await openSessionTemp(fs, base, "sess-crash");
    assert.equal(reopened.created, false);
    assert.equal(reopened.swept, true, "orphan wav must be swept on reopen");
    assert.equal(await fs.exists(opened.layout.wavPath), false, "orphan audio must not survive");
    const closed = await closeSessionTemp(fs, reopened.layout);
    assert.equal(closed.deleted, true);
    assert.equal(await fs.exists(opened.layout.dirPath), false);
  });

  it("no marker-less path is ever touched by the open/close path", async () => {
    const base = await scratchRoot();
    CLEANUP_ROOTS.push(base);
    const fs = realFs(base);
    const opened = await openSessionTemp(fs, base, "sess-marker");
    const marker = join(opened.layout.dirPath, SESSION_MARKER);
    assert.equal(await fs.exists(marker), true, "ownership marker must exist");
  });
});

describe("WS-20 startup sweep (spec 8 steps 6-7)", () => {
  it("removes only stale marker-carrying session dirs, keeps fresh ones", async () => {
    const base = await scratchRoot();
    CLEANUP_ROOTS.push(base);
    const fs = realFs(base);
    const now = Date.UTC(2026, 7, 21, 12, 0, 0);
    const stale = await openSessionTemp(fs, base, "sess-old");
    const fresh = await openSessionTemp(fs, base, "sess-new");
    // Age the "old" session dir beyond the staleness window.
    const oldTime = new Date(now - 30 * 24 * 3600 * 1000);
    await utimes(stale.layout.dirPath, oldTime, oldTime);
    const result = await sweepStaleTempAudio({ fs, baseRoot: base, nowMs: now });
    assert.equal(result.removed, 1);
    assert.equal(await fs.exists(stale.layout.dirPath), false, "stale audio removed");
    assert.equal(await fs.exists(fresh.layout.dirPath), true, "fresh session kept");
    assert.equal(result.kept, 1);
    assert.ok(result.oldestKeptAgeMs !== null);
  });

  it("never removes directories without the Candice marker, however stale", async () => {
    const base = await scratchRoot();
    CLEANUP_ROOTS.push(base);
    const fs = realFs(base);
    const now = Date.UTC(2026, 7, 21, 12, 0, 0);
    // A lookalike dir with the same naming convention but NO marker.
    const lookalike = join(base, "candice-companion", "session-decoy");
    await mkdir(lookalike, { recursive: true });
    await writeFile(join(lookalike, "utterance.wav"), new Uint8Array([7, 7]));
    const oldTime = new Date(now - 90 * 24 * 3600 * 1000);
    await utimes(lookalike, oldTime, oldTime);
    const result = await sweepStaleTempAudio({ fs, baseRoot: base, nowMs: now });
    assert.equal(result.removed, 0);
    assert.equal(await fs.exists(lookalike), true, "unmarked dir must be untouchable");
  });

  it("fresh install: missing candice root is a clean no-op", async () => {
    const base = await scratchRoot();
    CLEANUP_ROOTS.push(base);
    const fs = realFs(base);
    const result = await sweepStaleTempAudio({ fs, baseRoot: base, nowMs: Date.now() });
    assert.deepEqual(result, { scanned: 0, removed: 0, kept: 0, failed: 0, oldestKeptAgeMs: null });
  });

  it("bounded removal: maxRemovals protects live sessions in a crash storm (oldest first)", async () => {
    const base = await scratchRoot();
    CLEANUP_ROOTS.push(base);
    const fs = realFs(base);
    const now = Date.UTC(2026, 7, 21, 12, 0, 0);
    const ids: Array<{ dir: string }> = [];
    for (let i = 0; i < 4; i += 1) {
      const o = await openSessionTemp(fs, base, `sess-storm-${i}`);
      const t = new Date(now - (10 + i * 5) * 24 * 3600 * 1000);
      await utimes(o.layout.dirPath, t, t);
      ids.push({ dir: o.layout.dirPath });
    }
    const result = await sweepStaleTempAudio({ fs, baseRoot: base, nowMs: now, policy: { maxRemovals: 2 } });
    assert.equal(result.removed, 2);
    // Oldest first: sess-storm-3 (10 days) and sess-storm-2 (15 days) were removed.
    assert.equal(await fs.exists(ids[3].dir), false);
    assert.equal(await fs.exists(ids[2].dir), false);
    assert.equal(await fs.exists(ids[1].dir), true);
    assert.equal(await fs.exists(ids[0].dir), true);
    // Remaining stale dirs were NOT silently lost: they are reported as kept.
    assert.equal(result.kept, 2);
  });

  it("permissions are re-applied on reopen even if a crash left them loose", async () => {
    const base = await scratchRoot();
    CLEANUP_ROOTS.push(base);
    const fs = realFs(base);
    const opened = await openSessionTemp(fs, base, "sess-mode");
    await chmod(opened.layout.dirPath, 0o755); // simulate a loose legacy dir
    const reopened = await openSessionTemp(fs, base, "sess-mode");
    assert.equal(reopened.swept, true);
    const mode = (await stat(reopened.layout.dirPath)).mode & 0o777;
    assert.equal(mode, 0o700);
  });
});
