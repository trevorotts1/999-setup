/**
 * Native partial-input-region adapter and the region controller.
 *
 * The property under defense is fail-closed behavior. `input-policy.ts`
 * promises that an adapter which cannot prove installation drops the window
 * back to whole-window pass-through. If that promise breaks, a shell with a
 * broken or missing native command leaves a 420x640 invisible rectangle
 * capturing clicks over the operator's Terminal.
 *
 * So: every "native did not clearly say yes" path is asserted here, and the
 * end-to-end wiring is asserted against the REAL `createWindowInputPolicy`
 * rather than a stand-in, because the fail-closed logic lives in that
 * function and is the thing that must not regress.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SET_INPUT_REGIONS_COMMAND,
  createInputRegionController,
  createNativeInputRegionAdapter,
} from '../native-input-regions.ts';
import { createWindowInputPolicy, type InputRegion } from '../input-policy.ts';
import { CHARACTER_SELECTOR, CONTROL_SELECTOR } from '../visible-regions.ts';

// ------------------------------------------------------------------- fakes

class FakeCursorWindow {
  calls: boolean[] = [];
  setIgnoreCursorEvents(ignore: boolean): Promise<void> {
    this.calls.push(ignore);
    return Promise.resolve();
  }
}

const REGION: InputRegion = { x: 10, y: 20, width: 100, height: 40, purpose: 'drag-handle' };

// --------------------------------------------------------------- the adapter

test('adapter forwards the regions verbatim on the documented command', async () => {
  const seen: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const adapter = createNativeInputRegionAdapter(async (command, args) => {
    seen.push({ command, args });
    return true;
  });
  assert.equal(await adapter.setInteractiveRegions([REGION]), true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.command, SET_INPUT_REGIONS_COMMAND);
  assert.deepEqual(seen[0]?.args, {
    regions: [{ x: 10, y: 20, width: 100, height: 40, purpose: 'drag-handle' }],
  });
});

test('adapter treats anything but an explicit true as NOT installed', async () => {
  // A shell without the command resolves undefined; an older shell might
  // resolve null or a status string. None of those prove installation, and
  // guessing costs the operator's Terminal.
  for (const reply of [undefined, null, false, 'ok', 1, {}]) {
    const adapter = createNativeInputRegionAdapter(async () => reply);
    assert.equal(
      await adapter.setInteractiveRegions([REGION]),
      false,
      `reply ${JSON.stringify(reply) ?? 'undefined'} must not count as installed`,
    );
  }
});

test('adapter reports not-installed instead of throwing when IPC rejects', async () => {
  const adapter = createNativeInputRegionAdapter(async () => {
    throw new Error('ipc down');
  });
  assert.equal(await adapter.setInteractiveRegions([REGION]), false);
});

// ------------------------------------------- adapter + real policy, together

test('a rejecting adapter drops the REAL policy back to pass-through', async () => {
  const win = new FakeCursorWindow();
  const policy = createWindowInputPolicy(
    win,
    createNativeInputRegionAdapter(async () => false),
  );
  assert.equal(await policy.setInteractiveRegions([REGION]), false);
  assert.equal(policy.mode, 'pass-through', 'a refused install must not claim partial mode');
  assert.deepEqual(win.calls, [true], 'the window was put back into ignore-cursor-events');
});

test('an installing adapter puts the REAL policy into partial-interactive', async () => {
  const win = new FakeCursorWindow();
  const policy = createWindowInputPolicy(
    win,
    createNativeInputRegionAdapter(async () => true),
  );
  assert.equal(await policy.setInteractiveRegions([REGION]), true);
  assert.equal(policy.mode, 'partial-interactive');
  assert.deepEqual(win.calls, [], 'no pass-through reassertion is needed on success');
});

// ---------------------------------------------------------------- controller

interface StubStyle {
  display: string;
  visibility: string;
  opacity: string;
  objectFit: string;
  contentVisibility: string;
}

class StubElement {
  parentElement: StubElement | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  rect = { x: 0, y: 0, width: 0, height: 0 };
  readonly ownerDocument: { defaultView: StubView };

  constructor(view: StubView) {
    this.ownerDocument = { defaultView: view };
  }

  getBoundingClientRect(): { x: number; y: number; width: number; height: number } {
    return { ...this.rect };
  }
}

class StubView {
  innerWidth = 420;
  innerHeight = 640;
  addEventListener(): void {}
  removeEventListener(): void {}
  getComputedStyle(): StubStyle {
    return {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      objectFit: 'fill',
      contentVisibility: 'visible',
    };
  }
}

/** Root that owns a mutable control list, so a test can change what paints. */
class StubRoot {
  controls: StubElement[] = [];
  readonly ownerDocument: { defaultView: StubView };

  constructor(view: StubView) {
    this.ownerDocument = { defaultView: view };
  }

  querySelectorAll(selector: string): StubElement[] {
    if (selector === CHARACTER_SELECTOR) return [];
    if (selector === CONTROL_SELECTOR) return this.controls;
    throw new Error(`unexpected selector: ${selector}`);
  }

  addEventListener(): void {}
  removeEventListener(): void {}
}

