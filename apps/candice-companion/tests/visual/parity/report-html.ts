/**
 * FIX-020 parity review harness — reviewer HTML emitter.
 *
 * Owned lane: tests/visual/parity/** (this file).
 *
 * Renders a ParityReviewReport into a standalone HTML pack that the operator
 * reviewer opens directly: canonical source on the LEFT, runtime capture on
 * the RIGHT, per-row binary PASS/FAIL chips, global checks, ANIM scoring,
 * and the operator sign-off block. Self-contained (inline CSS only, images
 * referenced as pack-relative paths) — zero external resources.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ParityReviewReport, RowResult, StateResult } from './types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function chip(v: string): string {
  const cls = v === 'PASS' ? 'chip pass' : v === 'FAIL' ? 'chip fail' : 'chip warn';
  return `<span class="${cls}">${esc(v)}</span>`;
}

function rowHtml(r: RowResult): string {
  const proofs = r.proofs
    .map(
      (p) =>
        `<div class="proof ${p.pass ? 'ok' : 'bad'}">${esc(p.metric)}: ${p.pass ? 'OK' : 'NO'} — ${esc(p.note)}</div>`,
    )
    .join('');
  const sign = r.requiresSignOff ? `<div class="signoff-note">${esc(r.requiresSignOff)}</div>` : '';
  return `<tr><td>${esc(r.row)}</td><td>${chip(r.verdict)}</td><td>${proofs}${sign}</td></tr>`;
}

function stateHtml(s: StateResult, packDir: string): string {
  const cap = s.capture;
  const capImg = cap
    ? `<div class="side"><div class="cap-head">RIGHT — runtime capture<br><span class="small">${esc(cap.file)}</span><br><span class="small">build ${esc(cap.build ?? '?')} · commit ${esc(cap.commit ?? '?')} · ${esc(cap.os ?? '?')} ${esc(cap.displayScale ?? '')}</span></div><img src="${esc(path.posix.join('captures', cap.file))}" alt="${esc(cap.file)}"></div>`
    : `<div class="side empty">NO CAPTURE IN PACK</div>`;
  const canonImgs = s.capture
    ? s.capture.expectedAssetIds
        .map((id) => `<div class="canon-entry"><img src="${esc(path.posix.join('canonical', id + '.png'))}" alt="${esc(id)}"><div class="small">${esc(id)}</div></div>`)
        .join('')
    : `<div class="side empty">NO CAPTURE — NO CANONICAL PAIR</div>`;
  const rows = s.rows.map(rowHtml).join('');
  return `<section class="state ${s.verdict.toLowerCase()}">
  <h3>${esc(s.label)} ${chip(s.verdict)}</h3>
  <div class="pair">
    <div class="side"><div class="cap-head">LEFT — operator approved source</div>${canonImgs}</div>
    ${capImg}
  </div>
  <table><thead><tr><th>Row</th><th>Verdict</th><th>Proofs</th></tr></thead><tbody>${rows}</tbody></table>
</section>`;
}

/**
 * Write reviewer.html next to review-report.json in the review dir.
 * The pack must contain `canonical/<id>.png` (operator sources, byte-copied)
 * and `captures/<file>` (runtime captures) for the pairs to resolve.
 */
export function writeReviewerHtml(report: ParityReviewReport, dir: string): string {
  const out = path.join(dir, 'reviewer.html');
  const globals = report.globalChecks
    .map(
      (g) =>
        `<tr><td>${esc(g.check)}</td><td>${chip(g.verdict)}</td><td>${g.proofs
          .map((p) => `<div class="proof ${p.pass ? 'ok' : 'bad'}">${esc(p.note)}</div>`)
          .join('')}</td></tr>`,
    )
    .join('');
  const anim = report.animation.items
    .map(
      (a) =>
        `<tr><td>${esc(a.item)}</td><td>${chip(a.verdict)}</td><td>${a.proofs
          .map((p) => `<div class="proof ${p.pass ? 'ok' : 'bad'}">${esc(p.note)}</div>`)
          .join('')}</td></tr>`,
    )
    .join('');
  const animStateAcct = (report.animation.stateAccounting ?? [])
    .map(
      (p) =>
        `<tr><td>${esc(p.metric)}</td><td>${p.pass ? chip('PASS') : chip('DISABLED')}</td><td><div class="proof ${p.pass ? 'ok' : 'bad'}">${esc(p.note)}</div></td></tr>`,
    )
    .join('');
  const animEvidenceAcct = (report.animation.evidenceAccounting ?? [])
    .map(
      (p) =>
        `<tr><td>${esc(p.metric)}</td><td>${p.pass ? chip('PASS') : chip('FAIL')}</td><td><div class="proof ${p.pass ? 'ok' : 'bad'}">${esc(p.note)}</div></td></tr>`,
    )
    .join('');
  const op = report.operatorDecision;
  const opBlock = op
    ? `<div class="op signed"><h3>Operator decision</h3>
       <p>approved: <b>${op.approved ? 'YES' : 'NO'}</b> · signed by ${esc(op.signedBy)} · dated ${esc(op.dated)}</p>
       <p>reviewed build: ${esc(op.reviewedBuild)}${op.reviewedCommit ? ` · commit ${esc(op.reviewedCommit)}` : ''}${op.osDisplayScale ? ` · ${esc(op.osDisplayScale)}` : ''}</p>
       ${op.note ? `<p>note: ${esc(op.note)}</p>` : ''}</div>`
    : `<div class="op unsigned"><h3>Operator decision — NOT YET SIGNED</h3>
       <p>Rows marked REQUIRE_SIGN_OFF block BAR-10 until the operator signs this packet
       naming the reviewed build/commit and OS display scale.</p></div>`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(report.review)} — ${esc(report.verdict)}</title>
