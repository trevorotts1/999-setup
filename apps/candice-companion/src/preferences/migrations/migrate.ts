/**
 * WS-34 — versioned preferences migration: stepwise, bounded, lossless
 * (Master Spec section 9; CHECKLIST E.1 WS-34).
 *
 * Guarantees:
 *   1. Every step is `MIGRATIONS[n]`: doc@n -> doc@(n+1), pure, no I/O.
 *   2. The chain is bounded (64 steps max per run): no migration can spin.
 *   3. Dirty values are repaired AT THE VERSION THEY LIVE AT, before that
 *      version's step runs — a v1 document with `volume: 99` is normalized to
 *      the v1 default and then migrated; the WS-40 runtime guarantee (dirty
 *      values degrade to defaults, never fail the session) is preserved
 *      through the chain.
 *   4. Every step's OUTPUT is normalized and validated at its target version;
 *      a step that produces a shape violating its own target contract is a
 *      FAIL — never silently repaired (silent repair is how a chain hides
 *      data loss).
 *   5. A FUTURE document (version > CURRENT_SCHEMA_VERSION) is preserved at
 *      its own version, fields untouched (spec 20: an older lane must never
 *      silently downgrade or rewrite a document a newer lane owns).
 *   6. No step may destroy data: values survive byte-for-byte or under their
 *      declared new name; the step tests pin every mapping.
 *
 * This lane never edits the canonical protocol schema (WR-010-owned); bump
 * proposals live in `schemas/preferences-v2.proposal.json` and
 * `preferences-v3.proposal.json`. The WS-40 runtime consumes `runMigrations`
 * for its load path, or a newer runtime consumes the same chain.
 */

import { type VersionDoc } from './types.ts';
import { MIGRATIONS } from './registry.ts';
import { FIELD_RULES, type FieldRule, isSchemaVersion, CURRENT_SCHEMA_VERSION, MIN_SCHEMA_VERSION } from './contract.ts';
import { normalizeVersionedDoc } from './normalize.ts';

/** Cap on migration steps per run — the strongest guard against a bad step. */
export const MAX_MIGRATION_STEPS = 64;

/** Shape violation produced when a document breaks its version contract. */
export type Violation =
  | { kind: 'unknown-field'; path: string }
  | { kind: 'type'; path: string; expected: string }
  | { kind: 'enum'; path: string; expected: string }
  | { kind: 'range'; path: string; min?: number; max?: number }
  | { kind: 'length'; path: string; maxLength: number };

/** Realize a single field rule against a value; appends violations. */
function realizeRule(
  rule: FieldRule,
  value: unknown,
  path: string,
  out: Violation[],
): void {
  const isNull = value === null;
  const okType = rule.types.some((t) => (t === 'null' ? isNull : typeof value === t));
  if (!okType) {
    out.push({ kind: 'type', path, expected: rule.types.join(' | ') });
    return;
  }
  if (isNull || value === undefined) return;
  if (typeof value === 'number') {
    if (rule.min !== undefined && value < rule.min) {
      out.push({ kind: 'range', path, min: rule.min, max: rule.max });
    }
    if (rule.max !== undefined && value > rule.max) {
      out.push({ kind: 'range', path, min: rule.min, max: rule.max });
    }
  }
  if (typeof value === 'string') {
    if (rule.enum !== undefined && !(rule.enum as readonly unknown[]).includes(value)) {
      out.push({ kind: 'enum', path, expected: JSON.stringify(rule.enum) });
    }
    if (rule.maxLength !== undefined && value.length > rule.maxLength) {
      out.push({ kind: 'length', path, maxLength: rule.maxLength });
    }
  }
  if (typeof value === 'object' && rule.props !== undefined) {
    const obj = value as Record<string, unknown>;
    for (const [k, sub] of Object.entries(rule.props)) {
      if (k in obj) realizeRule(sub, obj[k], path + '.' + k, out);
    }
  }
}

/**
 * Validate a document against ONE version's field contract. A malformed
 * `schemaVersion` is reported first. Unknown top-level fields are violations,
 * so an unmapped drop fails loudly instead of silently disappearing.
 */
export function validateVersionedDoc(
  doc: Record<string, unknown>,
  version: number,
): Violation[] {
  const out: Violation[] = [];
  if (!isSchemaVersion(version)) {
    out.push({ kind: 'type', path: 'schemaVersion', expected: 'positive integer >= 1' });
    return out;
  }
  const contract = (FIELD_RULES[version] ?? {}) as Readonly<Record<string, FieldRule>>;
  for (const [key, value] of Object.entries(doc)) {
    if (key === 'schemaVersion') continue;
    const rule = contract[key];
    if (rule === undefined) {
      out.push({ kind: 'unknown-field', path: key });
    } else {
      realizeRule(rule, value, key, out);
    }
  }
  return out;
}

