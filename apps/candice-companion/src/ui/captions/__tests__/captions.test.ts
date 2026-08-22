/**
 * WS-14 acceptance tests (CHECKLIST E.1 WS-14) — the captions half.
 *
 *   PASS: captions always shown regardless of voice state; OS
 *         reduced-motion setting is respected.
 *
 * Runnable with zero deps on Node >= 22.6 (node:test + TS type-stripping),
 * following the lane convention established by WS-07/WS-12/WS-13/WS-40:
 *
 *   node --test apps/candice-companion/src/ui/captions/__tests__/captions.test.ts
 *
 * The reduced-motion half of WS-14 lives in
 * `src/a11y/__tests__/a11y.test.ts`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CAPTIONS_CONTRACT_VERSION,
  CAPTIONS_LIVE,
  CAPTIONS_MAX_CHARS,
  CAPTIONS_ROLE,
  CAPTIONS_ROOT_CLASS,
  CAPTIONS_STYLE_ID,
  CAPTIONS_TEXT_SCALES,
} from "../config.ts";
import {
  captionFromEffect,
  clipCaption,
  createCaptionsModel,
  isEmptyCaption,
} from "../model.ts";
import { createCaptionsController } from "../controller.ts";
import { createCaptionsView, CAPTIONS_STYLE_TEXT } from "../view.ts";
import { createCandiceStateMachine } from "../../../state/machine.ts";
import type { CandiceStateMachine } from "../../../state/machine.ts";

// ------------------------------------------------------------ tiny fake DOM

class FakeClassList {
  private set = new Set<string>();
  add(...names: string[]): void { for (const n of names) this.set.add(n); }
  remove(...names: string[]): void { for (const n of names) this.set.delete(n); }
  toggle(name: string, force?: boolean): boolean {
    const on = force === undefined ? !this.set.has(name) : force;
    if (on) this.set.add(name);
    else this.set.delete(name);
    return on;
  }
  contains(name: string): boolean { return this.set.has(name); }
  list(): string[] { return [...this.set]; }
}

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly classes = new FakeClassList();
  readonly children: FakeElement[] = [];
  parent: FakeElement | null = null;
  textContent = '';
  id = '';
  hidden = false;
  readonly tagName: string;
  readonly style: Record<string, string> = {};

  constructor(tagName: string) {
    this.tagName = tagName;
  }
  get classList(): FakeClassList { return this.classes; }
  set className(value: string) {
    this.classes.remove(...this.classes.list());
    for (const token of value.split(/\s+/)) if (token) this.classes.add(token);
  }
  get className(): string { return this.classes.list().join(' '); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  append(...children: FakeElement[]): void {
    for (const c of children) { c.parent = this; this.children.push(c); }
  }
  appendChild(child: FakeElement): FakeElement { this.append(child); return child; }
  replaceChildren(...children: FakeElement[]): void {
    this.children.length = 0;
    for (const c of children) { c.parent = this; this.children.push(c); }
  }
  remove(): void {
    if (this.parent === null) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
}

class FakeDocument {
  readonly head = new FakeElement('head');
  readonly documentElement = new FakeElement('html');
  createElement(tag: string): FakeElement { return new FakeElement(tag); }
  getElementById(id: string): FakeElement | null {
    return this.head.children.find((c) => c.id === id) ?? null;
  }
}

function fakeEnv(): { doc: FakeDocument; mount: FakeElement } {
  const doc = new FakeDocument();
  const mount = new FakeElement('div');
  return { doc, mount };
}

function captionTextOf(root: FakeElement): string {
  const parts: string[] = [];
  const walk = (el: FakeElement): void => {
    if (el.textContent.length > 0) parts.push(el.textContent);
    for (const c of el.children) walk(c);
  };
  walk(root);
  return parts.join('|');
}

// ------------------------------------------------------------ pure model

test('E.1 WS-14: contract constants are the published values', () => {
  assert.equal(CAPTIONS_CONTRACT_VERSION, 1);
  assert.equal(CAPTIONS_ROOT_CLASS, 'candice-captions');
  assert.equal(CAPTIONS_ROLE, 'status');
  assert.equal(CAPTIONS_LIVE, 'polite');
  assert.equal(CAPTIONS_MAX_CHARS, 500);
  assert.deepEqual([...CAPTIONS_TEXT_SCALES], ['small', 'medium', 'large']);
  assert.equal(CAPTIONS_STYLE_ID, 'candice-captions-style');
});

test('clipCaption: bounded display copy, never mutates the source string', () => {
  const long = 'a'.repeat(600);
  const clipped = clipCaption(long);
  assert.ok(clipped.length <= CAPTIONS_MAX_CHARS);
  assert.ok(clipped.endsWith('…'));
  const short = 'Hello';
  assert.equal(clipCaption(short), short);
});

test('captionFromEffect + isEmptyCaption: null/empty is the clear signal', () => {
  assert.ok(isEmptyCaption(null));
  assert.ok(isEmptyCaption(captionFromEffect(null, 0)));
  assert.ok(isEmptyCaption(captionFromEffect('', 0)));
  assert.ok(!isEmptyCaption(captionFromEffect('Hi', 0)));
});

test('createCaptionsModel: monotonic seq, shownCount, last-entry state', () => {
  const model = createCaptionsModel();
  model.push(captionFromEffect('one', 0));
  model.push(captionFromEffect('two', 0));
  assert.equal(model.state.shownCount, 2);
  assert.equal(model.state.current?.text, 'two');
  assert.ok((model.state.current?.seq ?? 0) !== 0);
});

// ------------------------------------------------------------- view + E.1

test('E.1 WS-14: captions always shown regardless of voice state (spec 5.2)', () => {
  const machine = createCandiceStateMachine();
  machine.transition({ type: 'session:begin' });
  const { doc, mount } = fakeEnv();
  const ctrl = createCaptionsController({
    machine,
    mount: mount as unknown as HTMLElement,
    doc: doc as unknown as Document,
  });

  // Question arrives with voice responses ON (default).
  machine.transition({ type: 'question:received', question: 'What is your name?' });
  ctrl.render();
  const on = captionTextOf(mount);
  assert.ok(on.includes('What is your name?'), `caption shown with voice ON: ${on}`);

  // Mute: voiceOutputEnabled=false is a SEPARATE toggle (spec 5.2); the
  // caption still shows. This lane never consults the voice toggle.
  const muted = createCandiceStateMachine({ ...machine.getState(), voiceEnabled: false });
  const ctrl2 = createCaptionsController({
    machine: muted,
    mount: mount as unknown as HTMLElement,
    doc: doc as unknown as Document,
  });
  muted.transition({ type: 'question:received', question: 'A second question?' });
  ctrl2.render();
  const off = captionTextOf(mount);
  assert.ok(off.includes('A second question?'), `caption shown with voice OFF: ${off}`);
});

test('E.1 WS-14: listening label + text-fallback caption render verbatim (machine-truth)', () => {
  const machine = createCandiceStateMachine();
  machine.transition({ type: 'session:begin' });
  const { doc, mount } = fakeEnv();
  const ctrl = createCaptionsController({
    machine,
    mount: mount as unknown as HTMLElement,
    doc: doc as unknown as Document,
  });
  // ptt:start emits mic:open with the exact spec-6 listening label.
  machine.transition({ type: 'ptt:start' });
  ctrl.render();
  assert.ok(captionTextOf(mount).includes('LISTENING - LET GO WHEN FINISHED'));
  // The machine emits no caption for ptt:stop; the label stays (faded),
  // never blanks (spec 5.2).
  machine.transition({ type: 'ptt:stop' });
  ctrl.render();
  assert.ok(captionTextOf(mount).includes('LISTENING - LET GO WHEN FINISHED'));
  // Answer-in-Claude path pushes an explicit captions:show with the
  // exact spec-5.1 label.
  machine.transition({ type: 'answer:delegate-to-claude' });
  ctrl.render();
  assert.ok(captionTextOf(mount).includes('Answer in Claude instead'));
});

test('E.1 WS-14: a transition without a caption effect fades, never blanks (spec 5.2)', () => {
  const machine = createCandiceStateMachine();
  const { doc, mount } = fakeEnv();
  const ctrl = createCaptionsController({
    machine,
    mount: mount as unknown as HTMLElement,
    doc: doc as unknown as Document,
  });
  machine.transition({ type: 'session:begin' });
  ctrl.render();
  machine.transition({ type: 'question:received', question: 'Sticky?' });
  ctrl.render();
  assert.ok(captionTextOf(mount).includes('Sticky?'));
  // answer:confirmed carries no captions:show; the caption must remain.
  machine.transition({ type: 'answer:confirmed', transcript: 'yes' });
  ctrl.render();
  const after = captionTextOf(mount);
  assert.ok(after.includes('Sticky?'), `caption retained after non-caption transition: ${after}`);
});

test('createCaptionsView: role/aria-live live region, textContent only, scale switching, no-op on null mount', () => {
  const { doc, mount } = fakeEnv();
  const view = createCaptionsView(mount as unknown as HTMLElement, doc as unknown as Document);
  const root = view.el as unknown as FakeElement | null;
  assert.ok(root !== null);
  assert.equal(root?.getAttribute('role'), CAPTIONS_ROLE);
  assert.equal(root?.getAttribute('aria-live'), CAPTIONS_LIVE);
  assert.ok(root?.classes.contains(CAPTIONS_ROOT_CLASS));
  view.show({ text: 'Hello', important: true, seq: 1 });
  assert.ok(captionTextOf(mount).includes('Hello'));
  view.setTextScale('large');
  const textEl = root?.children.find((c) => c.classList.contains('candice-captions-text'));
  assert.equal(textEl?.style.fontSize, '17px');
  view.destroy();
  assert.equal(root?.parent, null, 'detached on destroy');

  const nop = createCaptionsView(null, doc as unknown as Document);
  assert.equal(nop.el, null);
  assert.doesNotThrow(() => nop.show({ text: 'x', important: false, seq: 1 }));
  assert.doesNotThrow(() => nop.setTextScale('small'));
  assert.doesNotThrow(() => nop.sync(''));
  assert.doesNotThrow(() => nop.fade());
  assert.doesNotThrow(() => nop.destroy());
});

test('createCaptionsView: empty caption clears to the reset state, never stale text', () => {
  const { doc, mount } = fakeEnv();
  const view = createCaptionsView(mount as unknown as HTMLElement, doc as unknown as Document);
  view.show({ text: 'Old text', important: true, seq: 1 });
  assert.ok(captionTextOf(mount).includes('Old text'));
  view.show({ text: '', important: false, seq: 2 });
  assert.equal(captionTextOf(mount), 'Candice', 'cleared: only the static label remains');
});

test('captions controller: machine null / mount null never throw (spec 20)', () => {
  const { doc, mount } = fakeEnv();
  const ctrl = createCaptionsController({
    machine: null,
    mount: mount as unknown as HTMLElement,
    doc: doc as unknown as Document,
  });
  assert.doesNotThrow(() => ctrl.handle({ type: 'status', detail: 'idle' }));
  assert.doesNotThrow(() => ctrl.render());
  assert.doesNotThrow(() => ctrl.setTextScale('large'));
  assert.doesNotThrow(() => ctrl.destroy());

  const ctrl2 = createCaptionsController({ machine: createCandiceStateMachine(), mount: null, doc: null });
  assert.doesNotThrow(() => ctrl2.handle({ type: 'status', detail: 'idle' }));
  assert.doesNotThrow(() => ctrl2.destroy());
});

test('captions style text: no hex/rgba/url/background (WS-07 transparent invariant, spec 11)', () => {
  assert.doesNotMatch(CAPTIONS_STYLE_TEXT, /#(?:[0-9a-fA-F]{3,8})/, 'no hex colors');
  assert.doesNotMatch(CAPTIONS_STYLE_TEXT, /rgba?\(/i, 'no rgb/rgba colors');
  assert.doesNotMatch(CAPTIONS_STYLE_TEXT, /url\(/i, 'no background images');
  assert.doesNotMatch(CAPTIONS_STYLE_TEXT, /background/i, 'no background declarations');
  assert.ok(CAPTIONS_STYLE_TEXT.includes('candice-reduced-motion'), 'consumes the shared reduced-motion class');
});
