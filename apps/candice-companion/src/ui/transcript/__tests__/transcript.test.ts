/**
 * WS-18 transcription confirmation/edit/retry acceptance tests
 * (CHECKLIST E.1 WS-18).
 *
 *   PASS: no voice transcription is submitted to the skill until the user
 *         confirms; EDIT and TRY AGAIN work; confirmed answer counted
 *         exactly once.
 *
 * Runnable with zero deps on Node >= 22.6 (node:test + TS type-stripping),
 * following the lane convention established by WS-07/WS-08/WS-09/WS-17:
 *
 *   node --test apps/candice-companion/src/ui/transcript/__tests__/transcript.test.ts
 *
 * Proves the CONTRACT with the REAL WS-08 state machine (imported, not
 * faked) and the REAL DOM view (FakeEl shim, same convention as the ptt
 * lane): the heard prompt exact spec-6 wording, the show-row gating, the
 * click-path confirmation, the EDIT editor with WS-01 wire-bound
 * validation, TRY AGAIN restart semantics, and the exactly-once
 * submission latch (E.1 WS-18).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createCandiceStateMachine,
  INITIAL_STATE,
  type CandiceState,
} from '../../../state/machine.ts';
import { TRANSCRIPT_LABELS, TRANSCRIPT_MAX_TEXT_LENGTH } from '../config.ts';
import { transcriptModel, validateTranscriptEdit } from '../model.ts';
import { createTranscriptController } from '../controller.ts';

// ------------------------------------------------------- minimal fake DOM
// Same shim convention as `ui/ptt/__tests__/ptt.test.ts` (the WS-09 lane):
// the tiny document surface this view touches. Never a full DOM.

class FakeEl {
  type = '';
  className = '';
  textContent = '';
  hidden = false;
  /** Editor value (textarea mirror in the fake). */
  value = '';
  readonly = false;
  disabled = false;
  rows = 0;
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
      metaKey: ev.metaKey,
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
  findText(text: string): FakeEl | null {
    if (this.textContent === text) return this;
    for (const c of this.children) {
      const hit = c.findText(text);
      if (hit) return hit;
    }
    return null;
  }
}

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

// ------------------------------------------------------------ drive helpers

function stateOf(status: CandiceState['status']): CandiceState {
  return { ...INITIAL_STATE, status };
}

/** Exactly the real pipeline: ptt hold/release -> transcript delivered. */
function driveToConfirming(machine: ReturnType<typeof createCandiceStateMachine>, text: string): void {
  machine.transition({ type: 'ptt:start' });
  machine.transition({ type: 'ptt:stop' });
  machine.transition({ type: 'speech:transcript', transcript: text });
}

function makeController() {
  const machine = createCandiceStateMachine();
  const submitted: string[] = [];
  let retries = 0;
  const ctl = createTranscriptController({
    machine,
    mount: null,
    submitTranscript: (t) => submitted.push(t),
    retryTranscription: () => {
      retries += 1;
    },
  });
  return { machine, ctl, submitted, retries: () => retries };
}

/** Full DOM integration: real view handlers reachable by click. */
function makeMounted() {
  installFakeDom();
  const machine = createCandiceStateMachine();
  const submitted: string[] = [];
  let retries = 0;
  const mount = new FakeEl();
  const ctl = createTranscriptController({
    machine,
    mount: mount as unknown as HTMLElement,
    submitTranscript: (t) => submitted.push(t),
    retryTranscription: () => {
      retries += 1;
    },
  });
  const root = mount.children[0] as FakeEl;
  return {
    machine,
    ctl,
    mount,
    root,
    submitted,
    retries: () => retries,
    click: (el: FakeEl) => el.dispatch('click'),
  };
}

// ------------------------------------------------------------------ model

test('heard prompt + actions use the exact spec-6 wording', () => {
  assert.equal(TRANSCRIPT_LABELS.HEARD, 'Here is what I heard…');
  assert.equal(TRANSCRIPT_LABELS.USE_ANSWER, 'USE ANSWER');
  assert.equal(TRANSCRIPT_LABELS.EDIT, 'EDIT');
  assert.equal(TRANSCRIPT_LABELS.TRY_AGAIN, 'TRY AGAIN');
});

test('confirming with a real transcript: heard + row + canSubmit (E.1 WS-18)', () => {
  const m = transcriptModel({ ...stateOf('confirming'), transcript: 'two plus two' }, {});
  assert.equal(m.heardLabel, 'Here is what I heard…');
  assert.equal(m.transcript, 'two plus two');
  assert.equal(m.confirming, true);
  assert.equal(m.showConfirmRow, true);
  assert.equal(m.canSubmit, true);
  assert.equal(m.retryUsable, true);
  assert.equal(m.active, true);
});

