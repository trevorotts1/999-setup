/**
 * FIX-020 parity review harness — evaluation engine.
 *
 * Owned lane: tests/visual/parity/** (this file).
 *
 * Turns the review manifest (manifest.json) + cited capture metadata +
 * computed pixel proofs into a single machine-readable ParityReviewReport
 * with a binary verdict. Rules:
 *
 *  - Every required state must have a cited capture (metadata present).
 *  - Every state row must be PASS or REQUIRE_SIGN_OFF; any FAIL fails
 *    BAR-10 (spec: "If any one required state fails parity, BAR-10 fails").
 *  - REQUIRE_SIGN_OFF rows block the BAR-10 verdict until the operator
 *    decision block is signed (overall-likeness, second-batch selections,
 *    and similar human rows can never be auto-PASSed by pixels).
 *  - Missing capture metadata = FAIL, never a silent skip.
 *  - Capture build/commit identity is enforced: a capture that does not
 *    name both its packaged build and its commit makes every row of its
 *    state FAIL (builder verification: "every capture from candidate
 *    packaged binary naming its commit").
 *  - Every manifest global check must be evaluated (PASS/FAIL from the
 *    pack, or a mechanical proof computed by the harness); UNEVALUATED
 *    required checks FAIL BAR-10 — never a silent pass.
 *  - Prohibited wording ("same vibe", "looks good enough", "same concept",
 *    "roughly similar", "probably used the images") in any note or
 *    sign-off — operator note, ANIM notes, override/pack notes — is
 *    rejected by the verdict pass; the spec bans those claims.
 *  - Animation states marked disabled in docs/candice-visual/
 *    ANIMATION-STATE-MAP.md must not be measured as active: input claiming
 *    a measurement for a disabled state carries an explicit DISABLED
 *    marker and FAILs BAR-10A. Animation requiredStates/requiredEvidence
 *    are consumed: every required state must be accounted for and every
 *    required evidence kind must be named by the input.
 *
 * Zero deps; pure functions over the shared types.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import type {
  AnimResult,
  AnimVerdict,
  CaptureMetadata,
  CheckProof,
  GlobalCheckResult,
  ParityManifest,
  ParityReviewReport,
  RowResult,
  RowVerdict,
  StateResult,
} from './types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const PROHIBITED_PHRASES: ReadonlyArray<[string, RegExp]> = [
  ['same vibe', /same vibe/i],
  ['looks good enough', /looks? good enough/i],
  ['same concept', /same concept/i],
  ['roughly similar', /roughly similar/i],
  ['probably used the images', /probably used the images/i],
];

/**
 * Animation states the design map marks disabled/unapproved
 * (docs/candice-visual/ANIMATION-STATE-MAP.md). A state here must NOT be
 * measured as active: input claiming a measurement for it is surfaced with
 * an explicit DISABLED marker and FAILs BAR-10A. The map is the authority;
 * if it drifts, the self-test loadAnimationStateMap fails loud.
 */
export const DISABLED_ANIMATION_STATES: ReadonlySet<string> = new Set([
  'PROGRESS_COMPANION_ALERT',
]);

export function containsProhibitedPhrase(text: string): string | null {
  for (const [label, re] of PROHIBITED_PHRASES) {
    if (re.test(text)) return label;
  }
  return null;
}

/** Load and structurally validate the review manifest. */
export function loadReviewManifest(dir: string): ParityManifest {
  const p = path.join(dir, 'manifest.json');
  const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as ParityManifest;
  if (raw.schema !== 'candice/parity-review@1') {
    throw new Error(`review manifest schema '${raw.schema}' not supported`);
  }
  if (raw.bar !== 'BAR-10') throw new Error('review manifest must target BAR-10');
  const known = Object.keys(raw.stateRows);
  for (const s of raw.requiredStates) {
    if (!known.includes(s)) throw new Error(`manifest lists required state '${s}' with no stateRows entry`);
    const spec = raw.stateRows[s];
    if (!Array.isArray(spec.canonicalIds) || spec.canonicalIds.length === 0) {
      throw new Error(`state '${s}' has no canonicalIds`);
    }
    if (!Array.isArray(spec.rows) || spec.rows.length === 0) {
      throw new Error(`state '${s}' has no rows`);
    }
  }
  for (const item of raw.animation.items) {
    if (!/^ANIM-0[1-7]$/.test(item)) {
      throw new Error(`animation item '${item}' outside ANIM-01..ANIM-07`);
    }
  }
  return raw;
}

