/**
 * WS-34 — versioned preferences load/save with the migration chain
 * (Master Spec section 9; CHECKLIST E.1 WS-34).
 *
 * The WS-40 runtime store (`src/prefs/store.ts`) ships with its own
 * single-version load path — this module is the WS-34 upgraded store: it
 * loads a document, runs the version chain, and persists at the migrated
 * version (atomic write-then-rename, no clock, no env reads).
 *
 * Data-loss guarantees (each pinned by the tests in `tests/migrations/`):
 *   - a FUTURE document (version > CURRENT_SCHEMA_VERSION) is returned
 *     untouched at its own version and NEVER persisted here — persisting would
 *     let an old lane destroy a newer lane's fields. Callers surface it; this
 *     lane refuses (spec 20).
 *   - a migration that produces a contract-violating document is a FAIL: the
 *     result is returned with `ok=false` and nothing is persisted. Silently
 *     repairing a migration's output is how a chain hides data loss.
 *   - a corrupt/unparseable file is NEVER overwritten (spec 20: never destroy
 *     user data). It is reported; the caller decides.
 *
 * The store is dependency-free Node (`node:fs`, `node:path`), synchronous,
 * and never throws: errors are typed results (spec 20: a preference error
 * never blocks the session).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { runMigrations, normalizeVersionedDoc, parseDocVersion } from './index.ts';
import { CURRENT_SCHEMA_VERSION } from './contract.ts';
import type { VersionDoc } from './types.ts';

export interface LoadResultV2 {
  ok: boolean;
  doc: VersionDoc | null;
  /** true when a stored file existed but could not be parsed. */
  corrupt: boolean;
  /** true when the version chain advanced the document. */
  migrated: boolean;
  /** shape violations when ok=false and the failure was a migration FAIL. */
  violations: ReturnType<typeof runMigrations>['violations'];
  error?: string;
}

const readJson = (file: string): Record<string, unknown> | null => {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
};

/** Atomic write-then-rename with restrictive permissions (0o600). */
export function writeDocAtomic(file: string, doc: Record<string, unknown>): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n', { mode: 0o600 });
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // best-effort cleanup; the original file is untouched
    }
    throw err;
  }
}

/**
 * Load + migrate a preferences document from disk and persist the migrated
 * result. Returns a typed result; never throws.
 *
 * - missing file: ok=true, doc=defaults, nothing written.
 * - unparseable file: ok=true, corrupt=true, doc=null, file NOT touched.
 * - future version: ok=true, doc at its own version, NOT persisted, migrated=false.
 * - migration FAIL (contract violation): ok=false, nothing persisted.
 * - success: ok=true, doc migrated to CURRENT, persisted atomically.
 */
export function loadAndMigrateDoc(
  dir: string,
  formatDoc: (doc: VersionDoc) => Record<string, unknown>,
): LoadResultV2 {
  try {
    const file = path.join(dir, 'profile.json');
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      return {
        ok: true,
        doc: normalizedDefault(),
        corrupt: false,
        migrated: false,
        violations: [],
        error: 'profile directory missing or not a directory',
      };
    }
    if (!fs.existsSync(file)) {
      return { ok: true, doc: normalizedDefault(), corrupt: false, migrated: false, violations: [] };
    }
    const raw = readJson(file);
    if (raw === null) {
      // Never overwrite a file we cannot parse (spec 20: never destroy data).
      return { ok: true, doc: null, corrupt: true, migrated: false, violations: [] };
    }
    const result = runMigrations(raw);
    if (result.violations.length > 0) {
      return {
        ok: false,
        doc: result.profile,
        corrupt: false,
        migrated: result.migrated,
        violations: result.violations,
        error: 'migration produced a document that violates its schema version contract',
      };
    }
    const version = typeof result.profile.schemaVersion === 'number'
      ? result.profile.schemaVersion
      : parseDocVersion(result.profile);
    if (version > CURRENT_SCHEMA_VERSION) {
      // Future document: hand it back untouched, never persist (spec 20).
      return {
        ok: true,
        doc: result.profile,
        corrupt: false,
        migrated: false,
        violations: [],
      };
    }
    const normalized = normalizeVersionedDoc(result.profile, version);
    if (result.migrated) {
      // Only a MIGRATED document is written forward. A document already at
      // its version (current or future) is returned in memory and never
      // rewritten: persisting a doc a newer lane wrote — or one that merely
      // needed a repair — is how an old lane destroys newer data.
      writeDocAtomic(file, formatDoc(normalized));
    }
    return {
      ok: true,
      doc: normalized,
      corrupt: false,
      migrated: result.migrated,
      violations: [],
    };
  } catch (err) {
    return {
      ok: false,
      doc: null,
      corrupt: false,
      migrated: false,
      violations: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function normalizedDefault(): VersionDoc {
  // The default set is the version default of every defaulted field; the
  // omitted fields have no default and stay omitted (nothing was ever chosen).
  return normalizeVersionedDoc({ schemaVersion: CURRENT_SCHEMA_VERSION }, CURRENT_SCHEMA_VERSION);
}
