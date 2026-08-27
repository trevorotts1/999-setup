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
  #textContent = '';
  /**
   * Assigning textContent REPLACES all children in a real DOM. The plain
   * field this used to be kept them, so a stale <span> from a previous
   * sentence highlight survived in the fake tree and no test could see the
   * difference between "cleared" and "cleared but still full of children".
   * A fake DOM that is more forgiving than the real one hides exactly the
   * bugs it is there to catch.
   */
  get textContent(): string { return this.#textContent; }
  set textContent(value: string) {
    this.#textContent = value;
    for (const child of this.children) child.parent = null;
    this.children.length = 0;
  }
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
  assert.equal(CAPTIONS_MAX_CHARS, 20000);
  assert.deepEqual([...CAPTIONS_TEXT_SCALES], ['small', 'medium', 'large']);
  assert.equal(CAPTIONS_STYLE_ID, 'candice-captions-style');
});

test('clipCaption: bounded display copy, never mutates the source string', () => {
  const long = 'a'.repeat(CAPTIONS_MAX_CHARS + 100);
  const clipped = clipCaption(long);
  assert.ok(clipped.length <= CAPTIONS_MAX_CHARS);
  assert.ok(clipped.endsWith('…'));
  const short = 'Hello';
  assert.equal(clipCaption(short), short);
  // The regression that started this: a real question must arrive WHOLE.
  // 765 is the longest `spoken` text in the shipped registry (ENTRY_MODE).
  const realQuestion = 'q'.repeat(765);
  assert.equal(clipCaption(realQuestion), realQuestion,
    'a real registry question must never be truncated for display');
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

  // The DOM check above is not enough on its own. Clearing used to wipe the
  // element but keep the highlight state, so the next setSpokenProgress(null)
  // -- which the highlight driver emits on every speech drain -- took the
  // "restore plain text" branch and wrote the answered question back into an
  // aria-live region. Invisible (the empty class is opacity 0) and still
  // re-announced by a screen reader.
  view.setSpokenProgress(0.5);
  view.setSpokenProgress(null);
  assert.equal(
    captionTextOf(mount),
    'Candice',
    'a cleared caption must stay cleared through a speech-progress tick',
  );
});

test('createCaptionsView: highlight state does not leak from one question to the next', () => {
  const { doc, mount } = fakeEnv();
  const view = createCaptionsView(mount as unknown as HTMLElement, doc as unknown as Document);
  view.show({ text: 'First question. Second sentence.', important: true, seq: 1 });
  view.setSpokenProgress(0.9);
  view.show({ text: 'A different question.', important: true, seq: 2 });
  view.setSpokenProgress(null);
  const shown = captionTextOf(mount);
  assert.ok(shown.includes('A different question.'), 'the new question is shown');
  assert.ok(!shown.includes('First question.'), 'the previous question did not come back');
});

test('FIX-014 I-13: initialCaption shows at creation, important (never faded), before any machine effect', () => {
  const machine = createCandiceStateMachine();
  const { doc, mount } = fakeEnv();
  // Kept in step with SETUP_CHECK_GREETING in src/runtime/composition.ts.
  // This is a copy, not an import: the captions lane must not depend on the
  // runtime composition. It is a fixture for "a real greeting renders at
  // creation", so if the product greeting changes, update the copy here too
  // rather than leaving two versions of Candice's voice in the repo.
  const greeting =
    "Hi, I'm Candice. Think of me as your fairy godmother for building things: you make a wish, I help make it real. Setting things up now.";
  const ctrl = createCaptionsController({
    machine,
    mount: mount as unknown as HTMLElement,
    doc: doc as unknown as Document,
    initialCaption: greeting,
  });
  const root = mount.children[0];
  assert.ok(captionTextOf(mount).includes('fairy godmother'), 'welcome visible at creation');
  assert.ok(!root?.classes.contains('candice-captions-stale'), 'greeting is important, never faded');
  assert.ok(!root?.classes.contains('candice-captions-empty'), 'greeting clears the empty state');
  // A later machine caption replaces the greeting.
  machine.transition({ type: 'session:begin' });
  machine.transition({ type: 'question:received', question: 'What is your name?' });
  ctrl.render();
  assert.ok(captionTextOf(mount).includes('What is your name?'), 'machine caption replaces greeting');
});

