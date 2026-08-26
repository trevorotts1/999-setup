/**
 * WS-30 regression thresholds — Windows 10/11 x64 (Master Spec 19).
 *
 * Owned by WR-016 / WS-30 lane (ownership map 9.2). This file is the
 * single source of the baseline + threshold contract for the Windows
 * companion. The thresholds live with the instrumentation lane (not in
 * CI) so the lane and the CI fragment cannot drift apart.
 *
 * Baseline discipline (spec 19): do not hardcode an unrealistic memory
 * target before measuring the chosen runtime. No real Windows x64
 * measurement of the companion exists yet (no Windows runner in this
 * wave; the app shell/speech stack are not live), so the values below
 * are a DECLARED PROVISIONAL PLACEHOLDER baseline anchored to the macOS
 * WS-24 measured reference plus an x64 headroom allowance — NOT a
 * claimed measurement. The provisional thresholds are intentionally
 * generous: they catch regression-class defects (leaks, runaway loops,
 * engine double-loads), not noise.
 *
 * Release-blocking obligation (spec 19 + WS-46 interactive Windows
 * smoke): before Windows is labeled production-ready, the WS-30 phase
 * probe (probe.ts) must be run on a modern Windows 10/11 x64 machine
 * against the release artifact, and this registry must be updated with
 * the REAL measured baseline through this lane only.
 *
 * CI enforcement lives in `.github/workflows/**`, which is integration
 * owned (manifest 9.4). This lane SHIPS THE PROPOSAL FRAGMENT
 * (CI-PERF-THRESHOLDS-WS30.md) and the machine-readable registry below;
 * the integration owner applies the fragment at fan-in. Thresholds are
 * adjustable only through this lane (CROSS-LANE-FINDING) so CI never
 * drifts from the source.
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

/**
 * WS-30 PROVISIONAL baseline (2026-08-21). Not a claimed Windows
 * measurement — see the file header. Placeholder derived from the WS-24
 * macOS measured reference plus a conservative x64 allowance, pending
 * the real Windows x64 capture at the WS-46 interactive smoke gate
 * (release-blocking). The name says provisional on purpose: a const
 * named MEASURED_ would be a fabricated measurement claim.
 */
export const PROVISIONAL_BASELINE_WINDOWS_X64_2026_08_21 = {
  platform: 'windows-x64',
  provisionalAt: '2026-08-21',
  basis: 'WS-24 macOS measured reference + x64 headroom allowance (NOT a Windows measurement)',
  idleCpuPercentMean: 0.5,
  idleRssMiB: 74,
  speakingCpuPercentMean: 7.0,
  speakingRssMiB: 80,
  listeningCpuPercentMean: 10.5,
  listeningRssMiB: 78,
} as const;

/**
 * Regression thresholds. Each limit is a generous multiple of the
 * provisional baseline so that a healthy machine never trips, while a
 * regression-class defect (leak, loop, double-loaded engine) does.
 */
export const REGRESSION_THRESHOLDS: ThresholdsByPhase = {
  idle: {
    cpuMeanMax: 2.5, // baseline 0.5% x5
    cpuMaxMax: 10,
    rssMiBMax: 190, // baseline 74 MiB x2.6
  },
  speaking: {
    cpuMeanMax: 22, // baseline 7.0% x3.1
    cpuMaxMax: 65,
    rssMiBMax: 240, // baseline 80 MiB x3
  },
  listening: {
    cpuMeanMax: 32, // baseline 10.5% x3
    cpuMaxMax: 85,
    rssMiBMax: 240, // baseline 78 MiB x3.1
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
 * per-phase results plus an overall verdict; never throws. A phase with
 * no measurement window is a violation, not a skip.
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
