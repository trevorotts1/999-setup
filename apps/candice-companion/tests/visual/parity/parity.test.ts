/**
 * FIX-020 parity review harness — self-tests.
 *
 * Owned lane: tests/visual/parity/** (this file).
 *
 * Negative-result contract: a review harness that cannot fail proves
 * nothing. These tests prove the harness discriminates:
 *   - a complete pack with signed operator decision evaluates BAR-10 PASS
 *     only when every state is captured and the signature names a build;
 *   - a pack missing any one required state capture evaluates FAIL;
 *   - a capture citing an id outside the state's approved canonical set
 *     evaluates FAIL;
 *   - prohibited "same vibe"-class wording anywhere in the sign-off keeps
 *     BAR-10 FAIL;
 *   - the diff engine is alpha-exact (one changed byte fails a region);
 *   - the SSIM path detects an identity swap (different image) and scores
 *     a same image at 1.0;
 *   - manifest authority: contract string, SHA re-derivation, unknown id
 *     rejection, non-RGBA rejection.
 *
 * Runner: plain Node (type stripping):
 *
 *   cd apps/candice-companion
 *   node --test tests/visual/parity/parity.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { decodePngFile, encodeRgba } from '../png.ts';
import {
  alphaBBox,
  composeOver,
  likenessBound,
  scaleTo,
  ssim,
  strictDiff,
} from './diff.ts';
import {
  evaluate,
  containsProhibitedPhrase,
  loadReviewManifest,
  SIGN_OFF_ROWS,
  type EngineInput,
} from './engine.ts';
import {
  cite,
  loadManifest,
  proveManifestShas,
  sha256Bytes,
} from './asset.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(HERE, '../../../assets/candice');
const SOURCE_DIR = path.join(ASSETS, 'source', 'operator-approved');

function captureMeta(state: string, assetId: string): EngineInput['captures'][number] {
  return {
    meta: {
      file: `state-${state}.png`,
      source: 'pack',
      expectedAssetIds: [assetId],
      build: 'Candice Companion 0.2.0',
      commit: '0'.repeat(40),
      os: 'darwin arm64',
      displayScale: '1x',
      capturedAt: new Date().toISOString(),
    },
  };
}

const ALL_STATES = [
  'idle-neutral',
  'greeting',
  'listening',
  'speaking',
  'thinking-processing',
  'compact-idle',
  'expressive-gesture',
];

const DEFAULT_ASSET: Record<string, string> = {
  'idle-neutral': '01-fullbody-idle',
  greeting: '02-gesture-welcome',
  listening: '10-presenting-portrait-a',
  speaking: '03-mouth-neutral-closed',
  'thinking-processing': '12-presenting-fullbody-a',
  'compact-idle': '03-mouth-neutral-closed',
  'expressive-gesture': '07-mouth-smile-closed',
};

function fullCaptures(): EngineInput['captures'] {
  return ALL_STATES.map((s) => captureMeta(s, DEFAULT_ASSET[s]));
}

function signedDecision(): NonNullable<EngineInput['operatorDecision']> {
  return {
    approved: true,
    signedBy: 'operator',
    dated: '2026-08-22',
    reviewedBuild: 'Candice Companion 0.2.0',
    reviewedCommit: '0'.repeat(40),
    osDisplayScale: 'darwin 1x',
  };
}

function animAllPass(): NonNullable<EngineInput['anim']> {
  return ['ANIM-01', 'ANIM-02', 'ANIM-03', 'ANIM-04', 'ANIM-05', 'ANIM-06', 'ANIM-07'].map(
    (item) => ({ item, verdict: 'PASS' as const, notes: ['measured'] }),
  );
}

function globalAllPass(): NonNullable<EngineInput['globalOverrides']> {
  const out: Record<string, { pass: boolean; notes: string[] }> = {};
  for (const c of loadReviewManifest(HERE).globalChecks) {
    out[c] = { pass: true, notes: ['pack-provided evidence'] };
  }
  return out;
}

test('review manifest loads and lists exactly the seven required states', () => {
  const m = loadReviewManifest(HERE);
  assert.equal(m.bar, 'BAR-10');
  assert.equal(m.schema, 'candice/parity-review@1');
  assert.deepEqual(m.requiredStates, [
    'idle-neutral',
    'greeting',
    'listening',
    'speaking',
    'thinking-processing',
    'compact-idle',
    'expressive-gesture',
  ]);
  assert.deepEqual(m.animation.items, [
    'ANIM-01', 'ANIM-02', 'ANIM-03', 'ANIM-04', 'ANIM-05', 'ANIM-06', 'ANIM-07',
  ]);
});

test('complete pack + signed decision + all ANIM pass => BAR-10 PASS and BAR-10A PASS', () => {
  const report = evaluate({
    reviewDir: HERE,
    captures: fullCaptures(),
    globalOverrides: globalAllPass(),
    anim: animAllPass(),
    operatorDecision: signedDecision(),
  });
  assert.equal(report.verdict, 'PASS');
  assert.equal(report.animation.verdict, 'PASS');
  assert.ok(report.states.every((s) => s.verdict === 'PASS'));
});

test('missing one required state capture => BAR-10 FAIL', () => {
  const report = evaluate({
    reviewDir: HERE,
    captures: fullCaptures().filter((c) => c.meta.file !== 'state-greeting.png'),
    globalOverrides: globalAllPass(),
    anim: animAllPass(),
    operatorDecision: signedDecision(),
  });
  assert.equal(report.verdict, 'FAIL');
  const greeting = report.states.find((s) => s.state === 'greeting');
  assert.ok(greeting);
  assert.equal(greeting.verdict, 'FAIL');
});

test('capture citing an id outside the approved canonical set => FAIL', () => {
  const captures = fullCaptures().map((c) =>
    c.meta.file === 'state-idle-neutral.png'
      ? { ...c, meta: { ...c.meta, expectedAssetIds: ['02-gesture-welcome'] } }
      : c,
  );
  const report = evaluate({
    reviewDir: HERE,
    captures,
    globalOverrides: globalAllPass(),
    anim: animAllPass(),
    operatorDecision: signedDecision(),
  });
  assert.equal(report.verdict, 'FAIL');
});

test('unsigned pack (REQUIRE_SIGN_OFF rows outstanding) => BAR-10 FAIL', () => {
  const report = evaluate({
    reviewDir: HERE,
    captures: fullCaptures(),
    globalOverrides: globalAllPass(),
    anim: animAllPass(),
    operatorDecision: null,
  });
  assert.equal(report.verdict, 'FAIL');
  assert.ok(report.states.some((s) => s.rows.some((r) => r.verdict === 'REQUIRE_SIGN_OFF')));
});

test('prohibited wording in operator note keeps BAR-10 FAIL', () => {
  for (const phrase of ['same vibe', 'looks good enough', 'same concept', 'roughly similar', 'probably used the images']) {
    assert.ok(containsProhibitedPhrase(`this is ${phrase} territory`) !== null, phrase);
    const d = signedDecision();
    d.note = `I reviewed it: ${phrase}`;
    const report = evaluate({
      reviewDir: HERE,
      captures: fullCaptures(),
      globalOverrides: globalAllPass(),
      anim: animAllPass(),
      operatorDecision: d,
    });
    assert.equal(report.verdict, 'FAIL', `phrase '${phrase}' must not pass`);
  }
});

test('ANIM-06 UNMEASURED => BAR-10A FAIL (every item must pass)', () => {
  const anim = animAllPass().map((a) => (a.item === 'ANIM-06' ? { ...a, verdict: 'UNMEASURED' as const } : a));
  const report = evaluate({
    reviewDir: HERE,
    captures: fullCaptures(),
    globalOverrides: globalAllPass(),
    anim,
    operatorDecision: signedDecision(),
  });
  assert.equal(report.animation.verdict, 'FAIL');
  assert.equal(report.verdict, 'PASS'); // BAR-10 independent of BAR-10A in the report
});

test('asset manifest authority: contract, RGBA, SHA re-derivation, unknown id', () => {
  const m = loadManifest();
  assert.equal(m.contract, 'candice-operator-originals-v1');
  assert.equal(m.canonicalAuthority, 'operator-originals');
  for (const a of m.assets) assert.equal(a.colorType, 'RGBA');

  const { canonicalShas, proofs } = proveManifestShas(['01-fullbody-idle', '03-mouth-neutral-closed']);
  assert.equal(canonicalShas['01-fullbody-idle'], 'a32ed302820b7183ae26ac38693653175601a9304795ab39d01cdaa8251c9b02');
  assert.ok(proofs.every((p) => p.pass), 'manifest SHAs must re-derive from source bytes');

  assert.throws(() => cite('99-not-an-asset'), /not in the operator manifest/);
  assert.equal(cite('01-fullbody-idle').role, 'body/idle-standing');
});

test('strict diff: identical frames pass; one changed byte fails', () => {
  const a = { width: 2, height: 2, rgba: new Uint8Array([10, 20, 30, 255, 40, 50, 60, 128, 70, 80, 90, 0, 100, 110, 120, 255]) };
  const b = { width: 2, height: 2, rgba: new Uint8Array(a.rgba) };
  assert.equal(strictDiff(a, b).equal, true);
  b.rgba[5] = 51; // one byte differs
  const d = strictDiff(a, b);
  assert.equal(d.equal, false);
  assert.equal(d.mismatchPx, 1);
});

test('strict diff: alpha-exact regions detect alpha-only corruption', () => {
  const a = { width: 4, height: 4, rgba: new Uint8Array(64) };
  a.rgba.fill(0);
  for (let i = 0; i < 64; i += 4) a.rgba[i + 3] = 255;
  const b = { width: 4, height: 4, rgba: new Uint8Array(a.rgba) };
  b.rgba[3] = 254; // alpha corruption only, color untouched
  const d = strictDiff(a, b);
  assert.equal(d.equal, false);
  assert.equal(d.alphaMismatchPx, 1);
  assert.equal(d.colorOnlyMismatchPx, 0);
});

test('SSIM: same image scores 1.0; different image scores below identity bound', () => {
  const idle = decodePngFile(path.join(SOURCE_DIR, '01-fullbody-idle.png'));
  const welcome = decodePngFile(path.join(SOURCE_DIR, '02-gesture-welcome.png'));

  // Same image, both scaled to a common canvas: structural identity.
  const s1 = scaleTo(idle, 96, 171);
  const s2 = scaleTo(idle, 96, 171);
  assert.ok(ssim(s1, s2) > 0.999, 'identical frames must score ~1.0');

  // Different canonical pose: a detectable divergence, but both are Candice —
  // this is exactly the band where the harness must NOT auto-approve.
  const bound = likenessBound(idle, welcome, 96);
  assert.ok(bound < 0.99, `cross-pose likeness must differ measurably, got ${bound}`);
  assert.ok(bound > 0, 'cross-pose likeness must stay finite');
});

test('composeOver: alpha-over math is exact on a known pixel', () => {
  const base = { width: 1, height: 1, rgba: new Uint8Array([100, 100, 100, 255]) };
  const over = { width: 1, height: 1, rgba: new Uint8Array([200, 0, 0, 128]) };
  composeOver(base, over, 0, 0);
  assert.equal(base.rgba[0], Math.round((200 * 128 + 100 * 127) / 255));
  assert.equal(base.rgba[1], Math.round((0 * 128 + 100 * 127) / 255));
  assert.equal(base.rgba[3], 255);
});

test('alphaBBox finds the opaque bounding box and returns null on empty alpha', () => {
  const f = { width: 4, height: 4, rgba: new Uint8Array(64) };
  f.rgba[(1 * 4 + 1) * 4 + 3] = 255;
  f.rgba[(2 * 4 + 2) * 4 + 3] = 255;
  const box = alphaBBox(f);
  assert.ok(box);
  assert.deepEqual(box, { x: 1, y: 1, w: 2, h: 2 });
  const empty = alphaBBox({ width: 2, height: 2, rgba: new Uint8Array(16) });
  assert.equal(empty, null);
});

test('encode/decode round-trip keeps strictDiff at zero (fixture integrity)', async () => {
  const idle = decodePngFile(path.join(SOURCE_DIR, '01-fullbody-idle.png'));
  const buf = encodeRgba(idle);
  const { decodeRgba } = await import('../png.ts');
  const round = decodeRgba(new Uint8Array(buf));
  assert.equal(strictDiff(idle, round).equal, true);
});

test('sign-off row registry covers overall-likeness and identity', () => {
  assert.ok(SIGN_OFF_ROWS.has('overall-likeness'));
  assert.ok(SIGN_OFF_ROWS.has('identity'));
  assert.ok(SIGN_OFF_ROWS.has('selected-source-approved'));
});

test('sha256Bytes matches manifest for the idle source', () => {
  const bytes = fs.readFileSync(path.join(SOURCE_DIR, '01-fullbody-idle.png'));
  assert.equal(sha256Bytes(new Uint8Array(bytes)), 'a32ed302820b7183ae26ac38693653175601a9304795ab39d01cdaa8251c9b02');
});

test('CLI runner: synthetic pack emits review-report.json + reviewer.html, verdict FAIL unsigned', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-pack-'));
  const capDir = path.join(tmp, 'captures');
  fs.mkdirSync(capDir);
  // One capture only (pack is deliberately incomplete).
  const tiny = { width: 1, height: 1, rgba: new Uint8Array([10, 20, 30, 255]) };
  fs.writeFileSync(path.join(capDir, 'state-idle-neutral.png'), encodeRgba(tiny));
  fs.writeFileSync(
    path.join(capDir, 'state-idle-neutral.capture.json'),
    JSON.stringify({
      file: 'state-idle-neutral.png',
      source: 'pack',
      expectedAssetIds: ['01-fullbody-idle'],
      build: 'test-build',
      commit: '0'.repeat(40),
      os: 'darwin',
      displayScale: '1x',
      capturedAt: new Date().toISOString(),
    }),
  );
  const run = spawnSync(
    process.execPath,
    [path.join(HERE, 'run-review.ts'), tmp],
    { encoding: 'utf8' },
  );
  assert.equal(run.status, 0, `runner failed: ${run.stderr}`);
  assert.ok(fs.existsSync(path.join(tmp, 'review-report.json')), 'review-report.json missing');
  assert.ok(fs.existsSync(path.join(tmp, 'reviewer.html')), 'reviewer.html missing');
  const report = JSON.parse(fs.readFileSync(path.join(tmp, 'review-report.json'), 'utf8'));
  assert.equal(report.verdict, 'FAIL'); // unsigned + incomplete pack cannot pass
  assert.equal(report.animation.verdict, 'FAIL'); // no ANIM measurements
  fs.rmSync(tmp, { recursive: true, force: true });
});
