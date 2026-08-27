/**
 * ONE COLUMN — the layout contract, enforced.
 *
 * The operator's report on the running app was: "the boxes are all weirdly
 * shaped, mismatched, some boxes bigger than others. This doesn't look
 * smooth. It looks like three separate systems."
 *
 * It was not a perception problem. Six stylesheets drew the six surfaces —
 * styles.css plus one per UI module — and each picked its own numbers with
 * nothing shared between them:
 *
 *   width       five separate `width: fit-content` declarations, so every
 *               box was exactly as wide as the words inside it
 *   max-width   420px in styles.css and captions and answer-controls,
 *               404px in settings-toggle and power
 *   radius      3, 4, 6, 8, 10, 14 and 16px, all in use at once
 *   margin      0 here, 6px there, 12px above the off switch
 *
 * The fix was tokens in styles.css (--candice-col, --candice-panel-radius,
 * --candice-panel-pad, --candice-stack-gap) that every surface consumes.
 * Tokens alone do not hold: the next person to add a panel will reach for a
 * literal, exactly as five modules already had, and the column goes ragged
 * again one commit at a time. This file is what makes the contract survive
 * that. It is deliberately a source test — the values are static text in
 * template literals and a real layout is not needed to read them.
 *
 * NOT covered here: whether the tokens are the RIGHT values. That is a
 * design judgement and this file has no opinion on it. It only requires
 * that every panel uses the same one.
 *
 * @module
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dirname, '..', '..');

/**
 * Source with comments removed.
 *
 * These stylesheets document their own history, and that prose quotes the
 * very values this file forbids -- the #app rule explains why it must NOT
 * say `align-items: center`, and the power row records the margin it used to
 * carry. Reading comments as declarations made the first draft of this test
 * fail against correct CSS. Stripping them also makes the checks stricter:
 * a token named only in a comment no longer counts as being used.
 */
