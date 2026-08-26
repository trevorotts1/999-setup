/**
 * FIX-014 interaction composition acceptance tests (EXECUTION-PLAN step 8/9).
 *
 * The application-owned CandiceInteractionComposition:
 *  - reports a failed boot profile load to the machine as the truthful
 *    `preferences` error (reducer sets `preferencesUnavailable`),
 *  - applies the persisted text size to the captions live region,
 *  - records voice-output / preferred-name evidence on the root dataset,
 *  - mounts the first-run name prompt exactly once per local user
 *    (Master Spec section 4: Enter saves, Escape dismisses, never inferred
 *    from the OS username),
 *  - persists explicit changes through the native `cmd_save_profile` seam
 *    and refreshes the dataset evidence only after a successful save.
 *
 * Runnable with zero deps on Node >= 22.6 (node:test + TS type-stripping),
 * following the lane convention (fake-DOM pattern from captions.test.ts):
 *
 *   node --test apps/candice-companion/src/runtime/__tests__/interaction-composition.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createCandiceStateMachine } from "../../state/machine.ts";
import type { CandiceStateMachine } from "../../state/machine.ts";
import type { CaptionsController } from "../../ui/captions/index.ts";
import { defaultProfile } from "../../prefs/profile.ts";
import type { CandiceProfile } from "../../prefs/schema.ts";
import type { PrefsIpcAdapter, PrefsLoadResult } from "../../prefs/ipc.ts";
import {
  INTERACTION_COMPOSITION_ATTR,
  INTERACTION_COMPOSITION_SENTINEL,
  NAME_PROMPT_ROOT_CLASS,
  NAME_PROMPT_STYLE_ID,
  NAME_QUESTION_TEXT,
  TEXT_SIZE_SCALE,
  initializeCandiceInteractionComposition,
  textSizeToScale,
} from "../interaction-composition.ts";

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

/** WHATWG HTML DOMStringMap setter step 1: "-" + ASCII lower alpha is illegal. */
const ILLEGAL_DATASET_KEY = /-[a-z]/;

