/**
 * WS-45 threshold gate — enforces the WS-24 (macOS) and WS-30 (Windows)
 * regression thresholds by importing the registries DIRECTLY. This lane
 * never copies a threshold number: CI gate and instrumentation source
 * cannot drift apart (the same rule WS-24's CI fragment declares).
 *
 * Owned by WR-020 / WS-45 lane (ownership map 9.2: tests/performance/**).
 */

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';

const MACOS_THRESHOLDS = path.resolve(
  process.cwd(),
  'apps/candice-companion/src/platform/macos/instrumentation/thresholds.ts',
);
const WINDOWS_THRESHOLDS = path.resolve(
  process.cwd(),
  'apps/candice-companion/src/platform/windows/instrumentation/thresholds.ts',
);

function abs(p) {
  return pathToFileURL(p).href;
}

export async function loadThresholdRegistries() {
  const out = { macos: null, windows: null, notes: [] };
  if (existsSync(MACOS_THRESHOLDS)) {
    out.macos = await import(abs(MACOS_THRESHOLDS));
  } else {
    out.notes.push(`WS-24 thresholds not found at ${MACOS_THRESHOLDS}`);
  }
  if (existsSync(WINDOWS_THRESHOLDS)) {
    out.windows = await import(abs(WINDOWS_THRESHOLDS));
  } else {
    out.notes.push(`WS-30 thresholds not found at ${WINDOWS_THRESHOLDS}`);
  }
  return out;
}

/**
 * Gate one phase window against the registry for a platform.
 * The comparison itself is the owning lane's `checkThresholds` —
 * this gate only adapts WindowSample -> what the check expects and
 * records the verdict. A missing window or missing registry is a FAIL:
 * a failed measurement is never a silent pass (WS-24 gate semantics).
 */
export function gatePhase({ platform, phase, window, registry }) {
  if (!registry) {
    return {
      phase, platform,
      status: 'unavailable',
      registry: registryPath(platform),
      observed: null, limits: null,
      gateOk: false,
      violations: [`${platform}/${phase}: threshold registry unavailable — cannot enforce`],
      note: 'registry module missing',
    };
  }
  const fn = platform === 'macos' ? registry.checkThresholds : registry.checkThresholds;
  if (typeof fn !== 'function') {
    return {
      phase, platform,
      status: 'unavailable',
      registry: registryPath(platform),
      observed: null, limits: null,
      gateOk: false,
      violations: [`${platform}/${phase}: registry has no checkThresholds export`],
      note: 'registry shape unexpected',
    };
  }
  if (!window || !Array.isArray(window.samples) || window.sampleCount === 0) {
    return {
      phase, platform,
      status: 'unavailable',
      registry: registryPath(platform),
      observed: null, limits: null,
      gateOk: false,
      violations: [`${platform}/${phase}: no measurement window recorded`],
      note: 'missing or empty phase window',
    };
  }
  const result = fn(window, phase, registry.REGRESSION_THRESHOLDS);
  return {
    phase, platform,
    status: result.ok ? 'ok' : 'violation',
    registry: registryPath(platform),
    observed: result.observed,
    limits: result.limits,
    gateOk: result.ok,
    violations: result.violations,
    note: '',
  };
}

/** Verify a full three-phase report; any phase missing/failed fails. */
export function gateReport({ platform, windows, registry }) {
  const phases = ['idle', 'speaking', 'listening'];
  const results = phases.map((phase) => gatePhase({ platform, phase, window: windows[phase], registry }));
  const failures = results.filter((r) => !r.gateOk);
  return { results, ok: failures.length === 0, failures };
}

function registryPath(platform) {
  return platform === 'macos'
    ? 'apps/candice-companion/src/platform/macos/instrumentation/thresholds.ts'
    : 'apps/candice-companion/src/platform/windows/instrumentation/thresholds.ts';
}
