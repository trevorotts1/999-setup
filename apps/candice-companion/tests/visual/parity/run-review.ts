/**
 * FIX-020 parity review harness — CLI runner.
 *
 * Owned lane: tests/visual/parity/** (this file).
 *
 *     node tests/visual/parity/run-review.ts <packDir>
 *
 * <packDir> must contain:
 *   captures/<state>.png          runtime captures (one per required state)
 *   captures/*.capture.json       capture metadata (CaptureMetadata)
 *   canonical/<id>.png            byte-copied operator-approved sources
 *   evidence.overrides.json       OPTIONAL global-check overrides
 *   anim.json                     OPTIONAL ANIM-01..07 input scores
 *   decision.json                 OPTIONAL operator decision (signs the pack)
 *
 * Decoded capture frames are CONSUMED, not discarded: each capture's
 * pixels are compared against its cited canonical source (strictDiff for
 * same-canvas, SSIM identity bound for different-scale) and the three
 * mechanical asset global checks are computed from the pack bytes. The
 * resulting proofs are fed into the engine's scoring.
 *
 * Produces review-report.json (machine verdict) and reviewer.html
 * (side-by-side reviewer page) inside the pack directory.
 *
 * Exit code 0 = report generated (even when verdict is FAIL); exit 2 =
 * harness/pack contract error. The binary verdict lives in the report.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { evaluate, writeReport } from './engine.ts';
import { writeReviewerHtml } from './report-html.ts';
import { decodePngFile } from '../png.ts';
import { strictDiff, ssimProof, likenessBound, type Frame } from './diff.ts';
import {
  checkCaptureNamesCanonical,
  checkDerivativeNamesParent,
  checkNoPlaceholderOrKie,
  cite,
  loadManifest,
  sha256File,
  sourcePathOf,
  type AssetManifestEntry,
} from './asset.ts';
import type { CaptureMetadata, CheckProof } from './types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

interface CaptureJsonFile extends CaptureMetadata {
  state: string;
}

interface OverridesFile {
  [check: string]: { pass: boolean; notes: string[] };
}

interface AnimJsonFile {
  items: Array<{ item: string; verdict: 'PASS' | 'FAIL' | 'UNMEASURED'; notes: string[] }>;
  /** Optional per-item state names (see DISABLED markers in engine.ts). */
  states?: string[];
  /** Optional evidence kinds the pack carries (manifest requiredEvidence). */
  evidenceKinds?: string[];
}

interface DecisionJsonFile {
  approved: boolean;
  signedBy: string;
  dated: string;
  reviewedBuild: string;
  reviewedCommit?: string;
  osDisplayScale?: string;
  note?: string;
}