/** A legal `data-*` attribute name: non-empty, lowercase, no edge hyphens. */
export const LEGAL_DATA_ATTRIBUTE = /^data-[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * Spec-faithful `DOMStringMap` stand-in (WHATWG HTML 3.2.6.6).
 *
 * The fake DOM previously exposed `dataset` as a plain object, which accepts
 * every key a real engine rejects. That blind spot is precisely how a
 * `SyntaxError` DOMException reached a packaged WebKit build while the whole
 * Node suite stayed green. This stand-in enforces what the real setter does:
 *   1. a name containing "-" followed by an ASCII lower alpha throws
 *      `SyntaxError` — WebKit words it "The string did not match the expected
 *      pattern.", which is the string the companion's fallback card showed;
 *   2. otherwise the camelCase name maps to its `data-*` attribute.
 * Reads and writes go through the element's attribute map, so `dataset` and
 * `getAttribute` can never disagree.
 */
function createFakeDataset(element: FakeElement): Record<string, string> {
  const toAttribute = (key: string): string =>
    `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
  return new Proxy({} as Record<string, string>, {
    get: (_target, prop) =>
      (typeof prop === 'string' ? element.attributes.get(toAttribute(prop)) : undefined),
    set: (_target, prop, value) => {
      if (typeof prop !== 'string') return false;
      if (ILLEGAL_DATASET_KEY.test(prop)) {
        const error = new Error('The string did not match the expected pattern.');
        error.name = 'SyntaxError';
        throw error;
      }
      element.attributes.set(toAttribute(prop), String(value));
      return true;
    },
    has: (_target, prop) =>
      typeof prop === 'string' && element.attributes.has(toAttribute(prop)),
    deleteProperty: (_target, prop) => {
      if (typeof prop === 'string') element.attributes.delete(toAttribute(prop));
      return true;
    },
  });
}

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly classes = new FakeClassList();
  readonly children: FakeElement[] = [];
  readonly dataset: Record<string, string> = createFakeDataset(this);
  readonly style: Record<string, string> = {};
  parent: FakeElement | null = null;
  textContent = '';
  id = '';
  hidden = false;
  value = '';
  disabled = false;
  focused = false;
  readonly tagName: string;
  private listeners = new Map<string, ((event: { key?: string }) => void)[]>();

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
  focus(): void { this.focused = true; }
  addEventListener(type: string, handler: (event: { key?: string }) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }
  dispatch(type: string, event: { key?: string } = {}): void {
    for (const handler of this.listeners.get(type) ?? []) handler(event);
  }
  querySelector(selector: string): FakeElement | null {
    const match = (el: FakeElement): boolean => {
      if (selector.startsWith('.')) return el.classes.contains(selector.slice(1));
      if (selector.startsWith('#')) return el.id === selector.slice(1);
      return el.tagName.toLowerCase() === selector.toLowerCase();
    };
    const walk = (el: FakeElement): FakeElement | null => {
      if (match(el)) return el;
      for (const c of el.children) {
        const found = walk(c);
        if (found !== null) return found;
      }
      return null;
    };
    for (const c of this.children) {
      const found = walk(c);
      if (found !== null) return found;
    }
    return null;
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

// ------------------------------------------------------------ test doubles

interface RecordedInvoke {
  command: string;
  args?: Record<string, unknown>;
}

class FakeAdapter implements PrefsIpcAdapter {
  readonly calls: RecordedInvoke[] = [];
  saveResult = true;
  async invoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ command, args });
    if (command === 'cmd_save_profile') return this.saveResult;
    return null;
  }
}

class FakeCaptions implements CaptionsController {
  readonly announced: string[] = [];
  readonly scales: string[] = [];
  handle(): void {}
  render(): void {}
  setTextScale(scale: 'small' | 'medium' | 'large'): void { this.scales.push(scale); }
  readonly progress: (number | null)[] = [];
  setSpokenProgress(fraction: number | null): void { this.progress.push(fraction); }
  announce(text: string): void { this.announced.push(text); }
  destroy(): void {}
}

function loadResult(profile: CandiceProfile, ok = true, recovered = false): PrefsLoadResult {
  return { ok, profile, recoveredFromCorruption: recovered, error: ok ? undefined : 'load failed' };
}

function freshProfile(): CandiceProfile {
  return { ...defaultProfile() };
}

function textOf(root: FakeElement): string {
  const parts: string[] = [];
  const walk = (el: FakeElement): void => {
    if (el.textContent.length > 0) parts.push(el.textContent);
    for (const c of el.children) walk(c);
  };
  walk(root);
  return parts.join('|');
}

// ------------------------------------------------------------ pure mapping

test('textSizeToScale: spec-9 enum to a11y numeric multiplier, unknown -> medium', () => {
  assert.equal(textSizeToScale('small'), TEXT_SIZE_SCALE.small);
  assert.equal(textSizeToScale('medium'), TEXT_SIZE_SCALE.medium);
  assert.equal(textSizeToScale('large'), TEXT_SIZE_SCALE.large);
  assert.equal(textSizeToScale(null), TEXT_SIZE_SCALE.medium);
  assert.equal(textSizeToScale('huge'), TEXT_SIZE_SCALE.medium);
  assert.equal(textSizeToScale(undefined), TEXT_SIZE_SCALE.medium);
  assert.deepEqual(TEXT_SIZE_SCALE, { small: 0.9, medium: 1, large: 1.2 });
});

// ------------------------------------------------------------ boot wiring

test('failed boot load reports the truthful preferences error to the machine', async () => {
  const machine = createCandiceStateMachine();
  const root = new FakeElement('div');
  const captions = new FakeCaptions();
  const composition = await initializeCandiceInteractionComposition(
    root as unknown as HTMLElement,
    machine,
    captions,
    { profile: freshProfile(), prefsLoad: loadResult(freshProfile(), false), doc: new FakeDocument() as unknown as Document },
  );
  assert.equal(composition.loadOk, false);
  assert.equal(machine.getState().preferencesUnavailable, true, 'reducer set preferencesUnavailable');
  assert.equal(root.getAttribute(INTERACTION_COMPOSITION_ATTR), 'active');
});

test('successful boot load never flags preferencesUnavailable and applies the persisted text size', async () => {
  const machine = createCandiceStateMachine();
  const root = new FakeElement('div');
  const captions = new FakeCaptions();
  const profile = { ...freshProfile(), textSize: 'large' as const, voiceOutputEnabled: false, preferredName: 'Trevor' };
  const composition = await initializeCandiceInteractionComposition(
    root as unknown as HTMLElement,
    machine,
    captions,
    { profile, prefsLoad: loadResult(profile), doc: new FakeDocument() as unknown as Document },
  );
  assert.equal(composition.loadOk, true);
  assert.equal(machine.getState().preferencesUnavailable, false);
  assert.deepEqual(captions.scales, ['large'], 'persisted text size applied to captions');
  assert.equal(root.dataset.candiceVoiceOutput, 'false');
  assert.equal(root.dataset.candicePreferredName, 'Trevor');
  assert.equal(root.getAttribute(INTERACTION_COMPOSITION_ATTR), 'active');
});

test('null machine and null captions degrade to a no-op composition (spec 20)', async () => {
  const root = new FakeElement('div');
  const composition = await initializeCandiceInteractionComposition(
    root as unknown as HTMLElement,
    null,
    null,
    { profile: freshProfile(), prefsLoad: loadResult(freshProfile(), false), doc: new FakeDocument() as unknown as Document },
  );
  assert.equal(composition.loadOk, false);
  assert.doesNotThrow(() => composition.beginNameFlow());
  assert.doesNotThrow(() => composition.changeName());
  assert.doesNotThrow(() => composition.destroy());
  assert.equal(await composition.persist({ volume: 0.5 }), false, 'no adapter: save fails closed');
});

// ------------------------------------------------------------ first-run name flow

test('needsNameAsk: beginNameFlow mounts the spec-4 name question exactly once', async () => {
  const machine = createCandiceStateMachine();
  const root = new FakeElement('div');
  const captions = new FakeCaptions();
  const doc = new FakeDocument();
  const composition = await initializeCandiceInteractionComposition(
    root as unknown as HTMLElement,
    machine,
    captions,
    { profile: freshProfile(), prefsLoad: loadResult(freshProfile()), doc: doc as unknown as Document },
  );
  composition.beginNameFlow();

  const prompt = root.querySelector(`.${NAME_PROMPT_ROOT_CLASS}`);
  assert.ok(prompt !== null, 'prompt mounted');
  assert.equal(prompt?.getAttribute('role'), 'region');
  assert.equal(prompt?.getAttribute('aria-label'), 'Name prompt');
  assert.ok(textOf(root).includes(NAME_QUESTION_TEXT), 'exact spec-4 question text');
  assert.ok(captions.announced.includes(NAME_QUESTION_TEXT), 'question announced as a caption');
  const input = prompt?.querySelector('input');
  assert.ok(input?.focused === true, 'input focused on mount');
  assert.equal(input?.getAttribute('maxlength'), '60');
  assert.equal(input?.getAttribute('aria-label'), 'Your name');
  assert.equal(doc.getElementById(NAME_PROMPT_STYLE_ID)?.id, NAME_PROMPT_STYLE_ID, 'style tag mounted once');

  // Second call never double-mounts.
  composition.beginNameFlow();
  assert.equal(root.children.filter((c) => c.classes.contains(NAME_PROMPT_ROOT_CLASS)).length, 1);
});

test('Enter with a name saves it, records nameAsked, removes the prompt, greets back', async () => {
  const machine = createCandiceStateMachine();
  const root = new FakeElement('div');
  const captions = new FakeCaptions();
  const adapter = new FakeAdapter();
  const composition = await initializeCandiceInteractionComposition(
    root as unknown as HTMLElement,
    machine,
    captions,
    {
      profile: freshProfile(),
      prefsLoad: loadResult(freshProfile()),
      invokeAdapter: adapter,
      doc: new FakeDocument() as unknown as Document,
      nowIso: () => '2026-08-22T00:00:00.000Z',
    },
  );
  composition.beginNameFlow();
  const input = root.querySelector('input');
  assert.ok(input !== null);
  input!.value = '  Trevor   BlackCEO ';
  input!.dispatch('keydown', { key: 'Enter' });

  assert.equal(root.querySelector(`.${NAME_PROMPT_ROOT_CLASS}`), null, 'prompt removed after save');
  // The save is async; flush microtasks so the in-memory profile and the
  // dataset evidence reflect the successful persist before asserting.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const save = adapter.calls.find((c) => c.command === 'cmd_save_profile');
  assert.ok(save !== undefined, 'persisted through the native seam');
  const doc = save?.args?.doc as Record<string, unknown>;
  assert.equal(doc.preferredName, 'Trevor BlackCEO', 'normalized name stored');
  assert.deepEqual(doc.nameAsked, { askedAt: '2026-08-22T00:00:00.000Z' });
  assert.equal(composition.profile.preferredName, 'Trevor BlackCEO', 'in-memory profile updated');
  assert.equal(root.dataset.candicePreferredName, 'Trevor BlackCEO', 'dataset evidence refreshed');
  assert.ok(captions.announced.includes('Welcome back, Trevor BlackCEO'), 'welcome-back greeting announced');
});

test('Escape dismisses: records nameAsked without a name, never re-asks', async () => {
  const machine = createCandiceStateMachine();
  const root = new FakeElement('div');
  const captions = new FakeCaptions();
  const adapter = new FakeAdapter();
  const composition = await initializeCandiceInteractionComposition(
    root as unknown as HTMLElement,
    machine,
    captions,
    {
      profile: freshProfile(),
      prefsLoad: loadResult(freshProfile()),
      invokeAdapter: adapter,
      doc: new FakeDocument() as unknown as Document,
      nowIso: () => '2026-08-22T00:00:00.000Z',
    },
  );
  composition.beginNameFlow();
  const input = root.querySelector('input');
  input!.dispatch('keydown', { key: 'Escape' });

  assert.equal(root.querySelector(`.${NAME_PROMPT_ROOT_CLASS}`), null, 'prompt removed after dismiss');
  const save = adapter.calls.find((c) => c.command === 'cmd_save_profile');
  const doc = save?.args?.doc as Record<string, unknown>;
  assert.equal(doc.preferredName, null, 'no name stored on dismiss');
  assert.deepEqual(doc.nameAsked, { askedAt: '2026-08-22T00:00:00.000Z' });

  // The question was asked and declined: it must not re-ask on a later flow.
  // The dismissal persist is async; flush microtasks so the in-memory
  // profile reflects the recorded nameAsked before the re-check.
  await new Promise((resolve) => setTimeout(resolve, 0));
  composition.beginNameFlow();
  assert.equal(root.querySelector(`.${NAME_PROMPT_ROOT_CLASS}`), null, 'never re-asked after dismissal');
});

test('empty name on Enter never persists and refocuses the input', async () => {
  const machine = createCandiceStateMachine();
  const root = new FakeElement('div');
  const captions = new FakeCaptions();
  const adapter = new FakeAdapter();
  const composition = await initializeCandiceInteractionComposition(
    root as unknown as HTMLElement,
    machine,
    captions,
    {
      profile: freshProfile(),
      prefsLoad: loadResult(freshProfile()),
      invokeAdapter: adapter,
      doc: new FakeDocument() as unknown as Document,
    },
  );
  composition.beginNameFlow();
  const input = root.querySelector('input');
  input!.value = '   ';
  input!.focused = false;
  input!.dispatch('keydown', { key: 'Enter' });

  assert.equal(adapter.calls.length, 0, 'no save for an empty name');
  assert.equal(root.querySelector(`.${NAME_PROMPT_ROOT_CLASS}`) !== null, true, 'prompt stays mounted');
  assert.equal(input!.focused, true, 'input refocused');
});

test('existing name: beginNameFlow announces the welcome-back greeting, never mounts a prompt', async () => {
  const machine = createCandiceStateMachine();
  const root = new FakeElement('div');
  const captions = new FakeCaptions();
  const profile = { ...freshProfile(), preferredName: 'Trevor', nameAsked: { askedAt: '2026-08-01T00:00:00.000Z' } };
  const composition = await initializeCandiceInteractionComposition(
    root as unknown as HTMLElement,
    machine,
    captions,
    { profile, prefsLoad: loadResult(profile), doc: new FakeDocument() as unknown as Document },
  );
  composition.beginNameFlow();
  assert.equal(root.querySelector(`.${NAME_PROMPT_ROOT_CLASS}`), null, 'no prompt for a known user');
  assert.ok(captions.announced.includes('Welcome back, Trevor'), 'welcome-back greeting announced');
});

test('changeName re-opens the prompt for the spec-4 "change later" action', async () => {
  const machine = createCandiceStateMachine();
  const root = new FakeElement('div');
  const captions = new FakeCaptions();
  const profile = { ...freshProfile(), preferredName: 'Trevor', nameAsked: { askedAt: '2026-08-01T00:00:00.000Z' } };
  const composition = await initializeCandiceInteractionComposition(
    root as unknown as HTMLElement,
    machine,
    captions,
    { profile, prefsLoad: loadResult(profile), doc: new FakeDocument() as unknown as Document },
  );
  composition.changeName();
  assert.ok(root.querySelector(`.${NAME_PROMPT_ROOT_CLASS}`) !== null, 'prompt re-opened on demand');
});

// ------------------------------------------------------------ persistence

test('persist: successful save updates the in-memory profile and dataset evidence', async () => {
  const machine = createCandiceStateMachine();
  const root = new FakeElement('div');
  const captions = new FakeCaptions();
  const adapter = new FakeAdapter();
  const composition = await initializeCandiceInteractionComposition(
    root as unknown as HTMLElement,
    machine,
    captions,
    {
      profile: freshProfile(),
      prefsLoad: loadResult(freshProfile()),
      invokeAdapter: adapter,
      doc: new FakeDocument() as unknown as Document,
    },
  );
  const saved = await composition.persist({ voiceOutputEnabled: false });
  assert.equal(saved, true);
  assert.equal(composition.profile.voiceOutputEnabled, false);
  assert.equal(root.dataset.candiceVoiceOutput, 'false');
  const save = adapter.calls.find((c) => c.command === 'cmd_save_profile');
  assert.equal((save?.args?.doc as Record<string, unknown>).voiceOutputEnabled, false);
});

test('persist: a failed native save returns false and never mutates the profile or dataset', async () => {
  const machine = createCandiceStateMachine();
  const root = new FakeElement('div');
  const captions = new FakeCaptions();
  const adapter = new FakeAdapter();
  adapter.saveResult = false;
  const composition = await initializeCandiceInteractionComposition(
    root as unknown as HTMLElement,
    machine,
    captions,
    {
      profile: freshProfile(),
      prefsLoad: loadResult(freshProfile()),
      invokeAdapter: adapter,
      doc: new FakeDocument() as unknown as Document,
    },
  );
  const saved = await composition.persist({ voiceOutputEnabled: false });
  assert.equal(saved, false);
  assert.equal(composition.profile.voiceOutputEnabled, true, 'in-memory profile unchanged');
  assert.equal(root.dataset.candiceVoiceOutput, 'true', 'dataset evidence unchanged');
});

test('destroy removes a mounted prompt', async () => {
  const machine = createCandiceStateMachine();
  const root = new FakeElement('div');
  const captions = new FakeCaptions();
  const composition = await initializeCandiceInteractionComposition(
    root as unknown as HTMLElement,
    machine,
    captions,
    { profile: freshProfile(), prefsLoad: loadResult(freshProfile()), doc: new FakeDocument() as unknown as Document },
  );
  composition.beginNameFlow();
  assert.ok(root.querySelector(`.${NAME_PROMPT_ROOT_CLASS}`) !== null);
  composition.destroy();
  assert.equal(root.querySelector(`.${NAME_PROMPT_ROOT_CLASS}`), null, 'prompt removed on destroy');
});

// -------------------------------------------- WebKit DOM-token regression
//
// The packaged macOS build runs in WKWebView, not Node. `root.dataset[
// INTERACTION_COMPOSITION_SENTINEL]` threw a SyntaxError DOMException there
// ("The string did not match the expected pattern.") because the sentinel is
// a hyphenated attribute token, not a legal DOMStringMap key. Boot aborted at
// `initialize-runtime-composition` and the window showed the text-fallback
// card instead of the hologram. These tests assert on the TOKENS themselves,
// so they hold without a WebKit engine to run in.

test('CONTROL: the fake DOMStringMap rejects the same keys a real engine rejects', () => {
  // A negative result from the tests below is only meaningful if this guard
  // actually discriminates. Prove it fires on the illegal key and stays out
  // of the way for the legal one.
  const element = new FakeElement('div');
  assert.throws(
    () => { element.dataset['candice-interaction-composition'] = 'active'; },
    (error: unknown) => error instanceof Error
      && error.name === 'SyntaxError'
      && error.message === 'The string did not match the expected pattern.',
    'a hyphen followed by an ASCII lower alpha must throw SyntaxError',
  );
  assert.doesNotThrow(() => { element.dataset.candiceInteractionComposition = 'ok'; });
  assert.equal(
    element.getAttribute('data-candice-interaction-composition'),
    'ok',
    'the legal camelCase key maps to the same attribute the sentinel names',
  );
});

test('the composition sentinel is a valid, non-empty data-* attribute token', () => {
  assert.ok(
    INTERACTION_COMPOSITION_SENTINEL.length > 0,
    'the packaged-bundle sentinel must be non-empty',
  );
  assert.equal(
    INTERACTION_COMPOSITION_ATTR,
    `data-${INTERACTION_COMPOSITION_SENTINEL}`,
    'the attribute is the sentinel the bundle assertion greps for',
  );
  assert.match(
    INTERACTION_COMPOSITION_ATTR,
    LEGAL_DATA_ATTRIBUTE,
    'the attribute name must be lowercase, non-empty and free of edge hyphens',
  );
  // The reason the attribute exists: the sentinel itself is NOT a usable
  // dataset key, so it must never be handed to a DOMStringMap.
  assert.match(
    INTERACTION_COMPOSITION_SENTINEL,
    ILLEGAL_DATASET_KEY,
    'the sentinel is hyphenated; writing it through `dataset` is a SyntaxError',
  );
});

test('every attribute the composition writes is a valid, non-empty token', async () => {
  const machine = createCandiceStateMachine();
  const root = new FakeElement('div');
  const captions = new FakeCaptions();
  const profile = { ...freshProfile(), preferredName: 'Trevor' };
  await initializeCandiceInteractionComposition(
    root as unknown as HTMLElement,
    machine,
    captions,
    { profile, prefsLoad: loadResult(profile), doc: new FakeDocument() as unknown as Document },
  );
  assert.equal(
    root.getAttribute(INTERACTION_COMPOSITION_ATTR),
    'active',
    'mount evidence lands on the sentinel attribute',
  );
  const names = [...root.attributes.keys()];
  assert.ok(names.length > 0, 'the composition writes at least one attribute');
  for (const name of names) {
    assert.ok(name.length > 0, 'attribute names are never empty');
    assert.equal(name, name.toLowerCase(), `attribute ${name} must be lowercase`);
    assert.doesNotMatch(name, /(^-|-$|--|\s)/, `attribute ${name} has a malformed token`);
  }
});

// ------------------------------ the name flow never overwrites a live question
//
// The composition root defers beginNameFlow() until after the bridge is
// installed, but the bridge can deliver a question DURING that install. The
// caption region is the only place the user can read the governed question, so
// neither the first-run name question nor the welcome-back greeting may
// announce over it. Observed live: the window showed "Hi, I'm Candice. What's
// your name?" / "Welcome back, Trevor" while the delivered interview question
// was nowhere on screen.

/** Put the machine in the exact state a delivered question leaves behind. */
function machineWithPendingQuestion(question: string): CandiceStateMachine {
  const machine = createCandiceStateMachine();
  machine.transition({ type: 'session:begin' });
  machine.transition({ type: 'question:received', question });
  assert.equal(
    machine.getState().pendingQuestion,
    question,
    'guard: the fixture really did leave a question pending',
  );
  return machine;
}

test('a pending question survives the first-run name prompt (no caption announce)', async () => {
  const machine = machineWithPendingQuestion('What are we building?');
  const root = new FakeElement('div');
  const captions = new FakeCaptions();
  const composition = await initializeCandiceInteractionComposition(
    root as unknown as HTMLElement,
    machine,
    captions,
    { profile: freshProfile(), prefsLoad: loadResult(freshProfile()), doc: new FakeDocument() as unknown as Document },
  );
  composition.beginNameFlow();
  assert.ok(
    root.querySelector(`.${NAME_PROMPT_ROOT_CLASS}`) !== null,
    'the prompt still mounts: spec 4 is not skipped, only its caption announce is',
  );
  assert.ok(
    textOf(root).includes(NAME_QUESTION_TEXT),
    'the prompt still shows its own question text to the user',
  );
  assert.deepEqual(captions.announced, [], 'nothing was announced over the delivered question');
});

test('a pending question survives the welcome-back greeting', async () => {
  const machine = machineWithPendingQuestion('What are we building?');
  const root = new FakeElement('div');
  const captions = new FakeCaptions();
  const profile = { ...freshProfile(), preferredName: 'Trevor', nameAsked: { askedAt: '2026-08-25T00:00:00.000Z' } };
  const composition = await initializeCandiceInteractionComposition(
    root as unknown as HTMLElement,
    machine,
    captions,
    { profile, prefsLoad: loadResult(profile), doc: new FakeDocument() as unknown as Document },
  );
  composition.beginNameFlow();
  assert.deepEqual(captions.announced, [], 'the greeting never overwrites the governed question');
});

test('CONTROL: with NO question pending the name flow still announces normally', async () => {
  // Without this the tests above would pass even if the announce were deleted
  // outright. Same code path, only the pending question removed.
  const machine = createCandiceStateMachine();
  assert.equal(machine.getState().pendingQuestion, null, 'guard: no question pending');
  const root = new FakeElement('div');
  const captions = new FakeCaptions();
  const composition = await initializeCandiceInteractionComposition(
    root as unknown as HTMLElement,
    machine,
    captions,
    { profile: freshProfile(), prefsLoad: loadResult(freshProfile()), doc: new FakeDocument() as unknown as Document },
  );
  composition.beginNameFlow();
  assert.deepEqual(captions.announced, [NAME_QUESTION_TEXT], 'the name question is still announced');

  const back = new FakeElement('div');
  const backCaptions = new FakeCaptions();
  const known = { ...freshProfile(), preferredName: 'Trevor', nameAsked: { askedAt: '2026-08-25T00:00:00.000Z' } };
  const returning = await initializeCandiceInteractionComposition(
    back as unknown as HTMLElement,
    createCandiceStateMachine(),
    backCaptions,
    { profile: known, prefsLoad: loadResult(known), doc: new FakeDocument() as unknown as Document },
  );
  returning.beginNameFlow();
  assert.deepEqual(backCaptions.announced, ['Welcome back, Trevor'], 'the greeting is still announced');
});
