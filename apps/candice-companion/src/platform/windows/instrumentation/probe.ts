/**
 * Windows phase probe (Master Spec 0E WS-30, spec 19).
 *
 * Owned by WR-016 / WS-30 lane (ownership map 9.2:
 * `apps/candice-companion/src/platform/windows/instrumentation/**`).
 *
 * Measures the companion's footprint per canonical phase — idle, speaking,
 * listening — and returns a three-phase report consumed by the threshold
 * check (thresholds.ts) and, at fan-in, by the CI performance smoke (proposal
 * fragment CI-PERF-THRESHOLDS-WS30.md).
 *
 * Degradation contract (spec 20): the probe never throws. A failed phase
 * window records `status: 'unavailable'` with a human-readable note; the
 * companion UI never depends on measurement.
 */

import {
  sampleWindow,
  summarize,
  type ProcessReader,
  type ResourceSample,
  type WindowSample,
} from './sampler.ts';

export interface PhaseProbeOptions {
  /** Wall duration per phase window in ms (default 30_000). */
  durationMs?: number;
  /** Interval between samples in ms (default 1_000). */
  intervalMs?: number;
  /** Injectable process reader (tests); default live native backend. */
  reader?: ProcessReader;
  /** Injectable clock (tests). */
  clockMs?: () => number;
}

export const PHASE_NAMES = ['idle', 'speaking', 'listening'] as const;
export type PhaseName = (typeof PHASE_NAMES)[number];

export interface PhaseMeasurement {
  phase: PhaseName;
  /** 'ok' when a full window was captured; 'unavailable' on failure. */
  status: 'ok' | 'unavailable';
  /** Window aggregates when captured; zeroed window when not. */
  window: WindowSample;
  /** Human-readable failure note; never raw output or secrets. */
  note?: string;
}

export interface PhaseReport {
  phases: PhaseMeasurement[];
  /** True when every phase window was captured. */
  complete: boolean;
  /** ISO wall time of the report. */
  reportedAt: string;
  /** Platform label for the report. */
  platform: 'windows-x64';
}

const phaseDurationDefaults: Record<PhaseName, number> = {
  idle: 30_000,
  speaking: 30_000,
  listening: 30_000,
};

/**
 * Capture a measurement window for one phase. Never throws: a failed window
 * becomes an `unavailable` measurement with a note (spec 20). A rejection
 * from the caller's injected reader is converted here, at the probe
 * boundary, into that measurement — a dead instrument never propagates
 * and never stops Claude.
 */
export async function measurePhase(
  phase: PhaseName,
  options: PhaseProbeOptions = {},
): Promise<PhaseMeasurement> {
  const durationMs = options.durationMs ?? phaseDurationDefaults[phase];
  try {
    const window = await sampleWindow({
      durationMs,
      intervalMs: options.intervalMs ?? 1_000,
      reader: options.reader,
      clockMs: options.clockMs,
    });
    return { phase, status: 'ok', window };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      phase,
      status: 'unavailable',
      window: summarize([], durationMs),
      note: `phase window failed: ${message}`,
    };
  }
}

/** Measure all three phases and assemble the report. Never throws. */
export async function runPhaseReport(
  options: PhaseProbeOptions = {},
): Promise<PhaseReport> {
  const phases: PhaseMeasurement[] = [];
  for (const phase of PHASE_NAMES) {
    phases.push(await measurePhase(phase, options));
  }
  return {
    phases,
    complete: phases.every((p) => p.status === 'ok'),
    reportedAt: new Date().toISOString(),
    platform: 'windows-x64',
  };
}

/** Build a three-phase report from injected windows (tests). Pure. */
export function reportFromWindows(
  windows: Partial<Record<PhaseName, WindowSample>>,
  reportedAt = '2026-08-21T00:00:00.000Z',
): PhaseReport {
  const phases: PhaseMeasurement[] = PHASE_NAMES.map((phase) => {
    const window = windows[phase];
    return window
      ? { phase, status: 'ok', window }
      : {
          phase,
          status: 'unavailable',
          window: summarize([], 0),
          note: 'no measurement window provided',
        };
  });
  return {
    phases,
    complete: phases.every((p) => p.status === 'ok'),
    reportedAt,
    platform: 'windows-x64',
  };
}

export type { ProcessReader, ResourceSample, WindowSample };
