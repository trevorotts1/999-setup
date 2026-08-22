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
import { AssetRegistry } from '../../assets/candice/loader.ts';
import {
  GESTURE_CHARACTER_CLASS,
  mountGestureStage,
} from '../shell/gesture-stage.ts';
import {
  bindStatusFlow,
  type GestureStageHost,
} from '../shell/candice-composition.ts';
import { createCaptionsController } from '../ui/captions/index.ts';
import { defaultProfile } from '../prefs/profile.ts';

/**
 * FIX-014 (I-13): the exact setup-check greeting from the protocol fixture
 * (`packages/candice-protocol/tests/fixtures/status-event.valid.json`).
 * Shown as the first caption at boot, before any machine effect exists.
 */
const SETUP_CHECK_GREETING =
  "Hi, I'm Candice. Give me just a moment while I make sure everything is set up properly for us to work together.";

export interface RuntimeCompositionOptions {
  invokeAdapter?: RuntimeInvokeAdapter;
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

  // Animation host (FIX-016): bind the gesture stage to the machine only
  // after the backend handshake, per the audit repair plan. Shell errors
  // while the host is attached return the machine to its original
  // transition surface so the text fallback cannot drive stale layers.
  // Reduced motion is owned by the WS-14 runtime in main.ts, which
  // applies the class to `<html>` before this root runs; the driver
  // reads it through the stage's ownerDocument root.
  const character = document.querySelector<HTMLElement>(`.${GESTURE_CHARACTER_CLASS}`);
  let host: GestureStageHost | null = null;
  let unbind: (() => void) | null = null;
  const detachHost = (): void => {
    unbind?.();
    unbind = null;
    host?.detach();
    host = null;
  };
  window.addEventListener('candice:shell-error', detachHost, { once: true });
  if (character) {
    try {
      host = mountGestureStage({
        document,
        character,
        registry: AssetRegistry.create(),
        reportShellError: () => {
          window.dispatchEvent(new Event('candice:shell-error'));
        },
      });
      unbind = bindStatusFlow(machine, host);
    } catch {
      host = null;
      unbind = null;
    }
  }

  // FIX-014 (step 6): one persistent caption live region. The captions view
  // clears its mount on creation, so it gets a DEDICATED mount element —
  // never the shared #app root (the answer-controls view also clears its
  // mount). The controller wraps the machine's transition surface so every
  // real transition renders captions from `machine.lastEffects`; the
  // original transition stays the single authority (mirror of
  // `bindStatusFlow`). Installed BEFORE the bridge so bridge-driven
  // `question:received` transitions render captions.
  const captionsMount = document.createElement('div');
  captionsMount.id = 'candice-captions-mount';
  root.append(captionsMount);
  const captions = createCaptionsController({
    machine,
    mount: captionsMount,
    textScale: defaultProfile().textSize ?? 'medium',
    initialCaption: SETUP_CHECK_GREETING,
  });
  const originalTransition = machine.transition.bind(machine);
  machine.transition = (event) => {
    const result = originalTransition(event);
    if (result !== null) captions.render();
    return result;
  };

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
