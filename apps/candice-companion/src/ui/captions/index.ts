/**
 * Captions public surface (Master Spec 0E WS-14, spec 5.2).
 *
 * Single-file barrel: consuming lanes import from here only — never deep
 * imports. The WS-09 answer-controls lane already declares "captions
 * always shown (WS-14 lane owns captions; this lane never hides them)";
 * this barrel is the definition authority.
 *
 * @module
 */

export {
  CAPTIONS_CONTRACT_VERSION,
  CAPTIONS_DEFAULT_VISIBLE,
  CAPTIONS_LIVE,
  CAPTIONS_MAX_CHARS,
  CAPTIONS_ROLE,
  CAPTIONS_ROOT_CLASS,
  CAPTIONS_SETTINGS_LABEL,
  CAPTIONS_STALE_CLASS,
  CAPTIONS_STYLE_ID,
  CAPTIONS_TEXT_SCALES,
} from './config.ts';
export type { CaptionsTextScale } from './config.ts';

export {
  captionFromEffect,
  clipCaption,
  createCaptionsModel,
  isEmptyCaption,
} from './model.ts';
export type { CaptionEntry, CaptionsModelState } from './model.ts';

export { CAPTIONS_SCALE_FONT_SIZES, CAPTIONS_STYLE_TEXT, createCaptionsView, mountCaptionsStyle } from './view.ts';
export type { CaptionsView } from './view.ts';

export { createCaptionsController } from './controller.ts';
export type { CaptionsController, CaptionsControllerOptions } from './controller.ts';
