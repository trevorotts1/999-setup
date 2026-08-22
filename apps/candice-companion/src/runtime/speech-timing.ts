/**
 * TTS speech-timing channel (FIX-016).
 *
 * The native shell emits three timing facts over the existing bridge
 * event surface — `candice:speech-start` (phoneme timings),
 * `candice:speech-boundary` (utterance replaced/interrupted), and
 * `candice:speech-drain` (output provably silent) — and this module
 * validates them and feeds the WS-12 `VisemeScheduler`. The scheduler
 * stays a pure, asset-free state machine; this channel is the only
 * production consumer of its timing input.
 *
 * No new auth surface: the events ride the same `app.emit` surface as
 * the authenticated bridge events, and the invoke commands live in the
 * same handler list. Validation here is format sanitation, not
 * authorization — a webview caller is already inside the shell.
 *
 * Determinism rules (inherited from WS-08/WS-12): no timers inside.
 * The channel never reads a clock of its own; the scheduler owns the
 * timing clock and this channel only feeds it validated events.
 */

import type { VisemeScheduler } from '../animation/viseme/scheduler.ts';

export const SPEECH_TIMING_SCHEMA_VERSION = '1.0';
export const SPEECH_START_EVENT = 'candice:speech-start';
export const SPEECH_BOUNDARY_EVENT = 'candice:speech-boundary';
export const SPEECH_DRAIN_EVENT = 'candice:speech-drain';

/** Hard ceiling on phoneme timings per utterance (mirrors the native cap). */
const MAX_TIMINGS = 4096;

/** One phoneme span, exactly the WS-19 `PhonemeTiming` contract shape. */
export interface SpeechTiming {
  phoneme: string;
  startSec: number;
  endSec: number;
}

export interface SpeechStartPayload {
  schemaVersion: string;
  utteranceId: string;
  timings: SpeechTiming[];
}

export interface SpeechMarkerPayload {
  schemaVersion: string;
  utteranceId: string;
}

export interface SpeechTimingChannel {
  /** True while a native event listener is attached. */
  readonly listening: boolean;
  /** The utterance id the scheduler is currently animating, if any. */
  readonly activeUtteranceId: string | null;
  /** Detach all listeners and stop the scheduler. Idempotent. */
  dispose(): void;
}

/** Minimal event-listen contract; the Tauri event API satisfies it. */
export interface SpeechTimingListenApi {
  listen(event: string, handler: (event: { payload: unknown }) => void): Promise<() => void>;
}

export interface SpeechTimingChannelOptions {
  /** Injected for tests; defaults to the Tauri event API. */
  listenApi?: SpeechTimingListenApi;
}

function validUtteranceId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 128
    && /^[!-~]+$/.test(value);
}

function validTiming(value: unknown): value is SpeechTiming {
  if (!value || typeof value !== 'object') return false;
  const timing = value as Record<string, unknown>;
  return typeof timing.phoneme === 'string'
    && timing.phoneme.length > 0
    && timing.phoneme.length <= 16
    && /^[\x21-\x7e]+$/.test(timing.phoneme)
    && typeof timing.startSec === 'number'
    && Number.isFinite(timing.startSec)
    && timing.startSec >= 0
    && typeof timing.endSec === 'number'
    && Number.isFinite(timing.endSec)
    && timing.endSec > timing.startSec;
}

/**
 * Parse a speech-start payload. Returns null for anything malformed —
 * the channel must never throw on real-world event traffic, and a
 * malformed payload must never reach the scheduler.
 */
export function parseSpeechStart(payload: unknown): SpeechStartPayload | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as Record<string, unknown>;
  if (value.schemaVersion !== SPEECH_TIMING_SCHEMA_VERSION
    || !validUtteranceId(value.utteranceId)
    || !Array.isArray(value.timings)
    || value.timings.length > MAX_TIMINGS) return null;
  const timings: SpeechTiming[] = [];
  for (const item of value.timings) {
    if (!validTiming(item)) return null;
    timings.push(item as SpeechTiming);
  }
  return { schemaVersion: value.schemaVersion, utteranceId: value.utteranceId, timings };
}

/** Parse a boundary/drain marker payload. Null for anything malformed. */
export function parseSpeechMarker(payload: unknown): SpeechMarkerPayload | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as Record<string, unknown>;
  if (value.schemaVersion !== SPEECH_TIMING_SCHEMA_VERSION
    || !validUtteranceId(value.utteranceId)) return null;
  return { schemaVersion: value.schemaVersion, utteranceId: value.utteranceId };
}

/**
 * Attach the native speech-timing events to a viseme scheduler.
 *
 * - `speech-start` loads the utterance's phoneme timings into the
 *   scheduler (the scheduler itself skips spans that do not map to a
 *   valid viseme event — garbage in, gap out, never a throw).
 * - `speech-boundary` stops the current utterance; a new start event
 *   follows if speech continues.
 * - `speech-drain` stops the current utterance; the mouth returns to
 *   closed. A drain for a stale utterance id is ignored.
 *
 * Returns a channel handle; `dispose()` detaches the listeners and
 * stops the scheduler. Safe as a no-op when the Tauri event API is
 * absent (plain-web boot path).
 */
export async function attachSpeechTimingChannel(
  scheduler: VisemeScheduler,
  options: SpeechTimingChannelOptions = {},
): Promise<SpeechTimingChannel> {
  let activeUtteranceId: string | null = null;
  let disposed = false;
  const unlisteners: Array<() => void> = [];

  const stopActive = (): void => {
    if (activeUtteranceId !== null) {
      scheduler.stop();
      activeUtteranceId = null;
    }
  };

  try {
    const listenApi: SpeechTimingListenApi = options.listenApi
      ?? (await import('@tauri-apps/api/event'));
    const unlistenStart = await listenApi.listen(SPEECH_START_EVENT, (event) => {
      if (disposed) return;
      const payload = parseSpeechStart(event.payload);
      if (!payload) return;
      // A new utterance replaces the current one; the scheduler's start
      // call resets its own state, so no explicit stop is needed here.
      scheduler.start(payload.timings);
      activeUtteranceId = payload.utteranceId;
    });
    const unlistenBoundary = await listenApi.listen(SPEECH_BOUNDARY_EVENT, (event) => {
      if (disposed) return;
      const payload = parseSpeechMarker(event.payload);
      if (!payload) return;
      if (activeUtteranceId !== null && payload.utteranceId !== activeUtteranceId) return;
      stopActive();
    });
    const unlistenDrain = await listenApi.listen(SPEECH_DRAIN_EVENT, (event) => {
      if (disposed) return;
      const payload = parseSpeechMarker(event.payload);
      if (!payload) return;
      if (activeUtteranceId !== null && payload.utteranceId !== activeUtteranceId) return;
      stopActive();
    });
    unlisteners.push(unlistenStart, unlistenBoundary, unlistenDrain);
  } catch {
    // Tauri event API absent (plain-web boot): the channel stays inert.
    // The scheduler remains idle-closed; the shell degrades to text.
  }

  return {
    get listening(): boolean {
      return !disposed && unlisteners.length > 0;
    },
    get activeUtteranceId(): string | null {
      return activeUtteranceId;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const unlisten of unlisteners) {
        try { unlisten(); } catch { /* best-effort teardown */ }
      }
      unlisteners.length = 0;
      stopActive();
    },
  };
}