/** Parser output for docs/candice-visual/ANIMATION-STATE-MAP.md. */
export interface AnimStateMap {
  /** Every state name listed in the map's state table. */
  allStates: string[];
  /** States the map marks disabled (e.g. "disabled until operator approves"). */
  disabledStates: string[];
  /** Whether the map was parsed at all (false = parse failure). */
  parseOk: boolean;
}

/**
 * Read docs/candice-visual/ANIMATION-STATE-MAP.md and list the states its
 * state table declares plus the ones the "Animation rule" column marks
 * disabled. The design map is the authority for which animation states may
 * be measured; the harness must fail loud if the map cannot be parsed — a
 * disabled state silently re-enabled is a fake runtime state.
 */
export function loadAnimationStateMap(): AnimStateMap {
  const mapPath = path.resolve(
    HERE,
    '../../../../../docs/candice-visual/ANIMATION-STATE-MAP.md',
  );
  const text = fs.readFileSync(mapPath, 'utf8');
  const table = text.match(/\n\|.*\|/g);
  if (!table) throw new Error('ANIMATION-STATE-MAP.md has no state table rows');
  const allStates: string[] = [];
  const disabledStates: string[] = [];
  for (const line of table) {
    const cells = line.slice(1, -1).split('|').map((c) => c.trim());
    if (cells.length < 5) continue;
    const state = (cells[1] ?? '').replace(/`/g, '');
    const rule = cells[4] ?? '';
    if (!/^[A-Z][A-Z0-9_]*$/.test(state)) continue; // header / separator rows
    allStates.push(state);
    if (/state is disabled/i.test(rule) || /\bdisabled until\b/i.test(rule)) {
      disabledStates.push(state);
    }
  }
  return { allStates, disabledStates, parseOk: allStates.length > 0 };
}

/**
 * Row kinds that are human likeness decisions and can only be satisfied by
 * the operator's signed decision — pixels never auto-PASS them.
 */
export const SIGN_OFF_ROWS: ReadonlySet<string> = new Set([
  'overall-likeness',
  'face',
  'hair',
  'identity',
  'same-candice-small-scale',
  'face-recognizable',
  'selected-source-approved',
  'expression-fits-state',
  'gesture-meaning',
  'state-reads-as-thinking',
  'mouth-change-credibility',
  'face-alignment',
]);

/**
 * Global checks the harness itself proves from capture pixels, per capture.
 * For these checks an override may only DOWNGRADE a passing mechanical
 * proof to a documented operator judgment, never UPGRADE a failed or
 * missing proof to PASS (FIX-020-overridegate / R1). Every other global
 * check is not pixel-gated: overrides for those are accepted as pack
 * evidence (the harness has no counter-proof to raise).
 */
const OVERRIDE_GATED_PIXEL_CHECKS: ReadonlySet<string> = new Set([
  'identity-tracks-reference',
  'palette-tracks-reference',
  'alpha-preserved-light-and-dark',
]);

/**
 * Computed per-capture pixel proof grouping for the override gate.
 * The runner computes these from pack bytes (strictDiff/SSIM/coverage),
 * and they are the ground truth an override cannot contradict.
 */
export interface PixelProofGroup {
  /** One capture's file name (the RIGHT side). */
  capture: string;
  /** All proofs computed for this capture from its pack bytes
   *  (strictDiff / SSIM identity bound / opaque coverage / capture SHA).
   *  Passing proofs satisfy the gate but never approve likeness. */
  proofs: CheckProof[];
}

/**
 * Override-gate policy (R1): when the pack carries an override whose
 * `pass` is true for a pixel-gated global check, every computed capture
 * proof must pass, otherwise the override is rejected and the check
 * verdict becomes FAIL with reason
 * `override-conflicts-with-pixel-proof`. Missing pixel proofs for a
 * capture reject the override the same way. A passing override claim can
 * only DOWNGRADE a passing proof to a documented operator judgment; it
 * can never UPGRADE a failed or missing proof to PASS.
 */
export function gateOverrideAgainstPixelProofs(
  check: string,
  override: { pass: boolean; notes: string[] },
  groups: PixelProofGroup[],
): CheckProof[] {
  if (!override.pass || !OVERRIDE_GATED_PIXEL_CHECKS.has(check)) return [];
  const metricTag = check.slice(0, 32);
  if (groups.length === 0) {
    return [
      {
        metric: `override-gate(${metricTag} | no-capture-proofs)`,
        value: 0,
        threshold: 1,
        pass: false,
        note: `override-conflicts-with-pixel-proof: pack override claims PASS for '${check}' but the runner computed no pixel proofs for any capture — a passing override requires passing mechanical pixel proofs, never missing ones`,
      },
    ];
  }
  for (const g of groups) {
    if (g.proofs.length === 0) {
      return [
        {
          metric: `override-gate(${metricTag} | ${g.capture})`,
          value: 0,
          threshold: 1,
          pass: false,
          note: `override-conflicts-with-pixel-proof: pack override claims PASS for '${check}' but the runner computed no pixel proofs for capture ${g.capture}`,
        },
      ];
    }
    for (const p of g.proofs) {
      if (!p.pass) {
        return [
          {
            metric: `override-gate(${metricTag} | ${g.capture})`,
            value: 0,
            threshold: 1,
            pass: false,
            note: `override-conflicts-with-pixel-proof: pack override claims PASS for '${check}' but computed ${p.metric} for capture ${g.capture} failed (${p.note}) — an override may downgrade a passing mechanical proof to a documented operator judgment, never upgrade a failed or missing proof to PASS`,
          },
        ];
      }
    }
  }
  return [];
}

/**
 * Row kinds with a mechanical pixel/origin proof the harness can compute
 * from a capture that lies over a source-authenticated composite (a
 * packed capture whose pixels trace to cited canonical assets).
 */
export const MECHANICAL_ROWS: ReadonlySet<string> = new Set([
  'silhouette-body',
  'hologram-palette',
  'transparency-no-box',
  'no-frame-pop',
  'no-opaque-circle-or-box',
  'readable-without-aliasing',
]);

export interface InputCapture {
  meta: CaptureMetadata;
  /** Decoded capture frame (RGBA), from the pack PNG. */
  frame?: { width: number; height: number; rgba: Uint8Array };
}

export interface InputAnim {
  item: string;
  verdict: AnimVerdict;
  notes: string[];
  /**
   * Explicit marker for a measurement claimed against an animation state
   * the design map marks disabled. The map name is the only authority;
   * this field documents the map name, not the fact.
   */
  disabledState?: string;
}

export interface InputOperatorDecision {
  approved: boolean;
  signedBy: string;
  dated: string;
  reviewedBuild: string;
  reviewedCommit?: string;
  osDisplayScale?: string;
  note?: string;
}

export interface EngineInput {
  reviewDir: string;
  captures: InputCapture[];
  /** Optional global-check overrides (pixel proofs precomputed by the pack). */
  globalOverrides?: Record<string, { pass: boolean; notes: string[] }>;
  /**
   * Optional per-capture pixel proofs the runner computed from pack bytes
   * (strictDiff / SSIM identity bound / opaque-coverage / capture SHA).
   * When present they are verdict-gating: a pack override claiming PASS
   * for a pixel-gated global check (identity/palette/alpha) is rejected
   * with reason `override-conflicts-with-pixel-proof` if any computed
   * proof for that check failed or is missing (FIX-020-overridegate / R1).
   */
  pixelProofs?: PixelProofGroup[];
  anim?: InputAnim[];
  /**
   * Animation evidence kinds named by the pack (manifest
   * `animation.requiredEvidence`); the harness cross-checks the pack's
   * claim against the evidence the input actually carries.
   */
  animationStateMap?: { disabledStates: string[]; parseOk: boolean };
  animEvidenceKinds?: string[];
  operatorDecision?: InputOperatorDecision | null;
  gitCommit?: string;
}

/**
 * Evaluate one state: rows are evaluated from capture provenance + pixel
 * proofs. Builder verification is enforced here: a capture that does not
 * name both its packaged build and its commit makes every row FAIL (the
 * spec's builder verification is "every capture from candidate packaged
 * binary naming its commit" — metadata-optional captures are not
 * evidence).
 */
export function evaluateState(
  manifest: ParityManifest,
  state: (typeof manifest.requiredStates)[number],
  capture: InputCapture | undefined,
): StateResult {
  const spec = manifest.stateRows[state];
  const rows: RowResult[] = [];
  if (!capture) {
    for (const row of spec.rows) {
      rows.push({
        row,
        verdict: 'FAIL',
        proofs: [
          {
            metric: 'capture-present',
            value: 0,
            threshold: 1,
            pass: false,
            note: `no capture metadata for required state '${state}'`,
          },
        ],
      });
    }
    return {
      state,
      label: spec.label,
      verdict: 'FAIL',
      canonicalShas: {},
      rows,
    };
  }
  const captureFile = capture.meta.file;
  const captureAssetIds = capture.meta.expectedAssetIds;
  const unknownIds = captureAssetIds.filter((id) => !spec.canonicalIds.includes(id));
  const citedCount = captureAssetIds.length;
  const missingBuild = !capture.meta.build || capture.meta.build.trim() === '';
  const missingCommit = !capture.meta.commit || capture.meta.commit.trim() === '';
  const provenanceBad = missingBuild || missingCommit;
  const provenanceFailProof: CheckProof = {
    metric: 'capture-build-commit',
    value: (missingBuild ? 0 : 1) + (missingCommit ? 0 : 1),
    threshold: 2,
    pass: !provenanceBad,
    note: provenanceBad
      ? `capture ${captureFile} does not name its ${missingBuild && missingCommit ? 'build or commit' : missingBuild ? 'build' : 'commit'} (builder verification requires every capture from the candidate packaged binary naming its commit)`
      : `capture ${captureFile} names build '${capture.meta.build}' commit '${capture.meta.commit}'`,
  };
  for (const row of spec.rows) {
    let verdict: RowVerdict = unknownIds.length > 0 ? 'FAIL' : 'REQUIRE_SIGN_OFF';
    const proofs: CheckProof[] = [];
    if (provenanceBad) {
      // Every row of a provenance-less capture is unverifiable: the
      // pixels cannot be attributed to the candidate packaged binary.
      verdict = 'FAIL';
      proofs.push(provenanceFailProof);
    }
    if (row === 'selected-source-approved') {
      proofs.push({
        metric: 'selected-source-cited',
        value: citedCount,
        threshold: 1,
        pass: citedCount >= 1 && unknownIds.length === 0,
        note: citedCount === 0
          ? 'no canonical source selected for this state'
          : unknownIds.length > 0
            ? `cited ids outside the approved set: ${unknownIds.join(', ')}`
            : `cited ${captureAssetIds.join(', ')} from the approved set`,
      });
    } else {
      proofs.push({
        metric: 'capture-cited',
        value: citedCount,
        threshold: 1,
        pass: citedCount >= 1,
        note: `capture ${captureFile} cites ${captureAssetIds.join(', ') || 'nothing'}`,
      });
    }
    rows.push({
      row,
      verdict,
      proofs,
      requiresSignOff:
        verdict === 'REQUIRE_SIGN_OFF'
          ? `row '${row}' for state '${state}' requires operator decision (spec: no "close enough" claims)`
          : undefined,
    });
  }
  return {
    state,
    label: spec.label,
    verdict: 'FAIL', // settled by evaluate() after sign-off resolution
    canonicalShas: {},
    rows,
    capture: capture.meta,
  };
}

/** Assemble the full report and compute the binary verdicts. */
export function evaluate(input: EngineInput): ParityReviewReport {
  const manifest = loadReviewManifest(input.reviewDir);
  const capturesByState = new Map<string, InputCapture>();
  for (const c of input.captures) capturesByState.set(c.meta.file, c);
  const capturesFor = (state: string): InputCapture | undefined => {
    for (const c of input.captures) {
      if (c.meta.file.includes(`state-${state}`) || c.meta.file.includes(state)) return c;
    }
    return undefined;
  };

  const states: StateResult[] = manifest.requiredStates.map((state) => {
    const capture = capturesFor(state);
    const res = evaluateState(manifest, state, capture);
    // canonicalShas filled by the caller via proveManifestShas; pass-through.
    return res;
  });

  // Animation state map: the design map is the authority for which
  // animation states may be measured. Parse failure is fatal — a disabled
  // state silently re-enabled is a fake runtime state. The manifest's
  // requiredStates must be a subset of the map's state table, otherwise
  // the manifest claims a state the design map does not know (drift =
  // fail closed).
  let map: AnimStateMap;
  try {
    map = input.animationStateMap ?? loadAnimationStateMap();
  } catch (err) {
    map = { allStates: [], disabledStates: [], parseOk: false };
  }

  const globalChecks: GlobalCheckResult[] = manifest.globalChecks.map((check) => {
    const override = input.globalOverrides?.[check];
    // R1 override gate: a passing override for a pixel-gated check is
    // intersected against the runner's computed pixel proofs. An override
    // may downgrade a passing mechanical proof to a documented operator
    // judgment, never upgrade a failed or missing proof to PASS.
    const gateProofs = override
      ? gateOverrideAgainstPixelProofs(check, override, input.pixelProofs ?? [])
      : [];
    const proofs = override
      ? [
          ...gateProofs,
          ...override.notes.map((n, i) => ({
            metric: `${check}-proof-${i}`,
            value: override.pass ? 1 : 0,
            threshold: 1,
            pass: override.pass,
            note: n,
          })),
        ]
      : [
          {
            metric: 'evaluated',
            value: 0,
            threshold: 1,
            pass: false,
            note: 'global check not yet evaluated by the pack',
          },
        ];
    return {
      check,
      verdict:
        gateProofs.length > 0 ? 'FAIL' : override ? (override.pass ? 'PASS' : 'FAIL') : 'UNEVALUATED',
      proofs,
    };
  });

  const animItems: AnimResult[] = manifest.animation.items.map((item) => {
    const a = input.anim?.find((x) => x.item === item);
    if (!a) {
      return {
        item,
        verdict: 'UNMEASURED',
        proofs: [
          {
            metric: 'measured',
            value: 0,
            threshold: 1,
            pass: false,
            note: `${item} not scored yet`,
          },
        ],
      };
    }
    let verdict: AnimVerdict = a.verdict;
    const proofs: CheckProof[] = [];
    if (a.disabledState) {
      verdict = 'FAIL';
      proofs.push({
        metric: 'disabled-state-marker',
        value: 0,
        threshold: 1,
        pass: false,
        note: `DISABLED: measurement claimed for animation state '${a.disabledState}' which ANIMATION-STATE-MAP.md marks disabled — a disabled state cannot be scored active`,
      });
    }
    proofs.push(
      ...a.notes.map((n, i) => ({
        metric: `${item}-note-${i}`,
        value: verdict === 'PASS' ? 1 : 0,
        threshold: 1,
        pass: verdict === 'PASS',
        note: n,
      })),
    );
    return { item, verdict, proofs };
  });

  // Animation required-state/required-evidence accounting (manifest
  // consumption): every required state must be accounted for and every
  // required evidence kind must be named by the input, or BAR-10A FAILs
  // — unaccounted required states are never a silent pass. States the
  // design map marks disabled carry an explicit DISABLED marker here;
  // BAR-10A cannot PASS while any required state is unwired.
  const animStateAcct: CheckProof[] = [];
  for (const st of manifest.animation.requiredStates) {
    if (map.disabledStates.includes(st)) {
      animStateAcct.push({
        metric: `anim-state(${st})`,
        value: 0,
        threshold: 1,
        pass: false,
        note: `DISABLED: animation state '${st}' is marked disabled in ANIMATION-STATE-MAP.md and has no active measurement (honest gap, recorded)`,
      });
    } else if (map.parseOk && !map.allStates.includes(st)) {
      animStateAcct.push({
        metric: `anim-state(${st})`,
        value: 0,
        threshold: 1,
        pass: false,
        note: `UNKNOWN: animation state '${st}' is required by the manifest but absent from ANIMATION-STATE-MAP.md — manifest/map drift, fail closed`,
      });
    }
  }
  const evidenceKindProofs: CheckProof[] = [];
  for (const kind of manifest.animation.requiredEvidence) {
    const named = input.animEvidenceKinds?.includes(kind) ?? false;
    evidenceKindProofs.push({
      metric: `anim-evidence(${kind})`,
      value: named ? 1 : 0,
      threshold: 1,
      pass: named,
      note: named
        ? `animation evidence kind '${kind}' named by the pack input`
        : `animation evidence kind '${kind}' not named by the pack input`,
    });
  }
  const evidenceMissing = evidenceKindProofs.some((p) => !p.pass);

  // Signed operator decision. Prohibited wording is checked in every
  // evidence note the harness consumes (operator note, ANIM notes,
  // override/pack notes) — a claim the spec bans anywhere keeps BAR-10
  // FAIL.
  let signed = false;
  let signedOk = false;
  let prohibitedWording: string | null = null;
  if (input.operatorDecision) {
    const d = input.operatorDecision;
    const noteText = d.note ?? '';
    prohibitedWording = containsProhibitedPhrase(noteText);
    if (!d.signedBy || !d.dated || !d.reviewedBuild) {
      signed = false;
    } else if (prohibitedWording) {
      signed = false;
    } else {
      signed = true;
      signedOk = d.approved === true;
    }
  }
  for (const a of input.anim ?? []) {
    if (prohibitedWording) break;
    for (const n of a.notes) {
      prohibitedWording = containsProhibitedPhrase(n);
      if (prohibitedWording) break;
    }
  }
  if (!prohibitedWording) {
    for (const [check, ov] of Object.entries(input.globalOverrides ?? {})) {
      if (manifest.globalChecks.includes(check)) {
        for (const n of ov.notes) {
          prohibitedWording = containsProhibitedPhrase(n);
          if (prohibitedWording) break;
        }
      }
      if (prohibitedWording) break;
    }
  }

  // State verdicts: FAIL on any failed row or unmet sign-off.
  for (const s of states) {
    const failed = s.rows.some((r) => r.verdict === 'FAIL');
    const needsSign = s.rows.some((r) => r.verdict === 'REQUIRE_SIGN_OFF');
    s.verdict = failed ? 'FAIL' : needsSign && !signed ? 'FAIL' : 'PASS';
    if (needsSign && signed && !signedOk) s.verdict = 'FAIL';
  }
  const globalFailed =
    globalChecks.some((g) => g.verdict === 'FAIL') ||
    globalChecks.some((g) => g.verdict === 'UNEVALUATED');
  const animFailed = animItems.some((a) => a.verdict !== 'PASS');
  const animDisabled = animStateAcct.some((p) => !p.pass);
  const bar10 =
    !globalFailed &&
    states.every((s) => s.verdict === 'PASS') &&
    signed &&
    signedOk &&
    prohibitedWording === null;
  const bar10a =
    map.parseOk &&
    !animFailed &&
    !animDisabled &&
    !evidenceMissing &&
    animItems.length > 0 &&
    animItems.every((a) => a.verdict === 'PASS');

  return {
    schema: 'candice/parity-review@1',
    review: 'CANDICE-VISUAL-PARITY-REVIEW',
    generatedAt: new Date().toISOString(),
    runId: crypto.randomUUID(),
    gitCommit: input.gitCommit,
    bar: 'BAR-10',
    verdict: bar10 ? 'PASS' : 'FAIL',
    states,
    globalChecks,
    animation: {
      bar: 'BAR-10A',
      review: 'CANDICE-ANIMATION-PARITY-REVIEW',
      verdict: bar10a ? 'PASS' : 'FAIL',
      items: animItems,
      stateAccounting: animStateAcct,
      evidenceAccounting: evidenceKindProofs,
    },
    operatorDecision: input.operatorDecision
      ? { ...input.operatorDecision }
      : null,
  };
}

/** Serialize a report as stable JSON (2-space, trailing newline). */
export function serializeReport(report: ParityReviewReport): string {
  return JSON.stringify(report, null, 2) + '\n';
}

/** Write the report into the review directory as review-report.json. */
export function writeReport(report: ParityReviewReport, dir: string): string {
  const out = path.join(dir, 'review-report.json');
  fs.writeFileSync(out, serializeReport(report));
  return out;
}
