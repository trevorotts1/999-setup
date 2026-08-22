/**
 * Status event sources (Master Spec 0E WS-08).
 *
 * The state machine never invents progress. Every transition is driven by a
 * real status event, and every real status event names its source. A status
 * with no source is not a status; a source that is not listening is not a
 * source. This module owns the source registry; the bridge (WS-03/WS-04) and
 * the terminal fallback adapter (WS-05) register themselves here at startup.
 */
export type StatusEventSource = 'mcp' | 'terminal-fallback' | 'local';

export const STATUS_EVENT_SOURCE = {
  /** Structured MCP bridge: `candice.status`, `candice.compact` (spec 13.2). */
  MCP: 'mcp' as StatusEventSource,
  /** Same-session terminal fallback adapter (spec 13.3). */
  TERMINAL_FALLBACK: 'terminal-fallback' as StatusEventSource,
  /** Local application events (PTT, speech, window), never skill progress. */
  LOCAL: 'local' as StatusEventSource,
};

export const STATUS_EVENT_SOURCES: readonly StatusEventSource[] = [
  STATUS_EVENT_SOURCE.MCP,
  STATUS_EVENT_SOURCE.TERMINAL_FALLBACK,
  STATUS_EVENT_SOURCE.LOCAL,
];

export function isStatusEventSource(value: unknown): value is StatusEventSource {
  return typeof value === 'string' && (STATUS_EVENT_SOURCES as readonly string[]).includes(value);
}
