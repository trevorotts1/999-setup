/**
 * Machine-readable threshold registry (Master Spec 0E WS-24, spec 19).
 *
 * Owned by WR-015 / WS-24 lane (ownership map 9.2). Single JSON source
 * for the thresholds, exported for: CI fragments, dashboard tooling, and
 * any consumer that cannot import the TypeScript module. Schema-versioned
 * so a threshold bump is always an explicit, diffable change.
 */

import { MEASURED_BASELINE_MACOS_AS_2026_08_21, REGRESSION_THRESHOLDS } from './thresholds.ts';

export const MACHINE_READABLE_THRESHOLDS_JSON = JSON.stringify(
  {
    schemaVersion: 3,
    platform: MEASURED_BASELINE_MACOS_AS_2026_08_21.platform,
    measuredAt: MEASURED_BASELINE_MACOS_AS_2026_08_21.measuredAt,
    machine: MEASURED_BASELINE_MACOS_AS_2026_08_21.machine,
    phases: REGRESSION_THRESHOLDS,
  },
  null,
  2,
);
