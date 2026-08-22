/**
 * WS-20 duplex-safety public surface.
 *
 * Owned lane (manifest 9.2 WR-014 / WS-20):
 *   `apps/candice-companion/src-tauri/audio/duplex/**`
 *
 * The rest of the app imports one stable path (`@candice/audio-duplex` in
 * the bridge wiring), never deep imports — same discipline as `@candice/state`.
 */

export {
  DuplexController,
  EchoGate,
  LISTEN_WINDOW_MS,
} from "./controller.ts";
export type { DuplexControllerOptions } from "./controller.ts";

export {
  DUPLEX_DEFAULTS,
} from "./types.ts";
export type {
  DuplexEffect,
  DuplexEvent,
  DuplexPhase,
  DuplexPolicy,
  DuplexStats,
  DuplexTransition,
  SpeechTarget,
} from "./types.ts";
