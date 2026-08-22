/**
 * Floating answer controls DOM surface (Master Spec 0E WS-09, spec 5.1 /
 * 5.2 / 6).
 *
 * The floating answer surface owns:
 *  - the two answer methods side by side on EVERY question —
 *    🎙 HOLD TO TALK (mounts the WS-09 PTT control into the surface) and
 *    TYPE ANSWER (spec 5.1),
 *  - "Answer in Claude instead" (spec 5.1) — falls back to the
 *    terminal/Claude input surface, never double-counts;
 *  - the separate persistent Voice responses ON/OFF toggle (spec 5.2);
 *  - the post-release transcript with USE ANSWER / EDIT / TRY AGAIN
 *    (spec 6; nothing submitted until confirmed — E.1 WS-18).
 *
 * Never:
 *  - reads/writes prefs or session state (the controller does),
 *  - resolves identity/terminal targets (WS-03/WS-05),
 *  - runs continuous animation (spec 19: the PTT listening glow inside the
 *    embedded control is the only animation, own by the ptt lane),
 *  - paints a baked background behind the character (spec 11; WS-07 owns
 *    the transparent-window invariant).
 *
 * @module
 */

import {
  ANSWER_CONFIRM_CLASS,
  ANSWER_CONTROLS_LABELS,
  ANSWER_CONTROLS_ROOT_CLASS,
  ANSWER_CONTROLS_STYLE_ID,
  ANSWER_INPUT_CLASS,
} from './config.ts';
import type { AnswerControlsModel } from './model.ts';
import type { AnswerMethod } from './config.ts';

/**
 * Style contract. Variable references only, no baked background (the
 * WS-07 transparent-window invariant forbids hex/rgba backgrounds).
 */
export const ANSWER_CONTROLS_STYLE_TEXT = `
.candice-answer-controls {
  --candice-ac-text: var(--candice-text, #eceaf3);
  --candice-ac-muted: var(--candice-muted, #a8a3b8);
  --candice-ac-accent: var(--candice-accent, #7c5cff);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  max-width: 420px;
  padding: 12px 16px;
  font-size: 14px;
  line-height: 1.35;
  color: var(--candice-ac-text);
}
.candice-answer-methods {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  justify-content: center;
}
.candice-answer-type {
  min-width: 260px;
  display: flex;
  gap: 8px;
  align-items: center;
}
.candice-answer-input {
  flex: 1;
  min-width: 160px;
  border: 1px solid var(--candice-ac-muted);
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  padding: 10px 12px;
}
.candice-answer-input::placeholder {
  color: var(--candice-ac-muted);
}
.candice-answer-submit {
  border: 1px solid var(--candice-ac-accent);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 600;
  padding: 8px 16px;
  cursor: pointer;
}
.candice-answer-submit:focus-visible,
.candice-answer-link:focus-visible {
  outline: 2px solid var(--candice-ac-accent);
  outline-offset: 2px;
}
.candice-answer-link {
  border: 0;
  background: transparent;
  color: var(--candice-ac-muted);
  font: inherit;
  padding: 4px 6px;
  cursor: pointer;
}
.candice-answer-link:hover {
  color: var(--candice-ac-accent);
  text-decoration: underline;
}
.candice-answer-toggle {
  border: 1px solid var(--candice-ac-muted);
  border-radius: 999px;
  background: transparent;
  color: var(--candice-ac-muted);
  font: inherit;
  padding: 6px 14px;
  cursor: pointer;
}
.candice-answer-toggle[data-voice-on='true'] {
  border-color: var(--candice-ac-accent);
  color: var(--candice-ac-accent);
}
.candice-answer-confirm {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
}
.candice-answer-confirm[hidden] {
  display: none;
}
.candice-answer-transcript {
  max-width: 380px;
  text-align: center;
  color: var(--candice-ac-muted);
}
`;

/** Set once by the first DOM-capable creation. */
let styleMounted = false;

