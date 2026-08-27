/**
 * Turn-off control acceptance tests.
 *
 *   PASS: there IS a Candice switch, switching it off asks native to close
 *         the app, and a wedged native boundary tells the truth instead of
 *         pretending it worked.
 *
 * It was a button until the operator asked for a row of switches -- "then by
 * next one that says Candice and that has an on and off switch" -- so these
 * now drive a checkbox with a change event rather than a button with a
 * click. What is asserted is unchanged: the outcome, never reachability.
 *
 * OUTCOME tests: they assert what the control did, never that a function was
 * reachable. Run with:
 *
 *   node --test --experimental-strip-types \
 *     apps/candice-companion/src/ui/power/__tests__/power.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { createPowerOff } from '../controller.ts';
import {
  POWER_OFF_BUSY_HINT,
  POWER_OFF_FAILED_HINT,
  POWER_OFF_HINT,
  POWER_OFF_ID,
  POWER_OFF_LABEL,
  POWER_OFF_STYLE_ID,
} from '../config.ts';

// ------------------------------------------------------------- tiny fake DOM

class FakeElement {
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  listeners = new Map<string, Array<() => void>>();
  parent: FakeElement | null = null;
  ownerDocument: FakeDocument | null = null;
  textContent = '';
  className = '';
  id = '';
  type = '';
  disabled = false;
  checked = false;
  tagName: string;

  constructor(tagName: string) {
    this.tagName = tagName;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  addEventListener(type: string, listener: () => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  fire(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }
  findById(id: string): FakeElement | null {
    if (this.id === id) return this;
    for (const child of this.children) {
      const hit = child.findById(id);
      if (hit) return hit;
    }
    return null;
  }
  /** Depth-first search by tag, so the label can be read beside its input. */
  findByTag(tag: string): FakeElement | null {
    if (this.tagName === tag) return this;
    for (const child of this.children) {
      const hit = child.findByTag(tag);
      if (hit) return hit;
    }
    return null;
  }
  /** Depth-first search by class, so the hint can be read the way CSS sees it. */
  findByClass(cls: string): FakeElement | null {
    if (this.className.split(/\s+/).includes(cls)) return this;
    for (const child of this.children) {
      const hit = child.findByClass(cls);
      if (hit) return hit;
    }
    return null;
  }
}

class FakeDocument {
  documentElement = new FakeElement('html');
  head = new FakeElement('head');
  body = new FakeElement('body');
  defaultView: unknown = null;

  constructor() {
    this.documentElement.ownerDocument = this;
    this.head.ownerDocument = this;
    this.body.ownerDocument = this;
    this.documentElement.append(this.head, this.body);
  }
  createElement(tag: string): FakeElement {
    const el = new FakeElement(tag);
    el.ownerDocument = this;
    return el;
  }
  getElementById(id: string): FakeElement | null {
    return this.documentElement.findById(id);
  }
}

function mountPowerOff(quit: () => Promise<unknown> | unknown) {
  const doc = new FakeDocument();
  const mount = doc.createElement('div');
  doc.body.append(mount);
  let layoutRefreshes = 0;
  const control = createPowerOff({
    mount: mount as unknown as HTMLElement,
    doc: doc as unknown as Document,
    quit,
    onLayoutChange: () => {
      layoutRefreshes += 1;
    },
  });
  const toggle = doc.getElementById(POWER_OFF_ID);
  const label = (control.element as unknown as FakeElement | null)?.findByTag('label');
  const hint = (control.element as unknown as FakeElement | null)?.findByClass(
    'candice-power-off-hint',
  );
  return { doc, mount, control, toggle, label, hint, layout: () => layoutRefreshes };
}

/**
 * Switch Candice OFF the way a user does: move the checkbox, then let the
 * browser fire change. Setting `checked` without the event would test the
 * listener's absence, not its presence.
 */
function switchOff(toggle: FakeElement | null | undefined): void {
  if (!toggle) return;
  toggle.checked = false;
  toggle.fire('change');
}

// ------------------------------------------------------------------- tests

