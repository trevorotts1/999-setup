/**
 * Candice interaction composition (FIX-014, EXECUTION-PLAN step 8/9).
 *
 * The application-owned module that wires the loaded preference profile into
 * the mounted interaction surfaces:
 *  - applies the persisted text size to the captions live region,
 *  - records the voice-output and preferred-name state on the root dataset
 *    (evidence for tests/QC and the packaged-bundle sentinel),
 *  - reports a failed profile load to the machine as the truthful
 *    `preferences` error (the reducer sets `preferencesUnavailable`),
 *  - mounts the first-run name prompt exactly once per local user
 *    (Master Spec section 4: asked at most once, never inferred from the OS
 *    username, answerable by typed input, changeable later),
 *  - persists explicit user changes (name, dismissal, voice toggle) through
 *    the native `cmd_save_profile` seam.
 *
 * The profile is loaded ONCE at boot by the caller (main.ts) and handed in;
 * this module never loads it a second time. It imports only browser-safe
 * prefs modules (`ipc.ts`, `profile.ts`, `name.ts`, `schema.ts`) — never
 * `store.ts` — so the webview bundle never pulls `node:fs`.
 *
 * Never throws (spec 20): a null machine/captions/document degrades to a
 * no-op composition; every persistence failure returns false.
 *
 * @module
 */

import type { CandiceStateMachine } from '../state/machine.ts';
import type { CaptionsController } from '../ui/captions/index.ts';
import type { CandiceProfile } from '../prefs/schema.ts';
import { LATEST_SCHEMA_VERSION } from '../prefs/schema.ts';
import {
  loadProfileViaIpc,
  saveProfileViaIpc,
  type PrefsIpcAdapter,
  type PrefsLoadResult,
} from '../prefs/ipc.ts';
import { mergeProfile } from '../prefs/profile.ts';
import {
  markNameAsked,
  needsNameAsk,
  normalizeName,
  setPreferredName,
  welcomeBackPhrase,
} from '../prefs/name.ts';

/**
 * Packaged-bundle sentinel token (assert-interaction-composition.mjs).
 *
 * This is a hyphenated ATTRIBUTE token, never a `dataset` key. The
 * DOMStringMap setter (WHATWG HTML, step 1) throws a `SyntaxError`
 * DOMException for any name containing "-" followed by an ASCII lower alpha,
 * so `root.dataset[INTERACTION_COMPOSITION_SENTINEL]` is a hard failure in a
 * real engine. WebKit words that exception "The string did not match the
 * expected pattern.", which is what a packaged macOS build reports. Write it
 * through {@link INTERACTION_COMPOSITION_ATTR} with `setAttribute`.
 */
export const INTERACTION_COMPOSITION_SENTINEL = 'candice-interaction-composition';

/** The mount-evidence attribute written to the root: `data-` + the sentinel. */
export const INTERACTION_COMPOSITION_ATTR = `data-${INTERACTION_COMPOSITION_SENTINEL}`;

/** Root class of the first-run name prompt surface. */
export const NAME_PROMPT_ROOT_CLASS = 'candice-name-prompt';

/** Exported style id so the prompt style tag mounts exactly once. */
export const NAME_PROMPT_STYLE_ID = 'candice-name-prompt-style';

/** Master Spec section 4: the exact first-run name question. */
export const NAME_QUESTION_TEXT = "Hi, I'm Candice. What's your name?";

/** Spec 9 text-size enum to the a11y numeric multiplier (0.8..1.6 clamp). */
export const TEXT_SIZE_SCALE: Readonly<Record<'small' | 'medium' | 'large', number>> = {
  small: 0.9,
  medium: 1,
  large: 1.2,
};

/** Map a persisted text size to the a11y numeric scale. Unknown -> medium. */
export function textSizeToScale(textSize: unknown): number {
  if (textSize === 'small') return TEXT_SIZE_SCALE.small;
  if (textSize === 'large') return TEXT_SIZE_SCALE.large;
  return TEXT_SIZE_SCALE.medium;
}

