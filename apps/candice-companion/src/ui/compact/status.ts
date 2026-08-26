/**
 * Compact companion status presentation (Master Spec 0E WS-10, spec 16).
 *
 * Note: this module is necessarily NOT pure. The WS-08 state machine is the
 * pure reducer that owns transitions; this lane renders the transition
 * RESULT. Mapping a WS-08 `CandiceStatus` to a compact display interpretation
 * is a pure function of the status the bridge actually delivered — the
 * display never invents a status or a percentage (spec 16: "Do not invent
 * progress percentages. Use only real project state/status events").
 *
 * @module
 */

import type { CandiceStatus } from '../../state/status.ts';

/**
 * Progress-family statuses (spec 16). These are the post-interview
 * progression states the compact companion watches. `recovering` is its own
 * family; none of this implies a percentage — the text is the display, and
 * progress counts could only ever come from real `detail` fields in a real
 * status event.
 */
export const COMPACT_PROGRESS_STATUSES = [
  'building',
  'quality-checking',
  'fixing',
  'waiting-for-user',
  'complete',
] as const;
export type CompactProgressStatus = (typeof COMPACT_PROGRESS_STATUSES)[number];

/** Status families the compact view must recognize. */
export const COMPACT_FAMILIES = [
  'progress',
  'recovering',
  'idle',
  'voice',
  'text-fallback',
  'other',
] as const;
export type CompactFamily = (typeof COMPACT_FAMILIES)[number];

export interface CompactStatusView {
  /** Family the compact surface is in. */
  family: CompactFamily;
  /**
   * Canonical short label for the compact line (spec 16: BUILDING,
   * QUALITY CHECKING, FIXING, WAITING FOR USER, COMPLETE, RECOVERING ...).
   */
  label: string;
  /**
   * True when the compact view must show the offline "send later" hint
   * (spec 13.3: "Claude is working. I'll send that as soon as it's ready.").
   */
  busy: boolean;
  /** True when this is the special offline surface (spec 13.3). */
  offline: boolean;
}

/** The 14 canonical statuses with their compact display meaning. */
const VIEWS: Record<CandiceStatus, CompactStatusView> = {
  idle: { family: 'idle', label: 'Ready', busy: false, offline: false },
  listening: { family: 'voice', label: 'Listening', busy: false, offline: false },
  transcribing: { family: 'voice', label: 'Transcribing', busy: false, offline: false },
  confirming: { family: 'voice', label: 'Confirm', busy: false, offline: false },
  thinking: { family: 'voice', label: 'Thinking', busy: false, offline: false },
  speaking: { family: 'voice', label: 'Speaking', busy: false, offline: false },
  compact: { family: 'idle', label: 'Ready', busy: false, offline: false },
  recovering: { family: 'recovering', label: 'Recovering', busy: true, offline: false },
  'text-fallback': { family: 'text-fallback', label: 'Claude text', busy: false, offline: false },
  building: { family: 'progress', label: 'Building', busy: true, offline: false },
  'quality-checking': { family: 'progress', label: 'Quality checking', busy: true, offline: false },
  fixing: { family: 'progress', label: 'Fixing', busy: true, offline: false },
  'waiting-for-user': { family: 'progress', label: 'Waiting for you', busy: false, offline: false },
  complete: { family: 'progress', label: 'Complete', busy: false, offline: false },
};

/**
 * Map a real WS-08 status to its compact view. Statuses outside the
 * canonical list (impossible per the WS-08 type) degrade to a neutral
 * "other" view rather than throwing — failure never stops Claude.
 */
export function compactStatusView(status: CandiceStatus): CompactStatusView {
  return VIEWS[status] ?? {
    family: 'other' as const,
    label: 'Ready' as const,
    busy: false,
    offline: false,
  };
}
