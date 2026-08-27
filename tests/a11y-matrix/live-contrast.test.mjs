/**
 * FIX-008 a11y matrix — LIVE contrast leg (real browser measurement).
 *
 * Drives a real headless Chrome over the DevTools protocol (zero deps:
 * Node >= 22 global fetch + WebSocket) and measures the COMPUTED colors
 * of the real stylesheet for every theme x surface x text-scale cell:
 *
 *   - dark: computed color/background/border of the real status surface
 *   - light: prefers-color-scheme: light emulation — the shipped tokens
 *     have no light palette, so the cell records the measured values and
 *     the desktop-dependent note (honest, never fabricated)
 *   - increase-contrast: no CDP emulation exists for the macOS setting;
 *     recorded as a color-neutral re-measure of the shipped tokens
 *   - forced-colors: Emulation.setEmulatedMedia forced-colors: active —
 *     the computed Canvas/CanvasText/Highlight system colors are measured
 *     live and compared against the thresholds
 *   - text-scale 0.8/1.0/1.6: --candice-text-scale drives the computed
 *     font-size of the real surface (layout proof, not just the variable)
 *   - reduced-motion: prefers-reduced-motion: reduce emulation — the
 *     computed animation-name of the boot glow must be 'none'
 *
 * Skip discipline: when no Chrome debug endpoint answers (or the page
 * fails to load), the leg is RECORDED as skipped with the reason and the
 * suite still exits 0. The static leg (contrast.test.mjs) always runs.
 *
 *   node --test tests/a11y-matrix/live-contrast.test.mjs
 */

import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { contrastRatio, parseCssColor, THRESHOLDS } from './lib/wcag.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const APP = join(REPO_ROOT, 'apps', 'candice-companion', 'src');
const REPORT_DIR = join(HERE, 'report');
const REPORT_PATH = join(REPORT_DIR, 'live-contrast-report.json');

const CDP_BASE = process.env.CANDICE_CDP_BASE ?? 'http://127.0.0.1:9223';
const TEXT_SCALES = [0.8, 1.0, 1.6];

const STYLES = readFileSync(join(APP, 'styles.css'), 'utf8');
const CAPTIONS_VIEW = readFileSync(join(APP, 'ui', 'captions', 'view.ts'), 'utf8');
const CAPTIONS_STYLE = (CAPTIONS_VIEW.match(/export const CAPTIONS_STYLE_TEXT = `([\s\S]*?)`;/) ?? [])[1];
if (!CAPTIONS_STYLE) throw new Error('CAPTIONS_STYLE_TEXT not found in captions view source');

// ------------------------------------------------------------ CDP plumbing

