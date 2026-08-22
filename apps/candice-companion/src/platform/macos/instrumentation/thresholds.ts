/**
 * WS-24 regression thresholds — macOS Apple Silicon (Master Spec 19).
 *
 * Owned by WR-015 / WS-24 lane (ownership map 9.2). This file is the
 * single source of the measured-baseline + threshold contract for the
 * macOS companion. The thresholds live with the instrumentation lane
 * (not in CI) so the lane and the CI fragment cannot drift apart.
 *
 * Baseline discipline (spec 19): do not hardcode an unrealistic memory
 * target before measuring the chosen runtime. The values below are
 * conservative *upper bounds* derived from the operator-fleet reference
 * measurement campaign (2026-08-21, Apple Silicon Mac mini reference,
 * release profile, measured via `baseline-capture.mjs`). They are
 * intentionally generous — they catch regression-class defects (leaks,
 * runaway loops, engine double-loads), not noise.
 *
 * PROVISIONAL-EMULATED STATUS (QC-Q-WS-24 second blind recheck,
 * 2026-08-21): idle/speaking/listening windows over the REAL companion
 * app do not exist yet — they need WS-08 statuses driving the window
 * title under WS-45's phase-enforcing harness (this lane's cross-lane
 * finding). The baseline below is therefore the EMULATED
 * baseline-capture.mjs self-measure of the sampler process, measured
 * again by the second QC on this box: idle cpuMean 3.04% (20 s window),
 * speaking 10.18% (synthetic TTS-ish load), listening 14.54% (synthetic
 * STT-ish load), RSS ~70-74 MiB throughout. The first QC's fabricated
 * constants (idle 0.4%, speaking 6.2%, listening 9.8%) did NOT match
 * even this lane's own calibration notes (speaking 10.83%, listening
 * 14.86%) — they are replaced here by the honest re-measured values.
 * When WS-45's real-app harness lands, this lane re-measures the REAL
 * engine footprint and updates these constants through
 * CROSS-LANE-FINDING — never silent drift.
 *
 * CI enforcement lives in `.github/workflows/**`, which is integration
 * owned (manifest 9.4). This lane SHIPS THE PROPOSAL FRAGMENT
 * (CI-PERF-THRESHOLDS-WS24.md) and the machine-readable registry below;
 * the integration owner applies the fragment at fan-in. Thresholds are
 * adjustable only through this lane (CROSS-LANE-FINDING) so CI never
 * drifts from the measured source.
 */

import type { WindowSample } from './sampler.ts';

export interface PhaseThresholds {
  /** Percent of one core (fractional). */
  cpuMeanMax: number;
  /** Percent of one core (fractional). */
  cpuMaxMax: number;
  /** MiB. */
  rssMiBMax: number;
}

export interface ThresholdsByPhase {
  idle: PhaseThresholds;
  speaking: PhaseThresholds;
  listening: PhaseThresholds;
}

export const THRESHOLDS_SCHEMA_VERSION = 1;

/** WS-24 measured baseline (2026-08-21, Apple Silicon reference campaign). */
export const MEASURED_BASELINE_MACOS_AS_2026_08_21 = {
  platform: 'macos-apple-silicon',
  measuredAt: '2026-08-21',
  machine:
    'operator-fleet-reference (Apple Silicon, release profile) — EMULATED self-measure via baseline-capture.mjs; re-measured by QC-Q-WS-24 second recheck',
  emulated: true,
  note:
    'PROVISIONAL: synthetic phase loads, NOT real engine footprint. Real-app windows require the WS-45 phase-enforcing harness.',
  idleCpuPercentMean: 3.04,
  idleRssMiB: 69.3,
  speakingCpuPercentMean: 10.18,
  speakingRssMiB: 73.7,
  listeningCpuPercentMean: 14.54,
  listeningRssMiB: 73.6,
} as const;

/**
 * Regression thresholds. Each limit is a conservative multiple of the
 * re-measured emulated baseline so that a healthy machine never trips,
 * while a regression-class defect (leak, runaway loop, double-loaded
 * engine) does. Recalibrated by QC-Q-WS-24 (2026-08-21) against fresh
 * 20 s captures on this Apple Silicon box: idle cpuMean 3.04%,
 * speaking 10.18%, listening 14.54%.
 */
export const REGRESSION_THRESHOLDS: ThresholdsByPhase = {
  idle: {
    cpuMeanMax: 10, // emulated idle baseline 3.04% x3.3
    cpuMaxMax: 25, // measured idle max 6.39% x3.9
    rssMiBMax: 180, // baseline ~69 MiB x2.6
  },
  speaking: {
    cpuMeanMax: 25, // emulated baseline 10.18% x2.5
    cpuMaxMax: 60,
    rssMiBMax: 220, // baseline ~74 MiB x3
  },
  listening: {
    cpuMeanMax: 35, // emulated baseline 14.54% x2.4
    cpuMaxMax: 80,
    rssMiBMax: 220, // baseline ~74 MiB x3
  },
};

export type PhaseName = keyof ThresholdsByPhase;

export const PHASE_NAMES: readonly PhaseName[] = ['idle', 'speaking', 'listening'];

export interface ThresholdCheckResult {
  phase: PhaseName;
  ok: boolean;
  observed: { cpuPercentMean: number; cpuPercentMax: number; rssMiBMax: number };
  limits: PhaseThresholds;
  violations: string[];
}

/**
 * Check one measured window against the thresholds for a phase. Pure:
 * same window and phase always produce the same verdict.
 */
export function checkThresholds(
  window: WindowSample,
  phase: PhaseName,
  thresholds: ThresholdsByPhase = REGRESSION_THRESHOLDS,
): ThresholdCheckResult {
  const limits = thresholds[phase];
  const observed = {
    cpuPercentMean: window.cpuPercentMean,
    cpuPercentMax: window.cpuPercentMax,
    rssMiBMax: window.rssMiBMax,
  };
  const violations: string[] = [];
  if (observed.cpuPercentMean > limits.cpuMeanMax) {
    violations.push(
      `${phase} cpuPercentMean ${observed.cpuPercentMean.toFixed(1)} > ${limits.cpuMeanMax}`,
    );
  }
  if (observed.cpuPercentMax > limits.cpuMaxMax) {
    violations.push(
      `${phase} cpuPercentMax ${observed.cpuPercentMax.toFixed(1)} > ${limits.cpuMaxMax}`,
    );
  }
  if (observed.rssMiBMax > limits.rssMiBMax) {
    violations.push(
      `${phase} rssMiBMax ${observed.rssMiBMax.toFixed(1)} > ${limits.rssMiBMax}`,
    );
  }
  return {
    phase,
    ok: violations.length === 0,
    observed,
    limits,
    violations,
  };
}

/**
 * Verify a full three-phase report against thresholds. Returns the
 * per-phase results plus an overall verdict; never throws.
 */
export function verifyReport(
  windows: Partial<Record<PhaseName, WindowSample>>,
  thresholds: ThresholdsByPhase = REGRESSION_THRESHOLDS,
): { results: ThresholdCheckResult[]; ok: boolean } {
  const results: ThresholdCheckResult[] = [];
  for (const phase of PHASE_NAMES) {
    const window = windows[phase];
    if (!window) {
      results.push({
        phase,
        ok: false,
        observed: { cpuPercentMean: 0, cpuPercentMax: 0, rssMiBMax: 0 },
        limits: thresholds[phase],
        violations: [`${phase}: no measurement window recorded`],
      });
      continue;
    }
    results.push(checkThresholds(window, phase, thresholds));
  }
  return { results, ok: results.every((r) => r.ok) };
}
