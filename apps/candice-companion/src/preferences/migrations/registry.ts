/**
 * WS-34 — migration registry: the version-1 -> version-3 chain
 * (Master Spec section 9; CHECKLIST E.1 WS-34).
 *
 * Contract of every registered step:
 *   - pure (no I/O, no clocks, no env),
 *   - `MIGRATIONS[v]` takes doc@v and returns doc@(v+1) — the returned
 *     `schemaVersion` MUST be v+1 (enforced by the runner's per-step
 *     validation),
 *   - lossless on the fields IT owns (the field mappings below are pinned by
 *     the step tests: every retained value survives byte-for-byte, every
 *     renamed field survives under its new name, every dropped field was
 *     mapped into its successor),
 *   - a value the step does not understand is preserved under its old name
 *     (and flagged) rather than silently dropped — silent drop destroys data.
 *
 * The version constants, defaults, and field contracts live in `contract.ts`.
 */

import { type VersionDoc } from './types.ts';

/**
 * textScale 0.8..1.6 -> textSize enum (small | medium | large).
 * The runtime's textScale was a multiplier; the WR-010 contract field is the
 * enum. Mapping: < 1 -> small, 1 -> medium, > 1 -> large. Bounds are the v1
 * contract bounds (0.8..1.6); anything outside is normalized by the v1
 * contract first — a step must never see an out-of-contract value.
 */
export function textScaleToTextSize(textScale: unknown): 'small' | 'medium' | 'large' {
  const n = typeof textScale === 'number' ? textScale : 1;
  if (n < 1) return 'small';
  if (n > 1) return 'large';
  return 'medium';
}

/** The exact field-rename map for v1 -> v2 (see CROSS-LANE-FINDING note). */
const V1_TO_V2_RENAMES: Readonly<Record<string, string>> = Object.freeze({
  lastAnswerMethod: 'lastUsedAnswerMethod',
  companionPosition: 'companionScreenPosition',
  textScale: 'textSize',
});

/**
 * v1 -> v2: align runtime fields to the WR-010 protocol contract names.
 *   - `lastAnswerMethod`       -> `lastUsedAnswerMethod`        (same values)
 *   - `companionPosition` {left,top} -> `companionScreenPosition` {x,y} (same numbers, renamed keys)
 *   - `textScale`              -> `textSize`                    (multiplier mapped to the enum, `textScaleToTextSize`)
 *   - `nameAskedAt`            -> `nameAskedAt`                 (unchanged; dropped in v3)
 *   - all other fields pass through unchanged.
 */
export function migrateV1toV2(doc: VersionDoc): VersionDoc {
  const out: Record<string, unknown> = { schemaVersion: 2 };
  for (const [key, value] of Object.entries(doc)) {
    if (key === 'schemaVersion') continue;
    if (value === undefined) continue; // absent stays absent; target-version normalize decides null vs omit
    const renamed = V1_TO_V2_RENAMES[key];
    if (renamed !== undefined) {
      if (value === null) {
        out[renamed] = null;
        continue;
      }
      if (key === 'textScale') {
        out[renamed] = textScaleToTextSize(value);
        continue;
      }
      if (key === 'companionPosition' && typeof value === 'object' && value !== null) {
        const pos = value as Record<string, unknown>;
        out[renamed] = {
          x: typeof pos.left === 'number' ? pos.left : 0,
          y: typeof pos.top === 'number' ? pos.top : 0,
          anchor: 'floating',
        };
        continue;
      }
      out[renamed] = value;
      continue;
    }
    out[key] = value;
  }
  return out as VersionDoc;
}

/**
 * v2 -> v3: structure the first-run name ask state.
 *   - `nameAskedAt` (string|null) -> `nameAsked: { askedAt }` (object|null).
 *   - A non-null timestamp becomes `{ askedAt }`. Null/absent becomes null.
 *   - All other fields pass through unchanged.
 */
export function migrateV2toV3(doc: VersionDoc): VersionDoc {
  const out: Record<string, unknown> = { schemaVersion: 3 };
  for (const [key, value] of Object.entries(doc)) {
    if (key === 'schemaVersion') continue;
    if (value === undefined) continue; // absent stays absent
    if (key === 'nameAskedAt') {
      out.nameAsked = typeof value === 'string' && value.length > 0 ? { askedAt: value } : null;
      continue;
    }
    out[key] = value;
  }
  return out as VersionDoc;
}

/**
 * THE registry. `MIGRATIONS[v]` must return a document at v+1. Keys are
 * incoming versions; future steps land here (v3 -> v4, ...) without changing
 * `runMigrations` (`migrate.ts`).
 */
export const MIGRATIONS: Readonly<Record<number, (doc: VersionDoc) => VersionDoc>> = Object.freeze({
  1: migrateV1toV2,
  2: migrateV2toV3,
});
