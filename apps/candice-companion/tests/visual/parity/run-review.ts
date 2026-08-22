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
import type { CaptureMetadata } from './types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

interface CaptureJsonFile extends CaptureMetadata {
  state: string;
}

interface OverridesFile {
  [check: string]: { pass: boolean; notes: string[] };
}

interface AnimJsonFile {
  items: Array<{ item: string; verdict: 'PASS' | 'FAIL' | 'UNMEASURED'; notes: string[] }>;
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

  const captures: Array<{ meta: CaptureMetadata }> = [];
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
    captures.push({ meta: raw });
    void frame; // decoded only to prove the PNG is real and decodable
  }

  let overrides: OverridesFile | undefined;
  const ovPath = path.join(dir, 'evidence.overrides.json');
  if (fs.existsSync(ovPath)) {
    overrides = JSON.parse(fs.readFileSync(ovPath, 'utf8')) as OverridesFile;
  }

  let anim: Array<{ item: string; verdict: 'PASS' | 'FAIL' | 'UNMEASURED'; notes: string[] }> | undefined;
  const animPath = path.join(dir, 'anim.json');
  if (fs.existsSync(animPath)) {
    anim = (JSON.parse(fs.readFileSync(animPath, 'utf8')) as AnimJsonFile).items;
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
    globalOverrides: overrides,
    anim,
    operatorDecision: decision,
    gitCommit,
  });
  const jsonOut = writeReport(report, dir);
  const htmlOut = writeReviewerHtml(report, dir);
  process.stdout.write(`report: ${jsonOut}\nreviewer: ${htmlOut}\nverdict: ${report.verdict} (BAR-10) / ${report.animation.verdict} (BAR-10A)\n`);
  return 0;
}

process.exitCode = main();
