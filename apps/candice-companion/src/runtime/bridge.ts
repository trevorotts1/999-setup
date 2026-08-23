/**
 * Webview side of the authenticated local MCP bridge. Native code authenticates
 * the socket before emitting an event; this module still validates every event
 * before it can create a visible answer surface or send an answer back.
 */

import type { CandiceStateMachine } from '../state/machine.ts';
import { createAnswerControlsController, type AnswerControlsController } from '../ui/answer-controls/index.ts';
import type { AnswerMethod } from '../ui/answer-controls/config.ts';
import type { CaptureConsent } from '../ui/answer-controls/consent.ts';

interface BridgeQuestion {
  schemaVersion: '1.0';
  sessionId: string;
  questionKey: string;
  text: string;
  allowedInputModes: readonly string[];
}

interface BridgeCancellation {
  sessionId: string;
  questionKey: string;
}

function parseQuestion(payload: unknown): BridgeQuestion | null {
  if (!payload || typeof payload !== 'object') return null;
  const outer = payload as { type?: unknown; version?: unknown; question?: unknown };
  if (outer.type !== 'question' || outer.version !== '1.0' || !outer.question || typeof outer.question !== 'object') return null;
  const question = outer.question as Record<string, unknown>;
  if (
    question.schemaVersion !== '1.0'
    || typeof question.sessionId !== 'string' || question.sessionId.length === 0
    || typeof question.questionKey !== 'string' || !/^[A-Z][A-Z0-9_-]*$/.test(question.questionKey)
    || typeof question.text !== 'string' || question.text.length === 0
    || !Array.isArray(question.allowedInputModes)
  ) return null;
  return question as unknown as BridgeQuestion;
}

/** Accept only a native cancellation for an exact opaque bridge question. */
function parseCancellation(payload: unknown): BridgeCancellation | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as Record<string, unknown>;
  if (
    typeof value.sessionId !== 'string' || value.sessionId.length === 0
    || typeof value.questionKey !== 'string' || !/^[A-Z][A-Z0-9_-]*$/.test(value.questionKey)
  ) return null;
  return { sessionId: value.sessionId, questionKey: value.questionKey };
}

/**
 * FIX-014 (I-11): the persisted convenience values the answer surface
 * consumes, and the voice-toggle report the profile lane persists.
 */
export interface BridgePreferencesHooks {
  /** Remembered convenience only; never a lock (spec 5.1). */
  lastUsedMethod?: AnswerMethod | null;
  /** Separate persistent toggle (spec 5.2). */
  voiceEnabled?: boolean;
  /** The WS-40 profile lane owns persistence; the bridge only reports. */
  onVoiceToggleChange?: (voiceEnabled: boolean) => void;
}

/**
 * QFIX Q-02 (design 2.2): the consent transport the answer surface uses.
 * The composition injects the orchestrator's `queryConsent` here so the
 * sole-caller rule holds — the bridge never invokes a `cmd_speech_*`
 * command itself.
 */
export interface BridgeSpeechHooks {
  queryConsent?: () => CaptureConsent | Promise<CaptureConsent>;
}

