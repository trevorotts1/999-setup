/**
 * The WIRING of the speech events — not the parsers, not the machine.
 *
 * WHY THIS FILE EXISTS. `bridge.test.ts` never referenced
 * `initializeAuthenticatedBridge`, and `machine.test.ts` proves only that the
 * machine CAN leave `speaking`. Nothing proved the app ever TELLS it to. So
 * deleting the `speech:tts` dispatch, or either completion listener, left the
 * entire suite green — the exact shape of the defect this module was repaired
 * for, one layer out. These tests fail when that wiring is removed.
 *
 * They drive the REAL state machine, so the assertion is the outcome a user
 * would feel (the hologram renders / HOLD TO TALK works), never that a spy was
 * called.
 *
 *   node --test --experimental-strip-types \
 *     apps/candice-companion/src/runtime/__tests__/bridge-wiring.test.ts
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { initializeAuthenticatedBridge, type BridgeHostApi } from '../bridge.ts';
import { SPEECH_BOUNDARY_EVENT, SPEECH_DRAIN_EVENT, SPEECH_START_EVENT } from '../speech-timing.ts';
import { createCandiceStateMachine } from '../../state/machine.ts';

// ------------------------------------------------------------ tiny fake DOM
// Same convention as the captions/ptt lanes: hand-rolled, no dependency.

class FakeEl {
  readonly children: FakeEl[] = [];
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  parent: FakeEl | null = null;
  id = '';
  textContent = '';
  innerHTML = '';
  hidden = false;
  tagName = 'div';
  className = '';
  ownerDocument: unknown = null;
  get classList() {
    const set = new Set<string>();
    return {
      add: (...n: string[]) => { for (const x of n) set.add(x); },
      remove: (...n: string[]) => { for (const x of n) set.delete(x); },
      contains: (n: string) => set.has(n),
      toggle: (n: string, force?: boolean) => { const on = force ?? !set.has(n); if (on) set.add(n); else set.delete(n); return on; },
    };
  }
  setAttribute(n: string, v: string): void { this.attributes.set(n, v); }
  getAttribute(n: string): string | null { return this.attributes.get(n) ?? null; }
  removeAttribute(n: string): void { this.attributes.delete(n); }
  append(...c: FakeEl[]): void { for (const x of c) { x.parent = this; this.children.push(x); } }
  appendChild(c: FakeEl): FakeEl { this.append(c); return c; }
  replaceChildren(...c: FakeEl[]): void { this.children.length = 0; this.append(...c); }
  remove(): void {
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  addEventListener(): void { /* no interaction is driven here */ }
  removeEventListener(): void { /* no interaction is driven here */ }
  focus(): void { /* not asserted */ }
  querySelector(): FakeEl | null { return null; }
  querySelectorAll(): FakeEl[] { return []; }
  closest(): FakeEl | null { return null; }
  contains(): boolean { return false; }
}

function installFakeDom(): () => void {
  const doc = new FakeEl();
  doc.tagName = '#document';
  const api = doc as unknown as Record<string, unknown>;
  api['head'] = new FakeEl();
  api['body'] = new FakeEl();
  api['documentElement'] = new FakeEl();
  api['getElementById'] = (): FakeEl | null => null;
  api['querySelector'] = (): FakeEl | null => null;
  api['createElement'] = (tag: string): FakeEl => {
    const el = new FakeEl();
    el.tagName = tag;
    el.ownerDocument = doc;
    return el;
  };
  api['createTextNode'] = (text: string): FakeEl => { const el = new FakeEl(); el.textContent = text; return el; };
  api['addEventListener'] = (): void => {};
  api['removeEventListener'] = (): void => {};
  const g = globalThis as Record<string, unknown>;
  const hadDoc = 'document' in g;
  const hadWin = 'window' in g;
  g['document'] = doc;
  g['window'] = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  return () => {
    if (!hadDoc) delete g['document'];
    if (!hadWin) delete g['window'];
  };
}

// ------------------------------------------------------------ fake Tauri host

interface Harness {
  host: BridgeHostApi;
  emit(event: string, payload: unknown): void;
  listenerCount(event: string): number;
}

function fakeHost(): Harness {
  const handlers = new Map<string, Array<(e: { payload: unknown }) => void>>();
  const host: BridgeHostApi = {
    listen: async <T,>(event: string, handler: (e: { payload: T }) => void): Promise<() => void> => {
      const list = handlers.get(event) ?? [];
      const typed = handler as (e: { payload: unknown }) => void;
      list.push(typed);
      handlers.set(event, list);
      return () => {
        const current = handlers.get(event) ?? [];
        const at = current.indexOf(typed);
        if (at >= 0) current.splice(at, 1);
      };
    },
    invoke: async (): Promise<unknown> => null,
  };
  return {
    host,
    emit(event, payload) { for (const h of [...(handlers.get(event) ?? [])]) h({ payload }); },
    listenerCount(event) { return (handlers.get(event) ?? []).length; },
  };
}