export interface InteractionCompositionOptions {
  /** The profile loaded once at boot by the caller (main.ts). */
  profile: CandiceProfile;
  /** The boot load result (ok flag + corruption recovery evidence). */
  prefsLoad: PrefsLoadResult;
  /** Native invoke seam (tests inject a fake; default is the real Tauri invoke). */
  invokeAdapter?: PrefsIpcAdapter;
  /** Document injection (tests); defaults to the real document. */
  doc?: Document;
  /** Clock injection for the name-asked timestamp (deterministic tests). */
  nowIso?: () => string;
}

export interface InteractionComposition {
  /** The current in-memory profile (updated after each successful save). */
  readonly profile: CandiceProfile;
  /** True when the boot load succeeded (false -> preferencesUnavailable). */
  readonly loadOk: boolean;
  /** True when native recovered the profile from a corrupt file. */
  readonly recoveredFromCorruption: boolean;
  /** Persist an explicit user change (merge + native atomic save). */
  persist(patch: Partial<CandiceProfile>): Promise<boolean>;
  /**
   * Post-setup name flow (spec 4): mount the first-run name question when it
   * still needs asking, otherwise announce the welcome-back greeting. Called
   * once by the composition root after the bridge is installed.
   */
  beginNameFlow(): void;
  /** Re-open the name prompt (the spec-4 "change later" action). */
  changeName(): void;
  destroy(): void;
}

/**
 * Mount the first-run name prompt. The question is asked at most once per
 * local user: SAVE stores the normalized name and records `nameAsked`;
 * SKIP records `nameAsked` without a name. Enter submits, Escape skips.
 * The prompt is never inferred from the OS username (spec 4 item 8).
 */