test('submitted latch closed: row gone, canSubmit false, no resurrect', () => {
  const m = transcriptModel(
    { ...stateOf('confirming'), transcript: 'two plus two' },
    { submittedOnce: true },
  );
  assert.equal(m.showConfirmRow, false, 'row hides after submit');
  assert.equal(m.canSubmit, false, 'cannot submit twice');
});

test('transcribing: heard progress only, never submit (spec 6 steps 2-3)', () => {
  const m = transcriptModel(stateOf('transcribing'), {});
  assert.equal(m.heardLabel, 'Here is what I heard…');
  assert.equal(m.transcript, null);
  assert.equal(m.showConfirmRow, false);
  assert.equal(m.canSubmit, false);
  assert.equal(m.retryUsable, false);
});

test('listening: no transcript surface (PTT lane owns the live view)', () => {
  const m = transcriptModel(stateOf('listening'), {});
  assert.equal(m.showConfirmRow, false);
  assert.equal(m.canSubmit, false);
  assert.equal(m.listening, true);
});

test('nothing heard (empty transcript confirming): no submit, TRY AGAIN only', () => {
  const m = transcriptModel(stateOf('confirming'), {});
  assert.equal(m.transcript, null);
  assert.equal(m.showConfirmRow, false, 'never a submit row without a transcript');
  assert.equal(m.canSubmit, false, 'never submit blank (spec 20)');
  assert.equal(m.retryUsable, true, 'TRY AGAIN is the way out');
});

test('idle/thinking/speaking: no transcript surface in interview', () => {
  for (const status of ['idle', 'thinking', 'speaking'] as const) {
    const m = transcriptModel(stateOf(status), {});
    assert.equal(m.showConfirmRow, false, status);
    assert.equal(m.canSubmit, false, status);
  }
});

test('post-interview phase is not a transcript surface (compact owns it)', () => {
  const m = transcriptModel({ ...INITIAL_STATE, phase: 'post-interview', status: 'building' }, {});
  assert.equal(m.active, false);
  assert.equal(m.showConfirmRow, false);
});

test('text-fallback: no transcript surface — terminal owns the question', () => {
  const m = transcriptModel(stateOf('text-fallback'), {});
  assert.equal(m.active, true);
  assert.equal(m.showConfirmRow, false);
});

test('editing opens over the unconfirmed transcript and blocks submit', () => {
  const m = transcriptModel(
    { ...stateOf('confirming'), transcript: 'twoplusplus' },
    { editDraft: 'two plus two' },
  );
  assert.equal(m.editing, true);
  assert.equal(m.editDraft, 'two plus two');
  assert.equal(m.showConfirmRow, false, 'editor replaces the action row');
  assert.equal(m.canSubmit, false, 'no submit path while editing');
  assert.equal(m.retryUsable, false, 'no re-record while editing a draft');
  assert.deepEqual(m.editValidity, { ok: true, reason: null, error: null });
});

// ------------------------------------------------------- edit validation

test('edit validation mirrors the WS-01 wire bounds (1..4096)', () => {
  assert.deepEqual(validateTranscriptEdit(''), { ok: false, reason: 'empty', error: TRANSCRIPT_LABELS.EMPTY_ERROR });
  assert.deepEqual(validateTranscriptEdit('   '), { ok: false, reason: 'empty', error: TRANSCRIPT_LABELS.EMPTY_ERROR });
  assert.equal(validateTranscriptEdit('4').ok, true);
  assert.equal(validateTranscriptEdit('x'.repeat(TRANSCRIPT_MAX_TEXT_LENGTH)).ok, true);
  const tooLong = validateTranscriptEdit('x'.repeat(TRANSCRIPT_MAX_TEXT_LENGTH + 1));
  assert.deepEqual(tooLong, { ok: false, reason: 'too-long', error: TRANSCRIPT_LABELS.TOO_LONG_ERROR });
});

test('wire bound matches the WS-04 runtime maximum (4096)', () => {
  // MIRROR of plugins/candice-integration/mcp/ask-user/validate.js
  // MAX_TEXT_LENGTH=4096 (WS-04), which mirrors answer-event.schema.json
  // `answerText` max 4096 (WS-01). The lane must never diverge.
  assert.equal(TRANSCRIPT_MAX_TEXT_LENGTH, 4096);
});

// ------------------------------------------------ the exact-once proof