function read(rel: string): string {
  return readFileSync(join(SRC, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * The declaration block introduced by `header`, up to its closing brace.
 * These stylesheets have no nested at-rules inside a rule, so the first
 * `}` after the header terminates the block.
 *
 * The search for that brace starts AFTER the header, because several
 * selectors are template interpolations -- `.${POWER_OFF_CLASS} {` carries a
 * closing brace of its own, and a naive scan returned a two-line block that
 * silently passed nothing.
 */
function block(src: string, header: string): string {
  const start = src.indexOf(header);
  assert.notEqual(start, -1, `selector not found: ${header}`);
  const end = src.indexOf('}', start + header.length);
  assert.notEqual(end, -1, `unterminated block: ${header}`);
  return src.slice(start, end);
}

/** Every surface that paints a card the user reads text on. */
const PANELS: Array<{ what: string; file: string; header: string }> = [
  { what: 'status / fallback / runtime-status', file: 'styles.css', header: '.candice-status-surface,' },
  { what: 'state caption', file: 'styles.css', header: '.candice-state-caption {' },
  { what: 'captions (the question)', file: 'ui/captions/view.ts', header: '.candice-captions {' },
  { what: 'answer card', file: 'ui/answer-controls/view.ts', header: '.candice-answer-controls {' },
  { what: 'settings panel', file: 'ui/settings-toggle/controller.ts', header: '.${SETTINGS_PANEL_CLASS} {' },
];

/** Rows that live INSIDE a panel: they fill it and never paint their own. */
const ROWS: Array<{ what: string; file: string; header: string }> = [
  { what: 'settings row', file: 'ui/settings-toggle/controller.ts', header: '.${SETTINGS_TOGGLE_CLASS} {' },
  { what: 'power off row', file: 'ui/power/controller.ts', header: '.${POWER_OFF_CLASS} {' },
];

describe('layout contract: one column', () => {
  for (const panel of PANELS) {
    it(`${panel.what} takes its width from --candice-col`, () => {
      const css = block(read(panel.file), panel.header);
      assert.match(
        css, /width: var\(--candice-col\)/,
        `${panel.what} must use the shared column token, not a width of its own`,
      );
      assert.ok(
        !/width: fit-content/.test(css),
        `${panel.what} must not shrink-wrap: that is what made every box a different width`,
      );
      assert.ok(
        !/max-width: (min\(92vw|\d+px)/.test(css),
        `${panel.what} must not pin its own max-width — 420px and 404px disagreeing is the original defect`,
      );
    });

    it(`${panel.what} takes its radius and padding from the shared tokens`, () => {
      const css = block(read(panel.file), panel.header);
      assert.match(
        css, /border-radius: var\(--candice-panel-radius/,
        `${panel.what} must use the shared panel radius`,
      );
      assert.match(
        css, /padding: var\(--candice-panel-pad/,
        `${panel.what} must use the shared panel padding`,
      );
    });
  }

  for (const row of ROWS) {
    it(`${row.what} fills its panel instead of sizing itself`, () => {
      const css = block(read(row.file), row.header);
      assert.match(css, /width: 100%/, `${row.what} must fill the panel column`);
      assert.ok(
        !/width: fit-content/.test(css),
        `${row.what} must not shrink-wrap inside the panel`,
      );
      assert.ok(
        !/max-width: min\(92vw/.test(css),
        `${row.what} must not carry a column width of its own — the panel owns it`,
      );
      // A row that paints is a card, and three cards in a row is the exact
      // look this contract exists to end. The panel paints once for the group.
      assert.match(
        css, /background: transparent/,
        `${row.what} must not paint its own surface`,
      );
    });
  }

  it('the tokens the whole contract rests on are actually declared', () => {
    const root = block(read('styles.css'), ':root {');
    for (const token of [
      '--candice-col:',
      '--candice-panel-radius:',
      '--candice-panel-pad:',
      '--candice-control-radius:',
      '--candice-pill-radius:',
      '--candice-stack-gap:',
    ]) {
      assert.ok(root.includes(token), `${token} must be declared in :root`);
    }
    // The column is a min() so a narrower or scaled window shrinks it rather
    // than clipping it — body{overflow:hidden} does not scroll sideways.
    assert.match(root, /--candice-col: min\(/, 'the column must shrink with the window');
  });

  it('the stack owns the vertical rhythm, not the surfaces', () => {
    const app = block(read('styles.css'), '#app {');
    assert.match(app, /gap: var\(--candice-stack-gap\)/, '#app must supply one gap for the whole stack');
    // Centring #app would collapse the gesture stage: its layers are
    // position:absolute; inset:0, so a shrink-to-fit column is zero-wide and
    // Candice disappears. The panels centre on their own auto margins.
    assert.ok(
      !/align-items: center/.test(app),
      '#app must not centre its items — that collapses the gesture stage to zero width',
    );
  });

  it('CONTROL: every check above can actually say no', () => {
    // Same instrument, same helpers, against text that is known to violate
    // each rule. If these pass, the assertions above are vacuous and prove
    // nothing about the real stylesheets.
    const bad = '.candice-fake {\n  width: fit-content;\n  max-width: min(92vw, 404px);\n  border-radius: 8px;\n  padding: 8px 12px;\n  background: var(--candice-ui-surface);\n}';
    const css = block(bad, '.candice-fake {');
    assert.ok(/width: fit-content/.test(css), 'CONTROL: the shrink-wrap check must fire on shrink-wrapped CSS');
    assert.ok(/max-width: (min\(92vw|\d+px)/.test(css), 'CONTROL: the own-max-width check must fire');
    assert.ok(!/border-radius: var\(--candice-panel-radius/.test(css), 'CONTROL: the radius-token check must fire');
    assert.ok(!/padding: var\(--candice-panel-pad/.test(css), 'CONTROL: the padding-token check must fire');
    assert.ok(!/background: transparent/.test(css), 'CONTROL: the row-must-not-paint check must fire');
    // And the block reader itself must refuse a selector that is not there,
    // rather than silently returning an empty string that passes everything.
    assert.throws(() => block(bad, '.candice-not-present {'), /selector not found/);
    // CONTROL: an interpolated selector carries a closing brace inside its
    // own header. The reader must skip past it, or every ROWS check above is
    // reading two lines and asserting nothing.
    const interpolated = '.${SOME_CLASS} {\n  width: 100%;\n  background: transparent;\n}';
    const readBack = block(interpolated, '.${SOME_CLASS} {');
    assert.match(readBack, /width: 100%/, 'CONTROL: the reader must see past the interpolation brace');
    // CONTROL: comments must not be read as declarations.
    assert.equal(
      readFileSync(join(SRC, 'styles.css'), 'utf8').includes('align-items: center'), true,
      'CONTROL: styles.css does mention align-items: center (in prose) -- so the strip is load-bearing',
    );
  });
});
