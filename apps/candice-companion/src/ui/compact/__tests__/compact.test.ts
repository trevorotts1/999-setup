/**
 * WS-10 acceptance tests (CHECKLIST E.1 WS-10, spec 10 / 16 / 19 / 13.3).
 *
 *   PASS: compact companion remains after the interview, accepts voice and
 *   typed questions, can submit `/bro` and `/eli5`, and expands on click.
 *
 * Runnable with zero deps on Node >= 22.6 (node:test + TS type-stripping),
 * following the lane convention established by WS-07/WS-08/WS-13:
 *
 *   node --test apps/candice-companion/src/ui/compact/__tests__/compact.test.ts
 *
 * The suite proves: (1) the E.1 surface exists and stays after the
 * post-interview transition (spec 16), (2) the view accepts typed and
 * voice input and can submit slash commands, (3) expansion is a one-shot
 * class toggle (spec 16 "expands on click") and drops under reduced
 * motion, (4) the queue holds only user explicit input and drains FIFO at
 * a safe input point (spec 13.3), (5) the interface carries no invented
 * progress — no percentage field exists anywhere, (6) the style contract
 * has no hex/rgba/background declarations and no loop animation, (7) null
 * DOM degrades without throwing (spec 20).
 */

import { setHarnessName, resetHarnessNameForTest } from '../../../harness/name.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  busyHintText,
  COMPACT_CONTRACT_VERSION,
  COMPACT_EXPANDED_CLASS,
  COMPACT_PROGRESS_STATUSES,
  COMPACT_ROOT_CLASS,
  COMPACT_STATUS_ATTR,
  COMPACT_VISUAL_MODES,
  COMPACT_STYLE_TEXT,
  CompactSubmitQueue,
  compactStatusView,
  createCompactController,
  createCompactView,
  submissionMustWait,
} from '../index.ts';
import '../index.ts';
import { createCandiceStateMachine } from '../../../state/machine.ts';
import { ANSWER_CONTROLS_LABELS } from '../../answer-controls/config.ts';
import type { CandiceStateMachine } from '../../../state/machine.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The compact lane is never mounted, so a DOM test cannot reach these
// behaviours. Read the module text instead -- the same approach
// proc.rs::spawn_sites_all_use_the_helper takes for a rule that has to
// hold in code nobody currently executes.
const COMPACT_VIEW_SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'view.ts'),
  'utf8',
);

// -------------------------------------------------------------- tiny fake DOM

class FakeClassList {
  private set = new Set<string>();
  get value(): string { return [...this.set].join(' '); }
  replaceAll(names: string[]): void { this.set = new Set(names); }
  add(...names: string[]): void { for (const n of names) this.set.add(n); }
  remove(...names: string[]): void { for (const n of names) this.set.delete(n); }
  toggle(name: string, force?: boolean): boolean {
    const on = force === undefined ? !this.set.has(name) : force;
    if (on) this.set.add(name);
    else this.set.delete(name);
    return on;
  }
  contains(name: string): boolean { return this.set.has(name); }
}

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly classes = new FakeClassList();
  readonly children: FakeElement[] = [];
  readonly handlers = new Map<string, (e: unknown) => void>();
  readonly style: Record<string, string> = {};
  parent: FakeElement | null = null;
  textContent = '';
  hidden = false;
  value = '';
  placeholder = '';
  type = '';
  readonly id = '';
  readonly tagName: string;

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  get classList(): FakeClassList { return this.classes; }

  /**
   * The real DOM keeps `className` and `classList` as two views of one
   * value. This double did not model `className` AT ALL, so every class
   * the view assigns that way -- which is most of them -- vanished, and
   * any assertion about them silently found nothing. Wiring the two
   * together is what makes a class-based query in a test mean anything.
   */
  get className(): string { return this.classes.value; }
  set className(value: string) {
    this.classes.replaceAll(value.split(/\s+/).filter((n) => n.length > 0));
  }

  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string): void { this.attributes.delete(name); }
  append(...children: FakeElement[]): void {
    for (const c of children) { c.parent = this; this.children.push(c); }
  }
  replaceChildren(...children: FakeElement[]): void {
    this.children.length = 0;
    this.append(...children);
  }
  appendChild(child: FakeElement): FakeElement { this.append(child); return child; }
  remove(): void {
    if (this.parent === null) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  addEventListener(type: string, fn: (e: unknown) => void): void { this.handlers.set(type, fn); }
  dispatch(type: string, e: unknown = {}): void { this.handlers.get(type)?.(e); }
  closest(selector: string): FakeElement | null {
    if (selector === 'button, input, .candice-compact-surface') {
      if (this.tagName === 'button' || this.tagName === 'input') return this;
      return this.classes.contains('candice-compact-surface') ? this : null;
    }
    return this;
  }
  contains(other: FakeElement): boolean {
    let cur: FakeElement | null = other;
    while (cur !== null) {
      if (cur === this) return true;
      cur = cur.parent;
    }
    return false;
  }
}

