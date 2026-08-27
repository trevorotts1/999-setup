/**
 * Voice-at-rest and hologram-off acceptance tests.
 *
 *   PASS: both switches exist, both actually switch the thing off, both
 *         publish their box so the pointer can reach them, and a failed
 *         write does not veto the change.
 *
 * OUTCOME tests: they assert what the control DID, never that a function was
 * reachable.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSettingsToggle } from '../controller.ts';
import { HOLOGRAM_TOGGLE, SETTINGS_TOGGLE_CLASS, VOICE_TOGGLE } from '../config.ts';

// ------------------------------------------------------------- tiny fake DOM

class FakeElement {
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  classNameValue = '';
  textContent = '';
  id = '';
  checked = false;
  readonly tagName: string;
  private listeners = new Map<string, (() => void)[]>();
  ownerDocument: FakeDocument | null = null;

  constructor(tag: string) { this.tagName = tag; }
  set className(v: string) { this.classNameValue = v; }
  get className(): string { return this.classNameValue; }
  setAttribute(n: string, v: string): void { this.attributes.set(n, v); }
  getAttribute(n: string): string | null { return this.attributes.get(n) ?? null; }
  append(...kids: FakeElement[]): void {
    for (const k of kids) { k.ownerDocument = this.ownerDocument; this.children.push(k); }
  }
  addEventListener(type: string, fn: () => void): void {
    const l = this.listeners.get(type) ?? []; l.push(fn); this.listeners.set(type, l);
  }
  fire(type: string): void { for (const fn of this.listeners.get(type) ?? []) fn(); }
  find(pred: (el: FakeElement) => boolean): FakeElement | null {
    if (pred(this)) return this;
    for (const c of this.children) { const f = c.find(pred); if (f) return f; }
    return null;
  }
}

class FakeClassList {
  private set = new Set<string>();
  toggle(name: string, force?: boolean): void {
    const on = force ?? !this.set.has(name);
    if (on) this.set.add(name); else this.set.delete(name);
  }
  contains(name: string): boolean { return this.set.has(name); }
}

class FakeDocument {
  documentElement = new FakeElement('html');
  head = new FakeElement('head');
  classListStore = new FakeClassList();
  constructor() {
    this.documentElement.ownerDocument = this;
    this.head.ownerDocument = this;
    // `documentElement.classList` is what the hologram control writes.
    (this.documentElement as unknown as { classList: FakeClassList }).classList = this.classListStore;
  }
  createElement(tag: string): FakeElement { const e = new FakeElement(tag); e.ownerDocument = this; return e; }
  getElementById(id: string): FakeElement | null {
    return this.documentElement.find((e) => e.id === id) ?? this.head.find((e) => e.id === id);
  }
}

/** Structural, not `typeof VOICE_TOGGLE`: the frozen consts have literal
 *  types, so a `typeof` parameter accepts only that ONE spec and rejects the
 *  hologram row. */
interface ToggleSpec {
  readonly id: string;
  readonly className: string;
  readonly label: string;
  readonly onHint: string;
  readonly offHint: string;
}

function mount(spec: ToggleSpec, checked: boolean, opts: {
  apply?: (v: boolean) => void;
  persist?: (v: boolean) => Promise<boolean> | boolean | void;
} = {}) {
  const doc = new FakeDocument();
  const root = doc.createElement('div');
  doc.documentElement.append(root);
  let layouts = 0;
  const control = createSettingsToggle({
    mount: root as unknown as HTMLElement,
    doc: doc as unknown as Document,
    id: spec.id, className: spec.className, label: spec.label,
    onHint: spec.onHint, offHint: spec.offHint,
    checked,
    apply: opts.apply,
    persist: opts.persist,
    onLayoutChange: () => { layouts += 1; },
  });
  const input = doc.getElementById(spec.id);
  const hint = (control.element as unknown as FakeElement | null)
    ?.find((e) => e.getAttribute('role') === 'status') ?? null;
  return { doc, root, control, input, hint, layouts: () => layouts };
}

// ------------------------------------------------------------------- tests

test('voice can be switched off WITHOUT a question on screen', () => {
  // The regression: the only Voice control belonged to the answer surface,
  // which exists solely while a question is displayed. Between questions
  // there was no way to mute her.
  const stopped: boolean[] = [];
  const { control, input, hint } = mount(VOICE_TOGGLE, true, {
    apply: (on) => { if (!on) stopped.push(true); },
  });
  assert.notEqual(control.element, null, 'the voice row must mount at rest');
  assert.equal(control.isOn(), true);
  assert.equal(hint?.textContent, VOICE_TOGGLE.onHint);

  input!.checked = false;
  input!.fire('change');

  assert.equal(control.isOn(), false, 'the switch must switch');
  assert.equal(hint?.textContent, VOICE_TOGGLE.offHint);
  assert.deepEqual(stopped, [true], 'turning voice off must stop the voice playing NOW');
});

test('the hologram can be hidden while she keeps working', () => {
  const { doc, control, input } = mount(HOLOGRAM_TOGGLE, true, {
    apply: (visible) => {
      doc.classListStore.toggle('candice-hologram-hidden', !visible);
    },
  });
  assert.notEqual(control.element, null, 'the hologram row must mount');
  assert.equal(doc.classListStore.contains('candice-hologram-hidden'), false, 'visible at boot');

  input!.checked = false;
  input!.fire('change');

  assert.equal(
    doc.classListStore.contains('candice-hologram-hidden'), true,
    'unchecking Hologram must actually hide her',
  );
  // CONTROL: and it must come back, or this is a one-way door.
  input!.checked = true;
  input!.fire('change');
  assert.equal(doc.classListStore.contains('candice-hologram-hidden'), false, 'she must come back');
});

