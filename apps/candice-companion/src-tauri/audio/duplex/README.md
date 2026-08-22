# Candice audio duplex — speech interruption + half-duplex safety (WS-20)

Owned lane: `apps/candice-companion/src-tauri/audio/duplex/**` (PROJECT-MANIFEST
9.2 WR-014 / WS-20; snapshot owned_paths). Sibling of the WS-17 capture lane
(`src-tauri/audio/capture/**`) and the WS-20 cleanup lane
(`src-tauri/audio/cleanup/**`).

## What is proven

Binary acceptance criteria (CHECKLIST E.1 WS-20, Master Spec 6 / 8 / 20):

1. **Press while Candice speaks stops her speech immediately** — the lane
   calls `SpeechTarget.abort()` synchronously inside the same `press()`
   call, then emits `speech:interrupted` for the WS-08 state machine
   (speaking -> listening) and issues exactly one `stop()`.
2. **`ptt:start` is deferred until the playback tail drained** — capture
   never opens over live output (half duplex). `stop()` resolution + a
   `playbackTailMs` sink window gate the listen; the gate open is the only
   path into a NEW listen window.
3. **Candice's own TTS output never feeds STT** — `EchoGate` blocks every
   frame while closed; output windows keep the gate closed, so no output
   frame can reach a transcript path. (The capture lane itself never opens
   on a tail either — two independent seams.)
4. **An interrupt never blocks the session (spec 20)** — a `stop()` that
   rejects or never settles is FORCED after `stopTimeoutMs`; the tail
   window still applies, then `ptt:start` opens. Forced-stops are counted.
5. **Exact-once stop + single-flight press** — a second press while
   interrupting or listening is a no-op; `stop()` is called at most once
   per interrupt.
6. **Stuck-PTT safety** — the controller auto-releases a listen held
   `LISTEN_WINDOW_MS` (60 s), mirroring the WS-17 duration limit.
7. **Release during the tail cancels the phantom listen** — the user
   letting go mid-interrupt never gets a listen window after the tail.

What is NOT proven here: actual audio playback/sink (WS-19 engine +
platform adapter seam), the WS-08 reducer behavior (its own lane), and
pixels on a real desktop (WS-15 harness).

## Wiring contract

```ts
import { DuplexController, EchoGate } from "./duplex/index.ts";
import type { SpeechTarget } from "./duplex/types.ts";
import type { CandiceSideEffect, CandiceEvent } from "../../src/state/machine.ts";

const controller = new DuplexController(); // injected now() in tests
controller.attachTarget(ttsPlaybackTarget); // SpeechTarget: abort() + stop()

// On a PTT press (from WS-17 capture controller):
const t = controller.press();
// forward t.event?.type ("speech:interrupted" or "ptt:start") to the WS-08
// machine, and t.effects (tts:stop/mic:open/mic:close) to the sink.
// controller.tick() is driven by the bridge fast loop AND by the stop
// micro-task continuation; controller.gateFeed(frame) must front the
// frames fed to STT (frame permission of the transcript path).
```

## Run

```bash
node --test apps/candice-companion/src-tauri/audio/duplex/__tests__/duplex.test.ts
```

Requires Node >= 22.6, zero deps, matching the lane convention.
`tsc --strict` typechecks the lane (types only; no emit).

## Files

| File | Purpose |
|---|---|
| `types.ts` | DuplexPhase, DuplexEvent, DuplexEffect, SpeechTarget, DuplexPolicy, DuplexStats |
| `controller.ts` | DuplexController + EchoGate; deterministic via injected `now()`; no timers |
| `index.ts` | Barrel `@candice/audio-duplex` |
| `__tests__/duplex.test.ts` | 17 node:test cases (interrupt, tail, force, gate, single-flight) |