test('the Candice switch exists, is named, and starts on', () => {
  const { control, toggle, label, hint } = mountPowerOff(async () => undefined);
  assert.notEqual(control.element, null, 'the control must mount');
  assert.notEqual(toggle, null, 'there must be a Candice switch in the tree');
  assert.equal(toggle?.tagName, 'input');
  assert.equal(toggle?.getAttribute('type'), 'checkbox');
  // ON at mount, because she is: this control only exists while she runs. A
  // switch that reads OFF beside a visibly running Candice is the animation
  // toggle's old lie in a new place.
  assert.equal(toggle?.checked, true, 'the switch must start on');
  // The name is on the label, not the control, and the label points at it --
  // which is what gives the checkbox an accessible name at all.
  assert.equal(label?.textContent, POWER_OFF_LABEL);
  assert.equal(label?.getAttribute('for'), POWER_OFF_ID);
  // The reassurance is what replaces a confirm dialog. It is no longer drawn
  // (the operator asked for switches "without all the fucking words") but it
  // is still in the tree, because it is the live region a screen reader uses.
  assert.equal(hint?.textContent, POWER_OFF_HINT);
  assert.equal(hint?.getAttribute('role'), 'status');
  assert.equal(hint?.getAttribute('aria-live'), 'polite');
  // No aria-pressed invented on top of the native checked state.
  assert.equal(toggle?.getAttribute('aria-pressed'), null);
});

test('switching it off asks native to close the app', () => {
  let quits = 0;
  const { control, toggle } = mountPowerOff(async () => {
    quits += 1;
  });
  switchOff(toggle);
  assert.equal(quits, 1, 'switching off must reach native');
  assert.equal(control.closing, true);
  assert.equal(toggle?.disabled, true, 'the switch disarms while closing');
});

test('switching it back ON does not fire a quit', () => {
  // Only OFF is an action. After a failed close the control re-checks itself
  // (see fail()), which fires a change event -- if ON also quit, that would
  // loop straight back into another attempt.
  let quits = 0;
  const { toggle } = mountPowerOff(async () => {
    quits += 1;
  });
  if (toggle) {
    toggle.checked = true;
    toggle.fire('change');
  }
  assert.equal(quits, 0, 'switching on must never ask native to quit');
});

test('a second flick does not fire a second quit', () => {
  let quits = 0;
  const { toggle } = mountPowerOff(async () => {
    quits += 1;
  });
  switchOff(toggle);
  switchOff(toggle);
  switchOff(toggle);
  assert.equal(quits, 1, 'single-flight: the process is already leaving');
});

test('the hint reports the in-flight state', () => {
  const { toggle, hint, control } = mountPowerOff(() => new Promise(() => {}));
  switchOff(toggle);
  assert.equal(hint?.textContent, POWER_OFF_BUSY_HINT);
  assert.equal(control.element?.getAttribute('data-candice-power'), 'closing');
});

test('a native boundary that rejects says so instead of pretending', async () => {
  const { toggle, hint, control } = mountPowerOff(async () => {
    throw new Error('no native boundary');
  });
  switchOff(toggle);
  await new Promise((r) => setImmediate(r));
  assert.equal(hint?.textContent, POWER_OFF_FAILED_HINT);
  assert.equal(control.closing, false, 'a failed close must re-arm the switch');
  assert.equal(toggle?.disabled, false);
  // AND the switch goes back ON, because Candice is still running. Leaving it
  // OFF beside a visibly-present Candice is a control lying about its subject.
  assert.equal(toggle?.checked, true, 'a failed close must restore the ON state');
  assert.equal(control.element?.getAttribute('data-candice-power'), 'failed');
});

test('an explicit false from native is a failure, not a success', async () => {
  const { toggle, hint } = mountPowerOff(async () => false);
  switchOff(toggle);
  await new Promise((r) => setImmediate(r));
  assert.equal(hint?.textContent, POWER_OFF_FAILED_HINT);
});

test('the control publishes its box so the window lets the pointer through', () => {
  const { toggle, layout } = mountPowerOff(async () => undefined);
  // The window is pointer-transparent outside published regions, so a
  // control that never triggers a refresh is drawn but not clickable.
  const afterMount = layout();
  assert.ok(afterMount >= 1, 'mounting must refresh the input regions');
  switchOff(toggle);
  assert.ok(layout() > afterMount, 'a state change must refresh them again');
});

