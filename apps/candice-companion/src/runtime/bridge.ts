/**
 * Webview side of the authenticated local MCP bridge. Native code authenticates
 * the socket before emitting an event; this module still validates every event
 * before it can create a visible answer surface or send an answer back.
 *
 * FIX-013 S4: every visible surface is keyed by the exact operation identity
 * `(sessionId, questionKey, operationId)`; a native cancel clears the matching
 * pending UI by that identity and restores click-through. A replayed question
 * (the same operation after a reconnect) is surfaced as a recovery with the
 * lease id, and the native `recovered` acknowledgement is sent before the
 * controls are made interactive again — the exact handoff is acknowledged
 * before the surface is usable.
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

interface BridgeIdentity {
  sessionId: string;
  questionKey: string;
  operationId?: string;
}

interface BridgeLifecycleEvent {
  lifecycle: string;
  sessionId?: string;
  leaseId?: string;
  operationId?: string;
  questionKey?: string;
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
function parseCancellation(payload: unknown): BridgeIdentity | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as Record<string, unknown>;
  if (
    typeof value.sessionId !== 'string' || value.sessionId.length === 0
    || typeof value.questionKey !== 'string' || !/^[A-Z][A-Z0-9_-]*$/.test(value.questionKey)
  ) return null;
  const identity: BridgeIdentity = { sessionId: value.sessionId, questionKey: value.questionKey };
  if (typeof value.operationId === 'string' && value.operationId.length > 0) identity.operationId = value.operationId;
  return identity;
}

function parseLifecycle(payload: unknown): BridgeLifecycleEvent | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.lifecycle !== 'string' || value.lifecycle.length === 0) return null;
  const event: BridgeLifecycleEvent = { lifecycle: value.lifecycle };
  if (typeof value.sessionId === 'string') event.sessionId = value.sessionId;
  if (typeof value.leaseId === 'string') event.leaseId = value.leaseId;
  if (typeof value.operationId === 'string') event.operationId = value.operationId;
  if (typeof value.questionKey === 'string') event.questionKey = value.questionKey;
  return event;
}

const identityKey = (identity: BridgeIdentity): string =>
  `${identity.sessionId}::${identity.questionKey}`;

const sameIdentity = (a: BridgeIdentity, b: BridgeIdentity): boolean =>
  a.sessionId === b.sessionId && a.questionKey === b.questionKey;

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
  let active: (BridgeQuestion & { operationId?: string }) | null = null;
  let submitted = false;
  /** Set while a replayed question is awaiting its native recovered ack. */
  let awaitingRecovery = false;

  const closeControls = async (): Promise<void> => {
    const closing = active;
    controls?.destroy();
    controls = null;
    try { await invoke('cmd_set_answer_input_enabled', { enabled: false }); } catch { /* native disconnect fails closed */ }
    // Do not release native admission until click-through is restored. This
    // keeps a second inbound question from being acknowledged during teardown.
    active = null;
    submitted = false;
    awaitingRecovery = false;
    if (closing) {
      try {
        await invoke('cmd_release_bridge_question', {
          sessionId: closing.sessionId,
          questionKey: closing.questionKey,
          operationId: closing.operationId ?? null,
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
    const outer = payload as { operationId?: unknown; replayed?: unknown; leaseId?: unknown };
    const operationId = typeof outer.operationId === 'string' && outer.operationId.length > 0
      ? outer.operationId
      : undefined;
    const replayed = outer.replayed === true;
    const leaseId = typeof outer.leaseId === 'string' && outer.leaseId.length > 0
      ? outer.leaseId
      : undefined;
    active = { ...question, operationId };
    submitted = false;
    awaitingRecovery = replayed;
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
    // A replayed question is the SAME operation after a reconnect. The
    // recovery handoff must be acknowledged against the exact operation and
    // lease BEFORE the surface is interactive: the record leaves `recovering`
    // only on the acknowledged handoff. If the ack fails, the controls stay
    // un-mounted and the session fails closed.
    if (replayed) {
      try {
        await invoke('cmd_ack_replayed_question', {
          sessionId: question.sessionId,
          questionKey: question.questionKey,
          operationId,
          leaseId,
        });
      } catch {
        machine.transition({ type: 'bridge:unavailable' });
        await closeControls();
        return;
      }
      awaitingRecovery = false;
      machine.transition({ type: 'status', detail: 'recovering' });
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
            operationId: current.operationId ?? null,
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
        void invoke('cmd_cancel_bridge_question', {
          sessionId: current.sessionId,
          questionKey: current.questionKey,
          operationId: current.operationId ?? null,
        }).finally(closeControls);
      },
    });
  };
  const unlisten = await listen<unknown>('candice:bridge-question', (event) => { void present(event.payload); });
  const unlistenCancel = await listen<unknown>('candice:bridge-cancel', (event) => {
    const cancelled = parseCancellation(event.payload);
    if (!cancelled || !active || !sameIdentity(cancelled, active)) return;
    // Native cancellation carries the exact operation identity when the
    // server sent it; a mismatched operation id is never applied to a
    // different surface. A native cancel with no operation id still applies
    // only when the keys match exactly (the server always sends the id when
    // it has one).
    if (cancelled.operationId !== undefined && active.operationId !== undefined
      && cancelled.operationId !== active.operationId) return;
    // This is an authenticated server-side timeout/cancellation, not user
    // intent. Clear the machine's pending question before destroying its
    // controls, and restore transparent click-through through closeControls.
    machine.transition({ type: 'bridge:cancelled' });
    void closeControls();
  });
  const unlistenLifecycle = await listen<unknown>('candice:bridge-lifecycle', (event) => {
    const lifecycle = parseLifecycle(event.payload);
    if (!lifecycle) return;
    if (lifecycle.lifecycle === 'disconnected') {
      machine.transition({ type: 'bridge:unavailable' });
    } else if (lifecycle.lifecycle === 'connected' || lifecycle.lifecycle === 'recovered') {
      machine.transition({ type: 'bridge:restored' });
    } else if (lifecycle.lifecycle === 'ended') {
      machine.transition({ type: 'session:end' });
    }
  });
  // An event emitted before WebView initialization is retrieved exactly once.
  // Register first, then take the pending value so neither ordering loses it.
  await present(await invoke('cmd_take_pending_bridge_question'));
  return () => { unlisten(); unlistenCancel(); unlistenLifecycle(); void closeControls(); };
}

export { parseQuestion, parseCancellation, parseLifecycle };
