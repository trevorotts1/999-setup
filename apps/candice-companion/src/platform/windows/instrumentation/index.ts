/**
 * Windows resource/performance instrumentation public surface
 * (Master Spec 0E WS-30).
 *
 * Owned by WR-016 / WS-30 lane (ownership map 9.2:
 * `apps/candice-companion/src/platform/windows/instrumentation/**`).
 *
 * Single-file barrel: everything this lane owns is exported here so the rest
 * of the app imports one stable path (`@candice/platform/windows/
 * instrumentation`), never deep imports. Mirrors the WS-24 macOS lane shape.
 */

export {
  bytesToMiB,
  cpuPercentBetween,
  parseCounterLine,
  sampleWindow,
  summarize,
  probeLiveProcess,
  powershellProbeBackend,
  nodeChildProcess,
  SAMPLE_DEFAULTS,
  POWER_SHELL_CANDIDATES,
  type ResourceSample,
  type WindowSample,
  type SampleWindowOptions,
  type ProcessReader,
  type WindowsProbeBackend,
  type NativeProbeResult,
  type CounterLine,
  type Win32CounterSnapshot,
} from './sampler.ts';

export {
  measurePhase,
  runPhaseReport,
  reportFromWindows,
  PHASE_NAMES,
  type PhaseProbeOptions,
  type PhaseMeasurement,
  type PhaseReport,
  type PhaseName,
} from './probe.ts';

export {
  checkThresholds,
  verifyReport,
  REGRESSION_THRESHOLDS,
  PROVISIONAL_BASELINE_WINDOWS_X64_2026_08_21,
  THRESHOLDS_SCHEMA_VERSION,
  type PhaseThresholds,
  type ThresholdsByPhase,
  type ThresholdCheckResult,
} from './thresholds.ts';
