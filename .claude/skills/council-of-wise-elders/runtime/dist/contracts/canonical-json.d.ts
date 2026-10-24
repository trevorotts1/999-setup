/**
 * Canonical JSON serializer and strict parser (directive Section 11.6).
 *
 * One documented serializer governs every cross-language hash in the Council
 * of Wise Elders system:
 * - object keys are sorted by UTF-16 code unit order;
 * - array order is preserved exactly as given (semantically significant);
 * - output is UTF-8 encoded with no insignificant whitespace;
 * - NaN and infinity are rejected, never serialized;
 * - duplicate object keys are rejected at parse time;
 * - unknown values are represented as null, never as empty strings;
 * - money is integer minor units with a currency code (see primitives.ts);
 * - only explicitly enumerated self-referential hash/signature fields may be
 *   excluded before hashing (see SELF_REFERENTIAL_FIELDS and hashCanonical).
 *
 * Hashes are computed over exactly these normalized bytes: the bytes accepted
 * and stored, never a UI reserialization.
 */
export type CanonicalValue = null | boolean | number | string | CanonicalValue[] | {
    [key: string]: CanonicalValue;
};
/**
 * Serialize a value to its canonical JSON text. `undefined` becomes null
 * (unknown), functions/symbols/bigints/class instances are rejected, and
 * non-finite numbers throw NON_FINITE_NUMBER.
 */
export declare function canonicalStringify(value: unknown): string;
/** The exact normalized UTF-8 bytes for a value. */
export declare function canonicalBytes(value: unknown): Uint8Array;
/** SHA-256 hex digest over exactly the canonical bytes of a value. */
export declare function canonicalHash(value: unknown): string;
/**
 * Field names that are self-referential (a hash or signature of the object
 * that contains them). These, and only these, may be excluded before hashing
 * when a caller explicitly requests exclusion via hashCanonicalExcluding.
 */
export declare const SELF_REFERENTIAL_FIELDS: ReadonlySet<string>;
/**
 * Hash a value after removing only the enumerated self-referential fields.
 * Used for the record that carries its own hash (for example a draft
 * resolution's semantic hash or a run preview's preview hash).
 */
export declare function hashCanonicalExcludingSelfReferential(value: unknown): string;
/**
 * Strict JSON parser for canonical payloads. Unlike JSON.parse it rejects
 * duplicate object keys, trailing content, and non-JSON number tokens such as
 * NaN or Infinity. Parsed numbers that are not finite are rejected.
 */
export declare function parseCanonicalJson(text: string): CanonicalValue;
