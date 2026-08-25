# Speech playback contract (producer: speech lane — consumer: animation lane)

The signal an animation consumer drives Candice's mouth from. The speech lane
owns the producer side; nothing in this document requires the consumer to
touch speech code, and the producer never touches mouth/eye/breath code.

**Nothing here is new API.** The events already existed (FIX-016) and already
fire from real playback. This documents them so the consumer can rely on them.

## The three events

Tauri events on the global event channel. Subscribe with
`import { listen } from '@tauri-apps/api/event'`, or use the existing helper
`src/runtime/speech-timing.ts`, which already parses and sequences them into a
`VisemeScheduler`.

Names are exported as constants — import them, do not retype the strings:

```ts
// src/runtime/speech-timing.ts
export const SPEECH_START_EVENT    = 'candice:speech-start';
export const SPEECH_BOUNDARY_EVENT = 'candice:speech-boundary';
export const SPEECH_DRAIN_EVENT    = 'candice:speech-drain';
```

Rust side: `src-tauri/src/speech_timing.rs`
(`SPEECH_START_EVENT` / `SPEECH_BOUNDARY_EVENT` / `SPEECH_DRAIN_EVENT`).

### `candice:speech-start` — audio is about to be produced

```ts
{
  schemaVersion: string;      // 'candice.speech-timing/v1'
  utteranceId: string;        // correlate start with its stop
  timings: Array<{
    phoneme: string;          // ASCII-graphic, <= 16 chars
    startSec: number;         // >= 0, relative to utterance start
    endSec: number;           // > startSec
  }>;
}
```

Emitted by `TtsEngine::synthesize_and_play` **after** the engine returns real
audio and **before** the playback thread starts, so the consumer is armed
before the first sample moves. `timings` may be empty (the worker can return
audio without timings); an empty array is not an error and is not a reason to
skip the mouth-open state.

### `candice:speech-drain` — audio finished naturally

### `candice:speech-boundary` — audio was cut short (interrupt/replace)

Both carry:

```ts
{ schemaVersion: string; utteranceId: string; }
```

## The guarantee that matters: stop always follows start

Exactly one of `drain` or `boundary` fires for every `speech-start`, from the
playback thread, on both exit paths:

```rust
let finished = play_f32_pcm(&pcm, sample_rate, &stop);
if finished { emit_speech_drain(...) } else { emit_speech_boundary(...) }
```

Failure before audio exists (worker error, unreadable or silent PCM) returns
`Err` **before** `speech-start` is emitted, so there is no start without a
stop and no orphaned "speaking" state.

> There is prior art for getting this wrong: the orange PTT wave bars kept
> animating after speech ended, because they were driven by an assumption
> rather than by a stop signal. Drive the mouth from `drain`/`boundary` and
> that class of bug cannot recur. Do not infer "still speaking" from elapsed
> time or from the timings array running out.

Treat an unknown `utteranceId` on a stop event as authoritative anyway: stop.
A stop you did not expect is never a reason to keep the mouth moving.

## Amplitude / envelope

**Not currently emitted, and I am not going to pretend otherwise.** The
producer sends phoneme timings, not an amplitude track. Two honest options:

1. **Drive from `timings`** (available today). `speech-timing.ts` already maps
   phonemes to visemes with real start/end seconds — for lip sync this is
   better than an envelope, because it carries mouth *shape*, not just
   loudness.
2. **A real envelope** would mean computing per-frame RMS from the PCM in
   `TtsEngine::synthesize_and_play` and adding an `envelope: number[]` field
   (plus a `envelopeHz`) to the `speech-start` payload — additive, computed
   once at synthesis rather than streamed per buffer, so it costs no IPC
   during playback. That is a schema change to
   `SpeechStartPayload`/`SPEECH_TIMING_SCHEMA_VERSION`.

If the consumer needs (2), say so and the speech lane will add it. Do not add
it from the consumer side — the payload is producer-owned.

## Observable playback state (secondary; events are primary)

`src/runtime/bridge.ts` mirrors playback onto the root element:

```
data-speech-playback = "speaking" | "idle" | "failed"
```

**Nothing reads this attribute.** Verified across `apps/candice-companion/src`,
all file types: `speech-playback|speechPlayback` occurs only where it is
written (`bridge.ts`) and in comments — no CSS rule, no UI code, no test.
Control on the same search: `candice-captions` returns 5 files including
`src/styles.css`, so the search discriminates.

It is a breadcrumb for a human with a debugger, nothing more. It is set from
the call site, not from the audio thread, so it can lag the real audio by an
IPC hop — **do not drive animation from it.** Use the events.

**It is NOT how a failure reaches the user.** A speech failure is announced in
words on the caption surface via the `announceSpeechFailure` hook, carrying
the reason the native side gave. That matters most for the refusal the native
side now raises deliberately — an unapproved or unresolvable canonical voice —
because refusing to speak in a voice the operator did not choose is only an
improvement if the user is told why she went quiet. An attribute mutation
tells nobody anything.

Separately, `data-speech-status` (`available` | `degraded` | `unprobed` |
`unavailable`) is engine *health* from the startup probe. It is not playback
state; a healthy engine that is silent still reads `available`.

## Ownership

| Side | Owner | Files |
|---|---|---|
| Producer | speech lane | `src-tauri/speech/**`, `src-tauri/src/speech_timing.rs`, `src/runtime/bridge.ts`, `src/runtime/speech-orchestrator.ts` |
| Consumer | animation lane | `src/runtime/speech-timing.ts` consumers, mouth/eye/breath/character code, preferences |

`src/runtime/speech-timing.ts` is the seam: producer-shaped, consumer-used.
Changing the event payloads is a producer change; changing how visemes are
rendered is a consumer change.