test('E.1 WS-18: nothing submitted before USE ANSWER (real click path)', () => {
  const t = makeMounted();
  driveToConfirming(t.machine, 'hello candice');
  t.ctl.render();
  assert.equal(t.machine.getState().status, 'confirming');
  assert.equal(t.submitted.length, 0, 'transcript delivered but NOT submitted');
  assert.equal(t.ctl.confirmedOnce(), false);
  // The heard prompt and the transcript are on the real surface.
  assert.notEqual(t.root.findText(TRANSCRIPT_LABELS.HEARD), null);
  assert.notEqual(t.root.findText('hello candice'), null);
  uninstallFakeDom();
});

test('E.1 WS-18: USE ANSWER submits exactly once, latch closes (real click)', () => {
  const t = makeMounted();
  driveToConfirming(t.machine, 'hello candice');
  t.ctl.render();
  const use = t.root.findText(TRANSCRIPT_LABELS.USE_ANSWER) as FakeEl;
  assert.equal(use.hidden, false, 'action row visible while confirming');
  t.click(use);
  assert.deepEqual(t.submitted, ['hello candice'], 'exactly one submission');
  assert.equal(t.ctl.confirmedOnce(), true);
  assert.equal(t.machine.getState().status, 'thinking', 'machine recorded the answer');
  assert.equal(t.machine.getState().pendingQuestion, null, 'question answered');
  // Second click on the same row: row hidden and button disabled by render;
  // plus the latch double-belt — nothing can re-submit (spec 5.1/6).
  t.click(use);
  assert.deepEqual(t.submitted, ['hello candice'], 'never a second submission');
  uninstallFakeDom();
});

test('E.1 WS-18: EDIT opens the editor on the unconfirmed transcript', () => {
  const t = makeMounted();
  driveToConfirming(t.machine, 'forty two');
  t.ctl.render();
  const edit = t.root.findText(TRANSCRIPT_LABELS.EDIT) as FakeEl;
  t.click(edit);
  const m = t.ctl.model();
  assert.equal(m.editing, true);
  assert.equal(m.editDraft, 'forty two', 'editor pre-filled with the transcript');
  assert.equal(m.showConfirmRow, false);
  assert.equal(t.submitted.length, 0, 'opening the editor submits nothing');
  uninstallFakeDom();
});

test('E.1 WS-18: SAVE submits the corrected text exactly once', () => {
  const t = makeMounted();
  driveToConfirming(t.machine, 'forty two');
  t.ctl.render();
  (t.root.findText(TRANSCRIPT_LABELS.EDIT) as FakeEl).dispatch('click');
  const editor = t.root.findFirst('textarea') as FakeEl;
  assert.notEqual(editor, null);
  // The user types a correction: FakeEl value + input event (the real
  // path the view uses — onEditChange keeps the controller's draft live).
  editor.value = 'forty-two';
  editor.dispatch('input');
  const save = t.root.findText(TRANSCRIPT_LABELS.SAVE) as FakeEl;
  // FakeEl needs the render-gated disabled state; assert the controller's
  // model is valid before the click, then click SAVE.
  assert.equal(t.ctl.model().editValidity?.ok, true);
  t.click(save);
  assert.deepEqual(t.submitted, ['forty-two'], 'corrected text submitted once');
  assert.equal(t.ctl.confirmedOnce(), true);
  assert.equal(t.machine.getState().status, 'thinking');
  uninstallFakeDom();
});

test('E.1 WS-18: CANCEL closes the editor; nothing submitted; row returns', () => {
  const t = makeMounted();
  driveToConfirming(t.machine, 'forty two');
  t.ctl.render();
  (t.root.findText(TRANSCRIPT_LABELS.EDIT) as FakeEl).dispatch('click');
  const editor = t.root.findFirst('textarea') as FakeEl;
  assert.notEqual(editor, null, 'editor mounted');
  const cancel = t.root.findText(TRANSCRIPT_LABELS.CANCEL) as FakeEl;
  t.click(cancel);
  const m = t.ctl.model();
  assert.equal(m.editing, false);
  assert.equal(m.transcript, 'forty two', 'original unsubmitted transcript back');
  assert.equal(m.showConfirmRow, true, 'confirm row returns');
  assert.equal(t.submitted.length, 0, 'cancel submits nothing');
  uninstallFakeDom();
});

