/**
 * Candice viseme animation public surface (WS-12).
 *
 * What this lane owns: the viseme state machine — TTS timing ingestion,
 * phoneme→mouth mapping, scheduling, and cross-fade step emission. What it
 * does not own (other lanes): TTS runtime (`src-tauri/tts/**`, WS-19),
 * asset loading and mouth/eye region application
 * (`apps/candice-companion/assets/candice/**` + `src/loader/**`, WS-11),
 * gesture/idle animation (`src/animation/gesture/**`, WS-13).
 */

export { VisemeScheduler, type SchedulerOptions } from "./scheduler.ts";
export {
  phonemeToViseme,
  timingToVisemeEvent,
  shouldBlend,
  idleViseme,
} from "./mapping.ts";
export {
  DEFAULT_PHONEME_TO_VISEME,
} from "./types.ts";
export type {
  Clock,
  VisemeBlendMode,
  VisemeEvent,
  VisemeId,
  VisemeStep,
} from "./types.ts";
export {
  VISEME_REGISTRATION_PRECONDITION,
  assertRegistrationMeasured,
  recordRegistrationMeasured,
} from "./registration.ts";