const QUESTION = {
  type: 'question', version: '1.0', question: {
    schemaVersion: '1.0', sessionId: 'session-a', questionKey: 'PROJECT_NAME',
    text: 'What is the project name?', allowedInputModes: ['typed'],
    // BOTH are required: `shouldSpeakQuestion` fails closed unless the
    // question is explicitly read-aloud AND explicitly normal-sensitivity
    // (FIX-017). An omitted `sensitivity` is silence, by design.
    readAloud: true, sensitivity: 'normal',
  },
};

const marker = (utteranceId: string) => ({ schemaVersion: '1.0', utteranceId });

/** Mount the bridge, deliver a question, and return the live harness. */
async function speaking() {
  const restore = installFakeDom();
  const harness = fakeHost();
  const machine = createCandiceStateMachine();
  const root = new FakeEl() as unknown as HTMLElement;
  const teardown = await initializeAuthenticatedBridge(root, machine, {
    speakQuestion: async () => { /* the engine is not under test here */ },
    voiceOutputEnabled: () => true,
  }, harness.host);
  harness.emit('candice:bridge-question', QUESTION);
  // `present()` awaits the native input-policy call before it speaks.
  await new Promise((r) => setImmediate(r));
  return { harness, machine, teardown, restore };
}

test('delivering a question puts her in `speaking` — the ONLY hologram dispatch', async () => {
  const { machine, teardown, restore } = await speaking();
  // The bust, blink, lip sync and head drift render under no other status.
  // Delete the `speech:tts` dispatch in `speakQuestion` and this fails.
  assert.equal(machine.getState().status, 'speaking',
    'the hologram is unreachable: nothing dispatched speech:tts');
  teardown();
  restore();
});

test('a drain for the playing utterance ends `speaking` — or HOLD TO TALK stays dead', async () => {
  const { harness, machine, teardown, restore } = await speaking();
  harness.emit(SPEECH_START_EVENT, { schemaVersion: '1.0', utteranceId: 'u-1', timings: [] });
  harness.emit(SPEECH_DRAIN_EVENT, marker('u-1'));
  // `ptt:start` is REFUSED while speaking, so a missed completion leaves the
  // mic dead until the next question. Delete the drain listener: this fails.
  assert.notEqual(machine.getState().status, 'speaking',
    'she never left speaking: the drain listener is not wired');
  assert.equal(machine.transition({ type: 'ptt:start' }) !== null, true,
    'HOLD TO TALK is still blocked after the utterance ended');
  teardown();
  restore();
});

test('a boundary ends `speaking` too — the cut-short path is wired as well', async () => {
  const { harness, machine, teardown, restore } = await speaking();
  harness.emit(SPEECH_START_EVENT, { schemaVersion: '1.0', utteranceId: 'u-1', timings: [] });
  harness.emit(SPEECH_BOUNDARY_EVENT, marker('u-1'));
  assert.notEqual(machine.getState().status, 'speaking',
    'a cut-short utterance left her stuck in speaking');
  teardown();
  restore();
});

test('a LATE marker from a superseded utterance never ends the one now playing', async () => {
  const { harness, machine, teardown, restore } = await speaking();
  harness.emit(SPEECH_START_EVENT, { schemaVersion: '1.0', utteranceId: 'u-1', timings: [] });
  // Barge-in: the engine moves on to a replacement utterance.
  harness.emit(SPEECH_START_EVENT, { schemaVersion: '1.0', utteranceId: 'u-2', timings: [] });
  harness.emit(SPEECH_DRAIN_EVENT, marker('u-1'));
  assert.equal(machine.getState().status, 'speaking',
    'a stale drain ended the CURRENT utterance mid-sentence');
  // The real one still ends it.
  harness.emit(SPEECH_DRAIN_EVENT, marker('u-2'));
  assert.notEqual(machine.getState().status, 'speaking',
    'the matching drain must still be honoured');
  teardown();
  restore();
});

test('a marker arriving with no start seen is honoured, not discarded', async () => {
  const { harness, machine, teardown, restore } = await speaking();
  // Never having seen a start is not evidence the marker is stale, and being
  // stuck in `speaking` is the worse failure. Mirrors speech-timing.ts:166.
  harness.emit(SPEECH_DRAIN_EVENT, marker('u-unknown'));
  assert.notEqual(machine.getState().status, 'speaking',
    'an unmatched marker with no active id must still end speaking');
  teardown();
  restore();
});

test('teardown detaches every speech listener it attached', async () => {
  const { harness, teardown, restore } = await speaking();
  assert.equal(harness.listenerCount(SPEECH_START_EVENT), 1);
  assert.equal(harness.listenerCount(SPEECH_DRAIN_EVENT), 1);
  assert.equal(harness.listenerCount(SPEECH_BOUNDARY_EVENT), 1);
  teardown();
  assert.equal(harness.listenerCount(SPEECH_START_EVENT), 0, 'speech-start leaked');
  assert.equal(harness.listenerCount(SPEECH_DRAIN_EVENT), 0, 'speech-drain leaked');
  assert.equal(harness.listenerCount(SPEECH_BOUNDARY_EVENT), 0, 'speech-boundary leaked');
  restore();
});