test('FIX-014 I-13: null/empty initialCaption shows nothing until the first machine effect', () => {
  const machine = createCandiceStateMachine();
  const { doc, mount } = fakeEnv();
  const ctrl = createCaptionsController({
    machine,
    mount: mount as unknown as HTMLElement,
    doc: doc as unknown as Document,
    initialCaption: null,
  });
  const root = mount.children[0];
  assert.ok(root?.classes.contains('candice-captions-empty'), 'no initial caption: empty state');
  machine.transition({ type: 'session:begin' });
  machine.transition({ type: 'question:received', question: 'Later?' });
  ctrl.render();
  assert.ok(captionTextOf(mount).includes('Later?'), 'first machine caption still renders');
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

test('captions style text: token-only colors, no baked literals (WS-07 transparent invariant, spec 11)', () => {
  // The invariant this protects is "bake nothing": no literal colors, no
  // images, every color from the shared token set, so the window stays the
  // transparent holographic surface the design depends on. Those checks are
  // unchanged.
  //
  // The blanket `no background` clause was NARROWED for FIX-008. It was
  // copied from the character-surface invariant (gesture.test.ts, where it
  // still holds absolutely and is untouched), but the captions region is
  // TEXT, not artwork. The window is `transparent: true` and alwaysOnTop, so
  // a caption with no backdrop renders onto the user's desktop: the operator
  // reported reading his terminal scrollback straight through the governed
  // question. A token-based opaque scrim behind the text is now required —
  // the transparency that matters, around the character, is unaffected.
  assert.doesNotMatch(CAPTIONS_STYLE_TEXT, /#(?:[0-9a-fA-F]{3,8})/, 'no hex colors');
  assert.doesNotMatch(CAPTIONS_STYLE_TEXT, /rgba?\(/i, 'no rgb/rgba colors');
  assert.doesNotMatch(CAPTIONS_STYLE_TEXT, /url\(/i, 'no background images');
  const backgrounds = CAPTIONS_STYLE_TEXT.split('\n')
    .map((line) => line.trim())
    .filter((line) => /^background(-color)?\s*:/.test(line));
  assert.ok(backgrounds.length > 0, 'FIX-008: the caption text must paint an opaque backdrop');
  for (const declaration of backgrounds) {
    assert.match(
      declaration,
      /^background(-color)?\s*:\s*var\(--candice-[a-z-]+\)\s*;?$/,
      `background must come from a shared token, never a baked value: ${declaration}`,
    );
  }
  assert.ok(CAPTIONS_STYLE_TEXT.includes('candice-reduced-motion'), 'consumes the shared reduced-motion class');
});

// ------------------------------- the live region must never latch OFF

/**
 * Sentence highlighting sets `aria-live: off` so the caption is not
 * re-announced once per sentence over the speech it accompanies. The only
 * code that turned it back on was `setSpokenProgress(null)` -- which
 * returns early when `highlighted === -1`, and a freshly rendered caption
 * sets exactly that.
 *
 * So one interrupted utterance latched the region off for the rest of the
 * session, and every later caption -- including every later QUESTION --
 * mutated a dead live region. There was no visible symptom, because
 * sighted users could still read it. A screen-reader user simply stopped
 * being told anything.
 */
test('a new caption re-arms the live region even if highlighting left it off', () => {
  const { doc, mount } = fakeEnv();
  const view = createCaptionsView(mount as unknown as HTMLElement, doc as unknown as Document);
  const root = view.el as unknown as FakeElement | null;
  assert.ok(root !== null);

  view.show({ text: 'First question. Second sentence.', important: true, seq: 1 });
  // Highlighting begins: the region goes quiet on purpose.
  view.setSpokenProgress(0.1);
  assert.equal(root?.getAttribute('aria-live'), 'off', 'highlighting silences it, by design');

  // The utterance is interrupted and a NEW caption arrives.
  view.show({ text: 'A different question.', important: true, seq: 2 });
  assert.equal(
    root?.getAttribute('aria-live'),
    CAPTIONS_LIVE,
    'the new caption must be announceable, or a screen reader never hears it',
  );

  // The old drain still arrives afterwards and must not undo that.
  view.setSpokenProgress(null);
  assert.equal(root?.getAttribute('aria-live'), CAPTIONS_LIVE, 'a late drain leaves it live');
});

test('clearing the caption also leaves the region live for whatever comes next', () => {
  const { doc, mount } = fakeEnv();
  const view = createCaptionsView(mount as unknown as HTMLElement, doc as unknown as Document);
  const root = view.el as unknown as FakeElement | null;
  view.show({ text: 'A question. And more.', important: true, seq: 1 });
  view.setSpokenProgress(0.1);
  assert.equal(root?.getAttribute('aria-live'), 'off');
  view.show({ text: '', important: true, seq: 2 }); // clear
  assert.equal(root?.getAttribute('aria-live'), CAPTIONS_LIVE, 'cleared, not muted');
});

test('CONTROL: highlighting really does set it off, so the tests above are not vacuous', () => {
  // If `setSpokenProgress` never touched aria-live, every assertion above
  // would pass trivially against a region that is always polite.
  const { doc, mount } = fakeEnv();
  const view = createCaptionsView(mount as unknown as HTMLElement, doc as unknown as Document);
  const root = view.el as unknown as FakeElement | null;
  assert.equal(root?.getAttribute('aria-live'), CAPTIONS_LIVE, 'starts live');
  view.show({ text: 'One sentence. Two sentences.', important: true, seq: 1 });
  view.setSpokenProgress(0.1);
  assert.equal(root?.getAttribute('aria-live'), 'off', 'the off state is real');
});