class FakeDocument {
  readonly head = new FakeElement('head');
  readonly documentElement = new FakeElement('html');
  createElement(tag: string): FakeElement {
    return new FakeElement(tag);
  }
  getElementById(id: string): FakeElement | null {
    const found = this.head.children.find((c) => c.id === id);
    return found ?? null;
  }
}

function fakeEnv(): { doc: FakeDocument; mount: FakeElement } {
  const doc = new FakeDocument();
  const mount = new FakeElement('div');
  return { doc, mount };
}

/** Depth-first finder over the fake tree (tests drive real DOM events). */
function findByTag(root: FakeElement, tag: string): FakeElement | null {
  if (root.tagName === tag) return root;
  for (const child of root.children) {
    const hit = findByTag(child, tag);
    if (hit !== null) return hit;
  }
  return null;
}

function findByClass(root: FakeElement, cls: string): FakeElement | null {
  if (root.classes.contains(cls)) return root;
  for (const child of root.children) {
    const hit = findByClass(child, cls);
    if (hit !== null) return hit;
  }
  return null;
}

function findByText(root: FakeElement, text: string): FakeElement | null {
  if (root.textContent === text) return root;
  for (const child of root.children) {
    const hit = findByText(child, text);
    if (hit !== null) return hit;
  }
  return null;
}

function makeMachine(): CandiceStateMachine {
  return createCandiceStateMachine();
}

function postInterview(machine: CandiceStateMachine, ctrl: { handle(e: { type: string; detail?: string }): void }): void {
  ctrl.handle({ type: 'status', detail: 'building' });
  assert.equal(machine.getState().phase, 'post-interview');
  ctrl.handle({ type: 'compact:enter' });
  assert.equal(machine.getState().status, 'compact');
}

// ------------------------------------------------------------- E.1 surface

test('E.1 WS-10: compact surface remains after the interview (spec 16)', () => {
  const machine = makeMachine();
  const { doc, mount } = fakeEnv();
  const ctrl = createCompactController({ machine, mount: mount as unknown as HTMLElement, transport: null, doc: doc as unknown as Document });
  postInterview(machine, ctrl);
  assert.equal(ctrl.pending().length, 0, 'no invented pending state');
  assert.equal(ctrl.isExpanded(), false, 'present but collapsed initially');
  ctrl.destroy();
});

test('E.1 WS-10: real status shows the spec 16 line after the interview', () => {
  const machine = makeMachine();
  const { doc, mount } = fakeEnv();
  const ctrl = createCompactController({ machine, mount: mount as unknown as HTMLElement, transport: null, doc: doc as unknown as Document });
  ctrl.handle({ type: 'status', detail: 'complete' });
  const view = compactStatusView(machine.getState().status);
  assert.equal(view.family, 'progress');
  assert.equal(view.label, 'Complete');
  ctrl.destroy();
});

test('E.1 WS-10: labels match the spec 16 vocabulary, no invented percentages', () => {
  const surface = JSON.stringify(COMPACT_PROGRESS_STATUSES);
  assert.doesNotMatch(surface, /%|percent|progressbar?|estimated|eta/i, 'no progress metric');
  assert.equal(compactStatusView('building').label, 'Building');
  assert.equal(compactStatusView('quality-checking').label, 'Quality checking');
  assert.equal(compactStatusView('fixing').label, 'Fixing');
  assert.equal(compactStatusView('waiting-for-user').label, 'Waiting for you');
  assert.equal(compactStatusView('complete').label, 'Complete');
  assert.equal(compactStatusView('recovering').label, 'Recovering');
});

