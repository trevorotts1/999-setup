/**
 * Compact progress-companion public surface (Master Spec 0E WS-10).
 *
 * Consuming lanes import from here only — never deep imports. The reason
 * to centralize is the same as the WS-08 barrel: the compact lane's
 * stable surface (config keys, view interface, queue class, controller)
 * can then move internally without breaking consumers.
 *
 * @module
 */

export {
  COMPACT_CONTRACT_VERSION,
  COMPACT_EXPAND_MS,
  COMPACT_EXPANDED_CLASS,
  COMPACT_REDUCED_MOTION_CLASS,
  COMPACT_ROOT_CLASS,
  COMPACT_STAGE_SLOT_ID,
  COMPACT_STATUS_ATTR,
  COMPACT_VISUAL_MODES,
} from './config.ts';
export type { CompactVisualMode } from './config.ts';

export {
  COMPACT_FAMILIES,
  COMPACT_PROGRESS_STATUSES,
  compactStatusView,
} from './status.ts';
export type { CompactFamily, CompactProgressStatus, CompactStatusView } from './status.ts';

export { BUSY_HINT_TEXT, CompactSubmitQueue, submissionMustWait } from './queue.ts';
export type { CompactSubmitEntry } from './queue.ts';

export { COMPACT_STYLE_TEXT, createCompactView, mountCompactStyle } from './view.ts';
export type { CompactView, CompactViewHandlers } from './view.ts';

export { createCompactController } from './controller.ts';
export type { CompactController, CompactControllerOptions, CompactTransport } from './controller.ts';
