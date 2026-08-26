/**
 * macOS window-title probe for phase detection (Master Spec 0E WS-24).
 *
 * Owned by WR-015 / WS-24 lane (ownership map 9.2). The sampler needs to
 * know when the app is idle, speaking, or listening. The companion's own
 * window title is the phase carrier — the state machine (WS-08) already
 * drives the title from real status events, never invented progress.
 *
 * This module is *read-only over the window system*: it enumerates window
 * titles through the injectable probe and classifies the nearest phase.
 * The classification is deliberately simple: the phase is derived from a
 * stable title suffix the app itself writes. Window-system plumbing
 * (CGWindowList, AX API) lives in the WS-21 window lane; this lane owns
 * the classification contract, and the probe default stays a pure
 * in-process scanner so tests need no OS permissions.
 *
 * Spec 11 discipline: only the stable production title prefix and known
 * phase suffixes are matched — never a dev placeholder, never a
 * ChatGPT-derived download name.
 */

export const WINDOW_TITLE_PREFIX = 'Candice — ';

/** Phase-bearing title suffixes (production contract, WS-08 statuses). */
export const PHASE_TITLE_SUFFIXES = {
  idle: 'Idle',
  speaking: 'Speaking',
  listening: 'Listening',
} as const;

export type ProbePhase = keyof typeof PHASE_TITLE_SUFFIXES;

export interface ProbeResult {
  phase: ProbePhase | null;
  /** The matching title, or null when no Candice window was found. */
  title: string | null;
  /** Reason for a null result, in one line (never thrown). */
  note: string;
}

export interface ProbeOptions {
  /** Iterates candidate window titles; default scans `document.title`. */
  listTitles?: () => string[];
}

export const PROBE_DEFAULTS = {
  prefix: WINDOW_TITLE_PREFIX,
  /** Whether in-process scanning is allowed (browser-context fallback). */
  allowInProcess: true,
} as const;

/**
 * Default title source: the webview document title when running in the
 * Tauri webview, else an empty list. Pure and permission-free.
 */
export function defaultTitleSource(): string[] {
  if (typeof document !== 'undefined' && typeof document.title === 'string') {
    return [document.title];
  }
  return [];
}

/** Match a title against the Candice phase contract; null when no match. */
export function classifyTitle(title: string): ProbePhase | null {
  if (!title.startsWith(WINDOW_TITLE_PREFIX)) {
    return null;
  }
  const suffix = title.slice(WINDOW_TITLE_PREFIX.length);
  for (const [phase, marker] of Object.entries(PHASE_TITLE_SUFFIXES)) {
    if (suffix === marker) {
      return phase as ProbePhase;
    }
  }
  // Unknown suffix under the Candice prefix: the app is alive but the
  // phase marker is not one of the measured set. Report as idle-ish
  // (best effort) rather than failing the probe.
  return 'idle';
}

/**
 * Locate the app's own window title and classify the phase. Total:
 * any probe failure yields a `null` phase with a note.
 */
export function probeCandiceWindowTitle(
  options: ProbeOptions = {},
): ProbeResult {
  try {
    const list = options.listTitles ?? defaultTitleSource;
    const titles = list();
    for (const title of titles) {
      if (title.startsWith(WINDOW_TITLE_PREFIX)) {
        return { phase: classifyTitle(title), title, note: '' };
      }
    }
    return {
      phase: null,
      title: null,
      note: `no Candice window title found (${titles.length} candidate(s))`,
    };
  } catch (err) {
    return {
      phase: null,
      title: null,
      note: `window probe failed: ${String(err)}`,
    };
  }
}

/**
 * Nearest measured phase for a status: maps the WS-08 statuses onto the
 * three measured phases. Pure function of the status string.
 */
export function nearestPhase(status: string): ProbePhase {
  switch (status) {
    case 'listening':
    case 'transcribing':
      return 'listening';
    case 'speaking':
      return 'speaking';
    default:
      // idle, thinking, confirming, compact, recovering, text-fallback,
      // and every skill-progress status measure as the idle footprint.
      return 'idle';
  }
}
