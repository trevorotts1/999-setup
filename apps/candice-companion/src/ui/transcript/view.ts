/**
 * Transcript confirmation/edit/retry DOM surface (Master Spec 0E WS-18,
 * spec 6 / 5.1).
 *
 * The transcript surface owns:
 *  - the heard prompt — exact `Here is what I heard…` (spec 6 step 3);
 *  - the transcript display (the unconfirmed text, spec 6 step 4);
 *  - the confirmation actions USE ANSWER / EDIT / TRY AGAIN (spec 6 step
 *    5) — USE ANSWER is disabled unless the model gates it (real
 *    `confirming` + real transcript + submission latch open);
 *  - the EDIT editor: a textarea pre-filled with the transcript, SAVE
 *    (validates against the WS-01 wire bounds, 1..4096 — mirrored from
 *    answer-event.schema.json `answerText` and WS-04 validate.js
 *    MAX_TEXT_LENGTH) and CANCEL (returns to the unsubmitted transcript);
 *  - the nothing-heard state (STT returned empty): no submit surface,
 *    TRY AGAIN only (spec 20 — never submit a blank answer).
 *
 * Never:
 *  - fires machine events itself (the controller does — the machine is
 *    the only transition authority),
 *  - submits anything (the controller's latch is the only submit gate),
 *  - paints a baked background (WS-07 transparent-window invariant: style
 *    text is variable references only),
 *  - reads/writes prefs or session state.
 *
 * @module
 */

import {
  TRANSCRIPT_ACTIONS_CLASS,
  TRANSCRIPT_EDITOR_CLASS,
  TRANSCRIPT_HEARD_CLASS,
  TRANSCRIPT_LABELS,
  TRANSCRIPT_ROOT_CLASS,
  TRANSCRIPT_STYLE_ID,
} from './config.ts';
import type { TranscriptModel } from './model.ts';

/**
 * Style contract. Variable references only, no baked background (the
 * WS-07 transparent-window invariant forbids hex/rgba backgrounds).
 */
export const TRANSCRIPT_STYLE_TEXT = `
.candice-transcript {
  --candice-tx-text: var(--candice-text, #faf7ff);
  --candice-tx-muted: var(--candice-muted, #d7cfdf);
  --candice-tx-accent: var(--candice-accent, #7c5cff);
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 420px;
  padding: 10px 14px;
  font-size: 14px;
  line-height: 1.35;
  color: var(--candice-tx-text);
}
.candice-transcript-heard {
  color: var(--candice-tx-muted);
  margin: 0;
}
.candice-transcript-text {
  margin: 0;
  max-width: 380px;
  overflow-wrap: anywhere;
}
.candice-transcript-notheard {
  color: var(--candice-tx-muted);
  margin: 0;
}
/* The "display" in the rule below beats the user-agent [hidden] rule, so
   setting .hidden = true alone cannot hide this element. */
.candice-transcript-editor[hidden] {
  display: none;
}
.candice-transcript-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}
.candice-transcript-input {
  width: 100%;
  min-height: 64px;
  border: 1px solid var(--candice-tx-muted);
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  padding: 10px 12px;
  resize: vertical;
  box-sizing: border-box;
}
.candice-transcript-input:focus-visible {
  outline: 2px solid var(--candice-tx-accent);
  outline-offset: 2px;
}
.candice-transcript-input[data-invalid='true'] {
  border-color: var(--candice-danger, #e5484d);
}
/* The "display" in the rule below beats the user-agent [hidden] rule, so
   setting .hidden = true alone cannot hide this element. */
.candice-transcript-error[hidden] {
  display: none;
}
.candice-transcript-error {
  color: var(--candice-danger, #e5484d);
  margin: 0;
}
.candice-transcript-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.candice-transcript-actions[hidden] {
  display: none;
}
.candice-transcript-button {
  border: 1px solid var(--candice-tx-accent);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 600;
  padding: 8px 16px;
  cursor: pointer;
}
.candice-transcript-button:disabled {
  opacity: 0.45;
  cursor: default;
}
.candice-transcript-button:focus-visible {
  outline: 2px solid var(--candice-tx-accent);
  outline-offset: 2px;
}
.candice-transcript-link {
  border: 0;
  background: transparent;
  color: var(--candice-tx-muted);
  font: inherit;
  padding: 4px 6px;
  cursor: pointer;
}
.candice-transcript-link:focus-visible {
  outline: 2px solid var(--candice-tx-accent);
  outline-offset: 2px;
}
.candice-transcript-link:hover {
  color: var(--candice-tx-accent);
  text-decoration: underline;
}
`;

/** Set once by the first DOM-capable creation. */
let styleMounted = false;

