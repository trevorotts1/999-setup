/**
 * Transcript confirmation/edit/retry controller (Master Spec 0E WS-18,
 * spec 6 / 5.1).
 *
 * The machine is the source of truth; this controller wires its REAL
 * transition results to the transcript confirmation surface and owns the
 * EXACTLY-ONCE submission latch (E.1 WS-18):
 *
 *   - `speech:transcript` (delivered by the capture/STT path, WS-16/17)
 *     lands the machine in `confirming` with the transcript — nothing has
 *     been submitted yet;
 *   - USE ANSWER fires machine `answer:confirmed` and flips the latch in
 *     the same turn. From then on canSubmit is false, the row hides
 *     (model showConfirmRow false), and a second USE ANSWER or a stale
 *     click is a no-op — the answer is counted exactly once;
 *   - EDIT opens the editor on the unconfirmed transcript. SAVE validates
 *     the draft against the WS-01 wire bounds (1..4096, MIRROR of
 *     validate.js MAX_TEXT_LENGTH) and only then submits it through the
 *     same `answer:confirmed` path; CANCEL closes the editor with the
 *     original transcript still unsubmitted;
 *   - TRY AGAIN discards only the unconfirmed local transcript and
 *     restarts real capture via machine `ptt:start` (the machine's
 *     defined restart semantics from `confirming`). Nothing was
 *     submitted. The next transcription must be confirmed again;
 *   - the controller never submits an empty transcript: the machine
 *     ignores a `speech:transcript` with no text and the MCP runtime
 *     rejects blank answers (spec 20 / validate.js);
 *   - the latch is NOT stored on the machine — it is a view-of-the-world
 *     fact. It resets when a NEW question arrives (`question:received` /
 *     `question:recovered` re-arm the surface) and survives duplicate/
 *     late events by construction (machine ignores unknown transitions).
 *
 * The WS-09 answer-controls controller remains the owner of the
 * in-question row (PTT + TYPE + voice toggle + its own intent strip); the
 * shell wires THIS controller's transports into the SAME session answer
 * path (`candice.ask_user` answer event, WS-04) — one answer, one route,
 * one count.
 *
 * @module
 */

import type {
  CandiceEvent,
  CandiceStateMachine,
} from '../../state/machine.ts';
import { transcriptModel, validateTranscriptEdit, type TranscriptModel } from './model.ts';
import { createTranscriptView, type TranscriptView } from './view.ts';

export interface TranscriptControllerOptions {
  /** Real WS-08 machine instance (the transition authority). */
  machine: CandiceStateMachine;
  /** Mount element for the transcript surface. Null in headless runs (spec 20). */
  mount: HTMLElement | null;
  /**
   * Submission transport — the session answer path (WS-04 `answer` event
   * / WS-05 fallback). Called AT MOST ONCE per question: both USE ANSWER
   * and SAVE pass through the latch first, and the latch flips before the
   * transport runs, so a transport failure (or a re-render) can never
   * cause a second call (spec 5.1 no-double-count, E.1 WS-18).
   */
  submitTranscript?: (text: string) => void;
  /**
   * Retry transport — asks the WS-16/WS-17 pipeline to re-arm for a new
   * press (same wiring the PTT control uses). The controller also fires
   * `ptt:start` on the machine; the transport exists so the shell can
   * notify the capture path without re-implementing press semantics.
   */
  retryTranscription?: () => void;
}

export interface TranscriptController {
  /** Feed an event to the machine, then render the result. */
  handle(event: CandiceEvent): void;
  /** Render the machine's current state (idempotent). */
  render(): void;
  /** The current presentation model (evidence for tests/QC). */
  model(): TranscriptModel;
  /** True once this question's answer was confirmed (E.1 exactly-once). */
  confirmedOnce(): boolean;
  destroy(): void;
}

export function createTranscriptController(
  options: TranscriptControllerOptions,
): TranscriptController {
  const { machine } = options;
  let confirmedOnce = false;
  let editing = false;
  let editDraft: string | null = null;

  const view: TranscriptView = createTranscriptView(options.mount, {
    onUseAnswer: () => {
      submitConfirmed(machine.getState().transcript);
    },
    onEdit: () => {
      const transcript = machine.getState().transcript;
      if (transcript === null) return; // nothing to edit (nothing-heard)
      if (confirmedOnce) return; // latch closed — no resurrect
      editing = true;
      editDraft = transcript;
      render();
    },
    onSave: () => {
      if (!editing) return;
      const draft = editDraft ?? '';
      const validity = validateTranscriptEdit(draft);
      if (!validity.ok) {
        render(); // surface the exact error; nothing submitted
        return;
      }
      submitConfirmed(draft);
    },
    onEditChange: (text) => {
      if (!editing) return; // stale keystroke from a closed editor — ignore
      editDraft = text;
      render();
    },
    onCancel: () => {
      if (!editing) return;
      editing = false;
      editDraft = null;
      render();
    },
    onTryAgain: () => {
      // Restart real capture: the machine's defined semantics from
      // `confirming` discard only the unconfirmed transcript (nothing was
      // submitted — the latch is untouched by design: a retry is a NEW
      // utterance for the SAME question, still unconfirmed).
      machine.transition({ type: 'ptt:start' });
      options.retryTranscription?.();
      editing = false;
      editDraft = null;
      render();
    },
  });

  /**
   * The single submission gate. Flips the latch BEFORE the transport runs
   * so nothing can re-enter: the same event turn, the same question, one
   * answer (spec 5.1/6, E.1 WS-18 "counted exactly once").
   */
  function submitConfirmed(text: string | null): void {
    if (confirmedOnce) return; // closed (double-belt, also guarded in UI)
    if (text === null || text.length === 0) return; // never submit blank (spec 20)
    const maybe = machine.transition({ type: 'answer:confirmed', transcript: text });
    if (maybe === null) return; // machine refused (e.g. not in interview)
    confirmedOnce = true;
    options.submitTranscript?.(text);
    editing = false;
    editDraft = null;
    render();
  }

  function render(): void {
    const state = machine.getState();
    const model = transcriptModel(state, {
      editDraft: editing ? editDraft : null,
      submittedOnce: confirmedOnce,
    });
    view.setModel(model);
  }

  // The machine is a pure reducer and exposes transition() only; the
  // controller re-renders on its own entry points (handle/render) and on
  // question re-arm — every real transition this lane cares about passes
  // through `handle` or the machine events it fires itself.

  return {
    handle(event) {
      machine.transition(event);
      // Re-arm on a new question (the latch is per-question, never
      // per-session: spec 5.1 counts answers, not sessions).
      if (event.type === 'question:received' || event.type === 'question:recovered') {
        confirmedOnce = false;
        editing = false;
        editDraft = null;
      } else if (event.type === 'answer:confirmed') {
        // An answer confirmed through ANY path closes the latch in the
        // same turn — a later stale USE ANSWER / SAVE click is a no-op
        // (spec 5.1/6 no-double-count, E.1 WS-18 exactly once).
        confirmedOnce = true;
        editing = false;
        editDraft = null;
      }
      render();
    },
    render,
    model: () =>
      transcriptModel(machine.getState(), {
        editDraft: editing ? editDraft : null,
        submittedOnce: confirmedOnce,
      }),
    confirmedOnce: () => confirmedOnce,
    destroy: () => view.destroy(),
  };
}
