/**
 * WS-34 — versioned preferences schema: version constants and per-version
 * field contracts (Master Spec section 9; CHECKLIST E.1 WS-34).
 *
 * The local preference profile is a small, versioned JSON document. This
 * module is the single authority in this lane for:
 *   - the version numbering (integer schemaVersion; the on-disk documents
 *     written by the WS-40 runtime carry an integer — see CROSS-LANE-FINDING
 *     on the protocol schema's string "1.0" const),
 *   - the field contract of every version the migration chain understands,
 *   - the defaults applied after a backend stores a value.
 *
 * Ownership discipline:
 *   - This lane (WS-34) never edits the canonical protocol schema
 *     `packages/candice-protocol/schemas/preferences.schema.json` (WR-010).
 *     Version 2 and 3 of the profile DOCUMENT are proposed here
 *     (`schemas/preferences-v2.proposal.json`, `preferences-v3.proposal.json`)
 *     and applied by WR-010 / the integration owner.
 *   - The profile is NEVER project/conversation memory (spec 9).
 */

/** First schema version that ever existed (the WS-40 runtime baseline). */
export const MIN_SCHEMA_VERSION = 1;

/**
 * Newest schema version this lane understands. Migrations exist for every
 * step below it; a document above it is preserved untouched (spec 20: an
 * older lane must never silently downgrade a newer lane's document).
 */
export const CURRENT_SCHEMA_VERSION = 3;

/** Human notes per version — why the bump happened (proposals to WR-010). */
export const VERSION_NOTES: Readonly<Record<number, string>> = Object.freeze({
  1: 'Baseline: WS-40 runtime profile (name, voice toggle, volume, rate, method, text scale, motion, position, last skill, nameAskedAt).',
  2: 'Field alignment to the WR-010 protocol contract names: lastUsedAnswerMethod, textSize, companionScreenPosition; textScale mapped to textSize enum.',
  3: 'Structural: nameAskedAt (string) becomes nameAsked: { askedAt } (object), future-proofing dismissal/rename state.',
});

/** True when v is a positive integer schema version. */
export function isSchemaVersion(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= MIN_SCHEMA_VERSION;
}

/**
 * One field rule. Recursive for object fields. `null` is always valid for
 * nullable fields (a value a user has not chosen is recorded as null, not
 * invented).
 */
export interface FieldRule {
  /** Allowed JSON types for this field. */
  types: ReadonlyArray<'string' | 'number' | 'boolean' | 'object' | 'null'>;
  /** Allowed values when the field is an enum. */
  enum?: ReadonlyArray<unknown>;
  /** Inclusive bound for numbers. */
  min?: number;
  max?: number;
  /** Non-empty string length cap. */
  maxLength?: number;
  /** Nested rules for object fields (additional props are contract errors). */
  props?: Readonly<Record<string, FieldRule>>;
}

const STRING: FieldRule = { types: ['string'], maxLength: 60 };
const NULLABLE_STRING: FieldRule = { types: ['string', 'null'], maxLength: 60 };
const NULLABLE_ENUM = (values: readonly string[]): FieldRule => ({ types: ['string', 'null'], enum: values });

/** Field contract per schema version. Unknown fields are contract errors. */
export const FIELD_RULES: Readonly<Record<number, Readonly<Record<string, FieldRule>>>> = {
  /* eslint-disable @typescript-eslint/naming-convention */
  1: {
    schemaVersion: { types: ['number'], min: 1 },
    preferredName: STRING,
    voiceOutputEnabled: { types: ['boolean'] },
    volume: { types: ['number'], min: 0, max: 1 },
    speechRate: { types: ['number'], min: 0.5, max: 2 },
    lastAnswerMethod: { types: ['string'], enum: ['voice', 'typed', 'terminal'] },
    textScale: { types: ['number'], min: 0.8, max: 1.6 },
    reducedMotion: { types: ['boolean'] },
    companionPosition: {
      types: ['object'],
      props: {
        left: { types: ['number'] },
        top: { types: ['number'] },
      },
    },
    lastUsedSkill: { types: ['string'], enum: ['spec-protocol', 'kaizen', 'eli5', 'bro'] },
    nameAskedAt: { types: ['string'], maxLength: 64 },
  },
  2: {
    schemaVersion: { types: ['number'], min: 1 },
    preferredName: NULLABLE_STRING,
    voiceOutputEnabled: { types: ['boolean'] },
    volume: { types: ['number'], min: 0, max: 1 },
    speechRate: { types: ['number'], min: 0.5, max: 2 },
    lastUsedAnswerMethod: NULLABLE_ENUM(['voice', 'typed', 'terminal']),
    textSize: NULLABLE_ENUM(['small', 'medium', 'large']),
    reducedMotion: { types: ['boolean', 'null'] },
    companionScreenPosition: {
      types: ['object', 'null'],
      props: {
        x: { types: ['number'] },
        y: { types: ['number'] },
        anchor: { types: ['string'], enum: ['left', 'right', 'floating'] },
      },
    },
    lastUsedSkill: NULLABLE_ENUM(['spec-protocol', 'kaizen', 'eli5', 'bro']),
    nameAskedAt: { types: ['string', 'null'], maxLength: 64 },
  },
  3: {
    schemaVersion: { types: ['number'], min: 1 },
    preferredName: NULLABLE_STRING,
    voiceOutputEnabled: { types: ['boolean'] },
    volume: { types: ['number'], min: 0, max: 1 },
    speechRate: { types: ['number'], min: 0.5, max: 2 },
    lastUsedAnswerMethod: NULLABLE_ENUM(['voice', 'typed', 'terminal']),
    textSize: NULLABLE_ENUM(['small', 'medium', 'large']),
    reducedMotion: { types: ['boolean', 'null'] },
    companionScreenPosition: {
      types: ['object', 'null'],
      props: {
        x: { types: ['number'] },
        y: { types: ['number'] },
        anchor: { types: ['string'], enum: ['left', 'right', 'floating'] },
      },
    },
    lastUsedSkill: NULLABLE_ENUM(['spec-protocol', 'kaizen', 'eli5', 'bro']),
    nameAsked: {
      types: ['object', 'null'],
      props: {
        askedAt: { types: ['string'], maxLength: 64 },
      },
    },
  },
  /* eslint-enable @typescript-eslint/naming-convention */
};

/** Defaults recorded when a field is absent or its stored value is invalid. */
export const FIELD_DEFAULTS: Readonly<Record<number, Readonly<Record<string, unknown>>>> = Object.freeze({
  1: Object.freeze({
    voiceOutputEnabled: true,
    volume: 1,
    speechRate: 1,
    textScale: 1,
    reducedMotion: false,
  }),
  2: Object.freeze({
    voiceOutputEnabled: true,
    volume: 1,
    speechRate: 1,
    textSize: 'medium',
    reducedMotion: null,
  }),
  3: Object.freeze({
    voiceOutputEnabled: true,
    volume: 1,
    speechRate: 1,
    textSize: 'medium',
    reducedMotion: null,
  }),
});
