/**
 * Animation-off toggle acceptance tests.
 *
 *   PASS: the user can turn animation off, the choice survives a restart,
 *         and `prefers-reduced-motion: reduce` is honored without the user
 *         having to ask.
 *
 * These are OUTCOME tests. They assert what the control actually did to the
 * preference and to the a11y controller — never merely that a function was
 * reachable. Run with:
 *
 *   node --test --experimental-strip-types \
 *     apps/candice-companion/src/ui/animation-toggle/__tests__/animation-toggle.test.ts
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAnimationToggle } from '../controller.ts';
import {
  ANIMATION_TOGGLE_ID,
  ANIMATION_TOGGLE_OFF_HINT,
  ANIMATION_TOGGLE_ON_HINT,
  ANIMATION_TOGGLE_OS_HINT,
} from '../config.ts';
import type { ReducedMotionPreference } from '../../../a11y/config.ts';

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
  checked = false;
  disabled = false;
  style: Record<string, string> = {};
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
  /** Fire a listener the way a real user interaction would. */
  fire(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }
  /** Depth-first search by id, mirroring getElementById reach. */
  findById(id: string): FakeElement | null {
    if (this.id === id) return this;
    for (const child of this.children) {
      const hit = child.findById(id);
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

class FakeMedia {
  listeners: Array<() => void> = [];
  matches: boolean;
  constructor(matches: boolean) {
    this.matches = matches;
  }
  addEventListener(_type: string, listener: () => void): void {
    this.listeners.push(listener);
  }
  removeEventListener(_type: string, listener: () => void): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }
  /** Simulate the OS setting flipping while the app is running. */
  set(next: boolean): void {
    this.matches = next;
    for (const listener of [...this.listeners]) listener();
  }
}

interface Harness {
  doc: FakeDocument;
  mount: FakeElement;
  media: FakeMedia;
  applied: ReducedMotionPreference[];
  persisted: ReducedMotionPreference[];
  layoutChanges: number;
}

function harness(
  reducedMotion: ReducedMotionPreference,
  osReduced = false,
): Harness & { toggle: ReturnType<typeof createAnimationToggle> } {
  const doc = new FakeDocument();
  const mount = doc.createElement('div');
  doc.body.append(mount);
  const media = new FakeMedia(osReduced);
  const applied: ReducedMotionPreference[] = [];
  const persisted: ReducedMotionPreference[] = [];
  let layoutChanges = 0;
  const toggle = createAnimationToggle({
    mount: mount as unknown as HTMLElement,
    doc: doc as unknown as Document,
    reducedMotion,
    media,
    applyPreference: (p) => applied.push(p),
    persist: (p) => {
      persisted.push(p);
      return true;
    },
    onLayoutChange: () => {
      layoutChanges += 1;
    },
  });
  return {
    doc,
    mount,
    media,
    applied,
    persisted,
    toggle,
    get layoutChanges() {
      return layoutChanges;
    },
  };
}

function checkbox(h: { doc: FakeDocument }): FakeElement {
  const input = h.doc.getElementById(ANIMATION_TOGGLE_ID);
  assert.ok(input !== null, 'the toggle checkbox must be mounted');
  return input;
}

function hintText(h: { doc: FakeDocument }): string {
  const input = checkbox(h);
  const hint = input.parent?.children.find((c) => c.getAttribute('role') === 'status');
  return hint?.textContent ?? '';
}

// ------------------------------------------------------------------- mounting

test('mounts one checkbox that starts ON when no preference is stored', () => {
  const h = harness(null);
  const input = checkbox(h);
  assert.equal(input.type, 'checkbox');
  assert.equal(input.checked, true, 'animation runs by default');
  assert.equal(input.disabled, false);
  assert.equal(hintText(h), ANIMATION_TOGGLE_ON_HINT);
  // Boot must only REFLECT the persisted value; main.ts already applied it.
  assert.deepEqual(h.applied, [], 'mounting never re-applies the preference');
  assert.deepEqual(h.persisted, [], 'mounting never writes the profile');
  h.toggle.destroy();
});

test('a second mount is refused — two checkboxes cannot drive one preference', () => {
  const h = harness(null);
  const second = createAnimationToggle({
    mount: h.mount as unknown as HTMLElement,
    doc: h.doc as unknown as Document,
    reducedMotion: null,
    media: h.media,
    applyPreference: () => undefined,
    persist: () => true,
  });
  assert.equal(second.element, null, 're-entry yields an inert handle');
  assert.equal(h.mount.children.length, 1, 'exactly one control in the DOM');
  h.toggle.destroy();
});

// -------------------------------------------------------- the actual toggling

test('unchecking turns animation OFF: applies reducedMotion true AND persists it', () => {
  const h = harness(null);
  const input = checkbox(h);
  input.checked = false;
  input.fire('change');

  assert.deepEqual(h.applied, [true], 'the a11y controller is told to reduce');
  assert.deepEqual(h.persisted, [true], 'the choice is written to the profile');
  assert.equal(h.toggle.preference, true);
  assert.equal(h.toggle.motionOff, true);
  assert.equal(hintText(h), ANIMATION_TOGGLE_OFF_HINT);
  assert.equal(input.parent?.getAttribute('data-candice-animation'), 'off');
  h.toggle.destroy();
});

test('re-checking maps to null (follow the OS), never to false', () => {
  const h = harness(true);
  const input = checkbox(h);
  assert.equal(input.checked, false, 'a stored "off" renders unchecked');

  input.checked = true;
  input.fire('change');

  // Read the recorded values BEFORE any deepEqual: the assertion signature
  // on node:assert narrows them, which would hide the `false` check below.
  const persistedFalse = h.persisted.some((p) => p === false);
  const appliedFalse = h.applied.some((p) => p === false);
  assert.equal(
    persistedFalse || appliedFalse,
    false,
    'ON must never use false — that would override prefers-reduced-motion',
  );
  assert.deepEqual(h.applied, [null]);
  assert.deepEqual(h.persisted, [null]);
  assert.equal(hintText(h), ANIMATION_TOGGLE_ON_HINT);
  h.toggle.destroy();
});

test('the persisted OFF choice survives a restart (boot renders it unchecked)', () => {
  // Restart == a fresh mount handed the value the profile returned.
  const h = harness(true);
  assert.equal(checkbox(h).checked, false);
  assert.equal(h.toggle.motionOff, true);
  assert.equal(hintText(h), ANIMATION_TOGGLE_OFF_HINT);
  h.toggle.destroy();
});

// --------------------------------------------------- prefers-reduced-motion

test('OS reduced motion turns animation off automatically and locks the control', () => {
  const h = harness(null, true);
  const input = checkbox(h);
  assert.equal(input.checked, false, 'OS setting wins with no user preference');
  assert.equal(input.disabled, true, 'no override of prefers-reduced-motion is offered');
  assert.equal(h.toggle.motionOff, true);
  assert.equal(hintText(h), ANIMATION_TOGGLE_OS_HINT);
  assert.equal(input.parent?.getAttribute('data-candice-animation-source'), 'os');
  h.toggle.destroy();
});

test('the OS setting flipping at runtime repaints the control without a click', () => {
  const h = harness(null, false);
  assert.equal(checkbox(h).checked, true);

  h.media.set(true);
  assert.equal(checkbox(h).checked, false, 'live OS change is honored');
  assert.equal(checkbox(h).disabled, true);
  assert.equal(hintText(h), ANIMATION_TOGGLE_OS_HINT);

  h.media.set(false);
  assert.equal(checkbox(h).checked, true, 'and honored again when it clears');
  assert.equal(checkbox(h).disabled, false);
  h.toggle.destroy();
});

test('a user OFF still reads as user-owned while the OS also asks for reduce', () => {
  const h = harness(true, true);
  const input = checkbox(h);
  assert.equal(input.checked, false);
  assert.equal(
    input.disabled,
    false,
    'the user chose this, so they may undo it back to follow-the-OS',
  );
  assert.equal(input.parent?.getAttribute('data-candice-animation-source'), 'user');
  h.toggle.destroy();
});

// ------------------------------------------------------------- spec 20 / a11y

test('the control publishes a layout change so the native hit test can reach it', () => {
  const h = harness(null);
  const before = h.layoutChanges;
  assert.ok(before >= 1, 'mounting publishes at least once');
  checkbox(h).checked = false;
  checkbox(h).fire('change');
  assert.ok(h.layoutChanges > before, 'a state change republishes the region');
  h.toggle.destroy();
});

test('a failing persist never throws and never blocks the visible change', () => {
  const doc = new FakeDocument();
  const mount = doc.createElement('div');
  doc.body.append(mount);
  const applied: ReducedMotionPreference[] = [];
  const toggle = createAnimationToggle({
    mount: mount as unknown as HTMLElement,
    doc: doc as unknown as Document,
    reducedMotion: null,
    media: new FakeMedia(false),
    applyPreference: (p) => applied.push(p),
    persist: () => {
      throw new Error('profile write failed');
    },
  });
  const input = doc.getElementById(ANIMATION_TOGGLE_ID)!;
  input.checked = false;
  assert.doesNotThrow(() => input.fire('change'));
  assert.deepEqual(applied, [true], 'the animation still stops in memory');
  assert.equal(toggle.preference, true);
  toggle.destroy();
});

test('a throwing a11y controller never propagates (spec 20)', () => {
  const doc = new FakeDocument();
  const mount = doc.createElement('div');
  doc.body.append(mount);
  const persisted: ReducedMotionPreference[] = [];
  const toggle = createAnimationToggle({
    mount: mount as unknown as HTMLElement,
    doc: doc as unknown as Document,
    reducedMotion: null,
    media: new FakeMedia(false),
    applyPreference: () => {
      throw new Error('a11y controller detached');
    },
    persist: (p) => {
      persisted.push(p);
      return true;
    },
  });
  const input = doc.getElementById(ANIMATION_TOGGLE_ID)!;
  input.checked = false;
  assert.doesNotThrow(() => input.fire('change'));
  assert.deepEqual(persisted, [true], 'the choice is still recorded');
  toggle.destroy();
});

test('a null mount degrades to an inert handle instead of throwing', () => {
  const toggle = createAnimationToggle({
    mount: null as unknown as HTMLElement,
    reducedMotion: null,
    applyPreference: () => undefined,
    persist: () => true,
  });
  assert.equal(toggle.element, null);
  assert.doesNotThrow(() => toggle.destroy());
});

test('destroy removes the control and stops listening to the OS', () => {
  const h = harness(null);
  assert.ok(h.doc.getElementById(ANIMATION_TOGGLE_ID) !== null);
  h.toggle.destroy();
  h.toggle.destroy(); // idempotent
  assert.equal(h.doc.getElementById(ANIMATION_TOGGLE_ID), null);
  assert.equal(h.media.listeners.length, 0, 'no leaked media listener');
});
