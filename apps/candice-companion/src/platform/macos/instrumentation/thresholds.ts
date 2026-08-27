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
 * PROVISIONAL STATUS (real-engine re-measure, 2026-08-21): WS-45's
 * phase-enforcing harness landed and the REAL engine windows were
 * measured on this box against the release 0.2.0 binary: idle cpuMean
 * 0.0% / RSS 98.0 MiB (real release-app idle window), speaking 14.1% /
 * 36.8 MiB (real `say` synthesis), listening 70.9% mean over 7 runs
 * (range 52.8-85.0) / RSS 163.5 MiB (real whisper-cli, pinned WS-16
 * model, canonical jfk.wav fixture). The listening numbers replace the
 * old EMULATED synthetic-load baseline (14.54%) and its threshold (35)
 * — the emulated constant was provably unrepresentative
 * (CROSS-LANE-FINDING WS-45, 2026-08-21). The phase windows remain
 * PHASE-EMULATED: the harness drives the phases; the app's own webview
 * does not yet emit the `Candice — <phase>` title carrier. When the app
 * emits real phase titles, this lane re-measures and updates through
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

export const THRESHOLDS_SCHEMA_VERSION = 3;

/**
 * WS-24 measured baseline (2026-08-21, Apple Silicon reference campaign).
 * Idle/speaking: REAL engine windows measured by WS-45's phase-enforcing
 * harness against the release 0.2.0 binary (2026-08-21, operator Apple
 * Silicon). Listening: REAL whisper-cli window, mean of 7 runs.
 * Phase-emulated: the harness drives the phases; the app's own webview
 * does not yet emit the `Candice — <phase>` title carrier.
 */
export const MEASURED_BASELINE_MACOS_AS_2026_08_21 = {
  platform: 'macos-apple-silicon',
  measuredAt: '2026-08-21',
  machine:
    'operator-fleet-reference (Apple Silicon, release 0.2.0 binary) — REAL engine windows via WS-45 phase-enforcing harness; phase-emulated (app does not yet emit phase titles)',
  emulated: true,
  note:
    'PROVISIONAL: real engine footprint, phase-emulated. Re-measure when the app emits real `Candice — <phase>` window titles.',
  idleCpuPercentMean: 0.0,
  idleRssMiB: 98.0,
  speakingCpuPercentMean: 14.1,
  speakingRssMiB: 36.8,
  listeningCpuPercentMean: 70.9,
  listeningRssMiB: 163.5,
} as const;

/**
 * Regression thresholds. Each limit is a conservative multiple of the
 * measured baseline so that a healthy machine never trips, while a
 * regression-class defect (leak, runaway loop, double-loaded engine)
 * does. Recalibrated 2026-08-21 against REAL engine windows on this
 * Apple Silicon box (release 0.2.0 binary, WS-45 harness): idle 0.0%,
 * speaking 14.1% mean (max spike 69.1% observed in perf-gate runs),
 * listening 70.9% mean over 7 runs (range 52.8-85.0).
 */
export const REGRESSION_THRESHOLDS: ThresholdsByPhase = {
  idle: {
    cpuMeanMax: 10, // real idle baseline 0.0% (release binary); headroom for launch noise
    cpuMaxMax: 25, // measured idle max 6.39% x3.9
    rssMiBMax: 180, // real idle RSS 98.0 MiB x1.8
  },
  speaking: {
    cpuMeanMax: 30, // real say baseline 14.1% x2.1 (observed mean spikes to 21.5%)
    cpuMaxMax: 100, // real say max 69.1% x1.4 (listening-precedent margin: real max x2.4)
    rssMiBMax: 220, // real say RSS 36.8 MiB x6
  },
  listening: {
    cpuMeanMax: 180, // real whisper-cli baseline 70.9% mean (7 runs, max 85.0) x2.5
    cpuMaxMax: 200, // real whisper-cli max 85.0% x2.4
    rssMiBMax: 250, // real whisper-cli RSS 163.5 MiB x1.5
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
