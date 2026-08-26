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
  /* FIX-008: accent applied to TEXT needs the AAA-safe tint. */
  --candice-ac-accent-text: var(--candice-accent-text, #b9a8ff);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  max-width: 420px;
  padding: 12px 16px;
  /* FIX-014: consume the a11y text-scale token (spec 9 text size). */
  font-size: calc(14px * var(--candice-text-scale, 1));
  line-height: 1.35;
  color: var(--candice-ac-text);
  /* FIX-008: opaque backdrop over the transparent window. */
  background: var(--candice-ui-surface, #171321);
  border: 1px solid var(--candice-ui-border, #beb0ff);
  border-radius: 10px;
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
  /* FIX-008: opaque so the typed answer is readable over any desktop. */
  background: var(--candice-ui-surface, #171321);
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
  /* FIX-008: an opaque fill reads as an ENABLED control. Transparent over a
     bright desktop read as a disabled ghost, which is a false affordance:
     the model enables this button whenever delegate mode is inactive. */
  background: var(--candice-ui-surface, #171321);
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
  /* FIX-008: opaque backdrop; this is a real action, not decoration. */
  background: var(--candice-ui-surface, #171321);
  color: var(--candice-ac-muted);
  font: inherit;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
}
.candice-answer-link:hover {
  color: var(--candice-ac-accent-text);
  text-decoration: underline;
}
.candice-answer-toggle {
  border: 1px solid var(--candice-ac-muted);
  border-radius: 999px;
  /* FIX-008: opaque backdrop; the muted colour is the OFF state, not a
     disabled state, and it stays AAA against this surface. */
  background: var(--candice-ui-surface, #171321);
  color: var(--candice-ac-muted);
  font: inherit;
  padding: 6px 14px;
  cursor: pointer;
}
.candice-answer-toggle[data-voice-on='true'] {
  border-color: var(--candice-ac-accent);
  color: var(--candice-ac-accent-text);
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
/* Choice questions ship their answer values in the registry. Before this the
   webview dropped them and rendered a bare text box, so the user had to type a
   value they had never been shown. These are big, obvious tap targets. */
.candice-answer-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  width: 100%;
}
.candice-answer-options[hidden] {
  display: none;
}
.candice-answer-option {
  border: 1px solid var(--candice-ac-accent);
  border-radius: 999px;
  background: var(--candice-ui-surface, #171321);
  color: inherit;
  font: inherit;
  font-weight: 600;
  padding: 10px 18px;
  /* 44px is the Apple HIG minimum touch/pointer target. At 40 these pills sat
     just under it, 8px apart, in a floating always-on-top window -- which is
     a large part of what "the options were hard to select" meant. */
  min-height: 44px;
  min-width: 64px;
  cursor: pointer;
  /* Option text is a raw registry value and can be a sentence or a path. With
     no wrapping, one long option renders wider than the 420px window, and the
     body's overflow:hidden then clips it into pixels nobody can click. */
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
  text-align: center;
}
/* A click submits and the surface is torn down a moment later. Between those
   two events the pills previously looked untouched, so a slow answer read as
   a dead button and invited a second click on a different option. */
.candice-answer-option[data-candice-option-chosen='true'] {
  background: var(--candice-ac-accent);
  color: var(--candice-ui-surface, #171321);
  opacity: 1;
}
.candice-answer-option:disabled:not([data-candice-option-chosen='true']) {
  opacity: 0.45;
  cursor: default;
}
.candice-answer-footer {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
}
.candice-answer-option:hover {
  /* Border-colour alone was almost invisible against this palette, so a
     choice gave no feedback that it was even hoverable. */
  border-color: var(--candice-ac-accent-text);
  background: var(--candice-ac-accent-text);
  color: var(--candice-ac-surface);
}
.candice-answer-option:focus-visible {
  outline: 2px solid var(--candice-ac-accent-text);
  outline-offset: 2px;
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
  /** User picked one of the registry options for a choice question. */
  onChooseOption(value: string): void;
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
  /** Render the choice buttons for a choice question; null hides the row. */
  showOptions(options: readonly string[] | null): void;
  destroy(): void;
}

/**
 * Human-readable label for a registry option value.
 *
 * Registry options are answer VALUES, not display copy: `provided-material`
 * is what the protocol accepts, and showing that raw is barely better than a
 * blank box. This only re-cases and de-hyphenates -- it never invents wording,
 * because inventing a label would show the user a choice the registry does
 * not define. Values that are already prose (`I don't know`) pass through.
 */
export function optionLabel(value: string): string {
  const spaced = value.replace(/[-_]+/g, ' ').trim();
  if (spaced.length === 0) return value;
  if (/[A-Z]/.test(spaced) || /\s/.test(value)) return spaced;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Empty no-op view — DOM absence must never throw (spec 20). */
function nullView(): AnswerControlsView {
  return {
    el: null,
    setModel() {},
    attachPtt() {},
    showOptions() {},
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
  const optionsRow = document.createElement('div');
  optionsRow.className = 'candice-answer-options';
  optionsRow.hidden = true;
  // Without these the options are a run of unrelated buttons: assistive
  // technology has no way to say that they belong together or that they
  // are the answers to the question sitting in the caption above them.
  optionsRow.setAttribute('role', 'group');
  optionsRow.setAttribute('aria-label', 'Answer choices');

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
  // Choices sit ABOVE the answer methods: when a question has options, picking
  // one is the intended path and typing is the fallback, not the reverse.
  root.append(optionsRow, methods, footer, confirm);

  mount.append(root);

  let destroyed = false;
  /** The option values currently painted, so an unchanged list is not rebuilt. */
  let renderedOptions: string[] | null = null;

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
    const key = e as KeyboardEvent;
    // An IME (Japanese, Chinese, Korean) uses Enter to COMMIT the characters
    // being composed. Submitting on that Enter sends a half-composed answer
    // and closes the surface, so the user never gets to finish the word.
    // `isComposing` is exactly this distinction; 229 is the legacy keyCode
    // browsers report while a composition is active.
    if (key.isComposing || key.keyCode === 229) return;
    if (key.key === 'Enter') submitTyped();
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
  edit.addEventListener('click', () => {
    // EDIT was a dead button. The controller routes it to
    // `options.editTranscript?.(...)`, and bridge.ts -- the only place that
    // builds this controller in production -- never passes that callback, so
    // clicking EDIT did nothing at all. The surface that WAS built for it
    // (src/ui/transcript) has no importer anywhere outside its own tests.
    //
    // The edit affordance already exists on screen: the type box, whose
    // submit is a confirmed answer path in its own right. So EDIT now does
    // the obvious thing -- puts what she heard into the box, ready to be
    // corrected -- instead of nothing. The machine still stays in
    // `confirming` via the handler below; nothing is submitted here.
    const heard = transcript.textContent ?? '';
    if (heard !== '' && !input.disabled) {
      input.value = heard;
      try {
        input.focus();
        input.setSelectionRange(heard.length, heard.length);
      } catch {
        // Focus is a courtesy; the text is already in the box.
      }
    }
    handlers.onConfirmEdit();
  });
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
    showOptions(list: readonly string[] | null): void {
      if (destroyed) return;
      if (list === null || list.length === 0) {
        optionsRow.hidden = true;
        optionsRow.replaceChildren();
        renderedOptions = null;
        return;
      }
      // Every handler in the controller ends in render(), and render() calls
      // this. Rebuilding an unchanged list on every voice toggle, PTT press
      // and retry threw away keyboard focus that was sitting on an option,
      // and -- worse -- a mousedown and mouseup that straddled a rebuild
      // landed on two different nodes, so no click event fired at all. A
      // silently swallowed selection is a large part of what "the options are
      // hard to select" meant.
      const unchanged = renderedOptions !== null
        && renderedOptions.length === list.length
        && renderedOptions.every((v, i) => v === list[i]);
      if (unchanged && !optionsRow.hidden) return;
      renderedOptions = [...list];
      const buttons = list.map((value) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'candice-answer-option';
        b.textContent = optionLabel(value);
        // The LABEL is humanized for reading; the submitted VALUE is always
        // the registry string, never the prettified text.
        b.dataset.candiceOptionValue = value;
        b.addEventListener('click', () => {
          // Mark the choice and close the others BEFORE handing off. The
          // controller submits synchronously and the bridge tears the surface
          // down afterwards; until then the user is looking at pixels that
          // must already say "got it".
          for (const other of buttons) other.disabled = true;
          b.dataset.candiceOptionChosen = 'true';
          handlers.onChooseOption(value);
        });
        return b;
      });
      optionsRow.replaceChildren(...buttons);
      optionsRow.hidden = false;
    },
    destroy(): void {
      destroyed = true;
      root.remove();
    },
  };
}