function mountNamePrompt(
  root: HTMLElement,
  doc: Document,
  captions: CaptionsController | null,
  nowIso: () => string,
  persist: (patch: Partial<CandiceProfile>) => Promise<boolean>,
  current: () => CandiceProfile,
  /**
   * Whether the prompt may also speak its question into the shared caption
   * region. False while a governed question is already displayed there: the
   * prompt renders its own question text either way, so suppressing the
   * announce costs the user nothing and keeps the interview question visible.
   */
  announceQuestion = true,
): HTMLElement | null {
  if (root.querySelector(`.${NAME_PROMPT_ROOT_CLASS}`) !== null) return null;

  if (doc.getElementById(NAME_PROMPT_STYLE_ID) === null) {
    const style = doc.createElement('style');
    style.id = NAME_PROMPT_STYLE_ID;
    style.textContent = `
.${NAME_PROMPT_ROOT_CLASS} {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  max-width: 420px;
  padding: 12px 16px;
  font-size: calc(14px * var(--candice-text-scale, 1));
  line-height: 1.35;
  color: var(--candice-text, #eceaf3);
  text-align: center;
  /* FIX-008: opaque backdrop — the window is transparent, so this prompt
     otherwise renders onto the user's desktop and cannot be read. */
  background: var(--candice-ui-surface, #171321);
  border: 1px solid var(--candice-ui-border, #beb0ff);
  border-radius: 10px;
}
.${NAME_PROMPT_ROOT_CLASS} input {
  min-width: 220px;
  padding: 6px 10px;
  font-size: calc(14px * var(--candice-text-scale, 1));
  border: 1px solid var(--candice-muted, #a8a3b8);
  border-radius: 6px;
  background: var(--candice-ui-surface, rgba(20, 18, 30, 0.9));
  color: var(--candice-text, #eceaf3);
}
.${NAME_PROMPT_ROOT_CLASS} .candice-name-prompt-actions {
  display: flex;
  gap: 10px;
}
.${NAME_PROMPT_ROOT_CLASS} button {
  padding: 6px 14px;
  font-size: calc(13px * var(--candice-text-scale, 1));
  border-radius: 6px;
  border: 1px solid var(--candice-muted, #a8a3b8);
  background: var(--candice-ui-surface, rgba(20, 18, 30, 0.9));
  color: var(--candice-text, #eceaf3);
  cursor: pointer;
}
.${NAME_PROMPT_ROOT_CLASS} button.candice-name-prompt-save {
  border-color: var(--candice-accent, #7c5cff);
  /* FIX-008: accent as TEXT uses the AAA-safe tint. */
  color: var(--candice-accent-text, #b9a8ff);
}
`;
    (doc.head ?? doc.documentElement).append(style);
  }

  const prompt = doc.createElement('div');
  prompt.className = NAME_PROMPT_ROOT_CLASS;
  prompt.setAttribute('role', 'region');
  prompt.setAttribute('aria-label', 'Name prompt');

  const question = doc.createElement('p');
  question.className = 'candice-name-prompt-question';
  question.textContent = NAME_QUESTION_TEXT;
  prompt.append(question);

  const input = doc.createElement('input');
  input.className = 'candice-name-prompt-input';
  input.setAttribute('type', 'text');
  input.setAttribute('maxlength', '60');
  input.setAttribute('aria-label', 'Your name');
  prompt.append(input);

  const actions = doc.createElement('div');
  actions.className = 'candice-name-prompt-actions';
  const save = doc.createElement('button');
  save.className = 'candice-name-prompt-save';
  save.textContent = 'SAVE';
  const skip = doc.createElement('button');
  skip.className = 'candice-name-prompt-skip';
  skip.textContent = 'SKIP';
  actions.append(save, skip);
  prompt.append(actions);

  const remove = (): void => {
    prompt.remove();
  };

  const submit = (): void => {
    const name = normalizeName(input.value);
    if (name.length === 0) {
      input.focus();
      return;
    }
    const next = markNameAsked(setPreferredName(current(), name), nowIso());
    void persist({ preferredName: next.preferredName, nameAsked: next.nameAsked });
    remove();
    const phrase = welcomeBackPhrase(next);
    if (phrase !== null) captions?.announce(phrase);
  };

  const dismiss = (): void => {
    const next = markNameAsked(current(), nowIso());
    void persist({ nameAsked: next.nameAsked });
    remove();
  };

  save.addEventListener('click', submit);
  skip.addEventListener('click', dismiss);
  input.addEventListener('keydown', (event) => {
    // An IME commits its composition with Enter; submitting on that one
    // saves a half-typed name. See the same guard on the answer input.
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter') submit();
    if (event.key === 'Escape') dismiss();
  });

  root.append(prompt);
  if (announceQuestion) captions?.announce(NAME_QUESTION_TEXT);
  input.focus();
  return prompt;
}

/**
 * Wire the boot-loaded profile into the mounted interaction surfaces.
 * Called exactly once from `initializeRuntimeComposition`.
 */
