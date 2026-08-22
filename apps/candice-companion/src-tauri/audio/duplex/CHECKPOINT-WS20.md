# WS-20 CHECKPOINT — speech interruption, duplex safety, audio cleanup

- Slice: WR-014 (5+5 candice-speech), unit WS-20
- Date: 2026-08-21
- Branch: `candice/wr001-bootstrap` @ base 6bb00ec, worktree
  `/Users/blackceomacmini/Downloads/999-setup/worktrees/wr001-bootstrap`
- Ownership: `apps/candice-companion/src-tauri/audio/duplex/**` +
  `apps/candice-companion/src-tauri/audio/cleanup/**` (worktree
  PROJECT-MANIFEST 9.2 WR-014 WS-20; snapshot owned_paths)
- Not committed, not pushed (per fan-out rule).

## Acceptance criterion (CONTROL/CHECKLIST.md E.1 WS-20)

> WS-20 PASS: pressing PTT while Candice speaks stops her speech immediately;
> Candice's own TTS output never feeds STT; temp audio is discarded after
> transcription.

Status: **all legs satisfied with primary-source evidence; blind QC recheck
REQUIRED.**

## Files (all under the two owned globs)

### `src-tauri/audio/duplex/**`

1. `types.ts` — DuplexPhase, DuplexEvent, DuplexEffect, SpeechTarget
   (abort + stop contract), DuplexPolicy, DuplexStats. Effects/events shape
   mirror WS-08 `CandiceSideEffect`/events.
2. `controller.ts` — DuplexController + EchoGate. Deterministic: injected
   `now()`, no timers (tick() is the clock); interrupt sequence
   abort -> speech:interrupted -> stop -> tail -> ptt:start; force limb at
   stopTimeoutMs (spec 20); single-flight press; exact-once stop; stuck-PTT
   auto-release at 60 s; cancelled read mid-tail.
3. `index.ts` — barrel.
4. `__tests__/duplex.test.ts` — 17 node:test cases.
5. `README.md` — contract + wiring.
6. `CHECKPOINT-WS20.md` — this file.

### `src-tauri/audio/cleanup/**`

1. `types.ts` — SessionTempLayout/Open, ArtifactDeleteResult, SweepResult,
   FsAdapter (injectable real fs), SweepPolicy.
2. `session-temp.ts` — openSessionTemp (0o700, marker, realpath safety),
   deleteArtifact (delete-after-transcribe, both limbs), closeSessionTemp.
3. `sweep.ts` — sweepStaleTempAudio: marker-gated, age-gated (>= staleAfterMs),
   bounded (maxRemovals, oldest first).
4. `index.ts` — barrel.
5. `__tests__/cleanup.test.ts` — 11 node:test cases on a REAL temp
   filesystem (no mocking).
6. `README.md` — contract + wiring.
7. `CHECKPOINT-WS20.md` — this file.

## Evidence (run 2026-08-21, this worktree, Node v26.7.0)

```
node --test src-tauri/audio/duplex/__tests__/duplex.test.ts
  tests 17  pass 17  fail 0
node --test src-tauri/audio/cleanup/__tests__/cleanup.test.ts
  tests 11  pass 11  fail 0
tsc --strict (lane files, noEmit) — clean
```

## Deps consumed (verified present in this worktree)

- WS-08 `src/state/machine.ts` — `speech:interrupted` event + `tts:stop` /
  `mic:open` / `mic:close` side effects; the lane's effects are
  type-compatible (shape test in duplex.test.ts).
- WS-17 `src-tauri/audio/capture/**` — `PttEvent::InterruptRequest`
  (controller.rs) already emits on press; this lane is the authority that
  arbitrates the physical mic against the tail.
- WS-19 `src-tauri/tts/**` — `render.ts` AbortSignal + `KokoroEngine.stop()`
  (engine.ts) map to `SpeechTarget.abort()` / `stop()`.

## Notes / cross-lane

- WS-18 (`src/ui/transcript/**`) consumes the discarded recording after
  confirmation; the discard itself is WS-17 (`take_recording`) + this lane
  (temp wav delete for the whisper transport).
- WS-44 privacy audit (WR-021, deps depend on WS-20) will read the EchoGate
  + cleanup invariants as the audio-never-logs/never-uploads evidence.
- Windows capture path (WS-28, `src-tauri/audio/capture-windows/**`) is a
  platform adapter; the duplex/cleanup lanes are shared code and stay
  platform-agnostic (no OS imports in source).
