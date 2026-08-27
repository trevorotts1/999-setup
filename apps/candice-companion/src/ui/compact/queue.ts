/**
 * Compact companion submit queue (Master Spec 0E WS-10, spec 13.3).
 *
 * After the interview the compact companion can take typed/spoken questions
 * and slash commands (`/bro`, `/eli5`). Spec 13.3: when Claude is busy the
 * companion queues the user's explicit input and submits it only at a safe
 * input point — never hidden prompts, never injected into a different
 * terminal/window, and the user always sees what will be submitted.
 *
 * This module owns ONLY the queue (what is pending, in the user's own
 * order). It is a pure data structure: no clock, no IO, no DOM, no
 * injection. The actual terminal-input adapter is the WS-03/WS-05 lane's
 * transport; this lane hands it the drained entries one at a time and
 * never targets anything itself.
 *
 * A queue is never invented progress: entry counts come from real user
 * submissions, and they are private to the user's own session — they are
 * NOT progress percentages and are never shown as one (spec 16).
 *
 * @module
 */

import { harnessName } from '../../harness/name.ts';
import type { CandiceStatus } from '../../state/status.ts';

export interface CompactSubmitEntry {
  /** Exact text the user provided (typed, or transcribed voice after
   *  confirmation — never silent input). */
  readonly text: string;
  /** One of "typed" / "voice". Never "terminal" here: terminal-originated
   *  questions belong to the structured MCP path, not this queue. */
  readonly inputMode: 'typed' | 'voice';
  /** When the user supplied it; the queue preserves user order. */
  readonly submittedAt: number;
}

/**
 * Statuses that mean "the session is not at a safe input point" (spec
 * 13.3). Mirrored from WS-08's `isBusy` gate plus the skill-progress
 * statuses, which are not behind `isBusy` but must still hold submissions
 * while the skill is running (spec 16).
 */
const QUIET_STATUSES: ReadonlySet<CandiceStatus> = new Set([
  'listening',
  'transcribing',
  'confirming',
  'thinking',
  'speaking',
  'recovering',
  'building',
  'quality-checking',
  'fixing',
]);

/**
 * Single-flight queue per session. Only the compact companion creates one
 * per active session; nothing ever shared across sessions (spec 13.3:
 * "never inject into a different terminal/window").
 */
export class CompactSubmitQueue {
  private readonly entries: CompactSubmitEntry[] = [];
  private nextSeq = 0;

  /** Add the user's explicit input to the queue. Always visible to drain(). */
  enqueue(entry: Omit<CompactSubmitEntry, 'submittedAt'>): CompactSubmitEntry {
    const full: CompactSubmitEntry = {
      text: entry.text,
      inputMode: entry.inputMode,
      submittedAt: this.nextSeq++,
    };
    this.entries.push(full);
    return full;
  }

  /** Number of pending entries. */
  get size(): number {
    return this.entries.length;
  }

  /** Oldest pending entry without removing it — the user sees this. */
  peek(): CompactSubmitEntry | null {
    return this.entries[0] ?? null;
  }

  /**
   * Remove the oldest entry and return it for submission. Returns null
   * when empty. The caller (transport adapter) decides what happens next;
   * this queue never submits on its own.
   */
  drain(): CompactSubmitEntry | null {
    return this.entries.shift() ?? null;
  }

  /** Pending entries in submission order (for display, never for hiding). */
  pending(): readonly CompactSubmitEntry[] {
    return this.entries;
  }

  /** Clear all pending entries (user chose to discard, not submit). */
  clear(): void {
    this.entries.length = 0;
  }
}

/**
 * Whether the current status means submissions must wait (spec 13.3).
 * The pure gate is exported separately so the controller can compute
 * whether to expose the "send later" hint without touching the queue.
 */
export function submissionMustWait(status: CandiceStatus): boolean {
  return QUIET_STATUSES.has(status);
}

/**
 * Canonical offline hint text (spec 13.3).
 *
 * Harness-aware: this named Claude unconditionally, so a claude-nine user
 * was told a window that was not on their screen was busy. See
 * `src/harness/name.ts`; with the plain harness the wording is unchanged.
 */
export function busyHintText(): string {
  return `${harnessName() ?? 'Your terminal'} is working. I’ll send that as soon as it’s ready.`;
}