// -------------------------------------------------------- input + expansion

test('E.1 WS-10: typed submit — Enter on the input sends the slash command verbatim', () => {
  const machine = makeMachine();
  const { doc, mount } = fakeEnv();
  const submitted: string[] = [];
  const ctrl = createCompactController({
    machine,
    mount: mount as unknown as HTMLElement,
    transport: { submit: (e) => submitted.push(e.text) },
    doc: doc as unknown as Document,
  });
  postInterview(machine, ctrl);
  ctrl.handle({ type: 'status', detail: 'complete' }); // safe input point
  // The controller's view is attached to the mount; drive its real input.
  const input = findByTag(mount, 'input');
  assert.ok(input !== null, 'input surface exists');
  input.value = '/eli5';
  input.dispatch('keydown', { key: 'Enter' });
  assert.deepEqual(submitted, ['/eli5'], 'slash command submitted verbatim');
  assert.equal(input.value, '', 'input cleared after send');
  ctrl.destroy();
});

test('E.1 WS-10: voice path — ptt maps to real machine listening/transcribing', () => {
  const machine = makeMachine();
  const { doc, mount } = fakeEnv();
  const ctrl = createCompactController({ machine, mount: mount as unknown as HTMLElement, transport: null, doc: doc as unknown as Document });
  postInterview(machine, ctrl);
  ctrl.handle({ type: 'ptt:start' });
  assert.equal(machine.getState().status, 'listening', 'hold starts capture');
  ctrl.handle({ type: 'ptt:stop' });
  assert.equal(machine.getState().status, 'transcribing', 'release stops capture');
  ctrl.destroy();
});

test('E.1 WS-10: expands on click — one-shot surface toggle, machine untouched', () => {
  const machine = makeMachine();
  const { doc, mount } = fakeEnv();
  const ctrl = createCompactController({ machine, mount: mount as unknown as HTMLElement, transport: null, doc: doc as unknown as Document });
  postInterview(machine, ctrl);
  const statusBefore = machine.getState().status;
  // Pure surface click toggle through the view.
  const view = createCompactView(mount as unknown as HTMLElement, {
    onTalkToggle: () => undefined,
    onSubmit: () => undefined,
    onExpandToggle: () => view.setExpanded(true),
    onMuteToggle: () => undefined,
    onReturnToClaude: () => undefined,
  }, doc as unknown as Document);
  view.setExpanded(true);
  assert.equal(view.isExpanded(), true, 'expanded');
  view.setExpanded(false);
  assert.equal(view.isExpanded(), false, 'collapsed');
  assert.equal(machine.getState().status, statusBefore, 'machine state unchanged by UI toggle');
});

test('E.1 WS-10: visual modes are bubble/surface only; contract stable', () => {
  assert.equal(COMPACT_CONTRACT_VERSION, 1);
  assert.deepEqual([...COMPACT_VISUAL_MODES].sort(), ['bubble', 'surface']);
});

// ------------------------------------------------------------- style contract