test('a failed write still switches the thing off', () => {
  // An off switch must switch things off. Whether the choice survives a
  // restart is a separate question.
  const { control, input } = mount(VOICE_TOGGLE, true, {
    persist: () => Promise.reject(new Error('disk full')),
  });
  input!.checked = false;
  input!.fire('change');
  assert.equal(control.isOn(), false, 'a rejected persist must not veto the change');
});

test('set() syncs a second view without re-persisting', () => {
  // Two controls write one field (the at-rest row and the in-question
  // button). If they disagree the user cannot tell what she will do next.
  const writes: boolean[] = [];
  const { control, hint } = mount(VOICE_TOGGLE, true, {
    persist: (v) => { writes.push(v); return true; },
  });
  control.set(false);
  assert.equal(control.isOn(), false, 'the row must follow the other view');
  assert.equal(hint?.textContent, VOICE_TOGGLE.offHint);
  assert.deepEqual(writes, [], 'a sync must not write back — that is an echo loop');
});

test('the row publishes its box, at mount and on every change', () => {
  // Outside a published rectangle the window is pointer-transparent, so a
  // control that never refreshes them is drawn but not clickable.
  const { input, layouts } = mount(HOLOGRAM_TOGGLE, true);
  const afterMount = layouts();
  assert.ok(afterMount >= 1, 'mounting must publish the row');
  input!.checked = false;
  input!.fire('change');
  assert.ok(layouts() > afterMount, 'a state change must republish');
});

test('the row carries the shared class the hit test looks for', () => {
  const { control } = mount(VOICE_TOGGLE, true);
  assert.ok(
    control.element?.className.includes(SETTINGS_TOGGLE_CLASS),
    'without the shared class the row is not in CONTROL_SELECTOR and is unclickable',
  );
});

test('mounting twice keeps one control', () => {
  const { doc, root, control } = mount(VOICE_TOGGLE, true);
  const second = createSettingsToggle({
    mount: root as unknown as HTMLElement,
    doc: doc as unknown as Document,
    id: VOICE_TOGGLE.id, className: VOICE_TOGGLE.className, label: VOICE_TOGGLE.label,
    onHint: VOICE_TOGGLE.onHint, offHint: VOICE_TOGGLE.offHint,
    checked: true,
  });
  assert.equal(second.element, null, 'a duplicate would let the two disagree');
  assert.notEqual(control.element, null, 'the first survives');
});

test('an unusable DOM degrades instead of throwing (spec 20)', () => {
  assert.doesNotThrow(() => {
    const c = createSettingsToggle({
      mount: null as unknown as HTMLElement,
      doc: null as unknown as Document,
      id: 'x', className: 'y', label: 'L', onHint: 'a', offHint: 'b', checked: true,
    });
    assert.equal(c.element, null);
  });
});

test('the hint is a live region, so the change is ANNOUNCED not just shown', () => {
  const { hint } = mount(VOICE_TOGGLE, true);
  assert.equal(hint?.getAttribute('role'), 'status');
  assert.equal(hint?.getAttribute('aria-live'), 'polite');
});

test('CONTROL: boot state is honoured, not assumed ON', () => {
  // A stored "off" must be in force at first paint.
  const { control, hint } = mount(HOLOGRAM_TOGGLE, false);
  assert.equal(control.isOn(), false);
  assert.equal(hint?.textContent, HOLOGRAM_TOGGLE.offHint);
});

// --------------------------------------------------- the CSS that hides her
//
// The control writes a class; a stylesheet rule is what actually hides her.
// If that rule does not OUTRANK the rule that makes her visible, the switch
// is a silent no-op: the class lands, nothing changes, and no test that only
// exercises the controller would ever notice.

/** CSS specificity as (ids, classes+attrs+pseudo-classes, elements). */
function specificity(selector: string): [number, number, number] {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes = (selector.match(/\.[\w-]+/g) ?? []).length
    + (selector.match(/\[[^\]]+\]/g) ?? []).length
    + (selector.match(/:(?!:)[\w-]+/g) ?? []).length;
  const elements = (selector.match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
  return [ids, classes, elements];
}

function outranks(a: string, b: string): boolean {
  const x = specificity(a); const y = specificity(b);
  for (let i = 0; i < 3; i += 1) {
    if (x[i] !== y[i]) return x[i] > y[i];
  }
  return false;
}

test('the hologram-off rule outranks the rule that makes her visible', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../../../styles.css', import.meta.url), 'utf8');

  const hide = '.candice-hologram-hidden .candice-character[data-candice-gesture-mounted="true"]';
  const show = '.candice-character[data-candice-gesture-mounted="true"]';

  assert.ok(css.includes(hide), 'the hologram-off rule must exist in styles.css');
  assert.ok(css.includes(show), 'CONTROL: the rule it must beat must exist, or this proves nothing');
  assert.ok(
    outranks(hide, show),
    `the hologram-off rule must outrank the visible rule, else the switch silently does nothing `
    + `(${specificity(hide).join(',')} vs ${specificity(show).join(',')})`,
  );

  // CONTROL: the comparator must be capable of saying NO, or the assertion
  // above passes for any pair of selectors.
  assert.equal(outranks(show, hide), false, 'comparator must not rank everything as a winner');
  assert.equal(outranks(show, show), false, 'an equal selector does not outrank');
});