export async function initializeCandiceInteractionComposition(
  root: HTMLElement,
  machine: CandiceStateMachine | null,
  captions: CaptionsController | null,
  options: InteractionCompositionOptions,
): Promise<InteractionComposition> {
  const doc = options.doc ?? document;
  const nowIso = options.nowIso ?? ((): string => new Date().toISOString());
  const adapter: PrefsIpcAdapter = options.invokeAdapter ?? {
    invoke: async (command, args) => {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke(command, args);
    },
  };

  let current: CandiceProfile = options.profile;
  const loadOk = options.prefsLoad.ok;

  // Truthful failure reporting: a failed boot load is the machine's
  // `preferences` error (the reducer sets `preferencesUnavailable`).
  if (!loadOk && machine !== null) {
    machine.transition({ type: 'error', detail: 'preferences' });
  }

  // Presentation preferences onto the mounted views.
  captions?.setTextScale(current.textSize ?? 'medium');
  root.dataset.candiceVoiceOutput = String(current.voiceOutputEnabled);
  root.dataset.candicePreferredName = current.preferredName ?? '';
  // Mount evidence for tests/QC and the packaged-bundle sentinel. It is set
  // as an attribute because the hyphenated sentinel is not a legal
  // DOMStringMap key; the resulting DOM is identical to a `data-*` write.
  root.setAttribute(INTERACTION_COMPOSITION_ATTR, 'active');

  const persist = async (patch: Partial<CandiceProfile>): Promise<boolean> => {
    const next = mergeProfile(current, patch);
    // A newer lane's document is the ONE case where the change must not take
    // effect at all: this build would be overwriting a file it cannot read.
    if (next.schemaVersion > LATEST_SCHEMA_VERSION) return false;
    // APPLY FIRST, then write.
    //
    // This used to be `if (saved) current = next`, so a preference only took
    // effect if the disk write succeeded. `current` is what the live getters
    // read -- `voiceOutputEnabled()` in composition.ts is the gate the bridge
    // consults before speaking -- while the answer-controls surface keeps its
    // own copy and flips its label immediately. A failed write therefore left
    // the button reading "Voice responses OFF" while Candice went on speaking
    // every question, with nothing anywhere reporting a problem.
    //
    // An off switch must switch things off. Whether the choice survives a
    // restart is a separate question, and it is the one the return value
    // answers.
    current = next;
    root.dataset.candiceVoiceOutput = String(current.voiceOutputEnabled);
    root.dataset.candicePreferredName = current.preferredName ?? '';
    return saveProfileViaIpc(adapter, next);
  };

  const beginNameFlow = (): void => {
    // The composition root defers this until after the bridge is installed so
    // a delivered question is never wiped by the prompt. The bridge can
    // deliver DURING that install, though, in which case a governed question
    // is already on the caption region — and it is the caption region, not the
    // prompt, that is the only place the user can read the question. Neither
    // the name question nor the welcome-back greeting may overwrite it; both
    // are pleasantries, the interview question is the actual ask.
    const questionPending = machine !== null && machine.getState().pendingQuestion !== null;
    // First-run name question (spec 4): asked at most once per local user.
    if (needsNameAsk(current) && !questionPending) {
      // The name ask is DEFERRED while a question is on screen, not skipped.
      //
      // Suppressing only the caption announce was not enough: the prompt still
      // MOUNTED, so a 420px column carried two text inputs at once and
      // `input.focus()` took focus into the wrong one — the user's first
      // keystrokes went to the name box while they were reading an interview
      // question. Spec 4 says the name is asked at most once per local user;
      // it does not say it must be asked ON TOP of something else.
      //
      // `needsNameAsk(current)` stays true because nothing is persisted here,
      // so the ask simply happens on the next boot with no question pending.
      // The ask is preserved; only its timing changes.
      mountNamePrompt(root, doc, captions, nowIso, persist, () => current);
    } else if (!questionPending) {
      const phrase = welcomeBackPhrase(current);
      if (phrase !== null) captions?.announce(phrase);
    }
  };

  // The spec-4 "change later" action, exposed for a future settings surface.
  if (typeof window !== 'undefined') {
    (window as unknown as { __candiceInteraction?: unknown }).__candiceInteraction = {
      changeName: (): void => {
        mountNamePrompt(root, doc, captions, nowIso, persist, () => current);
      },
    };
  }

  return {
    get profile() {
      return current;
    },
    loadOk,
    recoveredFromCorruption: options.prefsLoad.recoveredFromCorruption,
    persist,
    beginNameFlow,
    changeName: () => {
      mountNamePrompt(root, doc, captions, nowIso, persist, () => current);
    },
    destroy: () => {
      const prompt = root.querySelector(`.${NAME_PROMPT_ROOT_CLASS}`);
      prompt?.remove();
      if (typeof window !== 'undefined') {
        delete (window as unknown as { __candiceInteraction?: unknown }).__candiceInteraction;
      }
    },
  };
}

export { loadProfileViaIpc };
