/**
 * Runtime composition root (FIX-009).
 *
 * This intentionally has no answer-submission method. FIX-011 will attach a
 * verified same-session bridge; until it does, this root exposes that absence
 * to the visual shell without hiding the approved companion artwork.
 */

import type { CandiceStateMachine } from '../state/machine.ts';
import {
  probeRuntimeCapabilities,
  type RuntimeCapabilities,
  type RuntimeInvokeAdapter,
} from './capabilities.ts';
import { initializeAuthenticatedBridge } from './bridge.ts';
import { initializeSpeechRuntime, type SpeechRuntime } from './speech-runtime.ts';

export interface RuntimeCompositionOptions {
  invokeAdapter?: RuntimeInvokeAdapter;
  /**
   * Speech runtime seam (FIX-015). Optional: tests and headless runs may
   * omit it; the visual shell stays fully usable (spec 20 fail closed).
   */
  speech?: { invokeAdapter?: import('./speech-runtime.ts').SpeechInvokeAdapter };
}

export async function initializeRuntimeComposition(
  root: HTMLElement,
  machine: CandiceStateMachine,
  options: RuntimeCompositionOptions = {},
): Promise<RuntimeCapabilities> {
  const capabilities = await probeRuntimeCapabilities(options.invokeAdapter);
  root.dataset.runtimeContractVersion = capabilities.contractVersion;
  root.dataset.runtimeComposition = 'active';
  root.dataset.bridgeAvailable = String(capabilities.bridgeAvailable);
  root.dataset.answerRoundTripAvailable = String(capabilities.answerRoundTripAvailable);

  const status = document.createElement('p');
  status.id = 'candice-runtime-status';
  status.className = 'candice-runtime-status candice-status-surface';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = runtimeStatusText(capabilities);
  root.append(status);

  // FIX-015 speech seam: mount the duplex controller and probe the native
  // speech boundary once. Failure is silent capability absence — the shell
  // never blocks composition on speech (spec 20).
  let speech: SpeechRuntime | null = null;
  try {
    speech = await initializeSpeechRuntime(options.speech?.invokeAdapter);
    root.dataset.speechSeam = 'active';
    if (speech.health) {
      root.dataset.speechStatus = speech.health.degraded ? 'degraded' : 'available';
      root.dataset.canonicalVoiceApproval = speech.health.canonicalVoiceApproval;
    } else {
      root.dataset.speechStatus = 'unprobed';
    }
    // The FIX-014 PTT lane owns the control surface; this seam only
    // exposes the controller for shell wiring. The duplex controller
    // gates every press (including interrupts) — mounted here so the
    // capture path is reached through one authority.
    speech.attachSpeechTarget({
      abort: () => {
        // FIX-017 boundary applied by the caller before any speak;
        // abort here stops the engine handle synchronously.
        speech?.detachSpeechTarget();
      },
      stop: async () => ({ stoppedAtMs: Date.now() }),
    });
  } catch {
    root.dataset.speechStatus = 'unavailable';
  }

  // The event listener itself is inert until native has authenticated the
  // local launch token and the MCP server delivers a validated question.
  // A connected transport does not by itself display controls or invent a
  // session; those conditions are met only by the delivered event.
  await initializeAuthenticatedBridge(root, machine);

  return capabilities;
}

export function runtimeStatusText(capabilities: RuntimeCapabilities): string {
  if (capabilities.rejectedLaunchReason) {
    return 'Candice wake request was rejected. Continue in Claude text mode.';
  }
  if (!capabilities.bridgeAvailable) {
    return 'Candice visual shell is available. Session bridge is unavailable; continue in Claude text mode.';
  }
  // This branch is deliberately defensive: the parser does not permit a
  // false-ready answer path to be inferred from a bridge alone.
  return capabilities.answerRoundTripAvailable
    ? 'Candice session bridge is available.'
    : 'Candice session bridge is connected without answer submission.';
}
