/**
 * WS-34 — versioned preferences document types (Master Spec section 9).
 *
 * `VersionDoc` is the on-disk shape of the profile document. It is a plain
 * JSON object; typed access happens at the version contract level
 * (`contract.ts`), never by guessing. `version` mirrors the integer
 * `schemaVersion` of the store's document.
 */

/**
 * A preferences document at any schema version. `version` is a mirror of the
 * integer `schemaVersion` field for the migration chain's convenience; the
 * canonical position is `schemaVersion`.
 */
export interface VersionDoc {
  schemaVersion: number;
  [key: string]: unknown;
}

export interface NameAskedV3 {
  askedAt?: string;
}

/** The v3 profile document — the current version this lane understands. */
export interface ProfileV3 extends VersionDoc {
  preferredName: string | null;
  voiceOutputEnabled: boolean;
  volume: number;
  speechRate: number;
  lastUsedAnswerMethod: 'voice' | 'typed' | 'terminal' | null;
  textSize: 'small' | 'medium' | 'large' | null;
  reducedMotion: boolean | null;
  /** Hide her image while she keeps working. See contract.ts. */
  characterHidden: boolean;
  companionScreenPosition: {
    x: number;
    y: number;
    anchor: 'left' | 'right' | 'floating';
  } | null;
  lastUsedSkill: 'spec-protocol' | 'kaizen' | 'eli5' | 'bro' | null;
  nameAsked: NameAskedV3 | null;
}
