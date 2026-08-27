/**
 * Captions controller (Master Spec 0E WS-14, spec 5.2 / 6).
 *
 * Wires the WS-08 state machine's REAL `captions:show` effect payloads to
 * the captions view:
 *  - the machine consumes events first (the reducer never invents a
 *    caption); the controller renders the result of each transition,
 *  - the caption is ALWAYS shown regardless of `voiceOutputEnabled`
 *    (spec 5.2) — this lane never consults the voice toggle,
 *  - a transition whose effects contain no `captions:show` keeps the last
 *    visible caption content (a stale-marked fallback the view renders
 *    faded) so the user is never left with an off-screen status change
 *    (spec 5.2 "always shown").
 *
 * The controller never owns session identity, never injects input, and
 * never opens a second AI conversation (spec 2 / 13).
 *
 * Never throws (spec 20): a null machine/mount/document degrades to a
 * no-op controller; render errors are swallowed by the view's no-op paths.
 *
 * @module
 */

import { isAnswerElsewhereCaption } from '../../harness/name.ts';
import type { CandiceStateMachine, CandiceSideEffect } from '../../state/machine.ts';
import { CAPTIONS_TEXT_SCALES, type CaptionsTextScale } from './config.ts';
import { captionFromEffect, clipCaption, type CaptionEntry } from './model.ts';
import { createCaptionsView, type CaptionsView } from './view.ts';

export interface CaptionsControllerOptions {
  /** Real WS-08 machine instance (the transition authority). */
  machine: CandiceStateMachine | null;
  /** Mount element for the caption region. Null in headless runs (spec 20). */
  mount: HTMLElement | null;
  /** Doc scale consumption (spec 9 text size) via injected view. */
  textScale?: CaptionsTextScale;
  /** Document injection (tests); defaults to the real document. */
  doc?: Document | null;
  /**
   * First visible caption shown at creation (FIX-014 I-13: the exact
   * setup-check greeting). Null/empty shows nothing until the first
   * machine effect. Always important (never faded).
   */
  initialCaption?: string | null;
}

export interface CaptionsController {
  /** Feed the machine a real event, then render the caption effects. */
  handle(event: Parameters<CandiceStateMachine['transition']>[0]): void;
  /** Force a re-render from the machine's last effects (idempotent). */
  render(): void;
  /** Set the display scale (spec 9). */
  setTextScale(scale: CaptionsTextScale): void;
  /**
   * Highlight the sentence being spoken; null clears it. Driven from the real
   * Kokoro phoneme timings that arrive on `candice:speech-start`.
   */
  setSpokenProgress(fraction: number | null): void;
  /**
   * Show an explicit caption outside machine effects (FIX-014: the
   * welcome-back greeting and the first-run name question). A later
   * machine transition re-renders from real effects and replaces it —
   * the machine stays the source of truth.
   */
  announce(text: string, important?: boolean): void;
  destroy(): void;
}

/**
 * Extract a caption from any side effect. The WS-08 machine declares a
 * `caption` field on EVERY effect type ("The exact caption text, always
 * shown regardless of voice state (spec 5.2)") — the listening label
 * arrives on `mic:open`, the question text on `tts:speak`, and explicit
 * caption events on `captions:show`. A null caption carries no content.
 */
function captionOf(effect: CandiceSideEffect): CaptionEntry | null {
  if (effect.caption === null) return null;
  return captionFromEffect(effect.caption, 0);
}

export function createCaptionsController(options: CaptionsControllerOptions): CaptionsController {
  const { machine, mount, textScale = 'medium', doc = null, initialCaption = null } = options;
  const view: CaptionsView = createCaptionsView(mount, doc);
  if (view.el !== null) view.setTextScale(textScale);

  // FIX-014 (I-13): the setup-check greeting is the first visible caption,
  // shown at creation before any machine effect exists. Always important
  // (never faded); empty/null shows nothing until the first effect.
  if (initialCaption !== null && initialCaption.length > 0) {
    view.show({ text: clipCaption(initialCaption), important: true, seq: 0 });
  }

  // Entry-importance classification: question/recovering/text-fallback
  // captions are important (never faded); status-only captions are not.
  const importantFor = (caption: string): boolean => {
    const t = caption.toUpperCase();
    return (
      t.startsWith('RECOVERING') ||
      isAnswerElsewhereCaption(caption) ||
      (t.length > 0 && !t.startsWith('LISTENING') && !t.startsWith('HERE IS WHAT'))
    );
  };

  function applyEffects(effects: readonly CandiceSideEffect[]): void {
    let shown = false;
    for (const effect of effects) {
      const entry = captionOf(effect);
      if (entry === null) continue;
      const clipped: CaptionEntry = {
        ...entry,
        text: clipCaption(entry.text),
        important: importantFor(entry.text),
      };
      view.show(clipped);
      shown = true;
    }
    if (!shown) {
      // No caption effect in this transition: keep the last caption visible
      // (faded staleness, spec 5.2), never blank it.
      view.fade();
    }
  }

  return {
    handle: (event) => {
      if (machine === null) return;
      machine.transition(event);
      applyEffects(machine.lastEffects);
    },
    render: () => {
      if (machine === null) return;
      applyEffects(machine.lastEffects);
    },
    setTextScale: (scale: CaptionsTextScale) => {
      if (!CAPTIONS_TEXT_SCALES.includes(scale)) return;
      view.setTextScale(scale);
    },
    setSpokenProgress: (fraction: number | null) => {
      view.setSpokenProgress(fraction);
    },
    announce: (text: string, important = true) => {
      const clipped = clipCaption(text);
      if (clipped.length === 0) return;
      view.show({ text: clipped, important, seq: 0 });
    },
    destroy: () => {
      view.destroy();
    },
  };
}