/** Mount the answer-controls style sheet once (idempotent, headless-safe). */
export function mountAnswerControlsStyle(): void {
  if (typeof document === 'undefined') return;
  if (styleMounted) return;
  if (document.getElementById(ANSWER_CONTROLS_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = ANSWER_CONTROLS_STYLE_ID;
  style.textContent = ANSWER_CONTROLS_STYLE_TEXT;
  (document.head ?? document.documentElement).append(style);
  styleMounted = true;
}

export interface AnswerControlsViewHandlers {
  /** User pressed ENTER or clicked submit in the type box. */
  onTypeAnswer(text: string): void;
  /** User chose the terminal/Claude path (spec 5.1). */
  onDelegateToClaude(): void;
  /** User toggled voice responses ON/OFF (spec 5.2). */
  onVoiceToggle(): void;
  /** Confirmation actions after a transcript (spec 6). */
  onConfirmUse(): void;
  onConfirmEdit(): void;
  onConfirmTryAgain(): void;
}

export interface AnswerControlsView {
  /** Root element (null when mount was null — no-op view, spec 20). */
  readonly el: HTMLElement | null;
  /** Pure render of the model. */
  setModel(model: AnswerControlsModel): void;
  /** Attach the PTT control into the answer surface (one slot). */
  attachPtt(mount: HTMLElement): void;
  destroy(): void;
}

/** Empty no-op view — DOM absence must never throw (spec 20). */
function nullView(): AnswerControlsView {
  return {
    el: null,
    setModel() {},
    attachPtt() {},
    destroy() {},
  };
}

/**
 * Create the floating answer controls. Takes an explicit mount element
 * (the shell or tests hand it in; this lane never owns
 * document.querySelector). Never throws — DOM absence degrades to no-op.
 */
export function createAnswerControlsView(
  mount: HTMLElement | null,
  handlers: AnswerControlsViewHandlers,
): AnswerControlsView {
  if (mount === null) return nullView();
  if (typeof document === 'undefined') return nullView();
  mountAnswerControlsStyle();
  mount.innerHTML = '';

  const root = document.createElement('div');
  root.className = ANSWER_CONTROLS_ROOT_CLASS;

  // Method row: the PTT slot + type answer. The PTT control is mounted by
  // the PTT lane into the slot below; this lane never re-implements it.
  const methods = document.createElement('div');
  methods.className = 'candice-answer-methods';

  const pttSlot = document.createElement('div');
  pttSlot.id = 'candice-ptt-slot';

  const typeWrap = document.createElement('div');
  typeWrap.className = 'candice-answer-type';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = ANSWER_INPUT_CLASS;
  input.placeholder = 'Type your answer…';
  input.setAttribute('aria-label', ANSWER_CONTROLS_LABELS.TYPE);

  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'candice-answer-submit';
  submit.textContent = ANSWER_CONTROLS_LABELS.TYPE;

  const delegate = document.createElement('button');
  delegate.type = 'button';
  delegate.className = 'candice-answer-link';
  delegate.textContent = ANSWER_CONTROLS_LABELS.ANSWER_IN_CLAUDE;

  const voice = document.createElement('button');
  voice.type = 'button';
  voice.className = 'candice-answer-toggle';
  voice.setAttribute('data-voice-on', 'true');
  voice.textContent = ANSWER_CONTROLS_LABELS.VOICE_ON_BUTTON;
  voice.setAttribute('aria-pressed', 'true');

  // Secondary row: Answer-in-Claude + the persistent voice toggle (5.1/5.2).
  const footer = document.createElement('div');
  footer.className = 'candice-answer-footer';
  footer.append(delegate, voice);

  // Confirmation surface (spec 6): transcript + USE ANSWER / EDIT / TRY AGAIN.
  const confirm = document.createElement('div');
  confirm.className = ANSWER_CONFIRM_CLASS;
  confirm.hidden = true;

  const transcript = document.createElement('p');
  transcript.className = 'candice-answer-transcript';
  transcript.setAttribute('role', 'status');

  const use = document.createElement('button');
  use.type = 'button';
  use.className = 'candice-answer-submit';
  use.textContent = ANSWER_CONTROLS_LABELS.USE;
  // Disabled until a real confirming transcript exists (spec 6); `canConfirm`
  // is the render gate — the click handler is a second belt.
  use.disabled = true;

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'candice-answer-link';
  edit.textContent = ANSWER_CONTROLS_LABELS.EDIT;

  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'candice-answer-link';
  retry.textContent = ANSWER_CONTROLS_LABELS.TRY_AGAIN;

  const actions = document.createElement('div');
  actions.className = 'candice-answer-confirm-actions';
  actions.append(use, edit, retry);
  confirm.append(transcript, actions);

  methods.append(pttSlot, typeWrap);
  typeWrap.append(input, submit);
  root.append(methods, footer, confirm);

  mount.append(root);

  let destroyed = false;

  const submitTyped = (): void => {
    // Render gate already disabled the input; guard again so a stale
    // handler can never submit outside a question surface (I-12).
    if (input.disabled) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    handlers.onTypeAnswer(text);
  };
  input.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') submitTyped();
  });
  submit.addEventListener('click', submitTyped);
  delegate.addEventListener('click', () => {
    if (delegate.disabled) return; // I-12: disabled path never delegates
    handlers.onDelegateToClaude();
  });
  voice.addEventListener('click', () => handlers.onVoiceToggle());
  use.addEventListener('click', () => {
    // Render gate already disabled the button; guard again so a stale
    // handler can never confirm a non-confirming state (spec 6).
    if (!canConfirm) return;
    handlers.onConfirmUse();
  });
  edit.addEventListener('click', () => handlers.onConfirmEdit());
  retry.addEventListener('click', () => handlers.onConfirmTryAgain());

  let canConfirm = false;

  const setModel = (model: AnswerControlsModel): void => {
    if (destroyed) return;
    root.setAttribute('data-candice-state', model.inQuestionFlow ? 'question' : 'off-question');
    // FIX-014 (I-12): the model's usability claims now become real DOM
    // protections — a disabled control can never start an answer path.
    // Both methods stay VISIBLE on every question (spec 5.1); usability
    // only gates interaction, never presence.
    const typedDisabled = !model.typedUsable;
    input.disabled = typedDisabled;
    submit.disabled = typedDisabled;
    delegate.disabled = !model.delegateUsable;
    pttSlot.setAttribute('aria-disabled', String(!model.pttUsable));
    // Both methods always present on every question (spec 5.1); the
    // convenience only marks the active one, never hides the other.
    input.setAttribute(
      'data-active',
      String(model.activeMethod === 'typed'),
    );
    // Voice toggle render (spec 5.2): label + aria state follow the model.
    voice.textContent = model.voiceButtonLabel;
    voice.setAttribute('data-voice-on', String(model.voiceEnabled));
    voice.setAttribute('aria-pressed', String(model.voiceEnabled));
    voice.setAttribute('aria-label', model.voiceToggleLabel);
    // Confirmation row (spec 6) — visible only while actually confirming
    // with a real transcript. After USE ANSWER the machine keeps the
    // transcript as the record but the row must hide so the answer can
    // never be confirmed twice (spec 5.1/6 no-double-count).
    const showRow = model.showConfirmRow;
    canConfirm = model.canConfirm;
    confirm.hidden = !showRow;
    transcript.textContent = showRow ? String(model.transcript ?? '') : '';
    use.disabled = !canConfirm;
    root.classList.toggle('candice-answer-confirming', model.confirming);
  };

  return {
    el: root,
    setModel,
    attachPtt(inner: HTMLElement): void {
      pttSlot.replaceChildren(inner);
    },
    destroy(): void {
      destroyed = true;
      root.remove();
    },
  };
}