/** Mount answer controls only after native delivered an authenticated question. */
export async function initializeAuthenticatedBridge(
  root: HTMLElement,
  machine: CandiceStateMachine,
  prefs: BridgePreferencesHooks & BridgeSpeechHooks = {},
): Promise<() => void> {
  const [{ listen }, { invoke }] = await Promise.all([
    import('@tauri-apps/api/event'),
    import('@tauri-apps/api/core'),
  ]);
  let controls: AnswerControlsController | null = null;
  let active: BridgeQuestion | null = null;
  let submitted = false;

  const closeControls = async (): Promise<void> => {
    const closing = active;
    controls?.destroy();
    controls = null;
    try { await invoke('cmd_set_answer_input_enabled', { enabled: false }); } catch { /* native disconnect fails closed */ }
    // Do not release native admission until click-through is restored. This
    // keeps a second inbound question from being acknowledged during teardown.
    active = null;
    submitted = false;
    if (closing) {
      try {
        await invoke('cmd_release_bridge_question', {
          sessionId: closing.sessionId,
          questionKey: closing.questionKey,
        });
      } catch { /* native disconnect/cancellation has already failed closed */ }
    }
  };

  const isCurrent = (question: BridgeQuestion): boolean => (
    active !== null && active.sessionId === question.sessionId && active.questionKey === question.questionKey
  );

  const present = async (payload: unknown): Promise<void> => {
    const question = parseQuestion(payload);
    if (!question || active !== null) return;
    active = question;
    submitted = false;
    machine.transition({ type: 'question:received', question: question.text });
    try { await invoke('cmd_set_answer_input_enabled', { enabled: true }); } catch {
      machine.transition({ type: 'bridge:unavailable' });
      await closeControls();
      return;
    }
    // A server timeout may have cancelled this question while the native
    // input-policy IPC call was in flight. Never mount a late answer surface.
    if (!isCurrent(question)) {
      try { await invoke('cmd_set_answer_input_enabled', { enabled: false }); } catch { /* fail closed */ }
      return;
    }
    // FIX-014 (I-13 mount bug): the answer-controls view clears its mount on
    // creation (`mount.innerHTML = ''`), so it gets a DEDICATED container —
    // never the shared #app root, which also hosts the captions live region
    // and the gesture stage. A delivered question must not wipe them.
    const controlsMount = document.createElement('div');
    controlsMount.id = 'candice-answer-controls-mount';
    root.append(controlsMount);
    controls = createAnswerControlsController({
      machine,
      mount: controlsMount,
      lastUsedMethod: prefs.lastUsedMethod ?? null,
      voiceEnabled: prefs.voiceEnabled,
      onVoiceToggleChange: prefs.onVoiceToggleChange,
      // FIX-015 FAIL-5 (plan 3D): consult the native capture-lane fact on
      // every HOLD TO TALK press. A denied/no-device/error report blocks
      // the press and leaves the typed-answer surface exactly as it was;
      // a failed query blocks too (fail closed, mic never opens on an
      // unknown consent state).
      captureConsent: {
        // QFIX Q-02 (design 2.2): the consent query routes through the
        // orchestrator's sole-caller seam. The composition always supplies
        // it; the inline fallback keeps the fail-closed contract for legacy
        // callers without a wired orchestrator.
        query: prefs.queryConsent ?? (async (): Promise<CaptureConsent> => 'error'),
      },
      submitAnswer: (text) => {
        if (!active || submitted || text.trim().length === 0) return;
        submitted = true;
        const current = active;
        void invoke('cmd_submit_bridge_answer', {
          request: {
            sessionId: current.sessionId,
            questionKey: current.questionKey,
            answer: {
              schemaVersion: '1.0', sessionId: current.sessionId, questionKey: current.questionKey,
              answerText: text, inputMode: 'typed', userConfirmedTranscript: true,
            },
          },
        }).then(closeControls).catch(() => {
          submitted = false;
          machine.transition({ type: 'bridge:unavailable' });
        });
      },
      delegateToClaude: () => {
        if (!active || submitted) return;
        submitted = true;
        const current = active;
        void invoke('cmd_cancel_bridge_question', { sessionId: current.sessionId, questionKey: current.questionKey })
          .finally(closeControls);
      },
    });
  };
  const unlisten = await listen<unknown>('candice:bridge-question', (event) => { void present(event.payload); });
  const unlistenCancel = await listen<unknown>('candice:bridge-cancel', (event) => {
    const cancelled = parseCancellation(event.payload);
    if (!cancelled || !active
      || cancelled.sessionId !== active.sessionId
      || cancelled.questionKey !== active.questionKey) return;
    // This is an authenticated server-side timeout/cancellation, not user
    // intent. Clear the machine's pending question before destroying its
    // controls, and restore transparent click-through through closeControls.
    machine.transition({ type: 'bridge:cancelled' });
    void closeControls();
  });
  // An event emitted before WebView initialization is retrieved exactly once.
  // Register first, then take the pending value so neither ordering loses it.
  await present(await invoke('cmd_take_pending_bridge_question'));
  return () => { unlisten(); unlistenCancel(); void closeControls(); };
}

export { parseQuestion, parseCancellation };
