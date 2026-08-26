/**
 * WS-34 — versioned preferences normalization (Master Spec section 9).
 *
 * Every step of the migration chain ends on a document that must satisfy its
 * version's contract; a real store can hold a document that does not (a torn
 * write, a manual edit, an old lane that wrote permissively). Normalization
 * produces a document that satisfies the contract WITHOUT inventing user
 * choices:
 *   - invalid enum value        -> null (unknown choice) when the field is
 *     nullable, otherwise the version default,
 *   - out-of-range number       -> version default,
 *   - wrong-type value          -> version default (or null when nullable),
 *   - unknown field             -> dropped (a field the version does not own
 *     was never a stored preference),
 *   - absent field with a version default -> the default (already the runtime
 *     behavior: WS-40 always writes voiceOutputEnabled/volume/speechRate/
 *     textScale/reducedMotion);
 *   - absent field with no default -> omitted (no value was ever chosen).
 *
 * Defaults are never user choices — they are the runtime's safe values applied
 * only when the store has no value (spec 9: never invent, never guess).
 */

import { type VersionDoc } from './types.ts';
import { FIELD_RULES, FIELD_DEFAULTS, isSchemaVersion } from './contract.ts';

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

interface RuleShape {
  types: ReadonlyArray<string>;
  enum?: ReadonlyArray<unknown>;
  min?: number;
  max?: number;
  maxLength?: number;
  props?: Readonly<Record<string, RuleShape>>;
}

/**
 * Normalize a document at one version. The schemaVersion of the OUTPUT is the
 * version passed in (or 1 when the input has no valid version). Unknown
 * fields are dropped. Absent fields without a version default are omitted;
 * absent fields with a default get the default (matches the WS-40 runtime
 * writer: the defaulted set is always present in a stored document).
 */
export function normalizeVersionedDoc(doc: Record<string, unknown>, version: number): VersionDoc {
  const targetVersion = isSchemaVersion(version) ? version : 1;
  const ruleMap = (FIELD_RULES[targetVersion] ?? {}) as Readonly<Record<string, RuleShape>>;
  const defaults = FIELD_DEFAULTS[targetVersion] ?? {};
  const out: Record<string, unknown> = { schemaVersion: targetVersion };
  for (const [key, rule] of Object.entries(ruleMap)) {
    if (key === 'schemaVersion') continue;
    const value = doc[key];
    const dflt = defaults[key];
    if (value === undefined) {
      if (dflt !== undefined) {
        out[key] = dflt;
      } else if (rule.types.includes('null')) {
        // Nullable with no default: the user never chose a value. Record it
        // as null — a versioned schema consumers validate against requires
        // the property PRESENT (protocol `preferences.schema.json` requires
        // `preferredName` etc. as null until asked), never absent.
        out[key] = null;
      }
      // no value, no default, non-nullable: omitted (nothing was ever chosen)
      continue;
    }
    const normalized = normalizeOne(rule, value, dflt);
    if (normalized !== undefined) out[key] = normalized;
  }
  return out as VersionDoc;
}

function normalizeOne(rule: RuleShape, value: unknown, dflt: unknown): unknown {
  const nullable = rule.types.includes('null');
  const isNull = value === null;
  const typeOk = rule.types.some((t) => (t === 'null' ? isNull : typeof value === t));
  if (!typeOk) {
    // Wrong type: degrade, never invent. Nullable fields degrade to null
    // (unknown choice); non-nullable to the version default.
    return nullable ? null : dflt;
  }
  if (isNull) return null;
  if (typeof value === 'number') {
    if (rule.min !== undefined && value < rule.min) return dflt;
    if (rule.max !== undefined && value > rule.max) return dflt;
    return value;
  }
  if (typeof value === 'string') {
    if (value.length === 0) {
      // Empty string is "no value" in the runtime semantics (WS-40
      // `normalizeName`/`asStr`: an empty string is never a stored choice).
      return nullable ? null : dflt;
    }
    if (rule.enum !== undefined && !(rule.enum as readonly unknown[]).includes(value)) {
      return nullable ? null : dflt;
    }
    if (rule.maxLength !== undefined && value.length > rule.maxLength) {
      return nullable ? null : dflt;
    }
    return value;
  }
  if (typeof value === 'boolean') return value;
  if (isPlainObject(value) && rule.props !== undefined) {
    const outObj: Record<string, unknown> = {};
    for (const [subKey, subRule] of Object.entries(rule.props)) {
      const subValue = value[subKey];
      if (subValue === undefined) {
        if (subRule.types.includes('null')) outObj[subKey] = null;
        continue;
      }
      const sub = normalizeOne(subRule, subValue, undefined);
      if (sub !== undefined) outObj[subKey] = sub;
    }
    return outObj;
  }
  return dflt;
}
