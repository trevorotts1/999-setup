/**
 * WS-45 report schema (version 1).
 *
 * Owned by WR-020 / WS-45 lane (ownership map 9.2: tests/performance/**).
 * One versioned shape for every WS-45 report — the CI runner and the
 * threshold gate consume this, never ad-hoc fields.
 */

export const REPORT_SCHEMA_VERSION = 1;

/**
 * A measurement of ONE metric in ONE phase/platform context.
 * unavailable is a real state: a missing measurement must be explicit.
 */
export function metricShape() {
  return {
    key: 'string', // e.g. 'ptt-release-to-transcript'
    phase: "'idle' | 'speaking' | 'listening' | 'activation' | 'ptt'",
    platform: "'macos' | 'windows' | 'cross'",
    status: "'ok' | 'unavailable'",
    valueMs: 'number|null',
    note: 'string',
    provenance: 'string (which real engine/process produced this)',
    measuredAt: 'string (ISO)',
  };
}

/**
 * One phase's CPU/RSS window against one platform's threshold registry.
 * `gateOk` and `violations` come straight from the WS-24 / WS-30
 * checkThresholds — this lane never re-implements the comparison.
 */
export function phaseGateShape() {
  return {
    phase: "'idle' | 'speaking' | 'listening'",
    platform: "'macos' | 'windows'",
    status: "'ok' | 'unavailable'",
    registry: 'string (source module path of the thresholds)',
    observed: '{ cpuPercentMean, cpuPercentMax, rssMiBMax }|null',
    limits: '{ cpuMeanMax, cpuMaxMax, rssMiBMax }|null',
    gateOk: 'boolean',
    violations: 'string[]',
    note: 'string',
  };
}

export function createReport(platforms) {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    lane: 'WS-45',
    suite: 'candice-performance',
    generatedAt: new Date().toISOString(),
    host: {
      platform: process.platform,
      arch: process.arch,
      release: process.release?.name ?? 'node',
      nodeVersion: process.version,
    },
    platforms,
    metrics: [],
    phases: [],
    verdict: {
      ok: null, // boolean when finalized
      failures: [],
      skippedReasons: [],
    },
  };
}
