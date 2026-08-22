/**
 * Push-to-talk status mapping (Master Spec 0E WS-09, spec 5.1 / 6).
 *
 * Maps the REAL WS-08 `CandiceStatus` to the PTT control's presentation.
 * Pure function of the status the bridge actually delivered — the control
 * never invents a state. Statuses outside the canonical list degrade to a
 * neutral idle view rather than throwing (spec 20: failure must never stop
 * Claude).
 *
 * @module
 */

import type { CandiceStatus } from '../../state/status.ts';
import { PTT_LABELS } from './config.ts';

/** Presentation families the PTT control shows. */
export const PTT_FAMILIES = [
  'idle',
  'listening',
  'transcribing',
  'busy',
] as const;
export type PttFamily = (typeof PTT_FAMILIES)[number];

/** The only status that means "microphone live, hold is pressed". */
const PTT_LIVE_STATUS: CandiceStatus = 'listening';

/** Statuses where the PTT prompt is not shown (never invented by this lane). */
const PTT_BUSY_STATUSES: ReadonlySet<CandiceStatus> = new Set([
  'transcribing',
  'confirming',
  'thinking',
  'speaking',
  'recovering',
]);

export interface PttStatusView {
  /** Family the control is in. */
  family: PttFamily;
  /**
   * Exact button label. `null` means the button is hidden (statuses where
   * a PTT prompt would be wrong, e.g. recovering, conferring with Claude).
   */
  label: string | null;
  /** Idle-button vs pressed-button label (spec 6). */
  mode: 'hold' | 'listening';
  /** True when the red glow pulse must run (spec 6 unmistakable state). */
  glowing: boolean;
  /** True when the lightweight waveform shows (spec 6 optional waveform). */
  waveform: boolean;
}

/** Canonical presentation per WS-08 status. */
const VIEWS: Record<CandiceStatus, PttStatusView> = {
  idle: { family: 'idle', label: PTT_LABELS.HOLD, mode: 'hold', glowing: false, waveform: false },
  listening: { family: 'listening', label: PTT_LABELS.LISTENING, mode: 'listening', glowing: true, waveform: true },
  transcribing: { family: 'transcribing', label: PTT_LABELS.TRANSCRIBING, mode: 'hold', glowing: false, waveform: false },
  confirming: { family: 'busy', label: null, mode: 'hold', glowing: false, waveform: false },
  thinking: { family: 'busy', label: null, mode: 'hold', glowing: false, waveform: false },
  speaking: { family: 'busy', label: null, mode: 'hold', glowing: false, waveform: false },
  compact: { family: 'idle', label: PTT_LABELS.HOLD, mode: 'hold', glowing: false, waveform: false },
  recovering: { family: 'busy', label: null, mode: 'hold', glowing: false, waveform: false },
  'text-fallback': { family: 'busy', label: null, mode: 'hold', glowing: false, waveform: false },
  building: { family: 'busy', label: null, mode: 'hold', glowing: false, waveform: false },
  'quality-checking': { family: 'busy', label: null, mode: 'hold', glowing: false, waveform: false },
  fixing: { family: 'busy', label: null, mode: 'hold', glowing: false, waveform: false },
  'waiting-for-user': { family: 'idle', label: PTT_LABELS.HOLD, mode: 'hold', glowing: false, waveform: false },
  complete: { family: 'busy', label: null, mode: 'hold', glowing: false, waveform: false },
};

/** True when this status is the machine's live-mic state (WS-08 `ptt:start`). */
export function isPttLiveStatus(status: CandiceStatus): boolean {
  return status === PTT_LIVE_STATUS;
}

/**
 * Map a real WS-08 status to its PTT presentation. Unknown statuses
 * degrade to an idle hold control — never throw, never invent a state.
 */
export function pttStatusView(status: CandiceStatus): PttStatusView {
  const view = VIEWS[status];
  if (view) return view;
  return { family: 'idle', label: PTT_LABELS.HOLD, mode: 'hold', glowing: false, waveform: false };
}

/** True when the status belongs to the busy family (button hidden). */
export function isPttBusy(status: CandiceStatus): boolean {
  if (PTT_BUSY_STATUSES.has(status)) return true;
  return pttStatusView(status).family === 'busy';
}
