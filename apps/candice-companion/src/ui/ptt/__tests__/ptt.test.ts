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
  className = '';
  textContent = '';
  hidden = false;
  children: FakeEl[] = [];
  attrs = new Map<string, string | null>();
  listeners = new Map<string, (e: unknown) => void>();
  classSet = new Set<string>();

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
function installFakeDom(): void {
  const documentApi = {
    head: new FakeEl(),
    documentElement: new FakeEl(),
    getElementById(_id: string): FakeEl | null {
      return null;
    },
    createElement(tag: string): FakeEl {
      const el = new FakeEl();
      el.type = tag;
      return el;
    },
  };
  (globalThis as Record<string, unknown>)['document'] = documentApi;
  (globalThis as Record<string, unknown>)['window'] = {
    addEventListener() {},
    dispatchEvent() {},
  };
}

function uninstallFakeDom(): void {
  delete (globalThis as Record<string, unknown>)['document'];
  delete (globalThis as Record<string, unknown>)['window'];
}

function render() {
  installFakeDom();
  const mount = new FakeEl();
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
  uninstallFakeDom();
  return { root, button, view, counts };
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
    'speaking',
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

// ------------------------------------------------------------ status render

test('setStatus renders the exact listening label + state attr', () => {
  const { root, button, view } = render();
  view.setStatus(pttStatusView('listening'));
  assert.equal(button.textContent, PTT_LABELS.LISTENING);
  assert.equal(root.getAttribute('data-candice-ptt-state'), 'listening');
  assert.equal(view.isListening(), true);
  assert.equal(root.classList.contains(PTT_LISTENING_CLASS), true);
  view.show('idle');
  assert.equal(button.textContent, PTT_LABELS.HOLD);
  assert.equal(view.isListening(), false);
  assert.equal(root.classList.contains(PTT_LISTENING_CLASS), false);
});

test('busy status disables the button (prompt hidden, control still present)', () => {
  const { root, button, view } = render();
  view.show('speaking');
  assert.equal(button.getAttribute('aria-disabled'), 'true');
  assert.equal(button.textContent, PTT_LABELS.HOLD, 'label kept for keyboard users');
  assert.equal(root.getAttribute('data-candice-ptt-state'), 'busy');
});

test('transcribing shows the exact spec-6 label', () => {
  const { root, button, view } = render();
  view.show('transcribing');
  assert.equal(button.textContent, PTT_LABELS.TRANSCRIBING);
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
  uninstallFakeDom();

  assert.equal(button.textContent, PTT_LABELS.LISTENING);
  assert.ok(
    root.findFirstClass(PTT_LISTENING_CLASS) !== null,
    'listening class active on the integrated PTT control',
  );
});
