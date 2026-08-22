/**
 * WS-34 — versioned preferences migration: public surface
 * (Master Spec section 9; CHECKLIST E.1 WS-34).
 *
 * The migration chain consumes the document the store reads (`VersionDoc`)
 * and returns the migrated document at CURRENT_SCHEMA_VERSION. It never
 * touches disk itself — the store (WS-40, `src/prefs/store.ts`, or a newer
 * store) calls `runMigrations` and then persists-or-refuses per its own
 * version guard. These two layers are separate on purpose: migration is a
 * pure document transform, persistence is an atomic write with refusal.
 */

export {
  runMigrations,
  validateVersionedDoc,
  parseDocVersion,
  MAX_MIGRATION_STEPS,
  type Violation,
} from './migrate.ts';
export { MIGRATIONS, migrateV1toV2, migrateV2toV3, textScaleToTextSize } from './registry.ts';
export { normalizeVersionedDoc } from './normalize.ts';
export {
  MIN_SCHEMA_VERSION,
  CURRENT_SCHEMA_VERSION,
  isSchemaVersion,
  FIELD_RULES,
  FIELD_DEFAULTS,
  VERSION_NOTES,
  type FieldRule,
} from './contract.ts';
export type { VersionDoc, ProfileV3, NameAskedV3 } from './types.ts';