function main(): number {
  const packDir = process.argv[2];
  if (!packDir) {
    process.stderr.write('usage: node run-review.ts <packDir>\n');
    return 2;
  }
  const dir = path.resolve(packDir);
  if (!fs.existsSync(path.join(dir, 'captures'))) {
    process.stderr.write(`pack dir '${dir}' has no captures/ directory\n`);
    return 2;
  }

  const captures: Array<{ meta: CaptureMetadata; frame: Frame }> = [];
  const capDir = path.join(dir, 'captures');
  for (const f of fs.readdirSync(capDir)) {
    if (!f.endsWith('.capture.json')) continue;
    const raw = JSON.parse(fs.readFileSync(path.join(capDir, f), 'utf8')) as CaptureJsonFile;
    const pngName = raw.file;
    if (!pngName || !fs.existsSync(path.join(capDir, pngName))) {
      process.stderr.write(`capture ${f} names missing png '${pngName}'\n`);
      return 2;
    }
    const frame = decodePngFile(path.join(capDir, pngName));
    captures.push({ meta: raw, frame });
  }

  let overrides: OverridesFile | undefined;
  const ovPath = path.join(dir, 'evidence.overrides.json');
  if (fs.existsSync(ovPath)) {
    overrides = JSON.parse(fs.readFileSync(ovPath, 'utf8')) as OverridesFile;
  }

  let anim: Array<{ item: string; verdict: 'PASS' | 'FAIL' | 'UNMEASURED'; notes: string[]; disabledState?: string }> | undefined;
  let animStates: string[] | undefined;
  let animEvidenceKinds: string[] | undefined;
  const animPath = path.join(dir, 'anim.json');
  if (fs.existsSync(animPath)) {
    const aj = JSON.parse(fs.readFileSync(animPath, 'utf8')) as AnimJsonFile;
    anim = aj.items;
    animStates = aj.states;
    animEvidenceKinds = aj.evidenceKinds;
  }
  // DISABLED markers: pack input claiming a measurement for a state that
  // the design map marks disabled gets an explicit marker (engine FAILs
  // BAR-10A on it). Missing measurements for disabled states are the
  // honest gap and stay unmarked.
  const mapText = (() => {
    try {
      return fs.readFileSync(
        path.resolve(HERE, '../../../../../docs/candice-visual/ANIMATION-STATE-MAP.md'),
        'utf8',
      );
    } catch {
      return '';
    }
  })();
  const disabledStates = new Set(
    mapText
      .match(/\n\|.*\|/g)
      ?.map((line) => {
        const cells = line.slice(1, -1).split('|').map((c) => c.trim());
        return { state: (cells[1] ?? '').replace(/`/g, ''), rule: cells[4] ?? '' };
      })
      .filter(
        (r) =>
          /^[A-Z][A-Z0-9_]*$/.test(r.state) &&
          (/state is disabled/i.test(r.rule) || /\bdisabled until\b/i.test(r.rule)),
      )
      .map((r) => r.state) ?? [],
  );
  if (anim && animStates) {
    anim = anim.map((a, i) => {
      const stateName = animStates![i];
      return stateName && disabledStates.has(stateName) ? { ...a, disabledState: stateName } : a;
    });
  }

  // Pixel proofs (D2): every decoded capture frame is compared against its
  // cited canonical source. strictDiff proves byte-level origin for
  // same-canvas pairs; SSIM provides the identity bound for different-scale
  // pairs. The mechanical asset checks below are computed from pack bytes
  // and fed into the engine scoring.
  const manifest = loadManifest();
  const pixelProofs: CheckProof[] = [];
  const canonDir = path.join(dir, 'canonical');
  for (const c of captures) {
    const capSha = sha256File(path.join(capDir, c.meta.file));
    const cited = c.meta.expectedAssetIds;
    const entries = cited
      .map((id) => manifest.assets.find((a) => a.id === id))
      .filter((a): a is AssetManifestEntry => a !== undefined);
    for (const e of entries) {
      const srcPng = sourcePathOf(cite(e.id));
      const srcFrame = decodePngFile(srcPng);
      // Opaque-pixel coverage: a capture whose opaque content differs
      // wildly in area from its cited source cannot be that source
      // (catches fully-transparent / black-square captures that would
      // otherwise sail through an alpha-folded SSIM).
      const opaqueCoverage = (f: Frame) => {
        let opaque = 0;
        for (let i = 3; i < f.rgba.length; i += 4) if (f.rgba[i] >= 8) opaque++;
        return opaque / (f.width * f.height);
      };
      const srcCov = opaqueCoverage(srcFrame);
      const capCov = opaqueCoverage(c.frame);
      const coverageRatio = srcCov > 0 ? capCov / srcCov : 0;
      const coverageOk = coverageRatio >= 0.25 && coverageRatio <= 4;
      pixelProofs.push({
        metric: `alphaCoverage(${e.id} vs ${c.meta.file})`,
        value: Number(coverageRatio.toFixed(4)),
        threshold: 0.25,
        pass: coverageOk,
        note: coverageOk
          ? `opaque coverage ratio ${coverageRatio.toFixed(4)} within identity band`
          : `opaque coverage ratio ${coverageRatio.toFixed(4)} outside identity band (source ${(srcCov * 100).toFixed(1)}%, capture ${(capCov * 100).toFixed(1)}%) — capture cannot be this source`,
      });
      if (srcFrame.width === c.frame.width && srcFrame.height === c.frame.height) {
        const d = strictDiff(srcFrame, c.frame);
        pixelProofs.push({
          metric: `strictDiff(${e.id} vs ${c.meta.file})`,
          value: d.mismatchPx,
          threshold: 0,
          pass: d.equal,
          note: d.equal
            ? `${c.meta.file} is byte-identical to canonical ${e.id} (${d.region.w}x${d.region.h} region, 0 differing bytes)`
            : `${c.meta.file} differs from canonical ${e.id}: ${d.mismatchPx}/${d.region.w * d.region.h} px differ (alpha ${d.alphaMismatchPx}, color-only ${d.colorOnlyMismatchPx}, max channel delta ${d.maxChannelDelta})`,
        });
      } else {
        const bound = likenessBound(srcFrame, c.frame, 128);
        pixelProofs.push({
          ...ssimProof(
            bound,
            0.5,
            `ssimBound(${e.id} vs ${c.meta.file})`,
            `cross-scale identity bound; likeness approval stays operator territory`,
          ),
          value: Number(bound.toFixed(4)),
        });
      }
    }
    if (c.meta.captureSha256 !== undefined) {
      pixelProofs.push({
        metric: `capture-sha256(${c.meta.file})`,
        value: c.meta.captureSha256.length,
        threshold: 64,
        pass: c.meta.captureSha256 === capSha,
        note:
          c.meta.captureSha256 === capSha
            ? `capture sha re-derived from pack bytes: ${capSha}`
            : `capture sha mismatch: pack bytes derive ${capSha}, metadata claims ${c.meta.captureSha256}`,
      });
    }
  }

  // Mechanical global checks: computed from the pack bytes, not asserted.
  const packGlobal: OverridesFile = { ...(overrides ?? {}) };
  const allIds = captures.flatMap((c) => c.meta.expectedAssetIds);
  const anySha = captures.map((c) => c.meta.captureSha256).find((s) => s !== undefined);
  let canonicalCheck: CheckProof[];
  try {
    canonicalCheck = checkCaptureNamesCanonical(allIds, anySha, captures.map((c) => c.meta.file).join(', '));
  } catch (err) {
    canonicalCheck = [
      {
        metric: 'capture-names-canonical',
        value: 0,
        threshold: 1,
        pass: false,
        note: `capture cites an id outside the operator manifest: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }
  let derivativeCheck: CheckProof[];
  try {
    derivativeCheck = checkDerivativeNamesParent(manifest.derivedAssets ?? []);
  } catch (err) {
    derivativeCheck = [
      {
        metric: 'derivative-parents',
        value: 0,
        threshold: 1,
        pass: false,
        note: `derivative parent check failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }
  const kieCheck = checkNoPlaceholderOrKie(captures.map((c) => c.meta.file), allIds);
  packGlobal['capture-names-canonical-asset-and-sha'] = {
    pass: canonicalCheck.every((p) => p.pass),
    notes: canonicalCheck.map((p) => p.note),
  };
  packGlobal['derivative-names-immutable-parent'] = {
    pass: derivativeCheck.every((p) => p.pass),
    notes: derivativeCheck.map((p) => p.note),
  };
  packGlobal['no-placeholder-or-kie-in-bundle'] = {
    pass: kieCheck.every((p) => p.pass),
    notes: kieCheck.map((p) => p.note),
  };
  // Remaining global checks without pack-provided evidence: pixel-proof
  // notes where available, otherwise honest UNEVALUATED (engine FAILs).
  for (const check of [
    'identity-tracks-reference',
    'palette-tracks-reference',
    'alpha-preserved-light-and-dark',
    'no-crop-alias-flicker-artifacts',
    'placement-readable-not-obstructing',
    'constrained-mode-preserves-identity',
  ]) {
    if (packGlobal[check]) continue;
    const relevant = pixelProofs.filter(
      (p) => p.metric.includes('ssimBound') || p.metric.includes('alphaCoverage'),
    );
    packGlobal[check] = {
      pass: relevant.length > 0 && relevant.every((p) => p.pass),
      notes:
        relevant.length > 0
          ? relevant.map((p) => p.note)
          : [`no pack evidence for '${check}'; harness pixel proofs recorded ${pixelProofs.length} entries`],
    };
  }

  let decision = null;
  const decPath = path.join(dir, 'decision.json');
  if (fs.existsSync(decPath)) {
    decision = JSON.parse(fs.readFileSync(decPath, 'utf8')) as DecisionJsonFile;
  }

  let gitCommit: string | undefined;
  try {
    gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: HERE }).trim();
  } catch {
    gitCommit = undefined;
  }

  const report = evaluate({
    reviewDir: HERE,
    captures,
    globalOverrides: packGlobal,
    anim,
    animEvidenceKinds,
    operatorDecision: decision,
    gitCommit,
  });
  const jsonOut = writeReport(report, dir);
  const htmlOut = writeReviewerHtml(report, dir);
  process.stdout.write(`report: ${jsonOut}\nreviewer: ${htmlOut}\nverdict: ${report.verdict} (BAR-10) / ${report.animation.verdict} (BAR-10A)\n`);
  return 0;
}

process.exitCode = main();
