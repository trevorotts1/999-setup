/**
 * WS-09 PTT control acceptance tests (CHECKLIST E.1 WS-09).
 *
 *   PASS: every question offers both HOLD TO TALK and TYPE ANSWER; listening
 *         state is unmistakable (glow/pulse + "LISTENING — LET GO WHEN
 *         FINISHED"); release shows transcript with USE ANSWER / EDIT /
 *         TRY AGAIN.
 *
 * Runnable with zero deps on Node >= 22.6 (node:test + TS type-stripping),
 * following the lane convention established by WS-07/WS-08/WS-17:
 *
 *   node --test apps/candice-companion/src/ui/ptt/__tests__/ptt.test.ts
 *
 * This suite proves the CONTRACT: exact spec-6 labels, the unmistakable
 * listening class + state attribute, the hold semantics (start on
 * pointerdown, stop on release/cancel/leave — mic live only while held),
 * keyboard hold, reduced-motion killing the pulse, and headless degrade
 * (mount null -> no-op view, never throws, spec 20).
 *
 * FIX-014 additions (I-04/I-05/I-06):
 *  - the label lives in a dedicated `candice-ptt-label` element that
 *    survives every render (glow/wave children never replaced);
 *  - busy statuses set BOTH `disabled` and `aria-disabled` and every
 *    start path re-checks eligibility;
 *  - `speaking` is NOT busy: the control stays enabled and shows the hold
 *    prompt, and a press dispatches the interrupt intent
 *    (`speech:interrupted` -> `tts:stop` THEN `mic:open`);
 *  - pointer capture + document-level release fallback +
 *    `lostpointercapture` + teardown release all end the hold exactly once.
 *
 * No DOM library: a minimal fake DOM is installed for the press-path tests
 * (same technique the WS-07 suite uses with its fake window object; a real
 * DOM is exercised in the webview and the WS-15 visual harness).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PTT_CONTRACT_VERSION,
  PTT_LABELS,
  PTT_LISTENING_CLASS,
  PTT_REDUCED_MOTION_CLASS,
} from '../config.ts';
import { pttStatusView, isPttBusy, isPttLiveStatus } from '../status.ts';
import { PTT_STYLE_TEXT, createPttView } from '../view.ts';
import { createAnswerControlsController } from '../../answer-controls/controller.ts';
import { createCandiceStateMachine } from '../../../state/machine.ts';

const allStatuses = [
  'idle',
  'listening',
  'transcribing',
  'confirming',
  'thinking',
  'speaking',
  'compact',
  'recovering',
  'text-fallback',
  'building',
  'quality-checking',
  'fixing',
  'waiting-for-user',
  'complete',
] as const;

// ------------------------------------------------------------------ helpers

/** Minimal fake element: listeners, attributes, children, classList. */
class FakeEl {
  type = '';
  private _className = '';
  textContent = '';
  hidden = false;
  disabled = false;
  children: FakeEl[] = [];
  attrs = new Map<string, string | null>();
  listeners = new Map<string, (e: unknown) => void>();
  classSet = new Set<string>();
  ownerDocument: FakeEl | null = null;
  capturedPointerId: number | null = null;
  /** Minimal CSSStyleDeclaration seam: setInputLevel writes a custom property. */
  style = {
    props: new Map<string, string>(),
    setProperty(name: string, value: string): void {
      this.props.set(name, value);
    },
    getPropertyValue(name: string): string {
      return this.props.get(name) ?? '';
    },
  };

  get className(): string {
    return this._className;
  }
  set className(v: string) {
    this._className = v;
    this.classSet = new Set(v.split(/\s+/).filter(Boolean));
  }

  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }
  addEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.set(type, fn);
  }
  removeEventListener(): void {}
  append(...nodes: FakeEl[]): void {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: FakeEl[]): void {
    this.children = [...nodes];
  }
  remove(): void {}
  setPointerCapture(id: number): void {
    this.capturedPointerId = id;
  }
  get classList(): { contains(c: string): boolean; toggle(c: string, on?: boolean): boolean } {
    const set = this.classSet;
    return {
      contains(c: string) {
        return set.has(c);
      },
      toggle(c: string, on?: boolean) {
        const next = on ?? !set.has(c);
        if (next) set.add(c);
        else set.delete(c);
        return next;
      },
    };
  }
  dispatch(type: string, ev: Record<string, unknown> = {}): void {
    const handler = this.listeners.get(type);
    if (!handler) return;
    handler({
      key: ev.key,
      button: ev.button,
      repeat: ev.repeat,
      pointerId: ev.pointerId,
      preventDefault() {},
    });
  }
  findFirst(tag: string): FakeEl | null {
    if (this.type === tag) return this;
    for (const c of this.children) {
      const hit = c.findFirst(tag);
      if (hit) return hit;
    }
    return null;
  }
  findFirstClass(cls: string): FakeEl | null {
    if (this.classSet.has(cls)) return this;
    for (const c of this.children) {
      const hit = c.findFirstClass(cls);
      if (hit) return hit;
    }
    return null;
  }
}

