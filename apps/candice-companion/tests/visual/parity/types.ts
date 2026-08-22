/**
 * FIX-020 parity review harness — shared types.
 *
 * Owned lane: tests/visual/parity/** (this file). The harness consumes the
 * machine-readable review manifest (manifest.json), evaluates every
 * checklist item mechanically, and emits a binary PASS/FAIL report that a
 * human operator signs. It never substitutes its own likeness judgment for
 * the operator's: pixel/alpha/region verdicts are computed here; the
 * operator likeness rows stay REQUIRE_SIGN_OFF until a human signs them.
 */

/** One required visual state of BAR-10. */
export type StateKey =
  | 'idle-neutral'
  | 'greeting'
  | 'listening'
  | 'speaking'
  | 'thinking-processing'
  | 'compact-idle'
  | 'expressive-gesture';

/** Checklist row outcome. FAIL is final; REQUIRE_SIGN_OFF blocks BAR-10. */
export type RowVerdict = 'PASS' | 'FAIL' | 'REQUIRE_SIGN_OFF';

/** ANIM-01..07 scoring outcome. */
export type AnimVerdict = 'PASS' | 'FAIL' | 'UNMEASURED';

/** Where the harness got the runtime evidence. */
export type CaptureSource = 'pack' | 'runtime-command' | 'manifest-asset';

/** Mandatory capture metadata per spec review-pack rules. */
export interface CaptureMetadata {
  /** Pack-relative path to the PNG. */
  file: string;
  /** Cite: where the pixels came from. */
  source: CaptureSource;
  /** Canonical asset ids the runtime is expected to render. */
  expectedAssetIds: string[];
  /** Build/commit identity claimed by the capture producer. */
  build?: string;
  commit?: string;
  os?: string;
  displayScale?: string;
  /** SHA-256 of the capture PNG itself (derived by the harness). */
  captureSha256?: string;
  /** ISO-8601 capture timestamp, per review-pack rules. */
  capturedAt?: string;
}

/** A provenance record checked against the asset manifest. */
export interface AssetCite {
  id: string;
  role: string;
  file: string;
  sha256: string;
  bytes: number;
  approval: string;
}

/** Per-state canonical source rows for the LEFT side. */
export interface StateSpec {
  key: StateKey;
  label: string;
  canonicalIds: string[];
  rows: string[];
}

/** The manifest.json shape (validated at load). */
export interface ParityManifest {
  schema: 'candice/parity-review@1';
  bar: 'BAR-10';
  requiredStates: StateKey[];
  stateRows: Record<StateKey, { label: string; canonicalIds: string[]; rows: string[] }>;
  globalChecks: string[];
  animation: {
    bar: 'BAR-10A';
    requiredStates: string[];
    items: string[];
    requiredEvidence: string[];
    technical: string[];
  };
}

/** A region (x, y, w, h in target-canvas pixels) whose source is named. */
export interface NamedRegion {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  sourceId: string;
}

/** A per-check independent pixel/origin proof produced by the harness. */
export interface CheckProof {
  metric: string;
  value: number;
  threshold: number;
  pass: boolean;
  note: string;
}

/** Outcome of one row of one state. */
export interface RowResult {
  row: string;
  verdict: RowVerdict;
  /** Independent pixel/origin proof when verdict is computed. */
  proofs: CheckProof[];
  /** Human line required before PASS can finalize (if any). */
  requiresSignOff?: string;
}

/** Outcome of one required state. */
export interface StateResult {
  state: StateKey;
  label: string;
  verdict: 'PASS' | 'FAIL';
  /** SHA-256 of each expected canonical asset, resolved from the manifest. */
  canonicalShas: Record<string, string>;
  rows: RowResult[];
  capture?: CaptureMetadata;
}

/** Outcome of one global binary release check. */
export interface GlobalCheckResult {
  check: string;
  verdict: 'PASS' | 'FAIL' | 'UNEVALUATED';
  proofs: CheckProof[];
}

/** Outcome of one ANIM item. */
export interface AnimResult {
  item: string;
  verdict: AnimVerdict;
  proofs: CheckProof[];
}

/** The complete machine review, ready for operator sign-off. */
export interface ParityReviewReport {
  schema: 'candice/parity-review@1';
  review: 'CANDICE-VISUAL-PARITY-REVIEW';
  generatedAt: string;
  runId: string;
  gitCommit?: string;
  bar: 'BAR-10';
  /** true only when every state PASSes with every row non-FAIL and
   *  REQUIRE_SIGN_OFF rows are resolved by a signed operator decision. */
  verdict: 'PASS' | 'FAIL';
  states: StateResult[];
  globalChecks: GlobalCheckResult[];
  animation: {
    bar: 'BAR-10A';
    review: 'CANDICE-ANIMATION-PARITY-REVIEW';
    verdict: 'PASS' | 'FAIL';
    items: AnimResult[];
  };
  /** Operator sign-off; null until a human completes the packet. */
  operatorDecision: null | {
    approved: boolean;
    signedBy: string;
    dated: string;
    reviewedBuild: string;
    reviewedCommit?: string;
    osDisplayScale?: string;
    note?: string;
  };
}
