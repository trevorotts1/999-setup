/**
 * Drives caption sentence-highlighting from the real speech events.
 *
 * `candice:speech-start` carries the utterance's Kokoro phoneme timings, so
 * the total duration is MEASURED. This converts elapsed time into a 0..1
 * fraction and hands it to the captions surface; `speech-drain` (played out)
 * and `speech-boundary` (cut short) clear it.
 *
 * NEVER THROWS. On the plain-web boot path the Tauri event API is absent and
 * this stays inert -- the caption still renders, just without the highlight.
 * A decorative feature must not be able to fail a boot step.
 *
 * @module
 */

import {
  SPEECH_START_EVENT,
  SPEECH_BOUNDARY_EVENT,
  SPEECH_DRAIN_EVENT,
  parseSpeechStart,
  parseSpeechMarker,
  type SpeechTimingListenApi,
} from '../../runtime/speech-timing.ts';
import { durationFromTimings } from './highlight.ts';

/** 100ms is well under sentence granularity and far cheaper than a frame loop. */
export const HIGHLIGHT_TICK_MS = 100;

export interface CaptionHighlightDriver {
  /** True when the native events were actually attached. */
  readonly listening: boolean;
  dispose(): void;
}

export interface CaptionHighlightOptions {
  listenApi?: SpeechTimingListenApi;
  /** Injected clock (tests). Defaults to performance-ish wall time. */
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

export async function attachCaptionHighlight(
  setProgress: (fraction: number | null) => void,
  options: CaptionHighlightOptions = {},
): Promise<CaptionHighlightDriver> {
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
  const clearTimer = options.clearInterval ?? ((h) => globalThis.clearInterval(h as never));

  let disposed = false;
  let activeId: string | null = null;
  let startedAt = 0;
  let durationMs = 0;
  let timer: unknown = null;
  const unlisteners: Array<() => void> = [];

  const stop = (): void => {
    if (timer !== null) { clearTimer(timer); timer = null; }
    activeId = null;
    durationMs = 0;
    setProgress(null);
  };

  const tick = (): void => {
    if (disposed || durationMs <= 0) return;
    const elapsed = now() - startedAt;
    // Clamped, never past 1: an utterance that runs slightly long must leave
    // the last sentence lit rather than wrapping back to the first.
    setProgress(Math.max(0, Math.min(1, elapsed / durationMs)));
  };

  try {
    const listenApi: SpeechTimingListenApi = options.listenApi
      ?? (await import('@tauri-apps/api/event'));

    unlisteners.push(await listenApi.listen(SPEECH_START_EVENT, (event) => {
      if (disposed) return;
      const payload = parseSpeechStart(event.payload);
      if (!payload) return;
      const total = durationFromTimings(payload.timings);
      activeId = payload.utteranceId;
      if (total <= 0) {
        // Timings present but unusable: show no highlight rather than a
        // highlight driven by a made-up duration.
        stop();
        return;
      }
      durationMs = total;
      startedAt = now();
      if (timer !== null) clearTimer(timer);
      timer = setTimer(tick, HIGHLIGHT_TICK_MS);
      tick();
    }));

    const endOn = (payload: unknown): void => {
      if (disposed) return;
      const marker = parseSpeechMarker(payload);
      if (!marker) return;
      // Same identity rule the bridge and the viseme scheduler use: a late
      // marker from a replaced utterance must not clear the live highlight.
      if (activeId !== null && marker.utteranceId !== activeId) return;
      stop();
    };
    unlisteners.push(await listenApi.listen(SPEECH_DRAIN_EVENT, (e) => endOn(e.payload)));
    unlisteners.push(await listenApi.listen(SPEECH_BOUNDARY_EVENT, (e) => endOn(e.payload)));
  } catch {
    // No native event API (plain-web boot). Inert, and the caption still shows.
    return { listening: false, dispose(): void { disposed = true; } };
  }

  return {
    listening: true,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (timer !== null) { clearTimer(timer); timer = null; }
      for (const un of unlisteners) { try { un(); } catch { /* best effort */ } }
      unlisteners.length = 0;
    },
  };
}
