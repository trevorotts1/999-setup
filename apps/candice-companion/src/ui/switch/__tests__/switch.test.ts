/**
 * Sliding switch acceptance tests.
 *
 *   PASS: the switch is a real checkbox the keyboard can reach, its knob
 *         moves left for off and right for on, the track is red for off and
 *         green for on, and the on/off state is never carried by colour
 *         alone.
 *
 * The operator specified this control himself: "slide to the left off, slide
 * to the right on... slide to the left, red. Slide to the right, green."
 * These assert that specification, plus the accessibility properties that
 * make it safe to build a switch out of spans.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  createSwitch,
  SWITCH_CLASS,
  SWITCH_KNOB_CLASS,
  SWITCH_TRACK_CLASS,
} from '../index.ts';

// ------------------------------------------------------------- tiny fake DOM

class FakeElement {
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  tagName: string;
  className = '';
  id = '';
  checked = false;

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
    for (const node of nodes) this.children.push(node);
  }
}

class FakeDocument {
  createElement(tag: string): FakeElement {
    return new FakeElement(tag);
  }
}

function build(id = 'candice-test-switch') {
  const doc = new FakeDocument();
  const parts = createSwitch(doc as unknown as Document, id);
  const root = parts.root as unknown as FakeElement;
  return { root, input: parts.input as unknown as FakeElement, parts };
}

const STYLES = readFileSync(
  join(import.meta.dirname, '..', '..', '..', 'styles.css'), 'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

// ------------------------------------------------------------------- markup

test('the switch is a real checkbox, named by the id the caller passes', () => {
  const { root, input } = build('candice-voice-toggle');
  assert.equal(root.className, SWITCH_CLASS);
  assert.equal(input.tagName, 'input');
  assert.equal(input.getAttribute('type'), 'checkbox');
  // The id is how a <label for> elsewhere in the row gives it its NAME.
  assert.equal(input.id, 'candice-voice-toggle');
});

test('the input comes FIRST and the track second', () => {
  // Load-bearing, not stylistic. The stylesheet moves the knob with
  // `input:checked + .candice-switch-track` — an adjacent sibling selector.
  // Reverse these two and the switch renders perfectly and never visibly
  // changes state, which is the worst kind of broken: it looks fine.
  const { root } = build();
  assert.equal(root.children.length, 2, 'exactly the input and the track');
  assert.equal(root.children[0]?.tagName, 'input');
  assert.equal(root.children[1]?.className, SWITCH_TRACK_CLASS);
});

test('the knob lives inside the track', () => {
  const { root } = build();
  const track = root.children[1];
  assert.equal(track?.children.length, 1);
  assert.equal(track?.children[0]?.className, SWITCH_KNOB_CLASS);
});

test('two switches are structurally identical apart from their ids', () => {
  // Voice, Hologram and Candice share a line and must be indistinguishable.
  const a = build('a').root;
  const b = build('b').root;
  const shape = (el: FakeElement): string =>
    `${el.tagName}.${el.className}(${el.children.map(shape).join(',')})`;
  assert.equal(shape(a), shape(b));
});

// -------------------------------------------------------------- the styling

test('the knob slides: left for off, right for on', () => {
  assert.match(
    STYLES,
    /\.candice-switch input:checked \+ \.candice-switch-track \.candice-switch-knob \{[^}]*transform: translateX\(/,
    'checked must move the knob to the right',
  );
  // ...and the resting position is the left edge, which is what it moves FROM.
  assert.match(
    STYLES, /\.candice-switch-knob \{[^}]*left: 3px;/,
    'the knob must rest at the left edge when off',
  );
});

test('the track is red for off and green for on', () => {
  assert.match(
    STYLES, /\.candice-switch-track \{[^}]*background: var\(--candice-switch-off\)/,
    'the resting track must carry the off colour',
  );
  assert.match(
    STYLES,
    /\.candice-switch input:checked \+ \.candice-switch-track \{[^}]*background: var\(--candice-switch-on\)/,
    'checked must repaint the track with the on colour',
  );
  // The values themselves, so "red" and "green" are facts and not names.
  assert.match(STYLES, /--candice-switch-off: #ff8a8a;/);
  assert.match(STYLES, /--candice-switch-on: #4ade80;/);
});

test('state is never carried by colour alone', () => {
  // WCAG 1.4.1, and red/green is exactly the pairing red-green colour
  // blindness collapses. The knob's POSITION is the independent signal, so
  // the transform above is not decoration — removing it would leave a
  // control two users in a hundred cannot read at all.
  assert.match(
    STYLES,
    /\.candice-switch input:checked \+ \.candice-switch-track \.candice-switch-knob \{[^}]*transform:/,
    'the position signal must exist alongside the colour signal',
  );
  // CONTROL: prove the regex is capable of missing. The same shape aimed at
  // a selector that does not exist must not match.
  assert.ok(
    !/\.candice-switch input:checked \+ \.candice-switch-nonexistent \{/.test(STYLES),
    'CONTROL: the selector probe can say no',
  );
});

test('the checkbox is invisible but still focusable and still announced', () => {
  const block = STYLES.slice(
    STYLES.indexOf('.candice-switch input {'),
    STYLES.indexOf('}', STYLES.indexOf('.candice-switch input {')),
  );
  assert.notEqual(block, '', 'CONTROL: the rule must exist for this to mean anything');
  assert.match(block, /opacity: 0;/, 'hidden by opacity');
  // These two would take it out of the focus order AND the accessibility
  // tree: the switch would be unreachable by keyboard and silent to a
  // screen reader, while looking exactly the same on screen.
  assert.ok(!/display: none/.test(block), 'display:none would unfocus it');
  assert.ok(!/visibility: hidden/.test(block), 'visibility:hidden would unfocus it');
  // 22px track stretched to a 44px activation target (Apple HIG minimum).
  assert.match(block, /top: -11px;/);
  assert.match(block, /bottom: -11px;/);
});

test('reduced motion stops the slide without stopping the state change', () => {
  // Both authorities: the OS media query and the applied class (WS-14).
  assert.match(
    STYLES,
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.candice-switch-knob,?[\s\S]*?transition: none;/,
    'the media query must cover the switch',
  );
  assert.match(
    STYLES, /html\.candice-reduced-motion \.candice-switch-knob \{[\s\S]*?transition: none;/,
    'the applied class must cover it too',
  );
  // What must NOT happen: the transform itself being removed. Reduced motion
  // takes away the animation, never the information — the knob still ends up
  // on the right, it just arrives instead of sliding.
  assert.ok(
    !/candice-reduced-motion[^{]*\{[^}]*transform: none/.test(STYLES),
    'reduced motion must not cancel the knob position',
  );
});
