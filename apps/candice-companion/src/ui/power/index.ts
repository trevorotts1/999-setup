/**
 * Turn-off control public surface.
 *
 * Single barrel so the composition root imports one stable path and never
 * deep-imports the controller (mirrors the animation-toggle convention).
 *
 * @module
 */

export {
  POWER_OFF_BUSY_HINT,
  POWER_OFF_CLASS,
  POWER_OFF_FAILED_HINT,
  POWER_OFF_HINT,
  POWER_OFF_ID,
  POWER_OFF_LABEL,
  POWER_OFF_STYLE_ID,
} from './config.ts';

export { createPowerOff } from './controller.ts';
export type { PowerOff, PowerOffOptions } from './controller.ts';
