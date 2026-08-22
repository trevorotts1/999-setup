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

export interface RuntimeCompositionOptions {
  invokeAdapter?: RuntimeInvokeAdapter;
}

export async function initializeRuntimeComposition(
  root: HTMLElement,
  _machine: CandiceStateMachine,
  options: RuntimeCompositionOptions = {},
): Promise<RuntimeCapabilities> {
  const capabilities = await probeRuntimeCapabilities(options.invokeAdapter);
  root.dataset.runtimeContractVersion = capabilities.contractVersion;
  root.dataset.runtimeComposition = 'active';
  root.dataset.bridgeAvailable = String(capabilities.bridgeAvailable);
  root.dataset.answerRoundTripAvailable = String(capabilities.answerRoundTripAvailable);

  const status = document.createElement('p');
  status.id = 'candice-runtime-status';
  status.className = 'candice-runtime-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = runtimeStatusText(capabilities);
  root.append(status);

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
