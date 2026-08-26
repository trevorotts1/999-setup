# Candice audio cleanup — temp audio lifecycle (WS-20)

Owned lane: `apps/candice-companion/src-tauri/audio/cleanup/**`
(PROJECT-MANIFEST 9.2 WR-014 / WS-20; snapshot owned_paths). Sibling of the
WS-17 capture lane and the ws-20 duplex lane.

## What is proven

Master Spec section 8 rules, with automated tests (the acceptance requires
the cleanup path to have automated tests):

1. **Per-session temp dir only** — every temp audio artifact lives under
   `<platform temp>/candice-companion/session-<id>/`; never an arbitrary
   path.
2. **Restrictive permissions** — the session dir is created `0o700`
   (owner-only), mode is re-applied on reopen even after a crash left a
   looser dir.
3. **Delete after transcription, success OR failure** — `deleteArtifact`
   removes the whole session dir (wav inside) unconditionally; the second
   limb (already gone) reports `alreadyGone: true` honestly, never an
   invented deletion.
4. **Session end cleanup** — `closeSessionTemp` removes the dir;
   idempotent.
5. **Startup cleanup for crash leftovers** — `sweepStaleTempAudio` removes
   only marker-carrying (`SESSION_MARKER`), stale (>= `staleAfterMs`)
   session dirs, oldest first, bounded by `maxRemovals`. Unmarked
   look-alike dirs are never touched, however old.
6. **Path safety** — session ids are restricted (`[A-Za-z0-9_-]{1,64}`),
   the resolved dir (realpath) is verified to be a direct child of the
   Candice temp root, and the base root must be absolute. A session id can
   never traverse out of the root.

The preferred path stays `microphone -> in-memory ring buffer -> whisper.cpp
-> transcript -> discard` (WS-17 ring buffer: zero disk audio). The temp
file path exists only for the whisper.cpp file transport — and when that
transport is used, every artifact goes through this lane.

## Wiring contract

```ts
import { openSessionTemp, deleteArtifact, closeSessionTemp, sweepStaleTempAudio }
  from "./cleanup/index.ts";
import { platformTempRoot } from "<platform adapter>"; // os.tmpdir() / %LOCALAPPDATA%\Temp

const fs = realFsAdapter; // node:fs/promises surface (FsAdapter)
const opened = await openSessionTemp(fs, os.tmpdir(), sessionId);
// -> { layout: { dirPath, wavPath, sessionId }, created, swept }
try {
  const result = await whisperTranscribe(opened.layout.wavPath, ...);
} finally {
  await deleteArtifact(fs, opened.layout); // success AND failure limbs
}
await closeSessionTemp(fs, opened.layout); // session end
await sweepStaleTempAudio({ fs, baseRoot }); // startup sweep
```

## Run

```bash
node --test apps/candice-companion/src-tauri/audio/cleanup/__tests__/cleanup.test.ts
```

Runs against REAL temp directories under a throwaway `mkdtemp` root — no
mocking; every removal assertion is a real filesystem proof. `tsc --strict`
typechecks the lane.

## Files

| File | Purpose |
|---|---|
| `types.ts` | SessionTempLayout/Open, ArtifactDeleteResult, SweepResult, FsAdapter, SweepPolicy |
| `session-temp.ts` | openSessionTemp, deleteArtifact, closeSessionTemp; 0o700 + realpath safety |
| `sweep.ts` | sweepStaleTempAudio — marker-gated, age-gated, bounded stale cleanup |
| `index.ts` | Barrel `@candice/audio-cleanup` |
| `__tests__/cleanup.test.ts` | 11 node:test cases on real filesystem |