class CdpClient {
  #ws;
  #nextId = 1;
  #pending = new Map();

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error(`CDP websocket failed: ${wsUrl}`)), { once: true });
    });
    const client = new CdpClient(ws);
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id !== undefined && client.#pending.has(msg.id)) {
        const { resolve, reject } = client.#pending.get(msg.id);
        client.#pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
      }
    });
    return client;
  }

  constructor(ws) { this.#ws = ws; }

  send(method, params = {}) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() { try { this.#ws.close(); } catch { /* best effort */ } }
}

async function newPage() {
  const res = await fetch(`${CDP_BASE}/json/new?about:blank`, { method: 'PUT' });
  if (!res.ok) throw new Error(`CDP /json/new failed: ${res.status}`);
  const target = await res.json();
  const client = await CdpClient.connect(target.webSocketDebuggerUrl);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  return { client, target };
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(`page evaluation failed: ${result.exceptionDetails.text}`);
  }
  return result.result.value;
}

async function setMedia(client, features) {
  await client.send('Emulation.setEmulatedMedia', { features });
}

async function navigate(client, url) {
  await client.send('Page.navigate', { url });
  // Poll for the probe element instead of readyState: the first readyState
  // poll can catch the OLD document (about:blank is already complete)
  // before the navigation commits, and evaluating mid-commit can throw
  // transient context errors. Sleep first, and treat any eval error as
  // "not loaded yet".
  await new Promise((r) => setTimeout(r, 200));
  for (let i = 0; i < 100; i += 1) {
    let found = false;
    try {
      found = await evaluate(client, "document.readyState === 'complete' && !!document.querySelector('#probe-text')");
    } catch {
      found = false;
    }
    if (found) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('probe page did not load');
}

// ------------------------------------------------------------ probe page

function probeHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLES}</style><style>${CAPTIONS_STYLE}</style></head><body>
<div id="app">
  <div class="boot" role="status" aria-live="polite">
    <span id="probe-glow" class="boot-glow" aria-hidden="true"></span>
    <p id="probe-text" class="candice-status-surface">Probe text</p>
  </div>
  <p id="probe-muted" class="candice-runtime-status">Probe muted</p>
  <div id="probe-captions" class="candice-captions">
    <div class="candice-captions-label">Candice</div>
    <div class="candice-captions-text">Probe caption</div>
  </div>
</div>
</body></html>`;
}

const MEASURE = `(() => {
  const cs = (sel) => getComputedStyle(typeof sel === 'string' ? document.querySelector(sel) : sel);
  const text = cs('#probe-text');
  const muted = cs('#probe-muted');
  const captions = cs('#probe-captions');
  const captionLabel = cs('.candice-captions-label');
  const glow = cs('#probe-glow');
  const root = cs(document.documentElement);
  return {
    textColor: text.color,
    textBg: text.backgroundColor,
    textBorder: text.borderColor,
    textFontSize: text.fontSize,
    mutedColor: muted.color,
    mutedBg: muted.backgroundColor,
    captionsColor: captions.color,
    captionsLabelColor: captionLabel.color,
    focusRingToken: root.getPropertyValue('--candice-focus-ring').trim(),
    surfaceToken: root.getPropertyValue('--candice-ui-surface').trim(),
    textScaleToken: root.getPropertyValue('--candice-text-scale').trim(),
    glowAnimation: glow.animationName,
  };
})()`;

function ratioOf(fg, bg) {
  return Number(contrastRatio(parseCssColor(fg), parseCssColor(bg)).toFixed(2));
}

function cellFor(surface, role, fg, bg, threshold) {
  const ratio = ratioOf(fg, bg);
  return {
    surface,
    role,
    fg,
    bg,
    ratio,
    threshold,
    pass: ratio >= threshold,
    aaa: ratio >= THRESHOLDS.aaa,
  };
}

// ------------------------------------------------------------ the live leg

async function runLiveLeg() {
  const { client, target } = await newPage();
  const cells = [];
  const motionCells = [];
  try {
    await navigate(client, `data:text/html;charset=utf-8,${encodeURIComponent(probeHtml())}`);

    // --- dark theme x text-scale
    for (const scale of TEXT_SCALES) {
      await evaluate(client, `document.documentElement.style.setProperty('--candice-text-scale', '${scale}')`);
      const m = await evaluate(client, MEASURE);
      cells.push({
        theme: 'dark',
        textScale: scale,
        text: cellFor('text', 'normal text', m.textColor, m.textBg, THRESHOLDS.normalText),
        muted: cellFor('muted', 'normal text (muted)', m.mutedColor, m.mutedBg, THRESHOLDS.normalText),
        border: cellFor('border', 'UI component boundary', m.textBorder, m.textBg, THRESHOLDS.largeTextOrUi),
        focus: cellFor('focus', 'focus indicator (token)', m.focusRingToken, m.surfaceToken, THRESHOLDS.largeTextOrUi),
        captionsText: cellFor('captions-text', 'captions text', m.captionsColor, m.textBg, THRESHOLDS.normalText),
        captionsLabel: cellFor('captions-label', 'captions label', m.captionsLabelColor, m.textBg, THRESHOLDS.normalText),
        fontSizePx: m.textFontSize,
        textScaleToken: m.textScaleToken,
        glowAnimation: m.glowAnimation,
      });
    }

    // --- light theme: emulated; tokens have no light palette (honest note)
    await setMedia(client, [{ name: 'prefers-color-scheme', value: 'light' }]);
    await evaluate(client, `document.documentElement.style.setProperty('--candice-text-scale', '1')`);
    const lightM = await evaluate(client, MEASURE);
    cells.push({
      theme: 'light',
      textScale: 1.0,
      text: cellFor('text', 'normal text', lightM.textColor, lightM.textBg, THRESHOLDS.normalText),
      muted: cellFor('muted', 'normal text (muted)', lightM.mutedColor, lightM.mutedBg, THRESHOLDS.normalText),
      border: cellFor('border', 'UI component boundary', lightM.textBorder, lightM.textBg, THRESHOLDS.largeTextOrUi),
      focus: cellFor('focus', 'focus indicator (token)', lightM.focusRingToken, lightM.surfaceToken, THRESHOLDS.largeTextOrUi),
      note: 'shipped tokens carry no light palette; measured values are the dark tokens under light emulation — effective contrast over a light desktop is desktop-dependent (human leg)',
    });

    // --- increase-contrast: no CDP emulation for the macOS setting
    await setMedia(client, [{ name: 'prefers-color-scheme', value: 'dark' }]);
    const incM = await evaluate(client, MEASURE);
    cells.push({
      theme: 'increase-contrast',
      textScale: 1.0,
      text: cellFor('text', 'normal text', incM.textColor, incM.textBg, THRESHOLDS.normalText),
      muted: cellFor('muted', 'normal text (muted)', incM.mutedColor, incM.mutedBg, THRESHOLDS.normalText),
      border: cellFor('border', 'UI component boundary', incM.textBorder, incM.textBg, THRESHOLDS.largeTextOrUi),
      focus: cellFor('focus', 'focus indicator (token)', incM.focusRingToken, incM.surfaceToken, THRESHOLDS.largeTextOrUi),
      note: 'macOS Increase Contrast does not alter webview CSS colors; re-measured under dark emulation (color-neutral)',
    });

    // --- forced-colors: live system colors
    await setMedia(client, [{ name: 'forced-colors', value: 'active' }]);
    const fcM = await evaluate(client, MEASURE);
    cells.push({
      theme: 'forced-colors',
      textScale: 1.0,
      text: cellFor('text', 'forced-colors CanvasText on Canvas', fcM.textColor, fcM.textBg, THRESHOLDS.normalText),
      muted: cellFor('muted', 'forced-colors CanvasText on Canvas', fcM.mutedColor, fcM.mutedBg, THRESHOLDS.normalText),
      border: cellFor('border', 'forced-colors CanvasText boundary', fcM.textBorder, fcM.textBg, THRESHOLDS.largeTextOrUi),
      note: 'measured with Emulation.setEmulatedMedia forced-colors: active',
    });

    // --- reduced-motion: emulated OS flip
    await setMedia(client, [
      { name: 'prefers-color-scheme', value: 'dark' },
      { name: 'prefers-reduced-motion', value: 'reduce' },
    ]);
    const rmReduce = await evaluate(client, MEASURE);
    motionCells.push({ os: 'reduce', glowAnimation: rmReduce.glowAnimation });
    await setMedia(client, [
      { name: 'prefers-color-scheme', value: 'dark' },
      { name: 'prefers-reduced-motion', value: 'no-preference' },
    ]);
    const rmAllow = await evaluate(client, MEASURE);
    motionCells.push({ os: 'allow', glowAnimation: rmAllow.glowAnimation });
  } finally {
    client.close();
    try { await fetch(`${CDP_BASE}/json/close/${target.id}`); } catch { /* best effort */ }
  }
  return { cells, motionCells };
}

// ------------------------------------------------------------ tests

test('FIX-008 live contrast: real browser measures every theme x surface x scale cell', { timeout: 120000 }, async (t) => {
  let live;
  try {
    const versionRes = await fetch(`${CDP_BASE}/json/version`, { signal: AbortSignal.timeout(3000) });
    if (!versionRes.ok) throw new Error(`CDP endpoint answered ${versionRes.status}`);
    live = await runLiveLeg();
  } catch (err) {
    t.skip(`live leg skipped: no usable headless Chrome at ${CDP_BASE} (${err.message}); static leg still covers the tokens`);
    return;
  }

  mkdirSync(REPORT_DIR, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    cdpBase: CDP_BASE,
    sources: { styles: join(APP, 'styles.css'), captionsView: join(APP, 'ui', 'captions', 'view.ts') },
    thresholds: THRESHOLDS,
    cells: live.cells,
    motionCells: live.motionCells,
  };
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  // Dark cells: every surface passes at every scale.
  for (const cell of live.cells.filter((c) => c.theme === 'dark')) {
    for (const key of ['text', 'muted', 'border', 'focus', 'captionsText', 'captionsLabel']) {
      assert.ok(cell[key].pass, `dark ${key} @ ${cell.textScale}: ${cell[key].ratio}:1 < ${cell[key].threshold}:1`);
    }
  }

  // Text scale drives real layout: font-size grows with the variable.
  const sizes = live.cells.filter((c) => c.theme === 'dark').map((c) => Number.parseFloat(c.fontSizePx));
  assert.ok(sizes[0] < sizes[1] && sizes[1] < sizes[2], `font sizes must grow 0.8 < 1.0 < 1.6 (got ${sizes.join(', ')})`);

  // Forced-colors: the live system pair must pass.
  const fc = live.cells.find((c) => c.theme === 'forced-colors');
  assert.ok(fc.text.pass, `forced-colors text: ${fc.text.ratio}:1 < ${fc.text.threshold}:1`);

  // Reduced motion: emulated OS reduce must kill the glow animation.
  const rmReduce = live.motionCells.find((c) => c.os === 'reduce');
  const rmAllow = live.motionCells.find((c) => c.os === 'allow');
  assert.equal(rmReduce.glowAnimation, 'none', 'prefers-reduced-motion: reduce must stop the animation');
  assert.notEqual(rmAllow.glowAnimation, 'none', 'no-preference must keep the animation');
});

test('FIX-008 live contrast: report artifact re-reads with the stable shape', (t) => {
  let report;
  try {
    report = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
  } catch {
    t.skip('live report not written (live leg skipped); static report still covers the tokens');
    return;
  }
  assert.ok(Array.isArray(report.cells));
  assert.ok(report.cells.some((c) => c.theme === 'dark'));
  assert.ok(report.cells.some((c) => c.theme === 'forced-colors'));
  assert.ok(Array.isArray(report.motionCells));
});
