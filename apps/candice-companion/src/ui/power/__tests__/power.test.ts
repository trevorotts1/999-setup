/**
 * Turn-off control acceptance tests.
 *
 *   PASS: there IS an off button, pressing it asks native to close the app,
 *         and a wedged native boundary tells the truth instead of pretending
 *         it worked.
 *
 * OUTCOME tests: they assert what the control did, never that a function was
 * reachable. Run with:
 *
 *   node --test --experimental-strip-types \
 *     apps/candice-companion/src/ui/power/__tests__/power.test.ts
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPowerOff } from '../controller.ts';
import {
  POWER_OFF_BUSY_HINT,
  POWER_OFF_FAILED_HINT,
  POWER_OFF_HINT,
  POWER_OFF_ID,
  POWER_OFF_LABEL,
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
  const button = doc.getElementById(POWER_OFF_ID);
  const hint = (control.element as unknown as FakeElement | null)?.findByClass(
    'candice-power-off-hint',
  );
  return { doc, mount, control, button, hint, layout: () => layoutRefreshes };
}

// ------------------------------------------------------------------- tests

test('the off button exists and says what it does', () => {
  const { control, button, hint } = mountPowerOff(async () => undefined);
  assert.notEqual(control.element, null, 'the control must mount');
  assert.notEqual(button, null, 'there must be an off button in the tree');
  assert.equal(button?.tagName, 'button');
  assert.equal(button?.textContent, POWER_OFF_LABEL);
  // The reassurance is what replaces a confirm dialog.
  assert.equal(hint?.textContent, POWER_OFF_HINT);
  // It is an action, not a two-state control: a verb cannot report pressed.
  assert.equal(button?.getAttribute('aria-pressed'), null);
});

test('pressing it asks native to close the app', () => {
  let quits = 0;
  const { control, button } = mountPowerOff(async () => {
    quits += 1;
  });
  button?.fire('click');
  assert.equal(quits, 1, 'a click must reach native');
  assert.equal(control.closing, true);
  assert.equal(button?.disabled, true, 'the button disarms while closing');
});

test('a second click does not fire a second quit', () => {
  let quits = 0;
  const { button } = mountPowerOff(async () => {
    quits += 1;
  });
  button?.fire('click');
  button?.fire('click');
  button?.fire('click');
  assert.equal(quits, 1, 'single-flight: the process is already leaving');
});

test('the hint reports the in-flight state', () => {
  const { button, hint, control } = mountPowerOff(() => new Promise(() => {}));
  button?.fire('click');
  assert.equal(hint?.textContent, POWER_OFF_BUSY_HINT);
  assert.equal(control.element?.getAttribute('data-candice-power'), 'closing');
});

test('a native boundary that rejects says so instead of pretending', async () => {
  const { button, hint, control } = mountPowerOff(async () => {
    throw new Error('no native boundary');
  });
  button?.fire('click');
  await new Promise((r) => setImmediate(r));
  assert.equal(hint?.textContent, POWER_OFF_FAILED_HINT);
  assert.equal(control.closing, false, 'a failed close must re-arm the button');
  assert.equal(button?.disabled, false);
  assert.equal(control.element?.getAttribute('data-candice-power'), 'failed');
});

test('an explicit false from native is a failure, not a success', async () => {
  const { button, hint } = mountPowerOff(async () => false);
  button?.fire('click');
  await new Promise((r) => setImmediate(r));
  assert.equal(hint?.textContent, POWER_OFF_FAILED_HINT);
});

test('the control publishes its box so the window lets the pointer through', () => {
  const { button, layout } = mountPowerOff(async () => undefined);
  // The window is pointer-transparent outside published regions, so a
  // control that never triggers a refresh is drawn but not clickable.
  const afterMount = layout();
  assert.ok(afterMount >= 1, 'mounting must refresh the input regions');
  button?.fire('click');
  assert.ok(layout() > afterMount, 'a state change must refresh them again');
});

test('mounting twice keeps one button', () => {
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
  // If the click listener were never attached, "pressing it asks native to
  // close" would pass vacuously only if quits stayed 0 — so prove the
  // inverse too: with no click, native is never asked.
  let quits = 0;
  mountPowerOff(async () => {
    quits += 1;
  });
  assert.equal(quits, 0, 'mounting alone must never quit the app');
});