/** Mount the transcript style sheet once (idempotent, headless-safe). */
export function mountTranscriptStyle(): void {
  if (typeof document === 'undefined') return;
  if (styleMounted) return;
  if (document.getElementById(TRANSCRIPT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = TRANSCRIPT_STYLE_ID;
  style.textContent = TRANSCRIPT_STYLE_TEXT;
  (document.head ?? document.documentElement).append(style);
  styleMounted = true;
}

export interface TranscriptViewHandlers {
  /** USE ANSWER — confirm the current transcript (spec 6 step 5). */
  onUseAnswer(): void;
  /** EDIT — open the editor on the unconfirmed transcript. */
  onEdit(): void;
  /** The user typed in the editor — draft moved to the controller. */
  onEditChange(text: string): void;
  /** SAVE — validate the draft and submit (still the exact-once gate). */
  onSave(): void;
  /** CANCEL — close the editor, transcript stays unsubmitted. */
  onCancel(): void;
  /** TRY AGAIN — discard the unconfirmed transcript and re-record. */
  onTryAgain(): void;
}

export interface TranscriptView {
  /** Root element (null when mount was null — no-op view, spec 20). */
  readonly el: HTMLElement | null;
  /** Pure render of the model. */
  setModel(model: TranscriptModel): void;
  destroy(): void;
}

/** Empty no-op view — DOM absence must never throw (spec 20). */
function nullView(): TranscriptView {
  return {
    el: null,
    setModel() {},
    destroy() {},
  };
}

/**
 * Create the transcript confirmation surface. Takes an explicit mount
 * element (the shell or tests hand it in; this lane never owns
 * document.querySelector). Never throws — DOM absence degrades to no-op.
 */
export function createTranscriptView(
  mount: HTMLElement | null,
  handlers: TranscriptViewHandlers,
): TranscriptView {
  if (mount === null || typeof document === 'undefined') return nullView();
  mountTranscriptStyle();
  mount.innerHTML = '';

  const root = document.createElement('div');
  root.className = TRANSCRIPT_ROOT_CLASS;

  const heard = document.createElement('p');
  heard.className = TRANSCRIPT_HEARD_CLASS;
  heard.setAttribute('role', 'status');

  const text = document.createElement('p');
  text.className = 'candice-transcript-text';
  text.setAttribute('role', 'status');

  const notHeard = document.createElement('p');
  notHeard.className = 'candice-transcript-notheard';
  notHeard.textContent = TRANSCRIPT_LABELS.NOTHING_HEARD;

  const actions = document.createElement('div');
  actions.className = TRANSCRIPT_ACTIONS_CLASS;
  actions.hidden = true;

  const use = document.createElement('button');
  use.type = 'button';
  use.className = 'candice-transcript-button';
  use.textContent = TRANSCRIPT_LABELS.USE_ANSWER;
  use.disabled = true;

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'candice-transcript-link';
  edit.textContent = TRANSCRIPT_LABELS.EDIT;

  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'candice-transcript-link';
  retry.textContent = TRANSCRIPT_LABELS.TRY_AGAIN;

  actions.append(use, edit, retry);

  // EDIT editor — textarea + SAVE/CANCEL. Built lazily, replaced on open.
  const editor = document.createElement('div');
  editor.className = TRANSCRIPT_EDITOR_CLASS;
  editor.hidden = true;

  const input = document.createElement('textarea');
  input.className = 'candice-transcript-input';
  input.rows = 3;
  input.setAttribute('aria-label', 'Correct your answer');

  const error = document.createElement('p');
  error.className = 'candice-transcript-error';
  error.hidden = true;

  const editorActions = document.createElement('div');
  editorActions.className = TRANSCRIPT_ACTIONS_CLASS;

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'candice-transcript-button';
  save.textContent = TRANSCRIPT_LABELS.SAVE;

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'candice-transcript-link';
  cancel.textContent = TRANSCRIPT_LABELS.CANCEL;

  editorActions.append(save, cancel);
  editor.append(input, error, editorActions);

  root.append(heard, text, notHeard, actions, editor);
  mount.append(root);

  let destroyed = false;

  use.addEventListener('click', () => {
    if (use.disabled) return; // render gate is the truth (double belt)
    handlers.onUseAnswer();
  });
  edit.addEventListener('click', () => handlers.onEdit());
  retry.addEventListener('click', () => handlers.onTryAgain());
  save.addEventListener('click', () => handlers.onSave());
  cancel.addEventListener('click', () => handlers.onCancel());
  input.addEventListener('keydown', (e) => {
    // Cmd/Ctrl+Enter submits in the editor; plain Enter inserts a newline.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handlers.onSave();
    }
  });
  // Live draft sync: the controller owns the draft (it validates and
  // submits it); the view only reports keystrokes.
  input.addEventListener('input', () => handlers.onEditChange(input.value));

  const setModel = (model: TranscriptModel): void => {
    if (destroyed) return;
    root.classList.toggle('candice-transcript-active', model.active);
    heard.hidden = model.heardLabel === null;
    if (model.heardLabel !== null) heard.textContent = model.heardLabel;
    // Transcript row vs nothing-heard vs editor
    text.hidden = model.transcript === null && !model.editing;
    if (model.transcript !== null && !model.editing) {
      text.textContent = model.transcript;
    }
    notHeard.hidden = !(model.confirming && model.transcript === null && !model.editing);
    // Confirmation actions: only the render-gated confirm row
    actions.hidden = !model.showConfirmRow;
    use.disabled = !model.canSubmit;
    retry.disabled = false;
    // Editor
    editor.hidden = !model.editing;
    if (model.editing) {
      if (document.activeElement !== input) input.value = model.editDraft ?? '';
      const invalid = model.editValidity !== null && !model.editValidity.ok;
      input.setAttribute('data-invalid', String(invalid));
      error.hidden = !invalid;
      if (invalid && model.editValidity !== null) {
        error.textContent = model.editValidity.error ?? '';
      }
      save.disabled = !(model.editValidity?.ok ?? false);
    }
    root.setAttribute('data-candice-state', model.active ? 'transcript' : 'off-question');
  };

  return {
    el: root,
    setModel,
    destroy(): void {
      destroyed = true;
      root.remove();
    },
  };
}