class RecordingPolicy {
  mode = 'pass-through' as const;
  installs: InputRegion[][] = [];
  passThroughCalls = 0;
  installResult = true;

  enablePassThrough(): Promise<boolean> {
    this.passThroughCalls += 1;
    return Promise.resolve(true);
  }

  setInteractiveRegions(regions: readonly InputRegion[]): Promise<boolean> {
    this.installs.push([...regions]);
    return Promise.resolve(this.installResult);
  }
}

function stubControl(view: StubView, rect: Partial<StubElement['rect']>): StubElement {
  const el = new StubElement(view);
  el.rect = { x: 0, y: 0, width: 0, height: 0, ...rect };
  return el;
}

function makeController(policy: RecordingPolicy, root: StubRoot) {
  return createInputRegionController({
    // The controller only reads structurally; the stubs satisfy that.
    policy: policy as unknown as Parameters<typeof createInputRegionController>[0]['policy'],
    root: root as unknown as HTMLElement,
    // A long interval keeps the safety timer out of these assertions; the
    // tests drive refresh() directly. dispose() clears it either way.
    intervalMs: 1_000_000,
  });
}

test('controller publishes measured regions once and skips the unchanged republish', async () => {
  const view = new StubView();
  const root = new StubRoot(view);
  root.controls = [stubControl(view, { x: 50, y: 60, width: 100, height: 30 })];
  const policy = new RecordingPolicy();
  const controller = makeController(policy, root);
  try {
    assert.equal(await controller.refresh(), true);
    assert.equal(policy.installs.length, 1);
    assert.deepEqual(policy.installs[0], [
      { x: 46, y: 56, width: 108, height: 38, purpose: 'control' },
    ]);
    assert.equal(controller.installed, true);

    // Nothing moved: republishing would be pure IPC churn.
    assert.equal(await controller.refresh(), true);
    assert.equal(policy.installs.length, 1, 'an unchanged measurement is not republished');
  } finally {
    controller.dispose();
  }
});

test('controller republishes when a surface actually moves', async () => {
  const view = new StubView();
  const root = new StubRoot(view);
  const control = stubControl(view, { x: 50, y: 60, width: 100, height: 30 });
  root.controls = [control];
  const policy = new RecordingPolicy();
  const controller = makeController(policy, root);
  try {
    await controller.refresh();
    control.rect = { x: 200, y: 300, width: 100, height: 30 };
    await controller.refresh();
    assert.equal(policy.installs.length, 2);
    assert.deepEqual(policy.installs[1], [
      { x: 196, y: 296, width: 108, height: 38, purpose: 'control' },
    ]);
  } finally {
    controller.dispose();
  }
});

test('controller falls back to pass-through when nothing paints any more', async () => {
  // This is the case that protects the Terminal: the artwork unmounts, so
  // there is no visible pixel left, so the window must stop capturing.
  const view = new StubView();
  const root = new StubRoot(view);
  root.controls = [stubControl(view, { x: 50, y: 60, width: 100, height: 30 })];
  const policy = new RecordingPolicy();
  const controller = makeController(policy, root);
  try {
    await controller.refresh();
    assert.equal(controller.installed, true);

    root.controls = [];
    assert.equal(await controller.refresh(), false);
    assert.equal(policy.passThroughCalls, 1, 'pass-through is reasserted, not merely implied');
    assert.equal(controller.installed, false);
    assert.deepEqual(controller.regions, []);
  } finally {
    controller.dispose();
  }
});

test('controller never reports installed when the policy refused', async () => {
  const view = new StubView();
  const root = new StubRoot(view);
  root.controls = [stubControl(view, { x: 50, y: 60, width: 100, height: 30 })];
  const policy = new RecordingPolicy();
  policy.installResult = false;
  const controller = makeController(policy, root);
  try {
    assert.equal(await controller.refresh(), false);
    assert.equal(controller.installed, false);
  } finally {
    controller.dispose();
  }
});

test('concurrent refreshes serialize instead of interleaving', async () => {
  const view = new StubView();
  const root = new StubRoot(view);
  const control = stubControl(view, { x: 0, y: 0, width: 100, height: 30 });
  root.controls = [control];
  const policy = new RecordingPolicy();
  const controller = makeController(policy, root);
  try {
    const first = controller.refresh();
    control.rect = { x: 300, y: 400, width: 100, height: 30 };
    const second = controller.refresh();
    await Promise.all([first, second]);
    // The last publish must reflect the last measurement taken, never an
    // older one that finished later.
    const last = policy.installs.at(-1);
    assert.deepEqual(last, [{ x: 296, y: 396, width: 108, height: 38, purpose: 'control' }]);
  } finally {
    controller.dispose();
  }
});

test('dispose is idempotent and stops further publishing', async () => {
  const view = new StubView();
  const root = new StubRoot(view);
  root.controls = [stubControl(view, { x: 0, y: 0, width: 100, height: 30 })];
  const policy = new RecordingPolicy();
  const controller = makeController(policy, root);
  await controller.refresh();
  controller.dispose();
  controller.dispose();
  const before = policy.installs.length;
  await controller.refresh();
  assert.equal(policy.installs.length, before, 'a disposed controller publishes nothing');
});