test('mounting twice keeps one switch', () => {
  const { doc, mount, control } = mountPowerOff(async () => undefined);
  const second = createPowerOff({
    mount: mount as unknown as HTMLElement,
    doc: doc as unknown as Document,
    quit: async () => undefined,
  });
  assert.equal(second.element, null, 'the second mount must be inert');
  assert.notEqual(control.element, null, 'the first control survives');
});

test('an unusable DOM degrades instead of throwing (spec 20)', () => {
  const control = createPowerOff({
    mount: null as unknown as HTMLElement,
    quit: async () => undefined,
  });
  assert.equal(control.element, null);
  assert.doesNotThrow(() => control.press());
  assert.doesNotThrow(() => control.destroy());
});

test('CONTROL: the quit callback is genuinely wired, not assumed', () => {
  // If the change listener were never attached, "switching it off asks
  // native to close" would pass vacuously only if quits stayed 0 — so prove
  // the inverse too: with no flick, native is never asked.
  let quits = 0;
  mountPowerOff(async () => {
    quits += 1;
  });
  assert.equal(quits, 0, 'mounting alone must never quit the app');
});

test('the Candice switch is the SAME switch as the two beside it', () => {
  // This reverses a rule that stood for weeks, so it is written down rather
  // than quietly dropped.
  //
  // The control that ends the session used to be deliberately unlike its
  // neighbours -- a red-bordered pill, then a red checkbox -- because the
  // operator once could not tell which chip turned Candice off. The operator
  // then specified the row himself, twice, and specified it uniform: "slide
  // to the left, red. Slide to the right, green." Red is now the OFF state of
  // every switch on the row. A permanently-red Candice switch would read as
  // permanently OFF, which is both false and a worse confusion than the one
  // the tint was introduced to prevent.
  //
  // So the invariant flips: this control must be INDISTINGUISHABLE from the
  // other two, and the way that is guaranteed is structural -- one builder,
  // one stylesheet, no local styling of the control anywhere.
  const { doc } = mountPowerOff(async () => undefined);
  const css = doc.getElementById(POWER_OFF_STYLE_ID)?.textContent ?? '';
  assert.notEqual(css, '', 'CONTROL: the style must actually be injected, or this test is vacuous');

  const here = readFileSync(join(import.meta.dirname, '..', 'controller.ts'), 'utf8');
  const siblingCss = readFileSync(
    join(import.meta.dirname, '..', '..', 'settings-toggle', 'controller.ts'), 'utf8',
  );

  // Same builder.
  for (const [what, src] of [['the Candice switch', here], ['Voice and Hologram', siblingCss]] as const) {
    assert.match(
      src, /import \{ createSwitch \} from '\.\.\/switch\/index\.ts';/,
      `${what} must be built by the shared ui/switch module`,
    );
    assert.match(src, /createSwitch\(/, `${what} must actually call it`);
  }

  // And no local dressing, in either module: a module that restyled its own
  // input would make them differ again without either test noticing.
  assert.ok(
    !/accent-color/.test(css),
    'this module must not tint its own control -- ui/switch dresses all three',
  );
  // The danger colour survives in exactly one place -- the failure message,
  // which is red text and should be. What must be gone is danger on the
  // CONTROL: red now means OFF, and this switch is normally ON, so a red
  // Candice switch would read as permanently off.
  // Comments stripped: this stylesheet EXPLAINS in prose why the danger tint
  // was removed, and prose naming a token is not the token being used. The
  // first draft of this check counted the explanation as a violation.
  const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(
    declarations.split('--candice-danger').length - 1, 1,
    'the danger colour may appear exactly once, on the failure hint',
  );
  const dangerAt = declarations.indexOf('--candice-danger');
  assert.notEqual(dangerAt, -1, 'CONTROL: the failure hint must still use it, or this proves nothing');
  const head = declarations.slice(0, dangerAt);
  const ruleStart = head.lastIndexOf('}');
  const selector = head.slice(ruleStart + 1, head.indexOf('{', ruleStart));
  assert.match(
    selector, /failed/,
    'danger may only tint the failure hint, never the switch itself',
  );
  assert.ok(
    !/accent-color/.test(siblingCss),
    'CONTROL: the sibling module must not tint its controls either',
  );
  // CONTROL: the "no local dressing" checks must be capable of failing, so
  // prove the string they hunt for is one these stylesheets could contain.
  assert.ok(
    /accent-color/.test('.x { accent-color: red; }'),
    'CONTROL: the accent-color probe matches accent-color when it is present',
  );

  // The ROW still sits on the shared surface -- but that surface moved up one
  // level. Voice, Hologram and Turn-off each painted their own opaque
  // background, which is correct in isolation (a transparent window can have
  // any desktop behind it) and awful together: three separate floating cards
  // stacked down the character. The paint now happens once, on
  // `.candice-settings-panel`, and the rows inside it are transparent.
  //
  // The claim this test defends is unchanged: this is a tinted control inside
  // the normal chrome, not a recoloured panel. So the row must NOT paint.
  assert.match(css, /background: transparent;\n  border: 0;/, 'the row must not paint its own surface');

  // ...and the surface must still exist, or "the row inherits it" is a story
  // rather than a fact. Read the module that owns the panel and require it to
  // paint the shared surface there.
  const panelCss = readFileSync(
    join(import.meta.dirname, '..', '..', 'settings-toggle', 'controller.ts'), 'utf8',
  );
  assert.match(
    panelCss, /\$\{SETTINGS_PANEL_CLASS\} \{[^}]*background: var\(--candice-ui-surface/,
    'the settings panel must paint the shared surface the rows now inherit',
  );
  // CONTROL: that regex must be capable of failing. A pattern that matches any
  // text would make the assertion above decorative.
  assert.ok(
    !/\$\{SETTINGS_PANEL_CLASS\} \{[^}]*background: var\(--candice-nonexistent/.test(panelCss),
    'CONTROL: the panel-surface check can say no',
  );
});

test('the row stays a real pointer target, and cannot overflow', () => {
  // PUBLICATION, not activation. The window is pointer-transparent outside
  // published rectangles, and what the hit test publishes is the ROW -- so a
  // near miss aimed at a 16px checkbox lands inside Candice rather than
  // passing through to the desktop. That is what the 44px buys, and it is the
  // whole reason .candice-power-off is in CONTROL_SELECTOR.
  const { doc } = mountPowerOff(async () => undefined);
  const css = doc.getElementById(POWER_OFF_STYLE_ID)?.textContent ?? '';

  const row = css.slice(0, css.indexOf('label {'));
  assert.match(row, /min-height: 44px;/, 'the published row must stay 44px');

  // At the Large text scale three names plus three checkboxes exceed the
  // column, and body{overflow:hidden} clips rather than scrolls, so an
  // unwrapped row would lose its tail.
  assert.match(css, /flex-wrap: wrap;/, 'the row must wrap rather than be clipped');

  // The row carries no width of its own -- in either direction. It used to
  // pin `max-width: min(92vw, 404px)` while the panel pinned a different
  // number and the status line above pinned 420px: three surfaces, three
  // widths, which is what "the boxes are all mismatched" was. Now it is one
  // of three items sharing a line, so it is sized by its contents and the
  // PANEL owns the column.
  assert.match(row, /width: auto;/, 'the row must size to its contents, not to a column');
  assert.ok(
    !/max-width: min\(/.test(css),
    'the row must not reintroduce a width of its own -- the panel owns the column',
  );

  // CONTROL: the slice above must actually contain the row and stop before
  // the label rule, or every assertion on `row` is reading the whole
  // stylesheet and proving nothing about which selector carries what.
  assert.ok(css.includes('label {'), 'CONTROL: the label rule must exist for the slice to bound');
  assert.ok(
    css.includes('cursor: pointer'), 'CONTROL: a later rule carries cursor: pointer...',
  );
  assert.ok(
    !row.includes('cursor: pointer'), '...and the row slice must stop before reaching it',
  );
});