/** Install the tiny fake DOM surface `createPttView` touches. */
function installFakeDom(): FakeEl {
  const documentApi = new FakeEl();
  documentApi.type = '#document';
  (documentApi as unknown as Record<string, unknown>).head = new FakeEl();
  (documentApi as unknown as Record<string, unknown>).documentElement = new FakeEl();
  (documentApi as unknown as Record<string, unknown>).getElementById = (_id: string): FakeEl | null => null;
  (documentApi as unknown as Record<string, unknown>).createElement = (tag: string): FakeEl => {
    const el = new FakeEl();
    el.type = tag;
    el.ownerDocument = documentApi;
    return el;
  };
  (globalThis as Record<string, unknown>)['document'] = documentApi;
  (globalThis as Record<string, unknown>)['window'] = {
    addEventListener() {},
    dispatchEvent() {},
  };
  return documentApi;
}

function uninstallFakeDom(): void {
  delete (globalThis as Record<string, unknown>)['document'];
  delete (globalThis as Record<string, unknown>)['window'];
}

function render() {
  const doc = installFakeDom();
  const mount = new FakeEl();
  mount.ownerDocument = doc;
  const counts = { starts: 0, stops: 0 };
  const view = createPttView(mount as unknown as HTMLElement, {
    onTalkStart: () => {
      counts.starts += 1;
    },
    onTalkStop: () => {
      counts.stops += 1;
    },
  });
  const root = mount.children[0] as FakeEl;
  const button = root.findFirst('button') as FakeEl;
  const label = button.findFirstClass('candice-ptt-label') as FakeEl;
  uninstallFakeDom();
  return { doc, root, button, label, view, counts };
}

// ------------------------------------------------------------ label contract

test('spec-6 labels are exact (acceptance evidence)', () => {
  assert.equal(PTT_LABELS.HOLD, '🎙 HOLD TO TALK');
  assert.equal(PTT_LABELS.LISTENING, '🔴 LISTENING — LET GO WHEN FINISHED');
  assert.equal(PTT_LABELS.TRANSCRIBING, 'Here is what I heard…');
});

test('idle view shows HOLD TO TALK, no glow, no waveform', () => {
  const v = pttStatusView('idle');
  assert.equal(v.label, PTT_LABELS.HOLD);
  assert.equal(v.mode, 'hold');
  assert.equal(v.glowing, false);
  assert.equal(v.waveform, false);
  assert.equal(v.family, 'idle');
  assert.equal(v.interruptible, false);
});

// --------------------------------------------------------- listening state

test('listening state is unmistakable: glow + pulse + exact label', () => {
  const v = pttStatusView('listening');
  assert.equal(v.label, PTT_LABELS.LISTENING);
  assert.equal(v.mode, 'listening');
  assert.equal(v.glowing, true, 'listening must glow (never icon-only)');
  assert.equal(v.waveform, true, 'optional lightweight waveform shown');
  assert.equal(v.family, 'listening');
});

test('isPttLiveStatus true ONLY for the machine live-mic state', () => {
  assert.equal(isPttLiveStatus('listening'), true);
  for (const s of allStatuses) {
    if (s !== 'listening') {
      assert.equal(isPttLiveStatus(s), false, `isPttLiveStatus(${s})`);
    }
  }
});

test('busy family hides the prompt; transcribing shows its own label', () => {
  assert.equal(pttStatusView('transcribing').label, PTT_LABELS.TRANSCRIBING);
  const busyStatuses = [
    'confirming',
    'thinking',
    'recovering',
    'text-fallback',
    'building',
    'quality-checking',
    'fixing',
    'complete',
  ] as const;
  for (const s of busyStatuses) {
    assert.equal(pttStatusView(s).label, null, s);
    assert.equal(isPttBusy(s), true, s);
  }
});

