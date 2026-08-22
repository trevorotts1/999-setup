/**
 * macOS instrument facade — the one entry point the rest of the app uses
 * (Master Spec 0E WS-24).
 *
 * Owned by WR-015 / WS-24 lane (ownership map 9.2). Publishes:
 *   - the sampler (sampleWindow, summarize),
 *   - the regression thresholds + baseline (checkThresholds, verifyReport),
 *   - the phase-probe scanner that locates the app's own window by its
 *     stable production title prefix (spec 11: stable filenames/titles
 *     only — never a ChatGPT download name, never a dev placeholder),
 *     so the sampler drives the app's real idle/speaking/listening
 *     windowing.
 *
 * Failure isolation (spec 20): every function is total — a probe failure
 * degrades to an error string, never a throw. No Candice failure may
 * stop Claude.
 */

export {
  sampleWindow,
  summarize,
  cpuPercentBetween,
  bytesToMiB,
  hrtimeToMs,
  liveProcessReader,
  SAMPLE_DEFAULTS,
} from './sampler.ts';
export type {
  CpuUsageLike,
  MemUsageLike,
  ProcessLike,
  ProcessReader,
  ResourceSample,
  SampleWindowOptions,
  WindowSample,
} from './sampler.ts';

export {
  REGRESSION_THRESHOLDS,
  MEASURED_BASELINE_MACOS_AS_2026_08_21,
  THRESHOLDS_SCHEMA_VERSION,
  PHASE_NAMES,
  checkThresholds,
  verifyReport,
} from './thresholds.ts';
export type {
  PhaseName,
  PhaseThresholds,
  ThresholdCheckResult,
  ThresholdsByPhase,
} from './thresholds.ts';

export {
  WINDOW_TITLE_PREFIX,
  PROBE_DEFAULTS,
  probeCandiceWindowTitle,
  nearestPhase,
} from './window-probe.ts';
export type { ProbeOptions, ProbeResult, ProbePhase } from './window-probe.ts';

export { MACHINE_READABLE_THRESHOLDS_JSON } from './thresholds-registry.ts';
