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

/**
 * Statuses where the PTT prompt is not shown (never invented by this lane).
 * `speaking` is NOT busy: spec 6 requires a PTT press while Candice speaks
 * to stop speech and begin listening, so the control must stay enabled and
 * show the hold prompt (the controller dispatches the interrupt intent —
 * see `interruptible` below).
 */
const PTT_BUSY_STATUSES: ReadonlySet<CandiceStatus> = new Set([
  'transcribing',
  'confirming',
  'thinking',
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
  /**
   * True while Candice is SPEAKING: a hold press must stop speech and open
   * the mic instead of a plain `ptt:start` (spec 6; machine event
   * `speech:interrupted`). The control stays enabled and shows the hold
   * prompt; the CALLER decides the event — this lane only renders state.
   */
  interruptible: boolean;
}

/** Canonical presentation per WS-08 status. */
const VIEWS: Record<CandiceStatus, PttStatusView> = {
  idle: { family: 'idle', label: PTT_LABELS.HOLD, mode: 'hold', glowing: false, waveform: false, interruptible: false },
  listening: { family: 'listening', label: PTT_LABELS.LISTENING, mode: 'listening', glowing: true, waveform: true, interruptible: false },
  transcribing: { family: 'transcribing', label: PTT_LABELS.TRANSCRIBING, mode: 'hold', glowing: false, waveform: false, interruptible: false },
  confirming: { family: 'busy', label: null, mode: 'hold', glowing: false, waveform: false, interruptible: false },
  thinking: { family: 'busy', label: null, mode: 'hold', glowing: false, waveform: false, interruptible: false },
  // Speaking: enabled hold prompt; a press dispatches the interrupt intent
  // (spec 6 — stop speech, then open the mic).
  speaking: { family: 'idle', label: PTT_LABELS.HOLD, mode: 'hold', glowing: false, waveform: false, interruptible: true },
  compact: { family: 'idle', label: PTT_LABELS.HOLD, mode: 'hold', glowing: false, waveform: false, interruptible: false },
  recovering: { family: 'busy', label: null, mode: 'hold', glowing: false, waveform: false, interruptible: false },
  'text-fallback': { family: 'busy', label: null, mode: 'hold', glowing: false, waveform: false, interruptible: false },
  building: { family: 'busy', label: null, mode: 'hold', glowing: false, waveform: false, interruptible: false },
  'quality-checking': { family: 'busy', label: null, mode: 'hold', glowing: false, waveform: false, interruptible: false },
  fixing: { family: 'busy', label: null, mode: 'hold', glowing: false, waveform: false, interruptible: false },
  'waiting-for-user': { family: 'idle', label: PTT_LABELS.HOLD, mode: 'hold', glowing: false, waveform: false, interruptible: false },
  complete: { family: 'busy', label: null, mode: 'hold', glowing: false, waveform: false, interruptible: false },
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
  return { family: 'idle', label: PTT_LABELS.HOLD, mode: 'hold', glowing: false, waveform: false, interruptible: false };
}

/** True when the status belongs to the busy family (button hidden). */
export function isPttBusy(status: CandiceStatus): boolean {
  if (PTT_BUSY_STATUSES.has(status)) return true;
  return pttStatusView(status).family === 'busy';
}
