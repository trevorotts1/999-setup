/**
 * WS-15 report dump — prints the measured transparency table for the
 * checked-in Candice pack (light #F2F2F2 and dark #161616 backdrops).
 *
 * This is the spec-19 "Add measurements to the test report" record for the
 * vis-EDGE side of the pack (per-asset alpha/fringe metrics). Runtime CPU
 * / RSS measurements belong to the WS-24/WS-30 instrumentation lanes,
 * not this harness — this harness measures the ASSET, not the process.
 *
 *   node --experimental-strip-types tests/visual/report.ts   (Node 22)
 *   node tests/visual/report.ts                              (Node 23+)
 */

import { decodePngFile } from './png.ts';
import { verdict, alphaStats, viewOf } from './gates.ts';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(HERE, '..', '..', 'assets', 'candice', 'source');

const pct = (v: number): string => `${(v * 100).toFixed(2)}%`;

const files = fs.readdirSync(SOURCE).filter((f) => f.endsWith('.png')).sort();

console.log('WS-15 transparency measurement — Candice final-art pack');
console.log(`backdrops: light #F2F2F2  dark #161616`);
console.log(
  'file'.padEnd(30),
  'WxH'.padEnd(10),
  'alpha'.padEnd(12),
  'washL'.padEnd(8),
  'washD'.padEnd(8),
  'borderT'.padEnd(7),
  'borderB'.padEnd(7),
  'borderL'.padEnd(7),
  'borderR'.padEnd(7),
  'hardEdg'.padEnd(8),
  'fringeA'.padEnd(8),
  'fringeDL'.padEnd(8),
  'fringeDD'.padEnd(8),
  'pass',
);

let allPass = true;
for (const f of files) {
  const frame = decodePngFile(path.join(SOURCE, f));
  const v = verdict(f, frame);
  const stats = alphaStats(viewOf(frame));
  const m = v.lightResult.measurement;
  const md = v.darkResult.measurement;
  if (!v.pass) allPass = false;
  console.log(
    f.padEnd(30),
    `${v.width}x${v.height}`.padEnd(10),
    `${stats.min}-${stats.max}(${stats.mean.toFixed(0)})`.padEnd(12),
    pct(m.washShare).padEnd(8),
    pct(md.washShare).padEnd(8),
    pct(m.edges.top).padEnd(7),
    pct(m.edges.bottom).padEnd(7),
    pct(m.edges.left).padEnd(7),
    pct(m.edges.right).padEnd(7),
    pct(m.hardCutShare).padEnd(8),
    m.fringeMeanAlpha.toFixed(0).padEnd(8),
    m.fringeLumaDelta.toFixed(0).padEnd(8),
    md.fringeLumaDelta.toFixed(0).padEnd(8),
    v.pass ? 'PASS' : 'FAIL',
  );
}
console.log(allPass ? '\nALL PASS (E.1 WS-15 binary verdict per asset)' : '\nFAILURES PRESENT');
