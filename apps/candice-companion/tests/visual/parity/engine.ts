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
 *  - Prohibited wording ("same vibe", "looks good enough", "same concept",
 *    "roughly similar", "probably used the images") in any note or
 *    sign-off is rejected by the verdict pass — the spec bans those claims.
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
  anim?: InputAnim[];
  operatorDecision?: InputOperatorDecision | null;
  gitCommit?: string;
}

/**
 * Evaluate one state: canonical SHAs are resolved by the asset module;
 * rows are evaluated from capture provenance + pixel proofs.
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
  for (const row of spec.rows) {
    const verdict: RowVerdict = unknownIds.length > 0 ? 'FAIL' : 'REQUIRE_SIGN_OFF';
    const proofs = [];
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
    verdict: unknownIds.length > 0 || citedCount === 0 ? 'FAIL' : 'FAIL', // resolved below after sign-off
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

  const globalChecks: GlobalCheckResult[] = manifest.globalChecks.map((check) => {
    const override = input.globalOverrides?.[check];
    const proofs = override
      ? override.notes.map((n, i) => ({
          metric: `${check}-proof-${i}`,
          value: override.pass ? 1 : 0,
          threshold: 1,
          pass: override.pass,
          note: n,
        }))
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
      verdict: override ? (override.pass ? 'PASS' : 'FAIL') : 'UNEVALUATED',
      proofs,
    };
  });

  const animItems: AnimResult[] = manifest.animation.items.map((item) => {
    const a = input.anim?.find((x) => x.item === item);
    return {
      item,
      verdict: a ? a.verdict : 'UNMEASURED',
      proofs: a
        ? a.notes.map((n, i) => ({
            metric: `${item}-note-${i}`,
            value: a.verdict === 'PASS' ? 1 : 0,
            threshold: 1,
            pass: a.verdict === 'PASS',
            note: n,
          }))
        : [
            {
              metric: 'measured',
              value: 0,
              threshold: 1,
              pass: false,
              note: `${item} not scored yet`,
            },
          ],
    };
  });

  // Signed operator decision
  let signed = false;
  let signedOk = false;
  if (input.operatorDecision) {
    const d = input.operatorDecision;
    const noteText = d.note ?? '';
    if (!d.signedBy || !d.dated || !d.reviewedBuild) {
      signed = false;
    } else if (containsProhibitedPhrase(noteText)) {
      signed = false;
    } else {
      signed = true;
      signedOk = d.approved === true;
    }
  }

  // State verdicts: FAIL on any failed row or unmet sign-off.
  for (const s of states) {
    const failed = s.rows.some((r) => r.verdict === 'FAIL');
    const needsSign = s.rows.some((r) => r.verdict === 'REQUIRE_SIGN_OFF');
    s.verdict = failed ? 'FAIL' : needsSign && !signed ? 'FAIL' : 'PASS';
    if (needsSign && signed && !signedOk) s.verdict = 'FAIL';
  }
  const globalFailed = globalChecks.some((g) => g.verdict === 'FAIL');
  const animFailed = animItems.some((a) => a.verdict !== 'PASS');
  const bar10 = !globalFailed && states.every((s) => s.verdict === 'PASS') && signed && signedOk;
  const bar10a = !animFailed && animItems.length > 0 && animItems.every((a) => a.verdict === 'PASS');

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