test('E.1 + spec 11/19: style contract has no baked colors/backgrounds, no loops', () => {
  // NARROWED for FIX-008, exactly as captions.test.ts was, and for the
  // same reason. The blanket "no background" clause came from the
  // CHARACTER-surface invariant, where it still holds absolutely. But this
  // lane is TEXT. The window is `transparent: true` and alwaysOnTop, so
  // text with no backdrop renders onto the user's desktop -- the operator
  // reported reading his terminal scrollback straight through a governed
  // question. Every shipping lane (captions, answer-controls, PTT,
  // animation-toggle) paints a token scrim; this lane predates the change
  // and was the only one left enforcing the old rule against itself.
  //
  // The transparency that the design actually depends on, around the
  // character, is untouched.
  assert.doesNotMatch(COMPACT_STYLE_TEXT, /#(?:[0-9a-fA-F]{3,8})/, 'no hex colors');
  assert.doesNotMatch(COMPACT_STYLE_TEXT, /rgba?\(/i, 'no rgb/rgba colors');
  assert.doesNotMatch(COMPACT_STYLE_TEXT, /url\(/i, 'no background images');
  const backgrounds = COMPACT_STYLE_TEXT.split('\n')
    .map((line) => line.trim())
    .filter((line) => /^background(-color)?\s*:/.test(line));
  assert.ok(backgrounds.length > 0, 'FIX-008: compact text must paint an opaque backdrop');
  for (const declaration of backgrounds) {
    assert.match(
      declaration,
      /^background(-color)?\s*:\s*(var\(--candice-[a-z-]+\)|transparent)\s*;?$/,
      `background must come from a shared token, never a baked value: ${declaration}`,
    );
  }
  assert.doesNotMatch(COMPACT_STYLE_TEXT, /@keyframes/, 'no keyframe loops');
  assert.doesNotMatch(COMPACT_STYLE_TEXT, /animation:/, 'no animation property');
});

test('spec 19: reduced motion drops the one-shot expand transition', () => {
  assert.ok(COMPACT_STYLE_TEXT.includes('candice-reduced-motion'), 'guarded by reduced-motion class');
  assert.ok(COMPACT_STYLE_TEXT.includes('transition: opacity 180ms ease'), 'one-shot opacity fade');
});

// --------------------------------------------------------------- queue (13.3)

test('spec 13.3: queue holds only explicit user input, FIFO order', () => {
  const q = new CompactSubmitQueue();
  assert.equal(q.size, 0);
  q.enqueue({ text: '/bro', inputMode: 'typed' });
  q.enqueue({ text: 'hello', inputMode: 'voice' });
  assert.equal(q.size, 2);
  assert.equal(q.peek()?.text, '/bro', 'oldest first');
  assert.equal(q.drain()?.text, '/bro');
  assert.equal(q.drain()?.text, 'hello');
  assert.equal(q.drain(), null, 'empty drain returns null, never throws');
  assert.equal(q.size, 0);
});

test('spec 13.3: busy gate matches the spec busy statuses', () => {
  assert.equal(submissionMustWait('speaking'), true);
  assert.equal(submissionMustWait('transcribing'), true);
  assert.equal(submissionMustWait('thinking'), true);
  assert.equal(submissionMustWait('building'), true);
  assert.equal(submissionMustWait('complete'), false, 'complete is a safe input point');
  assert.equal(submissionMustWait('idle'), false);
  assert.equal(submissionMustWait('waiting-for-user'), false);
});

test('spec 13.3: entries wait while busy then drain at the safe point', () => {
  const machine = makeMachine();
  const { doc, mount } = fakeEnv();
  const submitted: string[] = [];
  const ctrl = createCompactController({
    machine,
    mount: mount as unknown as HTMLElement,
    transport: { submit: (e) => submitted.push(e.text) },
    doc: doc as unknown as Document,
  });
  postInterview(machine, ctrl);
  ctrl.handle({ type: 'status', detail: 'building' }); // busy
  assert.equal(submissionMustWait(machine.getState().status), true);
  // First user input while busy: queued, NOT submitted (never hidden, but held).
  const input = findByTag(mount, 'input');
  assert.ok(input !== null);
  input.value = '/bro';
  input.dispatch('keydown', { key: 'Enter' });
  assert.equal(submitted.length, 0, 'busy: submitted nowhere');
  assert.equal(ctrl.pending().length, 1, 'held visibly in the pending list');
  assert.equal(ctrl.pending()[0].text, '/bro', 'user text preserved verbatim');
  // Release point: at the NEXT safe point the transport drains FIFO.
  ctrl.handle({ type: 'status', detail: 'waiting-for-user' });
  assert.equal(submissionMustWait(machine.getState().status), false);
  // A fresh submission at the safe point drains held + new in order.
  input.value = '/eli5';
  input.dispatch('keydown', { key: 'Enter' });
  assert.deepEqual(submitted, ['/bro', '/eli5'], 'FIFO drain at the safe point');
  assert.equal(ctrl.pending().length, 0);
  ctrl.destroy();
});

test('spec 13.3: offline hint text is the canonical string', () => {
  // Spec 13.3 verbatim, including the typographic apostrophes (U+2019).
  // Harness-aware now. With the plain harness the wording is unchanged;
  // under claude-nine it names that window instead of the wrong one.
  setHarnessName('Claude');
  assert.equal(busyHintText(), "Claude is working. I’ll send that as soon as it’s ready.");
  setHarnessName('Claude-Nine');
  assert.equal(busyHintText(), "Claude-Nine is working. I’ll send that as soon as it’s ready.");
  resetHarnessNameForTest();
  assert.equal(busyHintText(), "Your terminal is working. I’ll send that as soon as it’s ready.");
});

// ---------------------------------------------------------------- degrade

test('spec 13.3 + 20: no transport — held entries stay visible, never dropped', () => {
  const machine = makeMachine();
  const { doc, mount } = fakeEnv();
  const ctrl = createCompactController({ machine, mount: mount as unknown as HTMLElement, transport: null, doc: doc as unknown as Document });
  postInterview(machine, ctrl);
  // Busy point: the user's input is held, visibly.
  ctrl.handle({ type: 'status', detail: 'building' });
  const input = findByTag(mount, 'input');
  assert.ok(input !== null);
  input.value = '/bro';
  input.dispatch('keydown', { key: 'Enter' });
  assert.equal(ctrl.pending().length, 1, 'held visibly');
  // Safe point with NO transport adapter: the entry must stay queued and
  // visible — a missing adapter must never silently discard user input.
  ctrl.handle({ type: 'status', detail: 'complete' });
  assert.equal(ctrl.pending().length, 1, 'retained when transport is absent');
  assert.equal(ctrl.pending()[0].text, '/bro', 'text preserved verbatim');
  ctrl.destroy();
});

test('spec 13.3 + 16: spoken compact question queues the transcript, never dropped', () => {
  const machine = makeMachine();
  const { doc, mount } = fakeEnv();
  const submitted: string[] = [];
  const ctrl = createCompactController({
    machine,
    mount: mount as unknown as HTMLElement,
    transport: { submit: (e) => submitted.push(e.text) },
    doc: doc as unknown as Document,
  });
  postInterview(machine, ctrl);
  // Hold to talk, then the STT lane reports the transcript: the user's
  // explicit spoken text joins the visible FIFO.
  ctrl.handle({ type: 'ptt:start' });
  assert.equal(machine.getState().status, 'listening');
  ctrl.handle({ type: 'ptt:stop' });
  ctrl.handle({ type: 'speech:transcript', transcript: 'how many files?' });
  assert.equal(ctrl.pending().length, 1, 'transcript queued, visible');
  assert.equal(ctrl.pending()[0].inputMode, 'voice');
  assert.equal(ctrl.pending()[0].text, 'how many files?');
  // At the next safe input point the transport drains FIFO.
  ctrl.handle({ type: 'status', detail: 'complete' });
  assert.deepEqual(submitted, ['how many files?'], 'spoken question submitted at safe point');
  assert.equal(ctrl.pending().length, 0);
  ctrl.destroy();
});

test('spec 13.3 + 16 WS-10 defect: duplicate speech:transcript while confirming is NOT re-queued', () => {
  const machine = makeMachine();
  const { doc, mount } = fakeEnv();
  const submitted: string[] = [];
  const ctrl = createCompactController({
    machine,
    mount: mount as unknown as HTMLElement,
    transport: { submit: (e) => submitted.push(e.text) },
    doc: doc as unknown as Document,
  });
  postInterview(machine, ctrl);
  ctrl.handle({ type: 'ptt:start' });
  ctrl.handle({ type: 'ptt:stop' });
  ctrl.handle({ type: 'speech:transcript', transcript: 'how many files?' });
  assert.equal(machine.getState().status, 'confirming', 'machine is confirming');
  assert.equal(ctrl.pending().length, 1, 'single queue entry for the spoken question');
  // Same transcript arrives again while confirming (e.g. a second STT
  // emission or a replay of the recognition result). The machine ignores
  // it (status is neither listening nor transcribing), so the controller
  // must not queue it a second time — the question must be submitted
  // exactly once.
  ctrl.handle({ type: 'speech:transcript', transcript: 'how many files?' });
  assert.equal(
    machine.getState().status,
    'confirming',
    'duplicate left the machine confirming, transition was a no-op',
  );
  assert.equal(ctrl.pending().length, 1, 'duplicate transcript NOT re-queued');
  ctrl.handle({ type: 'status', detail: 'complete' });
  assert.deepEqual(submitted, ['how many files?'], 'exactly one submission');
  assert.equal(ctrl.pending().length, 0);
  ctrl.destroy();
});

test('spec 20: null mount and null doc degrade to no-op, never throw', () => {
  const machine = makeMachine();
  const ctrl = createCompactController({ machine, mount: null, transport: null, doc: null });
  assert.doesNotThrow(() => ctrl.handle({ type: 'status', detail: 'building' }));
  assert.doesNotThrow(() => ctrl.destroy());
});

test('no invented status: unknown statuses ignored by the machine, mirror intact', () => {
  const machine = makeMachine();
  const { doc, mount } = fakeEnv();
  const ctrl = createCompactController({ machine, mount: mount as unknown as HTMLElement, transport: null, doc: doc as unknown as Document });
  const before = machine.getState().status;
  ctrl.handle({ type: 'status', detail: 'definitely-not-a-status' as never });
  assert.equal(machine.getState().status, before, 'unknown status ignored');
  ctrl.destroy();
});

test('contract: root class and status attr are declared and distinct', () => {
  assert.equal(COMPACT_ROOT_CLASS, 'candice-compact');
  assert.equal(COMPACT_STATUS_ATTR, 'data-candice-compact-status');
  assert.equal(COMPACT_EXPANDED_CLASS, 'candice-compact-expanded');
});

// ------------------------------- the lane is unmounted, not exempt

/**
 * `CompactTransport` has no implementation anywhere in this product, so
 * this lane is deliberately never mounted. That is exactly why these
 * defects survived: nothing renders it, so nothing catches them.
 *
 * They are fixed and pinned here so that whenever a transport does exist,
 * mounting the lane does not ship a microphone that can stick open, a
 * mute button that lies, or a surface no keyboard user can open.
 */
test('hold-to-talk cannot strand the microphone open', () => {
  const source = COMPACT_VIEW_SOURCE;
  // pointercancel: the OS cancels a pointer mid-hold for its own reasons.
  // Unhandled, `talkHeld` stayed true and no release ever came.
  assert.match(source, /pointercancel/, 'a cancelled pointer must release the mic');
  assert.match(source, /lostpointercapture/, 'losing capture must release the mic');
  assert.match(source, /setPointerCapture/, 'release outside the button must still reach it');
  assert.match(source, /'blur'/, 'focus lost mid-hold must release the mic');
});

test('hold-to-talk works from the keyboard at all', () => {
  // Space and Enter on a <button> fire `click`, never `pointerdown`. With
  // only pointer handlers a keyboard-only user could not speak.
  assert.match(COMPACT_VIEW_SOURCE, /addEventListener\('keydown'/, 'keydown begins the hold');
  assert.match(COMPACT_VIEW_SOURCE, /addEventListener\('keyup'/, 'keyup ends it');
});

test('the mute button does not keep its state in its own label', () => {
  // It read `mute.textContent === 'Unmute' ? ... : ...`, so a copy edit
  // silently inverted the control and assistive tech was told nothing.
  assert.doesNotMatch(
    COMPACT_VIEW_SOURCE,
    /textContent === 'Unmute'/,
    'state must not be recovered by comparing the visible label',
  );
  assert.match(COMPACT_VIEW_SOURCE, /aria-pressed/, 'the pressed state must be exposed');
});

test('the expand affordance is reachable without a mouse', () => {
  assert.match(COMPACT_VIEW_SOURCE, /aria-expanded/, 'expansion state is exposed');
});

test('CONTROL: the source probe reads the real module', () => {
  // Every assertion above is a regex over source text. If the read failed
  // or pointed somewhere empty they would all fail rather than pass
  // vacuously -- but a future refactor could point it at the wrong file,
  // so pin something only this module contains.
  assert.ok(COMPACT_VIEW_SOURCE.length > 3000, 'the module was actually read');
  assert.match(COMPACT_VIEW_SOURCE, /COMPACT_STYLE_TEXT/, 'and it is the compact view');
});

test('collapsed is unreachable, not merely invisible', () => {
  // The collapsed rule is `opacity: 0; pointer-events: none`. That stops
  // the mouse and nothing else: every control inside stayed focusable and
  // exposed to assistive tech. Tabbing past "Open" landed on five
  // invisible controls, and Space on the first is HOLD TO TALK -- so the
  // MICROPHONE opened with nothing on screen to say so, while
  // aria-expanded="false" simultaneously claimed the content was closed.
  const { doc, mount } = fakeEnv();
  const view = createCompactView(mount as unknown as HTMLElement, {
    onTalkToggle: () => undefined,
    onSubmit: () => undefined,
    onExpandToggle: () => undefined,
    onMuteToggle: () => undefined,
    onReturnToClaude: () => undefined,
  }, doc as unknown as Document);
  const surface = findByClass(mount, 'candice-compact-surface');
  assert.ok(surface !== null, 'control: the interaction surface must exist to be tested');

  assert.equal(surface.getAttribute('inert'), '', 'born collapsed, so born inert');
  assert.equal(surface.getAttribute('aria-hidden'), 'true');

  view.setExpanded(true);
  assert.equal(surface.getAttribute('inert'), null, 'expanded surface must be reachable');
  assert.equal(surface.getAttribute('aria-hidden'), 'false');

  // CONTROL: it must go back. A one-way latch would leave the surface
  // permanently reachable after the first expand -- the same defect.
  view.setExpanded(false);
  assert.equal(surface.getAttribute('inert'), '', 'collapsing again must re-hide it');
  assert.equal(surface.getAttribute('aria-hidden'), 'true');
});

test('the mute button announces the state it is actually in', () => {
  // It rendered the label "Unmute" WITH aria-pressed="true" while muted.
  // A screen reader says "Unmute, pressed" -- which reads as "unmute is
  // engaged", i.e. sound is ON: the precise opposite of the truth. A name
  // that is a verb cannot carry a pressed state, so the accessible name
  // states the state and aria-pressed agrees with it.
  const { doc, mount } = fakeEnv();
  createCompactView(mount as unknown as HTMLElement, {
    onTalkToggle: () => undefined,
    onSubmit: () => undefined,
    onExpandToggle: () => undefined,
    onMuteToggle: () => undefined,
    onReturnToClaude: () => undefined,
  }, doc as unknown as Document);
  const mute = findByText(mount, 'Unmute');
  assert.ok(mute !== null, 'control: the mute control must exist, starting muted');

  assert.equal(mute.getAttribute('aria-label'), 'Voice responses OFF');
  assert.equal(mute.getAttribute('aria-pressed'), 'false');

  mute.dispatch('click');
  assert.equal(mute.textContent, 'Mute', 'the visible word stays the ACTION');
  assert.equal(mute.getAttribute('aria-label'), 'Voice responses ON');
  assert.equal(mute.getAttribute('aria-pressed'), 'true');

  // The failure this pins: the name and the pressed state must not disagree.
  const label = mute.getAttribute('aria-label') ?? '';
  assert.equal(
    label.endsWith('ON'),
    mute.getAttribute('aria-pressed') === 'true',
    'the accessible name and aria-pressed must agree',
  );
});

test('compact mute wording matches the answer-controls lane, so they cannot drift', () => {
  // The strings are copied rather than imported to keep the lanes
  // independent; this is what stops the copy diverging.
  assert.match(COMPACT_VIEW_SOURCE, /'Voice responses OFF'/);
  assert.match(COMPACT_VIEW_SOURCE, /'Voice responses ON'/);
  assert.equal(ANSWER_CONTROLS_LABELS.VOICE_ON, 'Voice responses ON');
  assert.equal(ANSWER_CONTROLS_LABELS.VOICE_OFF, 'Voice responses OFF');
});