test('E.1 WS-18: TRY AGAIN discards only the unconfirmed transcript (real click)', () => {
  const t = makeMounted();
  driveToConfirming(t.machine, 'bad take');
  t.ctl.render();
  const retry = t.root.findText(TRANSCRIPT_LABELS.TRY_AGAIN) as FakeEl;
  t.click(retry);
  assert.equal(t.machine.getState().status, 'listening', 'mic re-armed');
  assert.equal(t.machine.getState().transcript, null, 'unconfirmed transcript discarded');
  assert.equal(t.ctl.confirmedOnce(), false, 'nothing was ever submitted');
  assert.equal(t.submitted.length, 0);
  t.ctl.handle({ type: 'ptt:stop' });
  t.ctl.handle({ type: 'speech:transcript', transcript: 'second take' });
  const m = t.ctl.model();
  assert.equal(m.transcript, 'second take', 'new take must be confirmed again');
  assert.equal(m.showConfirmRow, true);
  assert.equal(t.submitted.length, 0, 'still nothing submitted after the retake');
  uninstallFakeDom();
});

test('E.1 WS-18: empty correction is blocked — never submit blank (spec 20)', () => {
  const t = makeMounted();
  driveToConfirming(t.machine, 'forty two');
  t.ctl.render();
  (t.root.findText(TRANSCRIPT_LABELS.EDIT) as FakeEl).dispatch('click');
  const editor = t.root.findFirst('textarea') as FakeEl;
  editor.value = '   ';
  editor.dispatch('input');
  assert.equal(t.ctl.model().editValidity?.reason, 'empty');
  const save = t.root.findText(TRANSCRIPT_LABELS.SAVE) as FakeEl;
  assert.equal(save.disabled, true, 'SAVE disabled while the edit is invalid');
  t.click(save);
  assert.equal(t.submitted.length, 0, 'blank never submitted');
  assert.equal(t.ctl.confirmedOnce(), false);
  uninstallFakeDom();
});

test('E.1 WS-18: over-length correction is blocked (WS-01 wire bound)', () => {
  const t = makeMounted();
  driveToConfirming(t.machine, 'short');
  t.ctl.render();
  (t.root.findText(TRANSCRIPT_LABELS.EDIT) as FakeEl).dispatch('click');
  const editor = t.root.findFirst('textarea') as FakeEl;
  editor.value = 'x'.repeat(TRANSCRIPT_MAX_TEXT_LENGTH + 1);
  editor.dispatch('input');
  assert.equal(t.ctl.model().editValidity?.reason, 'too-long');
  const save = t.root.findText(TRANSCRIPT_LABELS.SAVE) as FakeEl;
  assert.equal(save.disabled, true);
  t.click(save);
  assert.equal(t.submitted.length, 0, 'over-length never submitted');
  uninstallFakeDom();
});

// ------------------------------------------------------------- view safety

test('controller: headless mount never throws on any machine path (spec 20)', () => {
  const { ctl } = makeController();
  assert.doesNotThrow(() => {
    ctl.handle({ type: 'ptt:start' });
    ctl.handle({ type: 'ptt:stop' });
    ctl.handle({ type: 'speech:transcript', transcript: 'x' });
    ctl.render();
    ctl.handle({ type: 'question:received', question: 'What is 2+2?' });
    ctl.handle({ type: 'answer:delegate-to-claude' });
    ctl.destroy();
  });
  assert.doesNotThrow(() => ctl.destroy(), 'destroy is idempotent');
});

test('controller: new question re-arms the latch (per-question, not per-session)', () => {
  const { machine, ctl } = makeController();
  driveToConfirming(machine, 'fourty two');
  ctl.handle({ type: 'answer:confirmed', transcript: 'fourty two' });
  assert.equal(ctl.confirmedOnce(), true);
  ctl.handle({ type: 'question:received', question: 'Next question?' });
  assert.equal(ctl.confirmedOnce(), false, 'latch re-armed for the new question');
  const m = ctl.model();
  assert.equal(m.showConfirmRow, false, 'no stale confirm row on the new question');
});

test('controller: unknown events never throw and never submit (spec 20)', () => {
  const { ctl } = makeController();
  assert.doesNotThrow(() => ctl.handle({ type: 'session:begin' }));
  assert.doesNotThrow(() => ctl.handle({ type: 'speech:interrupted' }));
  assert.doesNotThrow(() => ctl.handle({ type: 'compact:enter' }));
  assert.equal(ctl.confirmedOnce(), false);
});

test('controller: submit never fires for a blank transcript (spec 20)', () => {
  const t = makeMounted();
  // STT produced nothing: machine in confirming with null transcript.
  t.machine.transition({ type: 'ptt:start' });
  t.machine.transition({ type: 'ptt:stop' });
  t.ctl.render();
  assert.equal(t.ctl.model().canSubmit, false, 'no submit row for nothing-heard');
  assert.equal(t.submitted.length, 0);
  uninstallFakeDom();
});
