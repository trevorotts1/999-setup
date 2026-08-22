/**
 * Webview side of the authenticated local MCP bridge. Native code authenticates
 * the socket before emitting an event; this module still validates every event
 * before it can create a visible answer surface or send an answer back.
 */

import type { CandiceStateMachine } from '../state/machine.ts';
import { createAnswerControlsController, type AnswerControlsController } from '../ui/answer-controls/index.ts';

interface BridgeQuestion {
  schemaVersion: '1.0';
  sessionId: string;
  questionKey: string;
  text: string;
  allowedInputModes: readonly string[];
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

/** Mount answer controls only after native delivered an authenticated question. */
export async function initializeAuthenticatedBridge(
  root: HTMLElement,
  machine: CandiceStateMachine,
): Promise<() => void> {
  const [{ listen }, { invoke }] = await Promise.all([
    import('@tauri-apps/api/event'),
    import('@tauri-apps/api/core'),
  ]);
  let controls: AnswerControlsController | null = null;
  let active: BridgeQuestion | null = null;
  let submitted = false;

  const closeControls = async (): Promise<void> => {
    controls?.destroy();
    controls = null;
    active = null;
    submitted = false;
    try { await invoke('cmd_set_answer_input_enabled', { enabled: false }); } catch { /* native disconnect fails closed */ }
  };

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
    controls = createAnswerControlsController({
      machine,
      mount: root,
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
  // An event emitted before WebView initialization is retrieved exactly once.
  // Register first, then take the pending value so neither ordering loses it.
  await present(await invoke('cmd_take_pending_bridge_question'));
  return () => { unlisten(); void closeControls(); };
}

export { parseQuestion };
