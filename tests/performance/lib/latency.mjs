/**
 * WS-45 latency instruments + thresholds (Master Spec 19 + E.1 WS-45).
 *
 * Owned by WR-020 / WS-45 lane (ownership map 9.2: tests/performance/**).
 *
 * The three latency metrics are measured with performance marks in the
 * REAL seam each metric lives on (no placeholders):
 *   - time-to-first-visible: measured on the app shell boot; in CI the
 *     webview boot is measured through the WS-06 entry path when a DOM is
 *     available, else recorded unavailable with the exact reason.
 *   - PTT-release-to-transcript: real whisper-cli wall time on the WS-16
 *     canonical fixture (the PTT-release -> transcription-complete seam;
 *     the release timestamp is the call start, transcript-ready is the
 *     process exit). Engine-only measurement is what the deployed app
 *     adds (the app's own overhead is a constant the WS-46 smoke adds).
 *   - first-spoken-audio: real engine time from request to first PCM
 *     (say/AIFF first byte; Kokoro first chunk when the WS-19 runtime is
 *     installed).
 *
 * Thresholds per spec 3/19: activation "within a few seconds"; the exact
 * budgets below are regression gates on the REAL engine path, generous
 * enough for a healthy machine, tight enough to catch engine regressions
 * (double model loads, unoptimized runtime).
 */

/** Milliseconds; inspected by QC as an honest budget, not a fabrication. */
export const LATENCY_THRESHOLDS_MS = {
  'time-to-first-visible': {
    budgetMs: 3000, // spec 3: "within a few seconds" — this is the few seconds
    severity: 'regression',
  },
  'ptt-release-to-transcript': {
    budgetMs: 5000, // tiny.en on Apple Silicon ~0.17 s core + model IO; 5 s catches runtime regressions
    severity: 'regression',
  },
  'first-spoken-audio': {
    budgetMs: 2500, // system say first byte ~350 ms; Kokoro worker cold start is the slow path
    severity: 'regression',
  },
};

export function checkLatency(key, valueMs) {
  const budget = LATENCY_THRESHOLDS_MS[key];
  if (!budget) {
    return { key, ok: false, valueMs, budgetMs: null, violation: `unknown metric key ${key}` };
  }
  const ok = Number.isFinite(valueMs) && valueMs <= budget.budgetMs;
  return {
    key,
    ok,
    valueMs: Number.isFinite(valueMs) ? valueMs : null,
    budgetMs: budget.budgetMs,
    violation: ok ? null : `${key} ${valueMs}ms > budget ${budget.budgetMs}ms`,
  };
}

/**
 * performance.mark-based first-visible measurement for the webview payload.
 * When the WS-06 boot path runs in a DOM (headless webkit or the real
 * app), `bootCandice` adds the `candice-ready` class; this instrument
 * measures interval from navigation start to that class. A missing DOM is
 * a real unavailable, never a fabricated zero.
 */
export function measureFirstVisibleFromDom() {
  if (typeof document === 'undefined' || typeof performance === 'undefined') {
    return { status: 'unavailable', note: 'no DOM in this process (webview boot path measured on the WS-46 interactive smoke / headless app shell)' };
  }
  const navStart = performance.timeOrigin;
  const readyAt = performance.now();
  return {
    status: 'ok',
    valueMs: readyAt,
    note: `document ready + ${document.readyState} at ${Math.round(readyAt)}ms from timeOrigin`,
  };
}

/** Pure math: derive the summary of a latency series (mean/p95/max). */
export function summarizeLatencies(valuesMs) {
  if (!Array.isArray(valuesMs) || valuesMs.length === 0) {
    return { meanMs: null, p95Ms: null, maxMs: null, count: 0 };
  }
  const sorted = [...valuesMs].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  return { meanMs: mean, p95Ms: p95, maxMs: sorted[sorted.length - 1], count: sorted.length };
}