<style>
:root { --bg:#161616; --fg:#e8e8e8; --ok:#2e7d32; --bad:#b71c1c; --warn:#8a6d00; --line:#3a3a3a; }
body { margin:0; font-family:-apple-system, "Segoe UI", sans-serif; background:var(--bg); color:var(--fg); }
header { padding:1rem 2rem; border-bottom:1px solid var(--line); }
h1 { font-size:1.2rem; margin:0 0 .5rem; }
.meta { color:#9a9a9a; font-size:.85rem; }
main { padding:1rem 2rem 4rem; max-width:1200px; margin:0 auto; }
section.state { border:1px solid var(--line); border-radius:8px; margin:1.2rem 0; padding:1rem; }
section.state.pass { border-left:4px solid var(--ok); }
section.state.fail { border-left:4px solid var(--bad); }
.pair { display:grid; grid-template-columns:1fr 1fr; gap:1rem; align-items:start; }
.side img { max-width:100%; max-height:420px; display:block; margin:.4rem 0; background:#222; border-radius:4px; }
.side.empty { padding:2rem; text-align:center; color:#9a9a9a; border:1px dashed var(--line); border-radius:6px; }
.cap-head { font-weight:600; margin-bottom:.3rem; }
.small { color:#9a9a9a; font-size:.75rem; }
.canon-entry { margin-bottom: .6rem; }
table { border-collapse:collapse; width:100%; margin-top:.8rem; }
th, td { border:1px solid var(--line); padding:.4rem .6rem; text-align:left; vertical-align:top; font-size:.85rem; }
th { background:#1e1e1e; }
.chip { display:inline-block; padding:.1rem .5rem; border-radius:10px; font-weight:700; font-size:.75rem; }
.chip.pass { background:var(--ok); color:#fff; }
.chip.fail { background:var(--bad); color:#fff; }
.chip.warn { background:var(--warn); color:#fff; }
.proof { font-size:.75rem; color:#b5b5b5; margin:.1rem 0; }
.proof.ok { color:#8fbf8f; }
.proof.bad { color:#e39a9a; }
.signoff-note { color:var(--warn); font-size:.75rem; margin-top:.3rem; }
.op { margin-top:2rem; padding:1rem; border:1px dashed var(--line); border-radius:8px; }
.op.signed { border-color:var(--ok); }
.op.unsigned { border-color:var(--warn); }
.verdict { font-size:1rem; }
</style>
</head>
<body>
<header>
  <h1>${esc(report.review)} — <span class="verdict">${chip(report.verdict)}</span></h1>
  <div class="meta">generated ${esc(report.generatedAt)} · run ${esc(report.runId)} · commit ${esc(report.gitCommit ?? 'unknown')}</div>
  <div class="meta">${esc(report.animation.review)} — ${chip(report.animation.verdict)}</div>
</header>
<main>
${report.states.map((s) => stateHtml(s, dir)).join('\n')}
<section class="state">
  <h3>Global binary release checks</h3>
  <table><thead><tr><th>Check</th><th>Verdict</th><th>Proofs</th></tr></thead><tbody>${globals}</tbody></table>
</section>
<section class="state">
  <h3>${esc(report.animation.review)} — ANIM scoring ${chip(report.animation.verdict)}</h3>
  <table><thead><tr><th>Item</th><th>Verdict</th><th>Proofs</th></tr></thead><tbody>${anim}</tbody></table>
</section>
<section class="state">
  <h3>Animation required states — honesty markers</h3>
  <table><thead><tr><th>State</th><th>Marker</th><th>Note</th></tr></thead><tbody>${animStateAcct || '<tr><td colspan="3">none</td></tr>'}</tbody></table>
</section>
<section class="state">
  <h3>Animation required evidence — accounting</h3>
  <table><thead><tr><th>Kind</th><th>Verdict</th><th>Note</th></tr></thead><tbody>${animEvidenceAcct || '<tr><td colspan="3">none</td></tr>'}</tbody></table>
</section>
${opBlock}
</main>
</body>
</html>
`;
  fs.writeFileSync(out, html);
  return out;
}