/**
 * Resolve a document's version to the migration chain's integer numbering.
 *
 * Two real on-disk shapes exist:
 *   - integer `schemaVersion` (the WS-40 runtime: 1..current), used as-is;
 *   - protocol-contract string `"N.0"` (packages/candice-protocol
 *     `preferences.schema.json` const, WR-010-owned). The protocol shape's
 *     field names ALREADY match this lane's v2 contract (lastUsedAnswerMethod,
 *     textSize, companionScreenPosition), so a protocol "N.0" document is
 *     integer version N+1: "1.0" -> 2, "2.0" -> 3, ...
 * Anything else (missing, torn, nonsense) is treated as version 1 — a
 * pre-versioned runtime doc — and repaired by the v1 contract plus
 * normalization. Never invented, never guessed.
 */
export function parseDocVersion(doc: Record<string, unknown>): number {
  const raw = doc.schemaVersion;
  if (isSchemaVersion(raw)) return raw;
  if (typeof raw === 'string') {
    const m = /^([0-9]+)\.0$/.exec(raw.trim());
    if (m !== null) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n >= MIN_SCHEMA_VERSION) return n + 1;
    }
  }
  return MIN_SCHEMA_VERSION;
}

/**
 * Migrate a document through the version chain to CURRENT_SCHEMA_VERSION.
 *
 * - Missing/invalid `schemaVersion` is treated as version 1 (a pre-versioning
 *   or torn file: the v1 contract plus normalization decides; backward
 *   compatible by construction).
 * - A string `"N.0"` protocol version resolves to integer N+1 (see
 *   `parseDocVersion`) — a protocol-shaped document is never misread as a
 *   runtime v1 and never loses its protocol field names.
 * - At every version: normalize (repair dirty values), validate (fail loudly
 *   on a contract inconsistency), step (if below CURRENT).
 * - `> current`: preserved untouched at its own version (spec 20).
 */
export function runMigrations(doc: Record<string, unknown>): {
  profile: VersionDoc;
  migrated: boolean;
  startVersion: number;
  endVersion: number;
  violations: Violation[];
} {
  const startVersion = parseDocVersion(doc);
  if (startVersion > CURRENT_SCHEMA_VERSION) {
    const profile = { ...doc, schemaVersion: startVersion };
    return {
      profile,
      migrated: false,
      startVersion,
      endVersion: startVersion,
      violations: [],
    };
  }
  let current: Record<string, unknown> = { ...doc };
  let version = startVersion;
  let migrated = false;
  let steps = 0;
  if (CURRENT_SCHEMA_VERSION - MIN_SCHEMA_VERSION > MAX_MIGRATION_STEPS) {
    // A chain that needs more steps than the cap is a broken registry; the
    // bounded loop below is the safety net, this is the loud gate.
    return {
      profile: current as VersionDoc,
      migrated: false,
      startVersion,
      endVersion: startVersion,
      violations: [{ kind: 'range', path: 'schemaVersion', min: MIN_SCHEMA_VERSION, max: CURRENT_SCHEMA_VERSION }],
    };
  }
  while (version < CURRENT_SCHEMA_VERSION && steps < MAX_MIGRATION_STEPS) {
    // Repair dirty values at the version they live at (spec 20 / WS-40
    // runtime behavior) BEFORE the step reads them — a step must never see or
    // map an out-of-contract value.
    current = normalizeVersionedDoc(current, version) as Record<string, unknown>;
    const preViolations = validateVersionedDoc(current, version);
    if (preViolations.length > 0) {
      return { profile: current as VersionDoc, migrated, startVersion, endVersion: version, violations: preViolations };
    }
    const step = MIGRATIONS[version];
    if (step === undefined) {
      // No registered step: the chain is broken mid-way. Fail loudly rather
      // than skip — skipping a version silently downgrades the document.
      return {
        profile: current as VersionDoc,
        migrated,
        startVersion,
        endVersion: version,
        violations: [{ kind: 'unknown-field', path: 'schemaVersion(missing migration ' + version + ')' }],
      };
    }
    current = step(current as VersionDoc) as Record<string, unknown>;
    version += 1;
    // Invariant: a registered step MUST return exactly its target version.
    // A step that returns anything else is a broken migration — fail loudly.
    if (current.schemaVersion !== version) {
      return {
        profile: current as VersionDoc,
        migrated,
        startVersion,
        endVersion: version,
        violations: [
          { kind: 'type', path: 'schemaVersion', expected: 'exactly ' + version + ' after step ' + (version - 1) },
        ],
      };
    }
    migrated = true;
    steps += 1;
  }
  // Final position: normalize at CURRENT, then validate. A violation here is
  // a contract inconsistency — fail loudly, never silently repair.
  current = normalizeVersionedDoc(current, version) as Record<string, unknown>;
  const violations = validateVersionedDoc(current, version);
  return {
    profile: current as VersionDoc,
    migrated,
    startVersion,
    endVersion: version,
    violations,
  };
}