// ------------------------------------------------- FIX-014 (I-04) speaking

test('speaking is NOT busy: hold prompt stays, interruptible flag set (I-04)', () => {
  const v = pttStatusView('speaking');
  assert.equal(v.label, PTT_LABELS.HOLD, 'hold prompt stays while Candice speaks');
  assert.equal(v.family, 'idle');
  assert.equal(v.interruptible, true, 'a press must dispatch the interrupt intent');
  assert.equal(isPttBusy('speaking'), false, 'control must stay enabled');
});

test('waiting-for-user keeps the hold control (question path)', () => {
  const v = pttStatusView('waiting-for-user');
  assert.equal(v.label, PTT_LABELS.HOLD);
  assert.equal(v.family, 'idle');
  assert.equal(isPttBusy('waiting-for-user'), false);
});

test('every canonical status maps without throwing', () => {
  for (const s of allStatuses) {
    const v = pttStatusView(s);
    assert.ok(['idle', 'listening', 'transcribing', 'busy'].includes(v.family), s);
  }
});

// ---------------------------------------------------------- reduced motion

test('reduced-motion class name matches the shared WS-14 convention', () => {
  assert.equal(PTT_REDUCED_MOTION_CLASS, 'candice-reduced-motion');
});

test('style text: pulse present, reduced-motion kills it, no baked background', () => {
  assert.match(PTT_STYLE_TEXT, /candice-ptt-glow-pulse/);
  assert.match(PTT_STYLE_TEXT, /animation: candice-ptt-glow-pulse/);
  assert.match(
    PTT_STYLE_TEXT,
    new RegExp(`html\\.${PTT_REDUCED_MOTION_CLASS}[^\\n]*\\n?[^\\n]*animation: none`),
  );
  assert.doesNotMatch(PTT_STYLE_TEXT, /background:\s*#/i, 'no hex background (WS-07 invariant)');
  assert.doesNotMatch(PTT_STYLE_TEXT, /background-image/);
  assert.equal(PTT_CONTRACT_VERSION, 1);
});

// -------------------------------------------------------- headless degrade

test('null mount returns a no-op view, never throws (spec 20)', () => {
  const view = createPttView(null, { onTalkStart() {}, onTalkStop() {} });
  assert.equal(view.el, null);
  assert.doesNotThrow(() => view.setStatus(pttStatusView('listening')));
  assert.doesNotThrow(() => view.show('listening'));
  assert.equal(view.isListening(), false);
  assert.doesNotThrow(() => view.destroy());
});

// ------------------------------------------------------------- press paths

test('pointerdown starts capture; pointerup stops; single-flight', () => {
  const { button, counts } = render();
  button.dispatch('pointerdown', { button: 0 });
  assert.equal(counts.starts, 1, 'down -> start');
  button.dispatch('pointerdown', { button: 0 });
  assert.equal(counts.starts, 1, 'second down ignored (single-flight)');
  assert.equal(counts.stops, 0);
  button.dispatch('pointerup');
  assert.equal(counts.stops, 1, 'up -> stop');
});

test('pointerleave and pointercancel both release the hold', () => {
  const { button, counts } = render();
  button.dispatch('pointerdown', { button: 0 });
  assert.equal(counts.starts, 1);
  button.dispatch('pointerleave');
  assert.equal(counts.stops, 1, 'leave -> stop (mic live only while held)');
  button.dispatch('pointerdown', { button: 0 });
  button.dispatch('pointercancel');
  assert.equal(counts.stops, 2, 'cancel -> stop');
});

test('non-left pointer button does not start capture', () => {
  const { button, counts } = render();
  button.dispatch('pointerdown', { button: 2 });
  assert.equal(counts.starts, 0);
});

test('keyboard hold: Space down starts, keyup stops, repeat filtered', () => {
  const { button, counts } = render();
  button.dispatch('keydown', { key: ' ', repeat: false });
  assert.equal(counts.starts, 1, 'Space down -> start');
  button.dispatch('keydown', { key: ' ', repeat: true });
  assert.equal(counts.starts, 1, 'repeat ignored');
  button.dispatch('keyup', { key: ' ' });
  assert.equal(counts.stops, 1, 'Space up -> stop');
});

test('blur releases a held key', () => {
  const { button, counts } = render();
  button.dispatch('keydown', { key: 'Enter', repeat: false });
  assert.equal(counts.starts, 1);
  button.dispatch('blur');
  assert.equal(counts.stops, 1);
});

// ------------------------------------------- FIX-014 (I-06) release paths

test('pointer capture: document-level pointerup ends the hold exactly once', () => {
  const { doc, button, counts } = render();
  button.dispatch('pointerdown', { button: 0, pointerId: 7 });
  assert.equal(counts.starts, 1);
  assert.equal(button.capturedPointerId, 7, 'pointer captured on press');
  // Release lands on the document (pointer outside the button): still stops.
  doc.dispatch('pointerup', { pointerId: 7 });
  assert.equal(counts.stops, 1, 'document-level release ends the hold');
  // The button-level pointerup for the same press must not double-stop.
  button.dispatch('pointerup', { pointerId: 7 });
  assert.equal(counts.stops, 1, 'release closes exactly once');
});

test('document-level pointercancel ends the hold', () => {
  const { doc, button, counts } = render();
  button.dispatch('pointerdown', { button: 0, pointerId: 3 });
  assert.equal(counts.starts, 1);
  doc.dispatch('pointercancel', { pointerId: 3 });
  assert.equal(counts.stops, 1);
});

test('lostpointercapture ends the hold', () => {
  const { button, counts } = render();
  button.dispatch('pointerdown', { button: 0, pointerId: 5 });
  assert.equal(counts.starts, 1);
  button.dispatch('lostpointercapture', { pointerId: 5 });
  assert.equal(counts.stops, 1, 'capture lost mid-hold -> release');
});

test('destroy releases a live hold (teardown path)', () => {
  const { button, view, counts } = render();
  button.dispatch('pointerdown', { button: 0 });
  assert.equal(counts.starts, 1);
  view.destroy();
  assert.equal(counts.stops, 1, 'teardown releases the hold');
});

// ------------------------------------------------------------ status render

test('setStatus renders the exact listening label + state attr', () => {
  const { root, label, view } = render();
  view.setStatus(pttStatusView('listening'));
  assert.equal(label.textContent, PTT_LABELS.LISTENING);
  assert.equal(root.getAttribute('data-candice-ptt-state'), 'listening');
  assert.equal(view.isListening(), true);
  assert.equal(root.classList.contains(PTT_LISTENING_CLASS), true);
  view.show('idle');
  assert.equal(label.textContent, PTT_LABELS.HOLD);
  assert.equal(view.isListening(), false);
  assert.equal(root.classList.contains(PTT_LISTENING_CLASS), false);
});

test('label element survives renders; glow/wave children never replaced (I-05)', () => {
  const { root, button, label, view } = render();
  const glow = button.findFirstClass('candice-ptt-glow');
  const wave = root.findFirstClass('candice-ptt-wave');
  assert.ok(glow !== null, 'glow child exists');
  assert.ok(wave !== null, 'wave child exists');
  view.show('listening');
  view.show('idle');
  view.show('transcribing');
  // Same label element object across renders (never re-created).
  assert.equal(button.findFirstClass('candice-ptt-label'), label);
  assert.equal(button.findFirstClass('candice-ptt-glow'), glow);
  assert.equal(root.findFirstClass('candice-ptt-wave'), wave);
});

test('busy status disables the button with BOTH disabled and aria-disabled (I-06)', () => {
  const { root, button, label, view, counts } = render();
  view.show('thinking');
  assert.equal(button.disabled, true, 'native disabled set');
  assert.equal(button.getAttribute('aria-disabled'), 'true');
  assert.equal(label.textContent, PTT_LABELS.HOLD, 'label kept for keyboard users');
  assert.equal(root.getAttribute('data-candice-ptt-state'), 'busy');
  // Disabled control can never start capture (pointer or keyboard).
  button.dispatch('pointerdown', { button: 0 });
  assert.equal(counts.starts, 0, 'pointer start blocked while busy');
  button.dispatch('keydown', { key: ' ', repeat: false });
  assert.equal(counts.starts, 0, 'keyboard start blocked while busy');
  // Back to idle: re-enabled, both flags cleared, capture works again.
  view.show('idle');
  assert.equal(button.disabled, false);
  assert.equal(button.getAttribute('aria-disabled'), 'false');
  button.dispatch('pointerdown', { button: 0 });
  assert.equal(counts.starts, 1, 'capture works after busy clears');
});

test('speaking keeps the control enabled and interruptible (I-04)', () => {
  const { root, button, label, view } = render();
  view.show('speaking');
  assert.equal(button.disabled, false, 'enabled while speaking');
  assert.equal(button.getAttribute('aria-disabled'), 'false');
  assert.equal(label.textContent, PTT_LABELS.HOLD);
  assert.equal(root.getAttribute('data-candice-ptt-state'), 'idle');
  assert.equal(root.getAttribute('data-candice-ptt-interruptible'), 'true');
});

test('transcribing shows the exact spec-6 label', () => {
  const { root, label, view } = render();
  view.show('transcribing');
  assert.equal(label.textContent, PTT_LABELS.TRANSCRIBING);
  assert.equal(root.getAttribute('data-candice-ptt-state'), 'transcribing');
});

test('destroy is idempotent and never throws after status renders', () => {
  const { view } = render();
  view.setStatus(pttStatusView('listening'));
  assert.doesNotThrow(() => view.destroy());
  assert.doesNotThrow(() => view.destroy());
});

// ------------------------------------------------ QC-fix regression tests
// (2026-08-21 QC round: the integrated answer-controls surface must drive
// the embedded PTT control with the machine's real status.)

test('integrated surface: machine status drives the embedded PTT control', () => {
  // The answer-controls controller now calls pttView.show(state.status)
  // on every render. Prove the full chain on the real machine:
  // ptt:start -> the PTT control embedded in the answer surface shows the
  // unmistakable listening state (spec 6): exact label + listening class.
  const machine = createCandiceStateMachine();

  installFakeDom();
  const mount = new FakeEl();
  const ctl = createAnswerControlsController({
    machine,
    mount: mount as unknown as HTMLElement,
  });
  ctl.handle({ type: 'ptt:start' });
  const root = mount.children[0] as FakeEl;
  const button = root.findFirst('button') as FakeEl;
  const label = button.findFirstClass('candice-ptt-label') as FakeEl;
  uninstallFakeDom();

  assert.equal(label.textContent, PTT_LABELS.LISTENING);
  assert.ok(
    root.findFirstClass(PTT_LISTENING_CLASS) !== null,
    'listening class active on the integrated PTT control',
  );
});

// ------------------------------------------- FIX-014 (I-04) interrupt path

// The interrupt now runs inside the capture-consent gate: `onAllowed` fires
// only after a granted permission answer, and the gate resolves that answer
// through `Promise.resolve(...).then(...)` so it lands on a microtask even
// when the query is synchronous. These two tests were written before that
// gate existed, so they wired no consent (defaulting to the fail-closed
// `() => 'error'` query, which never opens the mic) and asserted
// synchronously. Both are updated to grant consent and await the microtask;
// the behaviour under test — tts:stop THEN mic:open — is unchanged.

test('press while speaking dispatches the interrupt: tts:stop THEN mic:open', async () => {
  const machine = createCandiceStateMachine();

  installFakeDom();
  const mount = new FakeEl();
  const ctl = createAnswerControlsController({
    machine,
    mount: mount as unknown as HTMLElement,
    captureConsent: { query: () => 'granted' },
  });
  // Reach the speaking status through the real machine path.
  ctl.handle({ type: 'question:received', question: 'What is 2+2?' });
  ctl.handle({ type: 'speech:tts' });
  assert.equal(machine.getState().status, 'speaking');

  const root = mount.children[0] as FakeEl;
  const button = root.findFirst('button') as FakeEl;
  button.dispatch('pointerdown', { button: 0 });
  await Promise.resolve(); // the consent gate resolves onAllowed on a microtask
  uninstallFakeDom();

  assert.equal(machine.getState().status, 'listening', 'interrupt opens the mic');
  const effects = machine.lastEffects.map((e) => e.type);
  assert.deepEqual(
    effects,
    ['tts:stop', 'mic:open'],
    'speech stops FIRST, then the mic opens (spec-6 duplex-safety ordering)',
  );
});

test('press while speaking never dispatches a rejected ptt:start', async () => {
  const machine = createCandiceStateMachine();

  installFakeDom();
  const mount = new FakeEl();
  const ctl = createAnswerControlsController({
    machine,
    mount: mount as unknown as HTMLElement,
    captureConsent: { query: () => 'granted' },
  });
  ctl.handle({ type: 'question:received', question: 'What is 2+2?' });
  ctl.handle({ type: 'speech:tts' });
  assert.equal(machine.getState().status, 'speaking');

  const root = mount.children[0] as FakeEl;
  const button = root.findFirst('button') as FakeEl;
  button.dispatch('pointerdown', { button: 0 });
  await Promise.resolve(); // the consent gate resolves onAllowed on a microtask
  uninstallFakeDom();

  // ptt:start is REJECTED while speaking; the interrupt path must have been
  // taken instead — status listening proves it (a rejected ptt:start would
  // have left the machine speaking).
  assert.equal(machine.getState().status, 'listening');
  assert.equal(machine.lastEffects[0].type, 'tts:stop');
});

// ------------------------------------- FIX-001: indicators must not lie
//
// Two independent defects made the waveform bars assert live microphone
// audio that was not happening. The operator reported seeing them move while
// hearing nothing, at a moment when the speech worker had never even been
// spawned.
//
//  1. `.candice-ptt-wave` sets `display: flex`, which beats the user-agent
//     `[hidden] { display: none }` rule — so `wave.hidden = true` had no
//     effect and the bars rendered in EVERY status, including the ones whose
//     status view sets `waveform: false`.
//  2. The bars ran an unconditional infinite keyframe loop, so even when
//     legitimately shown they moved on a timer rather than on audio.

test('FIX-001: the waveform is hidden in every status whose view sets waveform:false', () => {
  // CONTROL first: the status table must actually distinguish the states, or
  // this test proves nothing.
  assert.equal(pttStatusView('listening').waveform, true, 'CONTROL: listening shows the waveform');
  for (const status of ['idle', 'thinking', 'speaking', 'transcribing'] as const) {
    assert.equal(pttStatusView(status).waveform, false, `${status} must not show a mic waveform`);
  }
  // The CSS must be able to act on `hidden`. Without this rule the flag is
  // set correctly and ignored completely.
  assert.match(
    PTT_STYLE_TEXT,
    /\.candice-ptt-wave\[hidden\]\s*\{[^}]*display:\s*none/,
    'the wave rule sets display, so it needs an explicit [hidden] guard',
  );
});

test('FIX-001: waveform bars are driven by a measured level, never by a timer', () => {
  const barRule = PTT_STYLE_TEXT.match(/\.candice-ptt-wave-bar\s*\{([^}]*)\}/);
  if (barRule === null) throw new Error('the waveform bar rule must exist');
  assert.doesNotMatch(
    barRule[1],
    /animation\s*:/,
    'bars must not run a keyframe loop: that animates with no audio behind it',
  );
  assert.match(
    barRule[1],
    /height:[^;]*var\(--candice-ptt-level/,
    'bar height must be a function of the measured level',
  );
  // With no level source attached the level token defaults to 0, so the bars
  // sit flat and assert nothing.
  assert.match(barRule[1], /var\(--candice-ptt-level,\s*0\)/, 'default level is 0 (flat, silent)');
  assert.doesNotMatch(
    PTT_STYLE_TEXT,
    /@keyframes\s+candice-ptt-wave-pop/,
    'the decorative wave keyframes must be gone, not merely unreferenced',
  );
});

test('FIX-001: setInputLevel only accepts a real number and clamps it', () => {
  installFakeDom();
  const mount = new FakeEl();
  const view = createPttView(mount as unknown as HTMLElement, {
    onTalkStart: () => {},
    onTalkStop: () => {},
  });
  const root = mount.children[0] as FakeEl;
  const levelOf = (): string => root.style.getPropertyValue('--candice-ptt-level');

  view.setInputLevel(0.5);
  assert.equal(levelOf(), '0.5', 'a measured level drives the bars');
  view.setInputLevel(4);
  assert.equal(levelOf(), '1', 'above range clamps to 1');
  view.setInputLevel(-2);
  assert.equal(levelOf(), '0', 'below range clamps to 0');
  view.setInputLevel(Number.NaN);
  assert.equal(levelOf(), '0', 'NaN is ignored rather than moving the bars');
  view.destroy();
  uninstallFakeDom();
});
