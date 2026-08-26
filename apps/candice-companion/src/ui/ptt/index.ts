/**
 * Push-to-talk control — public surface (Master Spec 0E WS-09).
 *
 * The floating PTT lane exports the control (DOM view + status mapping)
 * and the shared declarations. Ownership: `apps/candice-companion/src/ui/
 * ptt/**` (PROJECT-MANIFEST 9.2, WS-09 glob).
 *
 * Consumers:
 * - WS-09 answer controls (`../answer-controls`): mounts this control in
 *   the floating answer surface.
 * - WS-10 compact view (sibling lane): consumes the SAME labels/classes
 *   convention (its own surface is separate — WS-10 own glob).
 * - WR-009/WS-17 capture path: receives the intent callbacks.
 */

export {
  PTT_CONTRACT_VERSION,
  PTT_REDUCED_MOTION_CLASS,
  PTT_ROOT_CLASS,
  PTT_LISTENING_CLASS,
  PTT_TRANSCRIBING_CLASS,
  PTT_GLOW_CLASS,
  PTT_WAVE_CLASS,
  PTT_WAVE_BAR_CLASS,
  PTT_STYLE_ID,
  PTT_LABELS,
  PTT_WAVE_BAR_COUNT,
  PTT_GLOW_PULSE_MS,
} from './config.ts';

export {
  PTT_FAMILIES,
  pttStatusView,
  isPttLiveStatus,
  isPttBusy,
  type PttFamily,
  type PttStatusView,
} from './status.ts';

export { createPttView, mountPttStyle, PTT_STYLE_TEXT, type PttView } from './view.ts';
